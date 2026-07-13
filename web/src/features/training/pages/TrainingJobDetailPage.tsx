import { useCallback, useEffect, useRef, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import {
  ArrowLeft,
  Archive,
  AlertTriangle,
  Clipboard,
  Cloud,
  Cpu,
  Download,
  FileArchive,
  HardDrive,
  RefreshCw,
  RotateCcw,
  Rocket,
  Clock,
  UploadCloud,
  Loader2,
  CheckCircle,
  XCircle,
  ScrollText,
  Activity,
  Settings,
  Info,
} from 'lucide-react';
import type { ReactNode } from 'react';

import { Button } from '@/shared/ui/Button';
import {
  getTrainingJob,
  getTrainingJobEvents,
  getTrainingJobLogs,
  getTrainingJobMetrics,
  getTrainingJobDownloadUrl,
  deleteTrainingJob,
  restoreTrainingJob,
  refreshTrainingJobStatus,
  registerTrainingJobModel,
} from '@/features/training/api/trainingApi';
import {
  triggerModelProjectBuild,
  deployModelProject,
  checkModelEndpointHealth,
  redeployModelProject,
  stopModelEndpoint,
} from '@/features/build-deploy/api/buildDeployApi';
import { getModelEndpointLogs } from '@/features/catalog/api/catalogApi';
import { trainingQueryKeys } from '@/features/training/queryKeys';
import { catalogQueryKeys } from '@/features/catalog/queryKeys';
import { toast } from '@/shared/ui/toastStore';
import { getApiErrorMessage } from '@/shared/api/errors';
import { formatDuration, computeElapsed } from '@/shared/lib/formatDuration';
import type { ModelAccessMode, ModelFlavor } from '@/features/catalog/types';
import type {
  TrainingJob,
  TrainingJobMetricsResponse,
  TrainingJobStatus,
} from '@/features/training/types';

import { ModelDeploymentCard } from '@/features/build-deploy/components/ModelDeploymentCard';
import {
  LiveStatusBadge,
  MetadataRow,
  MilestoneTracker,
  TrainingEventHistory,
} from '@/features/training/components/TrainingOverviewSections';

// -- Shared formatting helpers --
const backendLabel = (backend?: TrainingJob['training_backend']) => backend || 'kubeflow';
const formatMetricPercent = (val: number) => `${Math.round(val)}%`;
const formatMegabytes = (mb: number) => {
  if (mb >= 1024) return `${(mb / 1024).toFixed(1)} GB`;
  return `${Math.round(mb)} MB`;
};

const ACTIVE_STATUSES: TrainingJobStatus[] = ['pending', 'uploading', 'running'];
const AUTO_SYNC_INTERVAL_MS = 3000;

export default function TrainingJobDetailPage() {
  const { t } = useTranslation('training');
  const { jobId } = useParams<{ jobId: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [refreshingSection, setRefreshingSection] = useState<'header' | 'logs' | 'metrics' | null>(null);
  const [activeTab, setActiveTab] = useState<'overview' | 'logs' | 'metrics' | 'artifacts' | 'config'>('overview');
  const [registerModalOpen, setRegisterModalOpen] = useState(false);
  const [registerForm, setRegisterForm] = useState({
    model_name: '',
    model_version: '',
    flavor: 'sklearn' as ModelFlavor,
    access_mode: 'public' as ModelAccessMode,
    description: '',
  });
  const [endpointLogs, setEndpointLogs] = useState('');
  const [endpointLogsOpen, setEndpointLogsOpen] = useState(false);

  const parsedJobId = jobId ?? '';
  const [liveElapsed, setLiveElapsed] = useState<number | null>(null);
  const lastToastedStatus = useRef<string | null>(null);
  const statusLabels: Record<TrainingJobStatus, string> = {
    pending: t('detail.statuses.pending'), queued: t('detail.statuses.queued'), uploading: t('detail.statuses.uploading'),
    running: t('detail.statuses.running'), completed: t('detail.statuses.completed'), failed: t('detail.statuses.failed'),
    cancelled: t('detail.statuses.cancelled'),
  };

  // -- Queries --
  const {
    data: job,
    isLoading: jobLoading,
    error: jobError,
    refetch: refetchJob,
  } = useQuery({
    queryKey: trainingQueryKeys.job(parsedJobId),
    queryFn: () => getTrainingJob(parsedJobId),
    enabled: Boolean(parsedJobId),
    refetchInterval: (query) => {
      const data = query.state.data;
      if (data && ACTIVE_STATUSES.includes(data.status)) return AUTO_SYNC_INTERVAL_MS;
      return false;
    },
  });

  useEffect(() => {
    if (!job?.status) return;
    const nextStatus = job.status;
    const prevStatus = lastToastedStatus.current;
    if (prevStatus && prevStatus !== nextStatus) {
      if (nextStatus === 'completed') toast.success(t('detail.completedToast'));
      else if (nextStatus === 'failed') toast.error(t('detail.failedToast'));
      else if (nextStatus === 'cancelled') toast.warning(t('detail.cancelledToast'));
    }
    lastToastedStatus.current = nextStatus;
  }, [job?.status, t]);

  const {
    data: logsResponse,
    isLoading: loadingLogs,
    refetch: refetchLogs,
  } = useQuery({
    queryKey: trainingQueryKeys.logs(parsedJobId),
    queryFn: () => getTrainingJobLogs(parsedJobId),
    enabled: !!job && (activeTab === 'logs' || ACTIVE_STATUSES.includes(job.status)),
    refetchInterval: () => {
      if (job && ACTIVE_STATUSES.includes(job.status) && activeTab === 'logs') return AUTO_SYNC_INTERVAL_MS;
      return false;
    },
  });

  const {
    data: metrics,
    isLoading: loadingMetrics,
    refetch: refetchMetrics,
  } = useQuery({
    queryKey: trainingQueryKeys.metrics(parsedJobId),
    queryFn: () => getTrainingJobMetrics(parsedJobId),
    enabled: !!job && (activeTab === 'metrics' || ACTIVE_STATUSES.includes(job.status)),
    refetchInterval: () => {
      if (job && ACTIVE_STATUSES.includes(job.status) && activeTab === 'metrics') return AUTO_SYNC_INTERVAL_MS;
      return false;
    },
  });

  const {
    data: eventsResponse,
    refetch: refetchEvents,
  } = useQuery({
    queryKey: trainingQueryKeys.events(parsedJobId),
    queryFn: () => getTrainingJobEvents(parsedJobId),
    enabled: !!job,
    refetchInterval: () => {
      if (job && ACTIVE_STATUSES.includes(job.status)) return AUTO_SYNC_INTERVAL_MS;
      return false;
    },
  });

  // -- Live elapsed ticker for running jobs --
  // Placed AFTER queries so 'job' is in scope
  useEffect(() => {
    if (!job || job.status !== 'running' || !job.started_at) return;
    const startedAt = job.started_at;
    const tick = () => {
      const elapsed = computeElapsed(startedAt);
      setLiveElapsed(elapsed != null ? Math.round(elapsed) : null);
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => {
      clearInterval(id);
      setLiveElapsed(null);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [job?.status, job?.started_at]);

  // -- Mutations --
  
  const handleRefreshHeader = async () => {
    setRefreshingSection('header');
    try {
      await refreshStatusMutation.mutateAsync();
    } finally {
      setRefreshingSection(null);
    }
  };

  const handleRefreshLogs = async () => {
    setRefreshingSection('logs');
    try {
      await refetchLogs();
    } finally {
      setRefreshingSection(null);
    }
  };

  const handleRefreshMetrics = async () => {
    setRefreshingSection('metrics');
    try {
      await refetchMetrics();
    } finally {
      setRefreshingSection(null);
    }
  };

  const refreshStatusMutation = useMutation({
    mutationFn: () => refreshTrainingJobStatus(parsedJobId),
    onSuccess: (data) => {
      queryClient.setQueryData(trainingQueryKeys.job(parsedJobId), data);
      refetchLogs();
      refetchMetrics();
      refetchEvents();
      toast.success(t('detail.refreshed'));
    },
    onError: (err) => {
      toast.error(getApiErrorMessage(err, t('detail.refreshFailed')));
    }
  });

  const downloadMutation = useMutation({
    mutationFn: () => getTrainingJobDownloadUrl(parsedJobId),
    onSuccess: (data) => {
      const link = document.createElement('a');
      link.href = data.download_url;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    },
    onError: (err) => {
      toast.error(getApiErrorMessage(err, t('detail.downloadFailed')));
    },
  });

  const archiveMutation = useMutation({
    mutationFn: () => deleteTrainingJob(parsedJobId),
    onSuccess: () => {
      toast.success(t('detail.archived'));
      refetchJob();
      queryClient.invalidateQueries({ queryKey: trainingQueryKeys.jobs() });
    },
    onError: (err) => {
      toast.error(getApiErrorMessage(err, t('detail.archiveFailed')));
    }
  });

  const registerModelMutation = useMutation({
    mutationFn: () =>
      registerTrainingJobModel(parsedJobId, {
        model_name: registerForm.model_name.trim(),
        model_version: registerForm.model_version.trim(),
        flavor: registerForm.flavor,
        access_mode: registerForm.access_mode,
        description: registerForm.description.trim(),
      }),
    onSuccess: async (model) => {
      toast.success(`Registered ${model.name} ${model.version || 'v1'} as a model.`);
      setRegisterModalOpen(false);
      queryClient.setQueryData(trainingQueryKeys.job(parsedJobId), (current: TrainingJob | undefined) =>
        current ? { ...current, registered_model: model, registered_model_id: model.id } : current,
      );
      await queryClient.invalidateQueries({ queryKey: trainingQueryKeys.jobs() });
      await queryClient.invalidateQueries({ queryKey: catalogQueryKeys.projects() });
      await refetchEvents();
    },
    onError: (err) => {
      toast.error(getApiErrorMessage(err, 'Unable to register training job as model.'));
    },
  });

  const buildRegisteredModelMutation = useMutation({
    mutationFn: (modelId: string) => triggerModelProjectBuild(modelId),
    onSuccess: async (model) => {
      toast.success(`Build started for ${model.name} ${model.version || 'v1'}.`);
      queryClient.setQueryData(trainingQueryKeys.job(parsedJobId), (current: TrainingJob | undefined) =>
        current ? { ...current, registered_model: model, registered_model_id: model.id } : current,
      );
      await queryClient.invalidateQueries({ queryKey: catalogQueryKeys.projects() });
      await refetchJob();
    },
    onError: (err) => {
      toast.error(getApiErrorMessage(err, 'Unable to start package build.'));
    },
  });

  const deployRegisteredModelMutation = useMutation({
    mutationFn: async (modelId: string) => {
      const res = await deployModelProject(modelId);
      let isDeployed = false;
      let attempts = 0;
      while (!isDeployed && attempts < 30) {
        attempts++;
        await new Promise((resolve) => setTimeout(resolve, 2000));
        try {
          const status = await checkModelEndpointHealth(modelId);
          if (status.status === 'deployed') {
            isDeployed = true;
          }
        } catch (err) {
          toast.error(getApiErrorMessage(err, "Endpoint is not healthy yet."));
        }
      }
      if (!isDeployed) throw new Error('Deployment is taking longer than expected.');
      return res;
    },
    onSuccess: async () => {
      toast.success('Model deployed successfully!');
      await queryClient.invalidateQueries({ queryKey: catalogQueryKeys.projects() });
      await refetchJob();
    },
    onError: (err) => {
      toast.error(getApiErrorMessage(err, 'Unable to deploy endpoint.'));
    },
  });

  const checkHealthMutation = useMutation({
    mutationFn: (modelId: string) => checkModelEndpointHealth(modelId),
    onSuccess: async (model) => {
      toast[model.endpoint_status === 'healthy' ? 'success' : 'warning'](
        model.endpoint_status === 'healthy' ? 'Endpoint is healthy.' : 'Endpoint is unhealthy.',
      );
      await queryClient.invalidateQueries({ queryKey: catalogQueryKeys.projects() });
      await refetchJob();
    },
    onError: (err) => toast.error(getApiErrorMessage(err, 'Unable to check endpoint health.')),
  });

  const redeployMutation = useMutation({
    mutationFn: async (modelId: string) => {
      const res = await redeployModelProject(modelId);
      let isDeployed = false;
      let attempts = 0;
      while (!isDeployed && attempts < 30) {
        attempts++;
        await new Promise((resolve) => setTimeout(resolve, 2000));
        try {
          const status = await checkModelEndpointHealth(modelId);
          if (status.status === 'deployed') {
            isDeployed = true;
          }
        } catch (err) {
          toast.error(getApiErrorMessage(err, "Endpoint is not healthy yet."));
        }
      }
      if (!isDeployed) throw new Error('Redeployment is taking longer than expected.');
      return res;
    },
    onSuccess: async () => {
      toast.success('Model redeployed successfully!');
      await queryClient.invalidateQueries({ queryKey: catalogQueryKeys.projects() });
      await refetchJob();
    },
    onError: (err) => toast.error(getApiErrorMessage(err, 'Unable to redeploy endpoint.')),
  });

  const stopEndpointMutation = useMutation({
    mutationFn: (modelId: string) => stopModelEndpoint(modelId),
    onSuccess: async () => {
      toast.success('Endpoint stopped.');
      await queryClient.invalidateQueries({ queryKey: catalogQueryKeys.projects() });
      await refetchJob();
    },
    onError: (err) => toast.error(getApiErrorMessage(err, 'Unable to stop endpoint.')),
  });

  const endpointLogsMutation = useMutation({
    mutationFn: (modelId: string) => getModelEndpointLogs(modelId),
    onSuccess: (payload) => {
      setEndpointLogs(payload.logs || 'No endpoint logs available.');
      setEndpointLogsOpen(true);
    },
    onError: (err) => toast.error(getApiErrorMessage(err, 'Unable to read endpoint logs.')),
  });

  const restoreMutation = useMutation({
    mutationFn: () => restoreTrainingJob(parsedJobId),
    onSuccess: () => {
      toast.success(t('detail.restored'));
      refetchJob();
      queryClient.invalidateQueries({ queryKey: trainingQueryKeys.jobs() });
    },
    onError: (err) => {
      toast.error(getApiErrorMessage(err, t('detail.restoreFailed')));
    }
  });

  const handleCopyUri = useCallback((value: string) => {
    navigator.clipboard.writeText(value);
    toast.success(t('detail.copied'));
  }, [t]);

  const openRegisterModal = () => {
    setRegisterForm({
      model_name: job?.name || '',
      model_version: job?.model_version || 'v1',
      flavor: 'sklearn',
      access_mode: 'public',
      description: job ? `Registered from training job #${job.id}` : '',
    });
    setRegisterModalOpen(true);
  };

  if (!parsedJobId) {
    return (
      <div className="flex h-[80vh] items-center justify-center">
        <p className="text-muted-foreground text-lg font-medium">{t('detail.invalidId')}</p>
      </div>
    );
  }

  if (jobLoading) {
    return (
      <div className="flex h-[80vh] flex-col items-center justify-center gap-4">
        <RefreshCw className="h-8 w-8 animate-spin text-primary" />
        <p className="text-muted-foreground font-medium">{t('detail.loading')}</p>
      </div>
    );
  }

  if (jobError || !job) {
    return (
      <div className="flex h-[80vh] flex-col items-center justify-center gap-4">
        <div className="rounded-full bg-danger-subtle p-4">
          <AlertTriangle className="h-10 w-10 text-danger" />
        </div>
        <p className="text-foreground font-bold text-lg">{t('detail.notFound')}</p>
        <p className="text-muted-foreground max-w-md text-center">
          {t('detail.notFoundDescription')}
        </p>
        <Button onClick={() => navigate('/dashboard/model-training')} variant="secondary" className="mt-2">
          {t('detail.backHistory')}
        </Button>
      </div>
    );
  }

  const elapsedForJob = (j: TrainingJob): number | null => {
    if (j.status === 'running' && liveElapsed != null) return liveElapsed;
    if (j.runtime_seconds) return Math.round(j.runtime_seconds);
    if (j.completed_at && j.started_at) {
      return Math.round((new Date(j.completed_at).getTime() - new Date(j.started_at).getTime()) / 1000);
    }
    return null;
  };

  const getAccentBorderClass = () => {
    if (job.is_deleted) return 'border-t-2 border-t-border';
    if (job.status === 'completed') return 'border-t-2 border-t-emerald-400';
    if (job.status === 'failed') return 'border-t-2 border-t-red-400';
    if (job.status === 'cancelled') return 'border-t-2 border-t-amber-400';
    if (job.status === 'running') return 'border-t-2 border-t-blue-400';
    return 'border-t-2 border-t-border';
  };

  const getMilestones = () => {
    const isCompleted = job.status === 'completed';
    const isFailed = job.status === 'failed';
    const isCancelled = job.status === 'cancelled';
    const isRunning = job.status === 'running';
    const isUploading = job.status === 'uploading';

    const hasStarted = Boolean(job.started_at);
    
    const createdState = 'completed';
    
    let submittedState: 'pending' | 'active' | 'completed' = 'pending';
    if (isUploading) submittedState = 'active';
    else if (isRunning || isCompleted || isFailed || isCancelled) submittedState = 'completed';
    
    let runningState: 'pending' | 'active' | 'completed' | 'skipped' = 'pending';
    if (isRunning) runningState = 'active';
    else if (isCompleted) runningState = 'completed';
    else if (isFailed || isCancelled) {
      runningState = hasStarted ? 'completed' : 'skipped';
    }
    
    let finalLabel = t('detail.milestones.completed');
    let finalState: 'pending' | 'completed' | 'failed' | 'cancelled' = 'pending';
    if (isCompleted) {
      finalState = 'completed';
    } else if (isFailed) {
      finalLabel = t('detail.milestones.failed');
      finalState = 'failed';
    } else if (isCancelled) {
      finalLabel = t('detail.milestones.cancelled');
      finalState = 'cancelled';
    }
    
    const formatTime = (iso?: string | null) => iso ? new Date(iso).toLocaleString() : t('detail.milestones.unavailable');
    const formatDurationDiff = (start?: string | null, end?: string | null) => {
      const elapsed = computeElapsed(start, end ?? undefined);
      return elapsed != null ? formatDuration(elapsed) : undefined;
    };

    return [
      {
        id: 'created',
        label: t('detail.milestones.created'),
        state: createdState as 'completed',
        icon: Clock,
        timestamp: formatTime(job.created_at),
        helper: undefined
      },
      {
        id: 'submitted',
        label: t('detail.milestones.submitted'),
        state: submittedState as 'pending' | 'active' | 'completed',
        icon: UploadCloud,
        timestamp: (submittedState === 'completed' || submittedState === 'active') ? formatTime(job.updated_at) : t('detail.milestones.pending'),
        helper: undefined
      },
      {
        id: 'running',
        label: t('detail.milestones.running'),
        state: runningState as 'pending' | 'active' | 'completed' | 'skipped',
        icon: Loader2,
        timestamp: (runningState === 'completed' || runningState === 'active') ? formatTime(job.started_at) : (runningState === 'skipped' ? t('detail.milestones.skipped') : t('detail.milestones.pending')),
        helper: hasStarted && job.created_at ? t('detail.milestones.startedAfter', { duration: formatDurationDiff(job.created_at, job.started_at) }) : undefined
      },
      {
        id: 'final',
        label: finalLabel,
        state: finalState as 'pending' | 'completed' | 'failed' | 'cancelled',
        icon: finalState === 'failed' || finalState === 'cancelled' ? XCircle : CheckCircle,
        timestamp: (finalState === 'completed' || finalState === 'failed' || finalState === 'cancelled') ? formatTime(job.completed_at) : t('detail.milestones.pending'),
        helper: job.completed_at && job.started_at ? t('detail.milestones.finishedIn', { duration: formatDurationDiff(job.started_at, job.completed_at) }) : undefined
      }
    ];
  };

  const tabs = [
    { id: 'overview', label: t('detail.tabs.overview'), icon: Info },
    { id: 'logs', label: t('detail.tabs.logs'), icon: ScrollText },
    { id: 'metrics', label: t('detail.tabs.metrics'), icon: Activity },
    { id: 'artifacts', label: t('detail.tabs.artifacts'), icon: FileArchive },
    { id: 'config', label: t('detail.tabs.config'), icon: Settings },
  ] as const;

  return (
    <section className="flex w-full flex-1 flex-col space-y-6">
      {/* Back button */}
      <button
        onClick={() => navigate('/dashboard/model-training')}
        className="mb-6 flex items-center gap-2 text-sm font-semibold text-muted-foreground hover:text-foreground transition-colors group"
      >
        <ArrowLeft className="h-4 w-4 text-muted-foreground group-hover:text-muted-foreground group-hover:-translate-x-0.5 transition-all" />
        {t('detail.backTraining')}
      </button>

      {/* Header Card */}
      <div className={`rounded-2xl border border-border bg-surface shadow-sm hover:shadow-md transition-shadow overflow-hidden border-t-4 ${getAccentBorderClass()} ${job.is_deleted ? 'opacity-80 grayscale-[0.2]' : ''}`}>
        <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between p-6 lg:p-8 gap-6 border-b border-border">
          <div className="flex items-start gap-4 min-w-0">
            {/* Model/Job Icon */}
            <div className="hidden sm:flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-muted border border-border text-muted-foreground shadow-inner">
              <Activity className="h-6 w-6" />
            </div>
            
            <div className="flex flex-col min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="text-2xl font-extrabold tracking-tight text-foreground truncate">{job.name}</h1>
                <span className="rounded-full bg-muted px-2.5 py-0.5 text-xs font-bold tracking-wide text-muted-foreground border border-border">
                  {job.model_version}
                </span>
                <span className={`w-fit rounded-full px-2.5 py-0.5 text-[10px] uppercase font-bold tracking-wider ring-1 ${
                  job.is_deleted ? 'bg-muted text-muted-foreground ring-border' :
                  job.status === 'completed' ? 'bg-success-subtle text-success ring-success/20' :
                  job.status === 'failed' ? 'bg-danger-subtle text-danger ring-danger/20' :
                  job.status === 'cancelled' ? 'bg-warning-subtle text-warning ring-warning/20' :
                  job.status === 'running' ? 'bg-primary-subtle text-primary ring-primary/30 animate-pulse' :
                  'bg-primary-subtle text-primary ring-primary/20'
                }`}>
                  {job.is_deleted ? t('detail.statuses.archived') : statusLabels[job.status]}
                </span>
              </div>
              <p className="mt-1 text-xs text-muted-foreground font-medium">
                {t('detail.jobNumber', { id: job.id })}
              </p>
              
              <div className="mt-4 flex flex-wrap items-center gap-3 text-xs font-bold text-muted-foreground">
                <span className="flex items-center gap-1.5 rounded-md border border-border bg-muted px-2 py-1 uppercase tracking-wider">
                  <Cloud className="h-3.5 w-3.5 text-muted-foreground" />
                  {backendLabel(job.training_backend)}
                </span>
                <span className="text-muted-foreground">•</span>
                <span className="flex items-center gap-1.5 rounded-md border border-border bg-muted px-2 py-1 uppercase tracking-wider">
                  <Cpu className="h-3.5 w-3.5 text-muted-foreground" />
                  {job.vcpu} vCPU / {job.memory / 1024} GB
                </span>
                {job.accelerator_type !== 'none' && (
                  <>
                    <span className="text-muted-foreground">•</span>
                    <span className="flex items-center gap-1.5 rounded-md border border-primary/20 bg-primary-subtle px-2 py-1 text-primary uppercase tracking-wider">
                      <Rocket className="h-3.5 w-3.5 text-primary" />
                      {job.accelerator_type.toUpperCase()} x{job.accelerator_count}
                    </span>
                  </>
                )}
              </div>
            </div>
          </div>
          
          <div className="flex shrink-0 flex-col items-end gap-3 mt-2 sm:mt-0">
            {ACTIVE_STATUSES.includes(job.status) && (
              <div className="flex shrink-0 mb-1">
                <LiveStatusBadge />
              </div>
            )}
            <div className="flex flex-wrap items-center justify-end gap-2">
              <Button
                variant="secondary"
                size="sm"
                icon={<RefreshCw className="h-4 w-4" />}
                loading={refreshingSection === 'header'}
                onClick={handleRefreshHeader}
                title={t('detail.refreshStatus')}
              >
                {t('detail.refresh')}
              </Button>
              <Button
                variant={job.status === 'completed' ? 'primary' : 'secondary'}
                size="sm"
                icon={<Download className="h-4 w-4" />}
                disabled={job.status !== 'completed'}
                loading={downloadMutation.isPending}
                onClick={() => downloadMutation.mutate()}
              >
                {t('detail.download')}
              </Button>
            </div>
            {job.is_deleted ? (
              <button onClick={() => restoreMutation.mutate()} disabled={restoreMutation.isPending} className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-muted-foreground hover:text-foreground transition-colors mt-1">
                <RotateCcw className="h-3.5 w-3.5" /> {t('detail.restore')}
              </button>
            ) : (
              <button onClick={() => archiveMutation.mutate()} disabled={archiveMutation.isPending} className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-muted-foreground hover:text-danger transition-colors mt-1">
                <Archive className="h-3.5 w-3.5" /> {t('detail.archive')}
              </button>
            )}
          </div>
        </div>

        {/* Stats Grid */}
        <div className="grid grid-cols-2 lg:grid-cols-4 divide-y lg:divide-y-0 lg:divide-x divide-border bg-muted/50">
          <div className="p-5 flex flex-col justify-center">
            <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground mb-1.5">{t('detail.status')}</p>
            <div className="flex items-center">
               <span className={`w-fit rounded-md px-2.5 py-0.5 text-sm font-bold border ${
                  job.is_deleted ? 'bg-muted text-muted-foreground border-border' :
                  job.status === 'completed' ? 'bg-success-subtle text-success border-success/20' :
                  job.status === 'failed' ? 'bg-danger-subtle text-danger border-danger/20' :
                  job.status === 'cancelled' ? 'bg-warning-subtle text-warning border-warning/20' :
                  job.status === 'running' ? 'bg-primary-subtle text-primary border-primary/20' :
                  'bg-surface text-foreground border-border'
                }`}>
                  {job.is_deleted ? t('detail.statuses.archived') : statusLabels[job.status]}
                </span>
            </div>
          </div>
          <div className="p-5 flex flex-col justify-center">
            <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground mb-1">{t('detail.runtimeElapsed')}</p>
            <p className="text-xl font-bold text-foreground">{formatDuration(elapsedForJob(job)) || '-'}{job.status === 'running' && <span className="ml-1 text-xs font-normal text-primary animate-pulse">{t('detail.live')}</span>}</p>
          </div>
          <div className="p-5 flex flex-col justify-center">
            <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground mb-1">{t('detail.maxRuntime')}</p>
            <p className="text-xl font-bold text-foreground">{formatDuration(job.max_runtime_seconds)}</p>
          </div>
          <div className="p-5 flex flex-col justify-center">
            <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground mb-1">{t('detail.createdAt')}</p>
            <p className="text-sm font-bold text-foreground">{new Date(job.created_at).toLocaleString()}</p>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="border-b border-border mt-2">
        <nav className="-mb-px flex space-x-8 px-2 overflow-x-auto scrollbar-none" aria-label={t('detail.tabsLabel')}>
          {tabs.map((tab) => {
            const Icon = tab.icon;
            const isActive = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id as 'overview' | 'logs' | 'metrics' | 'artifacts' | 'config')}
                className={`group inline-flex items-center border-b-2 py-4 px-1 text-sm font-bold transition-colors whitespace-nowrap ${
                  isActive
                    ? 'border-primary text-foreground'
                    : 'border-transparent text-muted-foreground hover:border-border hover:text-foreground'
                }`}
              >
                <Icon
                  className={`-ml-0.5 mr-2 h-4 w-4 transition-colors ${
                    isActive ? 'text-foreground' : 'text-muted-foreground group-hover:text-muted-foreground'
                  }`}
                  aria-hidden="true"
                />
                {tab.label}
              </button>
            );
          })}
        </nav>
      </div>

      {/* Tab Content */}
      <div className="min-h-100">
        {activeTab === 'overview' && (
          <div className="space-y-6">
            {job.status === 'failed' && (
              <div className="rounded-xl border border-danger/20 bg-danger-subtle p-5">
                <h4 className="flex items-center gap-2 text-base font-bold text-danger mb-2">
                  <AlertTriangle className="h-5 w-5" />
                  Training Failed
                </h4>
                <p className="text-sm font-medium text-danger mb-3">
                  {job.stop_reason || 'The training job exited unexpectedly.'}
                </p>
                {job.error_message && (
                  <div className="rounded-lg border border-danger/20 bg-surface p-4 overflow-x-auto">
                    <code className="whitespace-pre-wrap wrap-break-words text-xs text-danger font-mono">
                      {job.error_message}
                    </code>
                  </div>
                )}
              </div>
            )}

            {job.status === 'cancelled' && (
              <div className="rounded-xl border border-warning/20 bg-warning-subtle p-5">
                <h4 className="flex items-center gap-2 text-base font-bold text-warning mb-2">
                  <AlertTriangle className="h-5 w-5" />
                  Training Cancelled
                </h4>
                <p className="text-sm font-medium text-warning">
                  {job.stop_reason || 'This training job was cancelled before completion.'}
                </p>
              </div>
            )}

            <div className="rounded-xl border border-border bg-surface shadow-sm overflow-hidden">
              <div className="px-6 py-4 border-b border-border bg-muted/50">
                <h3 className="text-sm font-bold text-foreground uppercase tracking-wider">Job Metadata</h3>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-y-6 gap-x-8 p-6">
                <MetadataRow label="Internal Job ID" value={String(job.id)} />
                <MetadataRow label="External Job ID" value={job.external_job_id || job.sagemaker_job_name || '-'} monospace />
                <MetadataRow label="Model Name" value={job.name} />
                <MetadataRow label="Model Version" value={job.model_version} />
                <MetadataRow label="Backend" value={backendLabel(job.training_backend)} />
                <MetadataRow label="Status" value={statusLabels[job.status]} />
                <MetadataRow label="Created At" value={new Date(job.created_at).toLocaleString()} />
                <MetadataRow label="Updated At" value={new Date(job.updated_at).toLocaleString()} />
                <MetadataRow label="Started At" value={job.started_at ? new Date(job.started_at).toLocaleString() : '-'} />
                <MetadataRow label="Completed At" value={job.completed_at ? new Date(job.completed_at).toLocaleString() : '-'} />
              </div>
            </div>

            {/* Visual Timeline */}
            <div className="rounded-xl border border-border bg-surface shadow-sm overflow-hidden p-6 sm:p-8">
              <h3 className="text-sm font-bold text-foreground mb-6 uppercase tracking-wider">Status Timeline</h3>
              <div className="w-full overflow-x-auto pb-4">
                <MilestoneTracker milestones={getMilestones()} />
              </div>
              {job.status === 'failed' && (job.error_message || job.stop_reason) && (
                <div className="mt-6 rounded-lg border border-danger/20 bg-danger-subtle p-4">
                  <p className="text-xs font-bold uppercase tracking-wider text-danger mb-1 flex items-center gap-1.5"><AlertTriangle className="h-3.5 w-3.5" /> Failure Reason</p>
                  <p className="text-sm font-medium text-danger">{job.error_message || job.stop_reason}</p>
                </div>
              )}
              {job.status === 'cancelled' && job.stop_reason && (
                <div className="mt-6 rounded-lg border border-warning/20 bg-warning-subtle p-4">
                  <p className="text-xs font-bold uppercase tracking-wider text-warning mb-1 flex items-center gap-1.5"><AlertTriangle className="h-3.5 w-3.5" /> Cancel Reason</p>
                  <p className="text-sm font-medium text-warning">{job.stop_reason}</p>
                </div>
              )}
              <TrainingEventHistory events={eventsResponse?.events || []} />
            </div>
          </div>
        )}

        {activeTab === 'logs' && (
          <div className="space-y-4 animate-in fade-in duration-300">
             {job.status === 'failed' && job.stop_reason && (
               <div className="rounded-lg border border-danger/20 bg-danger-subtle p-4 flex gap-3 items-start text-sm text-danger font-medium">
                 <AlertTriangle className="h-5 w-5 shrink-0 text-danger mt-0.5" />
                 <div>
                   <p className="font-bold mb-1 text-danger">Stop Reason</p>
                   <p>{job.stop_reason}</p>
                 </div>
               </div>
             )}
            <LogTerminal 
              text={logsResponse?.text || (ACTIVE_STATUSES.includes(job.status) ? 'Logs will appear after the training container starts...' : 'No logs available for this job.')} 
              loading={loadingLogs || refreshingSection === 'logs'} 
              onRefresh={handleRefreshLogs} 
            />
          </div>
        )}

        {activeTab === 'metrics' && (
          <div className="space-y-4 animate-in fade-in duration-300">
            {!metrics?.metrics_available && ACTIVE_STATUSES.includes(job.status) ? (
              <div className="flex flex-col items-center justify-center py-16 px-4 rounded-xl border border-border border-dashed bg-muted text-center shadow-sm">
                <Activity className="h-10 w-10 text-muted-foreground mb-4" />
                <p className="text-base font-bold text-foreground">Metrics are starting up</p>
                <p className="text-sm text-muted-foreground mt-2 max-w-md">Runtime metrics will appear here automatically once the runner emits them.</p>
              </div>
            ) : !metrics?.metrics_available ? (
              <div className="flex flex-col items-center justify-center py-16 px-4 rounded-xl border border-border bg-surface text-center shadow-sm">
                <Activity className="mb-4 h-10 w-10 text-muted-foreground" />
                <p className="text-base font-bold text-foreground">No metrics available</p>
                <p className="text-sm text-muted-foreground mt-2">This job did not emit any runtime metrics.</p>
              </div>
            ) : (
              <RuntimeMetricsPanel metrics={metrics} loading={loadingMetrics || refreshingSection === 'metrics'} onRefresh={handleRefreshMetrics} />
            )}
          </div>
        )}

        {activeTab === 'artifacts' && (
          <div className="space-y-6 animate-in fade-in duration-300">
            {!job.registered_model ? (
              <div className="rounded-xl border border-primary/20 bg-primary-subtle p-5 mb-6">
                <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <p className="text-sm font-bold text-primary">Deploy this training artifact</p>
                    <p className="mt-1 text-sm text-primary">
                      Register the completed model artifact as a Model API before building and deploying an endpoint.
                    </p>
                  </div>
                  <Button
                    icon={<Rocket className="h-4 w-4" />}
                    loading={registerModelMutation.isPending}
                    onClick={openRegisterModal}
                    disabled={job.status !== 'completed'}
                  >
                    Register as Model
                  </Button>
                </div>
              </div>
            ) : (
              <div className="mb-6">
                <ModelDeploymentCard
                  model={job.registered_model}
                  variant="compact"
                  onBuild={(model) => buildRegisteredModelMutation.mutate(model.id)}
                  isBuilding={buildRegisteredModelMutation.isPending && buildRegisteredModelMutation.variables === job.registered_model.id}
                  onDeploy={(model) => deployRegisteredModelMutation.mutate(model.id)}
                  isDeploying={deployRegisteredModelMutation.isPending && deployRegisteredModelMutation.variables === job.registered_model.id}
                  onRedeploy={(model) => redeployMutation.mutate(model.id)}
                  isRedeploying={redeployMutation.isPending}
                  onStop={(model) => stopEndpointMutation.mutate(model.id)}
                  isStopping={stopEndpointMutation.isPending}
                  onCheckHealth={(model) => checkHealthMutation.mutate(model.id)}
                  isCheckingHealth={checkHealthMutation.isPending}
                  onOpenLogs={(model) => {
                    setEndpointLogs('Loading endpoint logs...');
                    setEndpointLogsOpen(true);
                    endpointLogsMutation.mutate(model.id);
                  }}
                  onOpenApiManagement={(model) => navigate(`/dashboard/api-management/${model.id}`)}
                  onTestPrediction={() => navigate('/dashboard/home/model-testing')}
                />
              </div>
            )}

            <div className="rounded-xl border border-border bg-surface shadow-sm overflow-hidden">
              <div className="px-6 py-4 border-b border-border bg-muted/50 flex flex-wrap gap-4 justify-between items-center">
                <h3 className="text-sm font-bold text-foreground uppercase tracking-wider">Output Artifacts</h3>
                <Button
                  size="sm"
                  icon={<Download className="h-4 w-4" />}
                  disabled={job.status !== 'completed'}
                  loading={downloadMutation.isPending}
                  onClick={() => downloadMutation.mutate()}
                >
                  Download Model
                </Button>
              </div>
              <div className="p-6 space-y-6">
                {job.status === 'completed' ? (
                  <>
                    <div className="space-y-2">
                      <p className="text-xs font-bold text-muted-foreground uppercase tracking-wider">Model Artifact URI</p>
                      <UriLine label="Model URI" value={job.model_artifact_uri} onCopy={handleCopyUri} />
                    </div>
                    <div className="space-y-2">
                      <p className="text-xs font-bold text-muted-foreground uppercase tracking-wider">Output S3 URI</p>
                      <UriLine label="Output URI" value={job.output_s3_uri} onCopy={handleCopyUri} />
                    </div>
                  </>
                ) : (
                  <div className="py-10 text-center">
                    <FileArchive className="mx-auto mb-4 h-10 w-10 text-muted-foreground" />
                    <p className="text-base font-bold text-muted-foreground">Model artifact is not ready yet.</p>
                    <p className="text-sm text-muted-foreground mt-1 max-w-sm mx-auto">Artifacts will be available for download and URI inspection once the training completes successfully.</p>
                  </div>
                )}
              </div>
            </div>

            <div className="rounded-xl border border-border bg-surface shadow-sm overflow-hidden">
              <div className="px-6 py-4 border-b border-border bg-muted/50">
                <h3 className="text-sm font-bold text-foreground uppercase tracking-wider">Source Files</h3>
              </div>
              <div className="p-6 space-y-6">
                <div className="space-y-2">
                  <p className="text-xs font-bold text-muted-foreground uppercase tracking-wider">Source ZIP URI</p>
                  <UriLine label="Source ZIP" value={job.s3_source_uri} onCopy={handleCopyUri} />
                </div>
                {job.s3_training_data_uri && (
                  <div className="space-y-2">
                    <p className="text-xs font-bold text-muted-foreground uppercase tracking-wider">Training Data URI</p>
                    <UriLine label="Data URI" value={job.s3_training_data_uri} onCopy={handleCopyUri} />
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {activeTab === 'config' && (
          <div className="rounded-xl border border-border bg-surface shadow-sm overflow-hidden animate-in fade-in duration-300">
            <div className="px-6 py-4 border-b border-border bg-muted/50">
              <h3 className="text-sm font-bold text-foreground uppercase tracking-wider">Submitted Configuration</h3>
            </div>
            <div className="p-6 space-y-8">
              <div>
                <h4 className="text-xs font-bold uppercase tracking-wider text-muted-foreground mb-4 border-b border-border pb-2">Compute & Runtime</h4>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-y-6 gap-x-8">
                  <MetadataRow label="Training Backend" value={backendLabel(job.training_backend)} />
                  <MetadataRow label="vCPU" value={String(job.vcpu)} />
                  <MetadataRow label="Memory (MB)" value={String(job.memory)} />
                  <MetadataRow label="Max Runtime (Seconds)" value={String(job.max_runtime_seconds)} />
                </div>
              </div>
              <div>
                <h4 className="text-xs font-bold uppercase tracking-wider text-muted-foreground mb-4 border-b border-border pb-2">Accelerator</h4>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-y-6 gap-x-8">
                  <MetadataRow label="Accelerator Type" value={job.accelerator_type === 'none' ? 'None' : job.accelerator_type.toUpperCase()} />
                  {job.accelerator_type !== 'none' && <MetadataRow label="Accelerator Count" value={String(job.accelerator_count)} />}
                </div>
              </div>
              <div>
                <h4 className="text-xs font-bold uppercase tracking-wider text-muted-foreground mb-4 border-b border-border pb-2">Source</h4>
                <div className="grid grid-cols-1 gap-y-6 gap-x-8">
                  <MetadataRow label="Entry Point" value={job.entry_point} monospace />
                </div>
              </div>
            </div>
          </div>
        )}
      </div>

      {registerModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-lg rounded-xl bg-surface p-6 shadow-xl">
            <div className="mb-5">
              <h3 className="text-lg font-bold text-foreground">Register training artifact as model</h3>
              <p className="mt-1 text-sm text-muted-foreground">
                This creates a Model API record first. You can build and deploy it after registration.
              </p>
            </div>
            <div className="space-y-4">
              <label className="block text-sm font-semibold text-foreground">
                Model name
                <input
                  value={registerForm.model_name}
                  onChange={(event) => setRegisterForm((current) => ({ ...current, model_name: event.target.value }))}
                  className="mt-1 w-full rounded-lg border border-border px-3 py-2 text-sm outline-none focus:border-primary"
                />
              </label>
              <label className="block text-sm font-semibold text-foreground">
                Version
                <input
                  value={registerForm.model_version}
                  onChange={(event) => setRegisterForm((current) => ({ ...current, model_version: event.target.value }))}
                  className="mt-1 w-full rounded-lg border border-border px-3 py-2 text-sm outline-none focus:border-primary"
                />
              </label>
              <label className="block text-sm font-semibold text-foreground">
                Flavor
                <select
                  value={registerForm.flavor}
                  onChange={(event) => setRegisterForm((current) => ({ ...current, flavor: event.target.value as ModelFlavor }))}
                  className="mt-1 w-full rounded-lg border border-border px-3 py-2 text-sm outline-none focus:border-primary"
                >
                  <option value="sklearn">Scikit-learn</option>
                  <option value="xgboost">XGBoost</option>
                </select>
              </label>
              <label className="block text-sm font-semibold text-foreground">
                Access mode
                <select
                  value={registerForm.access_mode}
                  onChange={(event) => setRegisterForm((current) => ({ ...current, access_mode: event.target.value as ModelAccessMode }))}
                  className="mt-1 w-full rounded-lg border border-border px-3 py-2 text-sm outline-none focus:border-primary"
                >
                  <option value="public">Public</option>
                  <option value="private">Private</option>
                </select>
              </label>
              <label className="block text-sm font-semibold text-foreground">
                Description
                <textarea
                  value={registerForm.description}
                  onChange={(event) => setRegisterForm((current) => ({ ...current, description: event.target.value }))}
                  className="mt-1 min-h-20 w-full rounded-lg border border-border px-3 py-2 text-sm outline-none focus:border-primary"
                />
              </label>
            </div>
            <div className="mt-6 flex justify-end gap-3">
              <Button variant="secondary" onClick={() => setRegisterModalOpen(false)}>
                Cancel
              </Button>
              <Button
                disabled={!registerForm.model_name.trim() || !registerForm.model_version.trim()}
                loading={registerModelMutation.isPending}
                onClick={() => registerModelMutation.mutate()}
              >
                Register model
              </Button>
            </div>
          </div>
        </div>
      )}

      {endpointLogsOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-4xl rounded-xl bg-surface p-6 shadow-xl">
            <div className="mb-4 flex items-center justify-between">
              <div>
                <h3 className="text-lg font-bold text-foreground">Endpoint logs</h3>
                <p className="text-sm text-muted-foreground">Recent Docker logs for the deployed model endpoint.</p>
              </div>
              <Button variant="secondary" onClick={() => setEndpointLogsOpen(false)}>
                Close
              </Button>
            </div>
            <pre className="max-h-120t overflow-auto rounded-lg bg-primary p-4 text-xs text-green-100">
              {endpointLogs}
            </pre>
          </div>
        </div>
      )}
    </section>
  );
}

// === Reused Components ===

function RuntimeMetricsPanel({
  metrics,
  loading,
  onRefresh,
}: {
  metrics?: TrainingJobMetricsResponse;
  loading: boolean;
  onRefresh: () => void;
}) {
  const isHighCpu = metrics?.latest?.cpu_percent != null && metrics.latest.cpu_percent > 85;
  const isHighRam = metrics?.latest?.memory_percent != null && metrics.latest.memory_percent > 85;

  const latest = metrics?.latest;
  const memoryValue =
    latest?.memory_percent != null
      ? `${formatMetricPercent(latest.memory_percent)}`
      : latest?.memory_used_mb != null
        ? `${formatMegabytes(latest.memory_used_mb)} used`
        : '-';
  const memoryDetail =
    latest?.memory_used_mb != null && latest?.memory_limit_mb != null
      ? `${formatMegabytes(latest.memory_used_mb)} / ${formatMegabytes(latest.memory_limit_mb)}`
      : latest?.memory_used_mb != null
        ? `${formatMegabytes(latest.memory_used_mb)} used`
        : metrics?.message || 'Waiting for runner metrics';
  const gpuValue = latest?.gpu_available && latest.gpu_percent != null ? formatMetricPercent(latest.gpu_percent) : 'N/A';
  const gpuDetail =
    latest?.gpu_available && latest.gpu_memory_used_mb != null && latest.gpu_memory_total_mb != null
      ? `${formatMegabytes(latest.gpu_memory_used_mb)} / ${formatMegabytes(latest.gpu_memory_total_mb)}`
      : 'No GPU detected by runner';

  return (
    <div className="rounded-xl border border-border bg-surface p-6 shadow-sm">
      <div className="mb-6 flex items-center justify-between gap-3 border-b border-border pb-4">
        <p className="flex items-center gap-2 text-sm font-bold uppercase tracking-wider text-foreground">
          <Activity className="h-4 w-4 text-blue-500" />
          Runtime metrics
        </p>
        <div className="flex items-center gap-3">
          <span className="text-xs font-bold text-muted-foreground">
            {latest?.timestamp
              ? `Sampled ${new Date(latest.timestamp).toLocaleTimeString()}`
              : 'Pending metrics...'}
          </span>
          <button
            onClick={onRefresh}
            disabled={loading}
            className="flex h-7 items-center gap-1.5 rounded bg-muted border border-border px-2.5 text-[11px] font-bold text-muted-foreground hover:bg-muted disabled:opacity-50 transition-colors"
          >
            <RefreshCw className={`h-3 w-3 ${loading ? 'animate-spin' : ''}`} />
            Refresh
          </button>
        </div>
      </div>
      <div className="grid gap-4 sm:grid-cols-3">
        <MetricCell
          icon={<Cpu className="h-3.5 w-3.5" />}
          label="CPU"
          value={latest?.cpu_percent == null ? '-' : formatMetricPercent(latest.cpu_percent)}
          detail={latest?.cpu_limit_cores ? `${latest.cpu_limit_cores} vCPU limit` : 'Container CPU usage'}
          warning={isHighCpu}
          progress={latest?.cpu_percent}
          progressColor={isHighCpu ? 'bg-amber-500' : 'bg-emerald-500'}
        />
        <MetricCell
          icon={<HardDrive className="h-3.5 w-3.5" />}
          label="RAM"
          value={memoryValue}
          detail={memoryDetail}
          warning={isHighRam}
          progress={latest?.memory_percent}
          progressColor={isHighRam ? 'bg-red-500' : 'bg-blue-500'}
        />
        <MetricCell
          icon={<Rocket className="h-3.5 w-3.5" />}
          label="GPU"
          value={gpuValue}
          detail={gpuDetail}
          muted={!latest?.gpu_available}
          progress={latest?.gpu_percent}
          progressColor="bg-purple-500"
        />
      </div>
    </div>
  );
}

function MetricCell({
  icon,
  label,
  value,
  detail,
  muted = false,
  warning = false,
  progress,
  progressColor,
}: {
  icon: ReactNode;
  label: string;
  value: string;
  detail: string;
  muted?: boolean;
  warning?: boolean;
  progress?: number | null;
  progressColor?: string;
}) {
  return (
    <div className={`min-w-0 flex flex-col justify-between rounded-xl bg-muted px-5 py-4 border ${warning ? 'border-amber-300 ring-1 ring-amber-100' : 'border-border'} ${muted ? 'opacity-50 grayscale border-dashed' : ''}`}>
      <div>
        <div className="flex items-start justify-between">
          <p className={`flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider ${warning ? 'text-amber-600' : 'text-muted-foreground'}`}>
            {icon}
            {label}
          </p>
          <p className={`truncate text-2xl font-black tracking-tight ${warning ? 'text-amber-700' : muted ? 'text-muted-foreground' : 'text-foreground'}`} title={value}>
            {value}
          </p>
        </div>
        
        {progress != null && !muted && (
          <div className="mt-4 h-1.5 w-full overflow-hidden rounded-full bg-muted">
            <div
              className={`h-full transition-all duration-500 ${progressColor || 'bg-border'}`}
              style={{ width: `${Math.min(100, Math.max(0, progress))}%` }}
            />
          </div>
        )}
      </div>
      
      <p className={`mt-3 truncate text-[11px] font-bold ${warning ? 'text-amber-600/80' : 'text-muted-foreground'}`} title={detail}>
        {detail}
      </p>
    </div>
  );
}

function LogTerminal({
  text,
  loading,
  onRefresh,
}: {
  text: string;
  loading: boolean;
  onRefresh: () => void;
}) {
  const scrollRef = useRef<HTMLPreElement | null>(null);
  const shouldStickToBottomRef = useRef(true);
  const [hasNewLogs, setHasNewLogs] = useState(false);

  useEffect(() => {
    const element = scrollRef.current;
    if (!element) return;
    if (shouldStickToBottomRef.current) {
      element.scrollTop = element.scrollHeight;
      setHasNewLogs(false);
    } else {
      setHasNewLogs(true);
    }
  }, [text]);

  const handleScroll = () => {
    const element = scrollRef.current;
    if (!element) return;
    const distanceFromBottom = element.scrollHeight - element.scrollTop - element.clientHeight;
    const isAtBottom = distanceFromBottom < 80;
    shouldStickToBottomRef.current = isAtBottom;
    if (isAtBottom) setHasNewLogs(false);
  };

  const scrollToBottom = () => {
    const element = scrollRef.current;
    if (!element) return;
    element.scrollTop = element.scrollHeight;
    shouldStickToBottomRef.current = true;
    setHasNewLogs(false);
  };

  const handleCopy = () => {
    navigator.clipboard.writeText(text);
    toast.success('Logs copied to clipboard');
  };

  return (
    <div className="overflow-hidden rounded-xl border border-gray-800 bg-[#0d1117] shadow-md">
      <div className="sticky top-0 z-10 flex items-center justify-between border-b border-gray-800 bg-[#161b22] px-4 py-2.5">
        <div className="flex items-center gap-2.5">
          <ScrollText className="h-4 w-4 text-muted-foreground" />
          <p className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
            Training Output
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={handleCopy}
            className="flex h-7 items-center gap-1.5 rounded bg-gray-800 px-2.5 text-[11px] font-bold text-muted-foreground hover:bg-gray-700 transition-colors"
          >
            <Clipboard className="h-3 w-3" />
            Copy
          </button>
          <button
            onClick={onRefresh}
            disabled={loading}
            className="flex h-7 items-center gap-1.5 rounded bg-gray-800 px-2.5 text-[11px] font-bold text-muted-foreground hover:bg-gray-700 disabled:opacity-50 transition-colors"
          >
            <RefreshCw className={`h-3 w-3 ${loading ? 'animate-spin' : ''}`} />
            Refresh
          </button>
        </div>
      </div>
      <div className="relative">
        <pre
          ref={scrollRef}
          onScroll={handleScroll}
          className="max-h-150 min-h-100 overflow-x-auto overflow-y-auto whitespace-pre p-6 font-mono text-[13px] leading-6 text-muted-foreground"
        >
          {text}
        </pre>
        {hasNewLogs && (
          <button
            type="button"
            onClick={scrollToBottom}
            className="absolute bottom-4 right-4 rounded-full border border-blue-400/40 bg-blue-500 px-3 py-1.5 text-xs font-bold text-white shadow-lg transition hover:bg-blue-400"
          >
            New logs ↓
          </button>
        )}
      </div>
    </div>
  );
}

function UriLine({
  icon,
  label,
  value,
  onCopy,
}: {
  icon?: ReactNode;
  label: string;
  value: string;
  onCopy: (value: string) => void;
}) {
  return (
    <div className="flex w-full min-w-0 items-center justify-between gap-3 rounded-lg border border-border bg-muted px-4 py-2 shadow-sm">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
          {icon}
          {label}
        </div>
        <code className="mt-1 block truncate text-xs sm:text-sm font-semibold text-foreground max-w-50 sm:max-w-md lg:max-w-xl" title={value || '-'}>
          {value || '-'}
        </code>
      </div>
      <button
        type="button"
        className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded border border-border bg-surface text-muted-foreground hover:bg-muted hover:text-foreground shadow-sm transition-all disabled:opacity-40"
        disabled={!value}
        onClick={() => onCopy(value)}
        aria-label={`Copy ${label}`}
      >
        <Clipboard className="h-4 w-4" />
      </button>
    </div>
  );
}
