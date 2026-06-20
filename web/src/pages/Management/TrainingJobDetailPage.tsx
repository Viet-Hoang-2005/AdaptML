import { useCallback, useEffect, useRef, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  ArrowLeft,
  Archive,
  AlertTriangle,
  Clipboard,
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

import { Button } from '../../components/ui/Button';
import {
  getTrainingJob,
  getTrainingJobEvents,
  getTrainingJobLogs,
  getTrainingJobMetrics,
  getTrainingJobDownloadUrl,
  deleteTrainingJob,
  restoreTrainingJob,
  refreshTrainingJobStatus,
} from '../../lib/api';
import { queryKeys } from '../../lib/queryKeys';
import { toast } from '../../lib/toast';
import { getApiErrorMessage } from '../../lib/apiError';
import { formatDuration, computeElapsed } from '../../lib/formatDuration';
import { useTrainingJobRealtime } from '../../hooks/useTrainingJobRealtime';
import type { TrainingJob, TrainingJobEvent, TrainingJobMetricsResponse, TrainingJobStatus } from '../../types/modelApi';

// -- Shared formatting helpers --
const backendLabel = (backend?: TrainingJob['training_backend']) => backend || 'sagemaker';
const formatMetricPercent = (val: number) => `${Math.round(val)}%`;
const formatMegabytes = (mb: number) => {
  if (mb >= 1024) return `${(mb / 1024).toFixed(1)} GB`;
  return `${Math.round(mb)} MB`;
};

const statusLabels: Record<TrainingJobStatus, string> = {
  pending: 'Pending',
  uploading: 'Uploading',
  running: 'Running',
  completed: 'Completed',
  failed: 'Failed',
  cancelled: 'Cancelled',
};

const ACTIVE_STATUSES: TrainingJobStatus[] = ['pending', 'uploading', 'running'];
const AUTO_SYNC_INTERVAL_MS = 5000;

export default function TrainingJobDetailPage() {
  const { jobId } = useParams<{ jobId: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [refreshingSection, setRefreshingSection] = useState<'header' | 'logs' | 'metrics' | null>(null);
  const [activeTab, setActiveTab] = useState<'overview' | 'logs' | 'metrics' | 'artifacts' | 'config'>('overview');

  const parsedJobId = Number(jobId);
  const [liveElapsed, setLiveElapsed] = useState<number | null>(null);
  const lastToastedStatus = useRef<string | null>(null);

  // -- WebSocket realtime hook --
  const { wsStatus } = useTrainingJobRealtime(
    !isNaN(parsedJobId) ? parsedJobId : null,
    {
      onStatusTransition: (prevStatus, nextStatus) => {
        // Only toast once per status transition to avoid duplicates
        const key = `${prevStatus}->${nextStatus}`;
        if (lastToastedStatus.current === key) return;
        lastToastedStatus.current = key;
        if (nextStatus === 'completed') toast.success('Training job completed!');
        else if (nextStatus === 'failed') toast.error('Training job failed.');
        else if (nextStatus === 'cancelled') toast.warning('Training job cancelled.');
      },
    },
  );
  const isPollingFallback = wsStatus !== 'connected';

  // -- Queries --
  const {
    data: job,
    isLoading: jobLoading,
    error: jobError,
    refetch: refetchJob,
  } = useQuery({
    queryKey: [...queryKeys.trainingJobs, 'detail', parsedJobId],
    queryFn: () => getTrainingJob(parsedJobId),
    enabled: !isNaN(parsedJobId),
    refetchInterval: (query) => {
      const data = query.state.data;
      if (!isPollingFallback) return false;
      if (data && ACTIVE_STATUSES.includes(data.status)) return AUTO_SYNC_INTERVAL_MS;
      return false;
    },
  });

  const {
    data: logsResponse,
    isLoading: loadingLogs,
    refetch: refetchLogs,
  } = useQuery({
    queryKey: [...queryKeys.trainingJobs, 'logs', parsedJobId],
    queryFn: () => getTrainingJobLogs(parsedJobId),
    enabled: !!job && (activeTab === 'logs' || ACTIVE_STATUSES.includes(job.status)),
    refetchInterval: () => {
      // Refresh logs actively if on the logs tab and job is active
      if (isPollingFallback && job && ACTIVE_STATUSES.includes(job.status) && activeTab === 'logs') return AUTO_SYNC_INTERVAL_MS;
      return false;
    },
  });

  const {
    data: metrics,
    isLoading: loadingMetrics,
    refetch: refetchMetrics,
  } = useQuery({
    queryKey: [...queryKeys.trainingJobs, 'metrics', parsedJobId],
    queryFn: () => getTrainingJobMetrics(parsedJobId),
    enabled: !!job && (activeTab === 'metrics' || ACTIVE_STATUSES.includes(job.status)),
    refetchInterval: () => {
      // Refresh metrics actively if on the metrics tab and job is active
      if (isPollingFallback && job && ACTIVE_STATUSES.includes(job.status) && activeTab === 'metrics') return AUTO_SYNC_INTERVAL_MS;
      return false;
    },
  });

  const {
    data: eventsResponse,
    refetch: refetchEvents,
  } = useQuery({
    queryKey: [...queryKeys.trainingJobs, 'events', parsedJobId],
    queryFn: () => getTrainingJobEvents(parsedJobId),
    enabled: !!job,
    refetchInterval: () => {
      if (isPollingFallback && job && ACTIVE_STATUSES.includes(job.status)) return AUTO_SYNC_INTERVAL_MS;
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
      queryClient.setQueryData([...queryKeys.trainingJobs, 'detail', parsedJobId], data);
      refetchLogs();
      refetchMetrics();
      refetchEvents();
      toast.success('Job status refreshed');
    },
    onError: (err) => {
      toast.error(getApiErrorMessage(err, 'Failed to refresh job status'));
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
      toast.error(getApiErrorMessage(err, 'Failed to get download URL'));
    },
  });

  const archiveMutation = useMutation({
    mutationFn: () => deleteTrainingJob(parsedJobId),
    onSuccess: () => {
      toast.success('Job archived');
      refetchJob();
      queryClient.invalidateQueries({ queryKey: queryKeys.trainingJobs });
    },
    onError: (err) => {
      toast.error(getApiErrorMessage(err, 'Failed to archive job'));
    }
  });

  const restoreMutation = useMutation({
    mutationFn: () => restoreTrainingJob(parsedJobId),
    onSuccess: () => {
      toast.success('Job restored');
      refetchJob();
      queryClient.invalidateQueries({ queryKey: queryKeys.trainingJobs });
    },
    onError: (err) => {
      toast.error(getApiErrorMessage(err, 'Failed to restore job'));
    }
  });

  const handleCopyUri = useCallback((value: string) => {
    navigator.clipboard.writeText(value);
    toast.success('Copied to clipboard');
  }, []);

  if (isNaN(parsedJobId)) {
    return (
      <div className="flex h-[80vh] items-center justify-center">
        <p className="text-gray-500 text-lg font-medium">Invalid Job ID</p>
      </div>
    );
  }

  if (jobLoading) {
    return (
      <div className="flex h-[80vh] flex-col items-center justify-center gap-4">
        <RefreshCw className="h-8 w-8 animate-spin text-blue-500" />
        <p className="text-gray-500 font-medium">Loading training workspace...</p>
      </div>
    );
  }

  if (jobError || !job) {
    return (
      <div className="flex h-[80vh] flex-col items-center justify-center gap-4">
        <div className="rounded-full bg-red-50 p-4">
          <AlertTriangle className="h-10 w-10 text-red-500" />
        </div>
        <p className="text-gray-900 font-bold text-lg">Job not found or error loading job</p>
        <p className="text-gray-500 max-w-md text-center">
          The training job you are looking for might have been deleted, or you don't have access to it.
        </p>
        <Button onClick={() => navigate('/dashboard/model-training')} variant="secondary" className="mt-2">
          Back to History
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
    if (job.is_deleted) return 'border-t-2 border-t-gray-300';
    if (job.status === 'completed') return 'border-t-2 border-t-emerald-400';
    if (job.status === 'failed') return 'border-t-2 border-t-red-400';
    if (job.status === 'cancelled') return 'border-t-2 border-t-amber-400';
    if (job.status === 'running') return 'border-t-2 border-t-blue-400';
    return 'border-t-2 border-t-gray-200';
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
    
    let finalLabel = 'Completed';
    let finalState: 'pending' | 'completed' | 'failed' | 'cancelled' = 'pending';
    if (isCompleted) {
      finalState = 'completed';
    } else if (isFailed) {
      finalLabel = 'Failed';
      finalState = 'failed';
    } else if (isCancelled) {
      finalLabel = 'Cancelled';
      finalState = 'cancelled';
    }
    
    const formatTime = (iso?: string | null) => iso ? new Date(iso).toLocaleString() : 'Timestamp unavailable';
    const formatDurationDiff = (start?: string | null, end?: string | null) => {
      const elapsed = computeElapsed(start, end ?? undefined);
      return elapsed != null ? formatDuration(elapsed) : undefined;
    };

    return [
      {
        id: 'created',
        label: 'Created',
        state: createdState as 'completed',
        icon: Clock,
        timestamp: formatTime(job.created_at),
        helper: undefined
      },
      {
        id: 'submitted',
        label: 'Submitted',
        state: submittedState as 'pending' | 'active' | 'completed',
        icon: UploadCloud,
        timestamp: (submittedState === 'completed' || submittedState === 'active') ? formatTime(job.updated_at) : 'Pending',
        helper: undefined
      },
      {
        id: 'running',
        label: 'Running',
        state: runningState as 'pending' | 'active' | 'completed' | 'skipped',
        icon: Loader2,
        timestamp: (runningState === 'completed' || runningState === 'active') ? formatTime(job.started_at) : (runningState === 'skipped' ? 'Skipped' : 'Pending'),
        helper: hasStarted && job.created_at ? `Started after ${formatDurationDiff(job.created_at, job.started_at)}` : undefined
      },
      {
        id: 'final',
        label: finalLabel,
        state: finalState as 'pending' | 'completed' | 'failed' | 'cancelled',
        icon: finalState === 'failed' || finalState === 'cancelled' ? XCircle : CheckCircle,
        timestamp: (finalState === 'completed' || finalState === 'failed' || finalState === 'cancelled') ? formatTime(job.completed_at) : 'Pending',
        helper: job.completed_at && job.started_at ? `Finished in ${formatDurationDiff(job.started_at, job.completed_at)}` : undefined
      }
    ];
  };

  const tabs = [
    { id: 'overview', label: 'Overview', icon: Info },
    { id: 'logs', label: 'Logs', icon: ScrollText },
    { id: 'metrics', label: 'Metrics', icon: Activity },
    { id: 'artifacts', label: 'Artifacts', icon: FileArchive },
    { id: 'config', label: 'Config', icon: Settings },
  ] as const;

  return (
    <section className="flex w-full flex-1 flex-col space-y-6">
      {/* Back button */}
      <button
        onClick={() => navigate('/dashboard/model-training')}
        className="mb-6 flex items-center gap-2 text-sm font-semibold text-gray-500 hover:text-gray-900 transition-colors group"
      >
        <ArrowLeft className="h-4 w-4 text-gray-400 group-hover:text-gray-600 group-hover:-translate-x-0.5 transition-all" />
        Back to Model Training
      </button>

      {/* Header Card */}
      <div className={`rounded-xl border border-gray-200 bg-white shadow-md overflow-hidden ${getAccentBorderClass()} ${job.is_deleted ? 'opacity-80 grayscale-[0.2]' : ''}`}>
        <div className="flex flex-col gap-4 border-b border-gray-100 p-6 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-3">
              <h1 className="truncate text-2xl font-extrabold tracking-tight text-gray-900">{job.name}</h1>
              <span className="rounded bg-gray-100 px-2.5 py-0.5 text-sm font-bold tracking-wide text-gray-600 border border-gray-200">
                {job.model_version}
              </span>
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-3 text-sm font-medium text-gray-500">
              <span className="flex items-center gap-1.5 rounded-full border border-gray-200 bg-gray-50 px-3 py-1.5 text-xs font-bold tracking-wider uppercase text-gray-600">
                <Cpu className="h-3.5 w-3.5" />
                {backendLabel(job.training_backend)}
              </span>
              <span className="flex items-center gap-1.5 rounded-full border border-gray-200 bg-gray-50 px-3 py-1.5 text-xs font-bold tracking-wider uppercase text-gray-600">
                {job.vcpu} vCPU / {job.memory / 1024} GB
              </span>
              {job.accelerator_type !== 'none' && (
                <span className="flex items-center gap-1.5 rounded-full border border-purple-200 bg-purple-50 px-3 py-1.5 text-xs font-bold tracking-wider uppercase text-purple-700">
                  <Rocket className="h-3.5 w-3.5" />
                  {job.accelerator_type.toUpperCase()} x{job.accelerator_count}
                </span>
              )}
            </div>
          </div>
          <div className="flex shrink-0 flex-col items-end gap-3">
            <div className="flex flex-wrap items-center gap-2">
              <WsStatusBadge status={wsStatus} />
              <Button
                variant="secondary"
                size="sm"
                icon={<RefreshCw className="h-4 w-4" />}
                loading={refreshingSection === 'header'}
                onClick={handleRefreshHeader}
                title="Refresh Status"
              >
                Refresh
              </Button>
              <Button
                variant="primary"
                size="sm"
                icon={<Download className="h-4 w-4" />}
                disabled={job.status !== 'completed'}
                loading={downloadMutation.isPending}
                onClick={() => downloadMutation.mutate()}
              >
                Download
              </Button>
            </div>
            {job.is_deleted ? (
              <button onClick={() => restoreMutation.mutate()} disabled={restoreMutation.isPending} className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-gray-500 hover:text-gray-900 transition-colors">
                <RotateCcw className="h-3.5 w-3.5" /> Restore
              </button>
            ) : (
              <button onClick={() => archiveMutation.mutate()} disabled={archiveMutation.isPending} className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-gray-400 hover:text-red-600 transition-colors">
                <Archive className="h-3.5 w-3.5" /> Archive
              </button>
            )}
          </div>
        </div>

        <div className="grid grid-cols-2 lg:grid-cols-4 divide-y lg:divide-y-0 lg:divide-x divide-gray-100 border-b border-gray-100 bg-gray-50">
          <div className="p-5 flex flex-col justify-center">
            <p className="text-[10px] font-bold uppercase tracking-wider text-gray-500 mb-1.5">Status</p>
            <div className="flex items-center">
               <span className={`w-fit rounded-full px-3 py-1 text-sm font-bold shadow-sm ring-1 ${
                  job.is_deleted ? 'bg-gray-100 text-gray-600 ring-gray-200' : 
                  job.status === 'completed' ? 'bg-emerald-50 text-emerald-700 ring-emerald-200' :
                  job.status === 'failed' ? 'bg-red-50 text-red-700 ring-red-200' :
                  job.status === 'cancelled' ? 'bg-amber-50 text-amber-700 ring-amber-200' :
                  job.status === 'running' ? 'bg-blue-50 text-blue-700 ring-blue-300' :
                  'bg-white text-gray-700 ring-gray-200'
                }`}>
                  {job.is_deleted ? 'Archived' : statusLabels[job.status]}
                </span>
            </div>
          </div>
          <div className="p-5 flex flex-col justify-center">
            <p className="text-[10px] font-bold uppercase tracking-wider text-gray-500 mb-1">Runtime Elapsed</p>
            <p className="text-xl font-bold text-gray-900">{formatDuration(elapsedForJob(job)) || '-'}{job.status === 'running' && <span className="ml-1 text-xs font-normal text-blue-500 animate-pulse">live</span>}</p>
          </div>
          <div className="p-5 flex flex-col justify-center">
            <p className="text-[10px] font-bold uppercase tracking-wider text-gray-500 mb-1">Max Runtime</p>
            <p className="text-xl font-bold text-gray-900">{formatDuration(job.max_runtime_seconds)}</p>
          </div>
          <div className="p-5 flex flex-col justify-center">
            <p className="text-[10px] font-bold uppercase tracking-wider text-gray-500 mb-1">Created At</p>
            <p className="text-sm font-bold text-gray-900">{new Date(job.created_at).toLocaleString()}</p>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="border-b border-gray-200">
        <nav className="-mb-px flex space-x-8" aria-label="Tabs">
          {tabs.map((tab) => {
            const Icon = tab.icon;
            const isActive = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id as 'overview' | 'logs' | 'metrics' | 'artifacts' | 'config')}
                className={`group inline-flex items-center border-b-2 py-4 px-1 text-sm font-bold transition-colors ${
                  isActive
                    ? 'border-blue-500 text-blue-600'
                    : 'border-transparent text-gray-500 hover:border-gray-300 hover:text-gray-700'
                }`}
              >
                <Icon
                  className={`-ml-0.5 mr-2 h-4 w-4 transition-colors ${
                    isActive ? 'text-blue-500' : 'text-gray-400 group-hover:text-gray-500'
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
      <div className="min-h-[400px]">
        {activeTab === 'overview' && (
          <div className="space-y-6">
            {job.status === 'failed' && (
              <div className="rounded-xl border border-red-200 bg-red-50 p-5 shadow-sm">
                <h4 className="flex items-center gap-2 text-base font-bold text-red-800 mb-2">
                  <AlertTriangle className="h-5 w-5" />
                  Training Failed
                </h4>
                <p className="text-sm font-medium text-red-700 mb-3">
                  {job.stop_reason || 'The training job exited unexpectedly.'}
                </p>
                {job.error_message && (
                  <div className="rounded-lg border border-red-100 bg-white p-4 shadow-sm overflow-x-auto">
                    <code className="whitespace-pre-wrap break-words text-xs text-red-900 font-mono">
                      {job.error_message}
                    </code>
                  </div>
                )}
              </div>
            )}

            {job.status === 'cancelled' && (
              <div className="rounded-xl border border-amber-200 bg-amber-50 p-5 shadow-sm">
                <h4 className="flex items-center gap-2 text-base font-bold text-amber-800 mb-2">
                  <AlertTriangle className="h-5 w-5" />
                  Training Cancelled
                </h4>
                <p className="text-sm font-medium text-amber-700">
                  {job.stop_reason || 'This training job was cancelled before completion.'}
                </p>
              </div>
            )}

            <div className="rounded-xl border border-gray-200 bg-white shadow-sm overflow-hidden">
              <div className="px-6 py-4 border-b border-gray-100 bg-gray-50/50">
                <h3 className="text-sm font-bold text-gray-900 uppercase tracking-wider">Job Metadata</h3>
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
            <div className="rounded-xl border border-gray-200 bg-white shadow-sm overflow-hidden p-6 sm:p-8">
              <h3 className="text-sm font-bold text-gray-900 mb-6 uppercase tracking-wider">Status Timeline</h3>
              <div className="w-full overflow-x-auto pb-4">
                <MilestoneTracker milestones={getMilestones()} />
              </div>
              {job.status === 'failed' && (job.error_message || job.stop_reason) && (
                <div className="mt-6 rounded-lg border border-red-200 bg-red-50 p-4">
                  <p className="text-xs font-bold uppercase tracking-wider text-red-600 mb-1 flex items-center gap-1.5"><AlertTriangle className="h-3.5 w-3.5" /> Failure Reason</p>
                  <p className="text-sm font-medium text-red-800">{job.error_message || job.stop_reason}</p>
                </div>
              )}
              {job.status === 'cancelled' && job.stop_reason && (
                <div className="mt-6 rounded-lg border border-amber-200 bg-amber-50 p-4">
                  <p className="text-xs font-bold uppercase tracking-wider text-amber-600 mb-1 flex items-center gap-1.5"><AlertTriangle className="h-3.5 w-3.5" /> Cancel Reason</p>
                  <p className="text-sm font-medium text-amber-800">{job.stop_reason}</p>
                </div>
              )}
              <TrainingEventHistory events={eventsResponse?.events || []} />
            </div>
          </div>
        )}

        {activeTab === 'logs' && (
          <div className="space-y-4 animate-in fade-in duration-300">
             {job.status === 'failed' && job.stop_reason && (
               <div className="rounded-lg border border-red-200 bg-red-50 p-4 flex gap-3 items-start text-sm text-red-800 font-medium shadow-sm">
                 <AlertTriangle className="h-5 w-5 shrink-0 text-red-600 mt-0.5" />
                 <div>
                   <p className="font-bold mb-1 text-red-900">Stop Reason</p>
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
              <div className="flex flex-col items-center justify-center py-16 px-4 rounded-xl border border-gray-200 border-dashed bg-gray-50 text-center shadow-sm">
                <Activity className="h-10 w-10 text-gray-300 mb-4" />
                <p className="text-base font-bold text-gray-900">Metrics are starting up</p>
                <p className="text-sm text-gray-500 mt-2 max-w-md">Runtime metrics will appear here automatically once the runner emits them.</p>
              </div>
            ) : !metrics?.metrics_available ? (
              <div className="flex flex-col items-center justify-center py-16 px-4 rounded-xl border border-gray-200 bg-white text-center shadow-sm">
                <Activity className="h-10 w-10 text-gray-200 mb-4" />
                <p className="text-base font-bold text-gray-900">No metrics available</p>
                <p className="text-sm text-gray-500 mt-2">This job did not emit any runtime metrics.</p>
              </div>
            ) : (
              <RuntimeMetricsPanel metrics={metrics} loading={loadingMetrics || refreshingSection === 'metrics'} onRefresh={handleRefreshMetrics} />
            )}
          </div>
        )}

        {activeTab === 'artifacts' && (
          <div className="space-y-6 animate-in fade-in duration-300">
            <div className="rounded-xl border border-gray-200 bg-white shadow-sm overflow-hidden">
              <div className="px-6 py-4 border-b border-gray-100 bg-gray-50/50 flex flex-wrap gap-4 justify-between items-center">
                <h3 className="text-sm font-bold text-gray-900 uppercase tracking-wider">Output Artifacts</h3>
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
                      <p className="text-xs font-bold text-gray-500 uppercase tracking-wider">Model Artifact URI</p>
                      <UriLine label="Model URI" value={job.model_artifact_uri} onCopy={handleCopyUri} />
                    </div>
                    <div className="space-y-2">
                      <p className="text-xs font-bold text-gray-500 uppercase tracking-wider">Output S3 URI</p>
                      <UriLine label="Output URI" value={job.output_s3_uri} onCopy={handleCopyUri} />
                    </div>
                  </>
                ) : (
                  <div className="py-10 text-center">
                    <FileArchive className="h-10 w-10 text-gray-200 mx-auto mb-4" />
                    <p className="text-base font-bold text-gray-600">Model artifact is not ready yet.</p>
                    <p className="text-sm text-gray-400 mt-1 max-w-sm mx-auto">Artifacts will be available for download and URI inspection once the training completes successfully.</p>
                  </div>
                )}
              </div>
            </div>

            <div className="rounded-xl border border-gray-200 bg-white shadow-sm overflow-hidden">
              <div className="px-6 py-4 border-b border-gray-100 bg-gray-50/50">
                <h3 className="text-sm font-bold text-gray-900 uppercase tracking-wider">Source Files</h3>
              </div>
              <div className="p-6 space-y-6">
                <div className="space-y-2">
                  <p className="text-xs font-bold text-gray-500 uppercase tracking-wider">Source ZIP URI</p>
                  <UriLine label="Source ZIP" value={job.s3_source_uri} onCopy={handleCopyUri} />
                </div>
                {job.s3_training_data_uri && (
                  <div className="space-y-2">
                    <p className="text-xs font-bold text-gray-500 uppercase tracking-wider">Training Data URI</p>
                    <UriLine label="Data URI" value={job.s3_training_data_uri} onCopy={handleCopyUri} />
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {activeTab === 'config' && (
          <div className="rounded-xl border border-gray-200 bg-white shadow-sm overflow-hidden animate-in fade-in duration-300">
            <div className="px-6 py-4 border-b border-gray-100 bg-gray-50/50">
              <h3 className="text-sm font-bold text-gray-900 uppercase tracking-wider">Submitted Configuration</h3>
            </div>
            <div className="p-6 space-y-8">
              <div>
                <h4 className="text-xs font-bold uppercase tracking-wider text-gray-500 mb-4 border-b border-gray-100 pb-2">Compute & Runtime</h4>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-y-6 gap-x-8">
                  <MetadataRow label="Training Backend" value={backendLabel(job.training_backend)} />
                  <MetadataRow label="vCPU" value={String(job.vcpu)} />
                  <MetadataRow label="Memory (MB)" value={String(job.memory)} />
                  <MetadataRow label="Max Runtime (Seconds)" value={String(job.max_runtime_seconds)} />
                </div>
              </div>
              <div>
                <h4 className="text-xs font-bold uppercase tracking-wider text-gray-500 mb-4 border-b border-gray-100 pb-2">Accelerator</h4>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-y-6 gap-x-8">
                  <MetadataRow label="Accelerator Type" value={job.accelerator_type === 'none' ? 'None' : job.accelerator_type.toUpperCase()} />
                  {job.accelerator_type !== 'none' && <MetadataRow label="Accelerator Count" value={String(job.accelerator_count)} />}
                </div>
              </div>
              <div>
                <h4 className="text-xs font-bold uppercase tracking-wider text-gray-500 mb-4 border-b border-gray-100 pb-2">Source</h4>
                <div className="grid grid-cols-1 gap-y-6 gap-x-8">
                  <MetadataRow label="Entry Point" value={job.entry_point} monospace />
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}

function MetadataRow({ label, value, monospace = false }: { label: string; value: string; monospace?: boolean }) {
  return (
    <div className="flex flex-col gap-1.5 py-1">
      <span className="text-[10px] font-bold uppercase tracking-wider text-gray-500">{label}</span>
      <span className={`text-sm font-medium ${monospace ? 'font-mono text-[13px] bg-gray-50 text-gray-800 px-2 py-1 rounded border border-gray-200 w-fit' : 'text-gray-900'}`}>{value}</span>
    </div>
  );
}

type MilestoneState = 'pending' | 'active' | 'completed' | 'failed' | 'cancelled' | 'skipped';



type WsStatusBadgeProps = { status: 'connecting' | 'connected' | 'disconnected' | 'fallback' };
function WsStatusBadge({ status }: WsStatusBadgeProps) {
  if (status === 'connected') {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider text-emerald-700">
        <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" />
        Live
      </span>
    );
  }
  if (status === 'connecting' || status === 'disconnected') {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-50 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider text-amber-700">
        <span className="h-1.5 w-1.5 rounded-full bg-amber-400 animate-ping" />
        Reconnecting...
      </span>
    );
  }
  // fallback
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-gray-100 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider text-gray-500">
      <span className="h-1.5 w-1.5 rounded-full bg-gray-400" />
      Polling fallback
    </span>
  );
}

function MilestoneTracker({
  milestones,
}: {
  milestones: Array<{
    id: string;
    label: string;
    state: MilestoneState;
    icon: React.ElementType;
    timestamp: string;
    helper?: string;
  }>;
}) {
  return (
    <div className="flex items-start justify-between min-w-[600px] w-full">
      {milestones.map((m, i) => {
        const Icon = m.icon;
        const isLast = i === milestones.length - 1;
        
        let circleClass = 'border-gray-200 bg-white text-gray-400';
        if (m.state === 'completed') circleClass = 'border-emerald-500 bg-emerald-50 text-emerald-600';
        if (m.state === 'active') circleClass = 'border-blue-500 bg-blue-50 text-blue-600 ring-4 ring-blue-50';
        if (m.state === 'failed') circleClass = 'border-red-500 bg-red-50 text-red-600 ring-4 ring-red-50';
        if (m.state === 'cancelled') circleClass = 'border-amber-500 bg-amber-50 text-amber-600 ring-4 ring-amber-50';
        if (m.state === 'skipped') circleClass = 'border-gray-200 bg-gray-50 text-gray-300';

        let lineClass = 'bg-gray-200';
        if (m.state === 'completed') lineClass = 'bg-emerald-500';
        else if (m.state === 'active') lineClass = 'bg-blue-400';
        else if (m.state === 'failed') lineClass = 'bg-red-500';
        else if (m.state === 'cancelled') lineClass = 'bg-amber-500';

        return (
          <div key={m.id} className={`flex ${isLast ? 'flex-none' : 'flex-1'} flex-col relative`}>
            <div className="flex items-center w-full">
              <div className={`relative z-10 flex h-10 w-10 shrink-0 items-center justify-center rounded-full border-2 transition-all duration-300 ${circleClass}`}>
                <Icon className={`h-5 w-5 ${m.state === 'active' ? 'animate-pulse' : ''}`} />
              </div>
              {!isLast && (
                <div className="flex-1 px-2">
                  <div className={`h-1 w-full rounded-full transition-all duration-500 ${lineClass}`} />
                </div>
              )}
            </div>
            
            <div className="mt-4 flex flex-col pr-4 w-36">
              <span className={`text-sm font-bold tracking-tight ${m.state === 'failed' ? 'text-red-700' : m.state === 'cancelled' ? 'text-amber-700' : m.state === 'active' ? 'text-blue-700' : m.state === 'completed' ? 'text-gray-900' : 'text-gray-400'}`}>
                {m.label}
              </span>
              <span className="mt-1 text-[11px] font-semibold text-gray-500">
                {m.timestamp}
              </span>
              {m.helper && (
                <span className="mt-1 text-[10px] font-bold uppercase tracking-wider text-gray-400">
                  {m.helper}
                </span>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function TrainingEventHistory({ events }: { events: TrainingJobEvent[] }) {
  if (!events.length) {
    return (
      <div className="mt-6 rounded-lg border border-dashed border-gray-200 bg-gray-50 p-4 text-sm font-medium text-gray-500">
        Event history will appear as the backend records lifecycle updates.
      </div>
    );
  }

  return (
    <div className="mt-6 rounded-lg border border-gray-200 bg-gray-50 p-4">
      <h4 className="mb-3 text-xs font-bold uppercase tracking-wider text-gray-600">Event History</h4>
      <div className="space-y-3">
        {events.map((event) => (
          <div key={event.id} className="flex gap-3 text-sm">
            <span className="w-36 shrink-0 font-semibold text-gray-500">
              {new Date(event.created_at).toLocaleString()}
            </span>
            <div className="min-w-0">
              <p className="font-bold text-gray-900">{event.event_type.replace(/_/g, ' ')}</p>
              <p className="break-words text-gray-600">{event.message}</p>
            </div>
          </div>
        ))}
      </div>
    </div>
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
    <div className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
      <div className="mb-6 flex items-center justify-between gap-3 border-b border-gray-100 pb-4">
        <p className="flex items-center gap-2 text-sm font-bold uppercase tracking-wider text-gray-900">
          <Activity className="h-4 w-4 text-blue-500" />
          Runtime metrics
        </p>
        <div className="flex items-center gap-3">
          <span className="text-xs font-bold text-gray-400">
            {latest?.timestamp
              ? `Sampled ${new Date(latest.timestamp).toLocaleTimeString()}`
              : 'Pending metrics...'}
          </span>
          <button
            onClick={onRefresh}
            disabled={loading}
            className="flex h-7 items-center gap-1.5 rounded bg-gray-50 border border-gray-200 px-2.5 text-[11px] font-bold text-gray-600 hover:bg-gray-100 disabled:opacity-50 transition-colors"
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
    <div className={`min-w-0 flex flex-col justify-between rounded-xl bg-gray-50 px-5 py-4 border ${warning ? 'border-amber-300 ring-1 ring-amber-100' : 'border-gray-200'} ${muted ? 'opacity-50 grayscale border-dashed' : ''}`}>
      <div>
        <div className="flex items-start justify-between">
          <p className={`flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider ${warning ? 'text-amber-600' : 'text-gray-500'}`}>
            {icon}
            {label}
          </p>
          <p className={`truncate text-2xl font-black tracking-tight ${warning ? 'text-amber-700' : muted ? 'text-gray-400' : 'text-gray-900'}`} title={value}>
            {value}
          </p>
        </div>
        
        {progress != null && !muted && (
          <div className="mt-4 h-1.5 w-full overflow-hidden rounded-full bg-gray-200">
            <div
              className={`h-full transition-all duration-500 ${progressColor || 'bg-gray-400'}`}
              style={{ width: `${Math.min(100, Math.max(0, progress))}%` }}
            />
          </div>
        )}
      </div>
      
      <p className={`mt-3 truncate text-[11px] font-bold ${warning ? 'text-amber-600/80' : 'text-gray-400'}`} title={detail}>
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
          <ScrollText className="h-4 w-4 text-gray-400" />
          <p className="text-[11px] font-bold uppercase tracking-wider text-gray-300">
            Training Output
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={handleCopy}
            className="flex h-7 items-center gap-1.5 rounded bg-gray-800 px-2.5 text-[11px] font-bold text-gray-300 hover:bg-gray-700 transition-colors"
          >
            <Clipboard className="h-3 w-3" />
            Copy
          </button>
          <button
            onClick={onRefresh}
            disabled={loading}
            className="flex h-7 items-center gap-1.5 rounded bg-gray-800 px-2.5 text-[11px] font-bold text-gray-300 hover:bg-gray-700 disabled:opacity-50 transition-colors"
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
          className="max-h-[600px] min-h-[400px] overflow-x-auto overflow-y-auto whitespace-pre p-6 font-mono text-[13px] leading-6 text-gray-300"
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
    <div className="flex w-full min-w-0 items-center justify-between gap-3 rounded-lg border border-gray-200 bg-gray-50 px-4 py-2 shadow-sm">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-gray-500">
          {icon}
          {label}
        </div>
        <code className="mt-1 block truncate text-xs sm:text-sm font-semibold text-gray-700 max-w-[200px] sm:max-w-md lg:max-w-xl" title={value || '-'}>
          {value || '-'}
        </code>
      </div>
      <button
        type="button"
        className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded border border-gray-200 bg-white text-gray-500 hover:bg-gray-100 hover:text-gray-900 shadow-sm transition-all disabled:opacity-40"
        disabled={!value}
        onClick={() => onCopy(value)}
        aria-label={`Copy ${label}`}
      >
        <Clipboard className="h-4 w-4" />
      </button>
    </div>
  );
}
