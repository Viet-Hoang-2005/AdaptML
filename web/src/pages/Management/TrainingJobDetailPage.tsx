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
  ScrollText,
  Activity,
  Settings,
  Info,
} from 'lucide-react';
import type { ReactNode } from 'react';

import { Button } from '../../components/ui/Button';
import {
  getTrainingJob,
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
import type { TrainingJob, TrainingJobMetricsResponse, TrainingJobStatus } from '../../types/modelApi';

// -- Shared formatting helpers --
const backendLabel = (backend?: TrainingJob['training_backend']) => backend || 'sagemaker';
const formatDuration = (seconds?: number | null) => {
  const totalSeconds = Math.max(Number(seconds || 0), 0);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const secs = totalSeconds % 60;
  if (hours > 0) return `${hours}h ${minutes}m`;
  if (minutes > 0) return `${minutes}m ${secs}s`;
  return `${secs}s`;
};
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
};

const ACTIVE_STATUSES: TrainingJobStatus[] = ['pending', 'uploading', 'running'];
const AUTO_SYNC_INTERVAL_MS = 5000;

export default function TrainingJobDetailPage() {
  const { jobId } = useParams<{ jobId: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState<'overview' | 'logs' | 'metrics' | 'artifacts' | 'config'>('overview');

  const parsedJobId = Number(jobId);

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
      if (job && ACTIVE_STATUSES.includes(job.status) && activeTab === 'logs') return AUTO_SYNC_INTERVAL_MS;
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
      if (job && ACTIVE_STATUSES.includes(job.status) && activeTab === 'metrics') return AUTO_SYNC_INTERVAL_MS;
      return false;
    },
  });

  // -- Mutations --
  const refreshStatusMutation = useMutation({
    mutationFn: () => refreshTrainingJobStatus(parsedJobId),
    onSuccess: (data) => {
      queryClient.setQueryData([...queryKeys.trainingJobs, 'detail', parsedJobId], data);
      refetchLogs();
      refetchMetrics();
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

  const elapsedForJob = (j: TrainingJob) => {
    if (j.completed_at && j.started_at) {
      return (new Date(j.completed_at).getTime() - new Date(j.started_at).getTime()) / 1000;
    }
    if (j.started_at && ACTIVE_STATUSES.includes(j.status)) {
      return (new Date().getTime() - new Date(j.started_at).getTime()) / 1000;
    }
    return j.runtime_seconds || null;
  };

  const getAccentBorderClass = () => {
    if (job.is_deleted) return 'border-t-4 border-t-gray-400';
    if (job.status === 'completed') return 'border-t-4 border-t-emerald-500';
    if (job.status === 'failed') return 'border-t-4 border-t-red-500';
    if (job.status === 'running') return 'border-t-4 border-t-blue-500';
    return 'border-t-4 border-t-gray-300';
  };

  const tabs = [
    { id: 'overview', label: 'Overview', icon: Info },
    { id: 'logs', label: 'Logs', icon: ScrollText },
    { id: 'metrics', label: 'Metrics', icon: Activity },
    { id: 'artifacts', label: 'Artifacts', icon: FileArchive },
    { id: 'config', label: 'Config', icon: Settings },
  ] as const;

  return (
    <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
      {/* Back button */}
      <button
        onClick={() => navigate('/dashboard/model-training')}
        className="mb-6 flex items-center gap-2 text-sm font-semibold text-gray-500 hover:text-gray-900 transition-colors group"
      >
        <ArrowLeft className="h-4 w-4 text-gray-400 group-hover:text-gray-600 group-hover:-translate-x-0.5 transition-all" />
        Back to Model Training
      </button>

      {/* Header Card */}
      <div className={`mb-8 rounded-xl border bg-white shadow-sm overflow-hidden ${getAccentBorderClass()} ${job.is_deleted ? 'opacity-80 grayscale-[0.2]' : ''}`}>
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
              <Button
                variant="secondary"
                size="sm"
                icon={<RefreshCw className="h-4 w-4" />}
                loading={refreshStatusMutation.isPending}
                onClick={() => refreshStatusMutation.mutate()}
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
                  job.status === 'running' ? 'bg-blue-50 text-blue-700 ring-blue-300' :
                  'bg-white text-gray-700 ring-gray-200'
                }`}>
                  {job.is_deleted ? 'Archived' : statusLabels[job.status]}
                </span>
            </div>
          </div>
          <div className="p-5 flex flex-col justify-center">
            <p className="text-[10px] font-bold uppercase tracking-wider text-gray-500 mb-1">Runtime Elapsed</p>
            <p className="text-xl font-bold text-gray-900">{formatDuration(elapsedForJob(job)) || '-'}</p>
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
      <div className="mb-6 border-b border-gray-200">
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
            <div className="rounded-xl border border-gray-200 bg-white shadow-sm overflow-hidden p-8">
              <h3 className="text-sm font-bold text-gray-900 mb-8 uppercase tracking-wider">Status Timeline</h3>
              <div className="relative flex items-center justify-between w-full max-w-3xl mx-auto px-4">
                <div className="absolute left-4 right-4 top-1/2 h-1 bg-gray-100 -z-10 -translate-y-1/2 rounded-full"></div>
                <div className="absolute left-4 top-1/2 h-1 bg-blue-500 -z-10 -translate-y-1/2 rounded-full transition-all duration-700 ease-in-out" style={{
                  width: job.status === 'completed' || job.status === 'failed' ? 'calc(100% - 2rem)' : job.status === 'running' ? '66%' : job.status === 'uploading' ? '33%' : '0%'
                }}></div>
                
                <TimelineStep label="Created" active={true} completed={true} />
                <TimelineStep label="Uploading" active={job.status === 'uploading'} completed={['running', 'completed', 'failed'].includes(job.status)} />
                <TimelineStep label="Running" active={job.status === 'running'} completed={['completed', 'failed'].includes(job.status)} />
                <TimelineStep label={job.status === 'failed' ? 'Failed' : 'Completed'} active={['completed', 'failed'].includes(job.status)} completed={job.status === 'completed'} isError={job.status === 'failed'} />
              </div>
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
              loading={loadingLogs} 
              onRefresh={() => refetchLogs()} 
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
              <RuntimeMetricsPanel metrics={metrics} loading={loadingMetrics} />
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
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-y-6 gap-x-8 p-6">
              <MetadataRow label="Training Backend" value={backendLabel(job.training_backend)} />
              <MetadataRow label="Entry Point" value={job.entry_point} monospace />
              <MetadataRow label="vCPU" value={String(job.vcpu)} />
              <MetadataRow label="Memory (MB)" value={String(job.memory)} />
              <MetadataRow label="Max Runtime (Seconds)" value={String(job.max_runtime_seconds)} />
              <MetadataRow label="Accelerator Type" value={job.accelerator_type.toUpperCase()} />
              <MetadataRow label="Accelerator Count" value={String(job.accelerator_count)} />
            </div>
          </div>
        )}
      </div>
    </div>
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

function TimelineStep({ label, active, completed, isError = false }: { label: string; active: boolean; completed: boolean; isError?: boolean }) {
  return (
    <div className="flex flex-col items-center gap-2.5 relative z-10 w-24">
      <div className={`w-10 h-10 rounded-full flex items-center justify-center border-4 transition-colors shadow-sm ${
        isError ? 'border-red-500 bg-white text-red-500 ring-4 ring-red-50' :
        completed ? 'border-blue-500 bg-blue-500 text-white' :
        active ? 'border-blue-500 bg-white text-blue-500 ring-4 ring-blue-50' :
        'border-gray-200 bg-white text-gray-300'
      }`}>
        {isError ? <AlertTriangle className="w-4 h-4" /> : <div className={`w-2.5 h-2.5 rounded-full ${completed ? 'bg-white' : 'bg-current'}`} />}
      </div>
      <span className={`text-xs font-bold uppercase tracking-wider text-center ${
        isError ? 'text-red-600' :
        active || completed ? 'text-gray-900' : 'text-gray-400'
      }`}>{label}</span>
    </div>
  );
}

// === Reused Components ===

function RuntimeMetricsPanel({
  metrics,
  loading,
}: {
  metrics?: TrainingJobMetricsResponse;
  loading: boolean;
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
          {loading && <span className="text-[10px] font-bold uppercase tracking-wider text-blue-500">Refreshing...</span>}
          <span className="text-xs font-bold text-gray-400">
            {latest?.timestamp
              ? `Sampled ${new Date(latest.timestamp).toLocaleTimeString()}`
              : 'Pending metrics...'}
          </span>
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

  useEffect(() => {
    const element = scrollRef.current;
    if (!element || !shouldStickToBottomRef.current) return;
    element.scrollTop = element.scrollHeight;
  }, [text]);

  const handleScroll = () => {
    const element = scrollRef.current;
    if (!element) return;
    const distanceFromBottom = element.scrollHeight - element.scrollTop - element.clientHeight;
    shouldStickToBottomRef.current = distanceFromBottom < 24;
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
      <pre
        ref={scrollRef}
        onScroll={handleScroll}
        className="max-h-[600px] min-h-[400px] overflow-x-auto overflow-y-auto whitespace-pre p-6 font-mono text-[13px] leading-6 text-gray-300"
      >
        {text}
      </pre>
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
        <code className="mt-1 block truncate text-sm font-semibold text-gray-700" title={value || '-'}>
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
