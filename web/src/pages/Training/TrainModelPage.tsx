import { Link, useNavigate } from 'react-router-dom';
import { Eye, Archive, Clock3, Cpu, Download, FileCode2, HardDrive, RefreshCw, Rocket } from 'lucide-react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Button } from '../../components/ui/Button';
import {
  cancelTrainingJob,
  getTrainingJobDownloadUrl,
  getTrainingUsage,
  listTrainingJobs,
  refreshTrainingJobStatus,
  retryTrainingJob,
} from '../../lib/api';
import { getApiErrorMessage } from '../../lib/apiError';
import { queryKeys } from '../../lib/queryKeys';
import { toast } from '../../lib/toast';
import { formatDuration } from '../../lib/formatDuration';
import { useModelSelection } from '../../hooks/useModelSelection';
import type { TrainingJob, TrainingJobStatus } from '../../types/modelApi';

const statusLabels: Record<TrainingJobStatus, string> = {
  pending: 'Pending',
  uploading: 'Uploading',
  running: 'Running',
  completed: 'Completed',
  failed: 'Failed',
  cancelled: 'Cancelled',
};

const jobLabel = (job: Pick<TrainingJob, 'name' | 'model_version'>) => `${job.name} ${job.model_version}`.trim();

const AUTO_SYNC_INTERVAL_MS = 4000;
const ACTIVE_STATUSES: TrainingJobStatus[] = ['pending', 'uploading', 'running'];

const elapsedForJob = (job: TrainingJob) => {
  if (job.runtime_seconds) return job.runtime_seconds;
  if (job.status === 'running' && job.started_at) {
    return Math.max(Math.floor((Date.now() - new Date(job.started_at).getTime()) / 1000), 0);
  }
  return 0;
};

const isActiveJob = (job: TrainingJob) => ACTIVE_STATUSES.includes(job.status);

const transitionToast = (previousJob: TrainingJob, updatedJob: TrainingJob) => {
  if (previousJob.status === updatedJob.status) return;
  const wasStarting = ['pending', 'uploading'].includes(previousJob.status);
  if (wasStarting && updatedJob.status === 'running') {
    toast.success(`${jobLabel(updatedJob)} started.`);
    return;
  }
  if (previousJob.status === 'running' && updatedJob.status === 'completed') {
    toast.success(`${jobLabel(updatedJob)} completed in ${formatDuration(elapsedForJob(updatedJob))}.`);
    return;
  }
  if (previousJob.status === 'running' && updatedJob.status === 'failed') {
    const reason = updatedJob.stop_reason || updatedJob.error_message || 'Check the training log for details.';
    toast.error(`${jobLabel(updatedJob)} failed: ${reason}`);
  }
};

type JobVisibilityFilter = 'active' | 'archived' | 'all';
type JobSortMode = 'newest' | 'oldest' | 'status' | 'name';

const statusRank: Record<TrainingJobStatus, number> = {
  running: 0,
  uploading: 1,
  pending: 2,
  failed: 3,
  cancelled: 4,
  completed: 5,
};

const sortTrainingJobs = (jobs: TrainingJob[], sortMode: JobSortMode) => {
  const nextJobs = [...jobs];
  if (sortMode === 'oldest') {
    return nextJobs.sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
  }
  if (sortMode === 'status') {
    return nextJobs.sort((a, b) => statusRank[a.status] - statusRank[b.status] || b.id - a.id);
  }
  if (sortMode === 'name') {
    return nextJobs.sort((a, b) => `${a.name} ${a.model_version}`.localeCompare(`${b.name} ${b.model_version}`));
  }
  return nextJobs.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
};

const upsertTrainingJob = (jobs: TrainingJob[], job: TrainingJob) => {
  const existingIndex = jobs.findIndex((item) => item.id === job.id);
  if (existingIndex === -1) {
    return [job, ...jobs];
  }

  const nextJobs = [...jobs];
  nextJobs[existingIndex] = job;
  return nextJobs;
};

export default function TrainModelPage() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const { selectedModel } = useModelSelection();

  const [refreshingJobId, setRefreshingJobId] = useState<number | null>(null);
  const [confirmAction, setConfirmAction] = useState<{ type: 'cancel' | 'retry'; job: TrainingJob } | null>(null);
  const [visibilityFilter, setVisibilityFilter] = useState<JobVisibilityFilter>('active');
  const [sortMode, setSortMode] = useState<JobSortMode>('newest');
  const statusNotificationRef = useRef<Record<number, TrainingJobStatus>>({});
  const {
    data,
    error: jobsError,
    isError,
    isFetching,
    isLoading,
    refetch,
  } = useQuery({
    queryKey: queryKeys.trainingJobs,
    queryFn: () => listTrainingJobs(true),
  });
  const { data: usage, isLoading: isUsageLoading } = useQuery({
    queryKey: queryKeys.trainingUsage,
    queryFn: getTrainingUsage,
    refetchInterval: 15000,
  });
  const allTrainingJobs = useMemo(() => data?.training_jobs ?? [], [data?.training_jobs]);
  const activeTrainingJobs = useMemo(
    () => allTrainingJobs.filter((job) => !job.is_deleted && job.id > 0 && isActiveJob(job)),
    [allTrainingJobs],
  );
  const activeUsageCount = usage?.active_jobs_count ?? usage?.running_jobs_count ?? 0;
  const filteredTrainingJobs = allTrainingJobs.filter((job) => {
    if (visibilityFilter === 'archived') return job.is_deleted;
    if (visibilityFilter === 'active') return !job.is_deleted;
    return true;
  });
  const trainingJobs = sortTrainingJobs(filteredTrainingJobs, sortMode);

  const invalidateJobs = useCallback(
    () => queryClient.invalidateQueries({ queryKey: queryKeys.trainingJobs }),
    [queryClient],
  );
  const invalidateUsage = useCallback(
    () => queryClient.invalidateQueries({ queryKey: queryKeys.trainingUsage }),
    [queryClient],
  );

  useEffect(() => {
    const syncableJobs = activeTrainingJobs;

    if (syncableJobs.length === 0) {
      return undefined;
    }

    let cancelled = false;

    const intervalId = window.setInterval(async () => {
      for (const job of syncableJobs) {
        if (cancelled) break;
        try {
          const res = await refreshTrainingJobStatus(job.id);
          const updated = Array.isArray(res) ? res[0] : res;
          queryClient.setQueryData(queryKeys.trainingJobs, (oldData: { training_jobs: TrainingJob[] } | undefined) => {
            if (!oldData?.training_jobs) return oldData;
            return {
              ...oldData,
              training_jobs: upsertTrainingJob(oldData.training_jobs, updated),
            };
          });

          if (statusNotificationRef.current[job.id] && statusNotificationRef.current[job.id] !== updated.status) {
            transitionToast({ ...job, status: statusNotificationRef.current[job.id] }, updated);
          }
          statusNotificationRef.current[job.id] = updated.status;
        } catch {
          // ignore
        }
      }
    }, AUTO_SYNC_INTERVAL_MS);

    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
    };
  }, [activeTrainingJobs, queryClient]);

    const handleRefreshJob = async (job: TrainingJob) => {
    setRefreshingJobId(job.id);
    try {
      await refreshMutation.mutateAsync(job);
    } finally {
      setRefreshingJobId(null);
    }
  };

  const refreshMutation = useMutation({
    mutationFn: (job: TrainingJob) => refreshTrainingJobStatus(job.id),
    onMutate: (job) => {
      toast.warning(`Refreshing status for ${jobLabel(job)}...`);
    },
    onSuccess: async (updatedJob, previousJob) => {
      queryClient.setQueryData(queryKeys.trainingJobs, (current: { training_jobs: TrainingJob[] } | undefined) => ({
        training_jobs: upsertTrainingJob(current?.training_jobs ?? [], updatedJob),
      }));
      void invalidateJobs();
      void invalidateUsage();
      if (updatedJob.status === previousJob.status) {
        toast.success(`${jobLabel(updatedJob)} status unchanged: ${statusLabels[updatedJob.status]}.`);
      } else if (updatedJob.status === 'failed') {
        const reason = updatedJob.stop_reason || updatedJob.error_message || 'Check the training log for details.';
        toast.error(`${jobLabel(updatedJob)} failed: ${reason}`);
      } else {
        toast.success(
          `${jobLabel(updatedJob)} status changed: ${statusLabels[previousJob.status]} -> ${statusLabels[updatedJob.status]}.`,
        );
      }
    },
    onError: (error, job) => {
      toast.error(`${jobLabel(job)}: ${getApiErrorMessage(error, 'Unable to refresh training status. Check backend logs.')}`);
    },
  });

  const downloadMutation = useMutation({
    mutationFn: (job: TrainingJob) => getTrainingJobDownloadUrl(job.id),
    onSuccess: ({ download_url }, job) => {
      window.open(download_url, '_blank', 'noopener,noreferrer');
      toast.success(`Download link opened for ${jobLabel(job)}.`);
    },
    onError: (error, job) => {
      toast.error(`${jobLabel(job)}: ${getApiErrorMessage(error, 'Model artifact is not ready yet. Refresh status first.')}`);
    },
  });

  const cancelMutation = useMutation({
    mutationFn: (job: TrainingJob) => cancelTrainingJob(job.id),
    onSuccess: (updatedJob) => {
      queryClient.setQueryData(queryKeys.trainingJobs, (current: { training_jobs: TrainingJob[] } | undefined) => ({
        training_jobs: upsertTrainingJob(current?.training_jobs ?? [], updatedJob),
      }));
      void invalidateJobs();
      void invalidateUsage();
      setConfirmAction(null);
      toast.success('Training job cancelled.');
    },
    onError: (error, job) => {
      toast.error(`${jobLabel(job)}: ${getApiErrorMessage(error, 'Unable to cancel training job.')}`);
    },
  });

  const retryMutation = useMutation({
    mutationFn: (job: TrainingJob) => retryTrainingJob(job.id),
    onSuccess: (newJob) => {
      queryClient.setQueryData(queryKeys.trainingJobs, (current: { training_jobs: TrainingJob[] } | undefined) => ({
        training_jobs: upsertTrainingJob(current?.training_jobs ?? [], newJob),
      }));
      void invalidateJobs();
      void invalidateUsage();
      setConfirmAction(null);
      toast.success(`Retry job created for ${jobLabel(newJob)}.`);
      if (selectedModel) {
        navigate(`/dashboard/model-training/${selectedModel.id}/job/${newJob.id}`);
      }
    },
    onError: (error, job) => {
      toast.error(`${jobLabel(job)}: ${getApiErrorMessage(error, 'Unable to retry training job.')}`);
    },
  });

  return (
    <section className="flex w-full flex-1 flex-col space-y-6">
      <div className="flex flex-col gap-4 border-b border-gray-200 pb-5 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-gray-900">Model Training</h1>
          <p className="mt-1 text-sm text-gray-500">
            Train new model artifacts or retrain the model selected in the header.
          </p>
        </div>
        <Button
          icon={<Rocket className="h-4 w-4" />}
          onClick={() => navigate(selectedModel ? `/dashboard/model-training/${selectedModel.id}/new` : '/dashboard/model-training')}
        >
          New Training Job
        </Button>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <div className="md:col-span-2 rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
          <div className="mb-4 flex items-center justify-between">
            <div>
              <p className="text-xs font-bold uppercase tracking-wider text-gray-500">Monthly Training Quota</p>
              <div className="mt-1 flex items-baseline gap-2">
                <span className="text-2xl font-bold text-gray-900">
                  {isUsageLoading ? '...' : formatDuration(usage?.monthly_runtime_seconds)}
                </span>
                <span className="text-sm font-medium text-gray-500">
                  / {formatDuration(usage?.monthly_quota_seconds || 43200)} used
                </span>
              </div>
            </div>
            <div className="text-right">
              <p className="text-xs font-bold uppercase tracking-wider text-gray-500">Remaining</p>
              <p className={`mt-1 text-lg font-bold ${
                usage && usage.remaining_seconds < (usage.monthly_quota_seconds * 0.1) 
                  ? 'text-red-600' 
                  : usage && usage.remaining_seconds < (usage.monthly_quota_seconds * 0.3) 
                    ? 'text-amber-600' 
                    : 'text-emerald-600'
              }`}>
                {isUsageLoading ? '...' : formatDuration(usage?.remaining_seconds)}
              </p>
            </div>
          </div>
          <div className="h-2.5 w-full overflow-hidden rounded-full bg-gray-100">
            <div
              className={`h-full transition-all duration-500 ease-out ${
                usage && usage.remaining_seconds < (usage.monthly_quota_seconds * 0.1) 
                  ? 'bg-red-500' 
                  : usage && usage.remaining_seconds < (usage.monthly_quota_seconds * 0.3) 
                    ? 'bg-amber-500' 
                    : 'bg-emerald-500'
              }`}
              style={{ width: `${Math.min(100, ((usage?.monthly_runtime_seconds || 0) / (usage?.monthly_quota_seconds || 1)) * 100)}%` }}
            />
          </div>
        </div>

        <div className={`flex flex-col justify-center rounded-xl border p-5 shadow-sm transition-colors ${
          activeUsageCount > 0
            ? 'border-blue-200 bg-blue-50/50' 
            : 'border-gray-200 bg-white'
        }`}>
          <p className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-gray-500">
            <Rocket className="h-4 w-4" />
            Active Jobs
          </p>
          <div className="mt-3 flex items-baseline gap-2">
            <span className={`text-3xl font-bold ${
              activeUsageCount > 0 ? 'text-blue-700' : 'text-gray-900'
            }`}>
              {activeUsageCount}
            </span>
            {activeUsageCount > 0 && (
              <span className="relative flex h-3 w-3">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-blue-400 opacity-75"></span>
                <span className="relative inline-flex h-3 w-3 rounded-full bg-blue-500"></span>
              </span>
            )}
          </div>
        </div>
      </div>

      

      {isLoading ? (
        <TrainingJobsSkeleton />
      ) : isError ? (
        <div className="rounded-lg border border-red-100 bg-red-50 p-5">
          <h2 className="text-base font-bold text-red-800">Unable to load training jobs</h2>
          <p className="mt-1 text-sm text-red-700">{getApiErrorMessage(jobsError, 'Please check the control plane API.')}</p>
          <Button className="mt-4" variant="secondary" size="sm" icon={<RefreshCw className="h-4 w-4" />} onClick={() => refetch()}>
            Retry
          </Button>
        </div>
      ) : allTrainingJobs.length === 0 ? (
        <div className="rounded-lg border border-dashed border-gray-300 bg-white p-10 text-center">
          <FileCode2 className="mx-auto h-8 w-8 text-gray-400" />
          <h2 className="mt-3 text-base font-bold text-gray-900">No training jobs yet</h2>
          <p className="mt-1 text-sm text-gray-500">Submit a source zip and CSV dataset to start your first training job.</p>
          <Button className="mt-4" icon={<Rocket className="h-4 w-4" />} onClick={() => navigate(selectedModel ? `/dashboard/model-training/${selectedModel.id}/new` : '/dashboard/model-training')}>
            Create your first training job
          </Button>
        </div>
      ) : (
        <div className="space-y-4">
          <div className="flex flex-col gap-4 rounded-xl border border-gray-200 bg-gray-50/50 p-4 sm:flex-row sm:items-center sm:justify-between shadow-sm">
            <div>
              <h2 className="text-sm font-bold text-gray-900">Training history</h2>
              <p className="mt-1 text-xs text-gray-500">
                {trainingJobs.length} shown / {allTrainingJobs.length} total
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <SegmentedFilter value={visibilityFilter} onChange={setVisibilityFilter} />
              <label className="flex items-center gap-2 text-xs font-semibold text-gray-500">
                Sort
                <select
                  className="h-8 rounded-lg border border-gray-300 bg-white px-2 text-xs font-semibold text-gray-700"
                  value={sortMode}
                  onChange={(event) => setSortMode(event.target.value as JobSortMode)}
                >
                  <option value="newest">Newest</option>
                  <option value="oldest">Oldest</option>
                  <option value="status">Status</option>
                  <option value="name">Name</option>
                </select>
              </label>
            </div>
            {isFetching && <span className="text-xs font-semibold text-gray-400">Refreshing list...</span>}
          </div>
          {trainingJobs.length === 0 ? (
            <div className="rounded-lg border border-dashed border-gray-300 bg-white p-8 text-center">
              <Archive className="mx-auto h-7 w-7 text-gray-400" />
              <h2 className="mt-3 text-sm font-bold text-gray-900">No jobs match this view</h2>
              <p className="mt-1 text-sm text-gray-500">Change the filter to Active, Archived, or All.</p>
            </div>
          ) : (
            <div className="space-y-4">
              {trainingJobs.map((job) => (
                <TrainingJobRow
                  key={job.id}
                  job={job}
                  refreshing={refreshingJobId === job.id}
                  downloading={downloadMutation.isPending}
                  cancelling={cancelMutation.isPending}
                  retrying={retryMutation.isPending}
                  onRefresh={() => handleRefreshJob(job)}
                  onDownload={() => downloadMutation.mutate(job)}
                  onCancel={() => setConfirmAction({ type: 'cancel', job })}
                  onRetry={() => setConfirmAction({ type: 'retry', job })}
                />
              ))}
            </div>
          )}
        </div>
      )}
      {confirmAction && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
          <div className="w-full max-w-md rounded-xl bg-white p-5 shadow-xl">
            <h3 className="text-base font-bold text-gray-900">
              {confirmAction.type === 'cancel' ? 'Cancel training job?' : 'Retry training job?'}
            </h3>
            <p className="mt-2 text-sm text-gray-600">
              {confirmAction.type === 'cancel'
                ? `This will stop ${jobLabel(confirmAction.job)} if it is still active.`
                : `Create a new training job using the same configuration as ${jobLabel(confirmAction.job)}?`}
            </p>
            <div className="mt-5 flex justify-end gap-2">
              <Button variant="secondary" size="sm" onClick={() => setConfirmAction(null)}>
                Close
              </Button>
              <Button
                size="sm"
                variant={confirmAction.type === 'cancel' ? 'danger' : 'primary'}
                loading={cancelMutation.isPending || retryMutation.isPending}
                onClick={() => {
                  if (confirmAction.type === 'cancel') {
                    cancelMutation.mutate(confirmAction.job);
                  } else {
                    retryMutation.mutate(confirmAction.job);
                  }
                }}
              >
                {confirmAction.type === 'cancel' ? 'Cancel job' : 'Retry job'}
              </Button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}

function SegmentedFilter({
  value,
  onChange,
}: {
  value: JobVisibilityFilter;
  onChange: (value: JobVisibilityFilter) => void;
}) {
  const options: Array<{ label: string; value: JobVisibilityFilter }> = [
    { label: 'Active', value: 'active' },
    { label: 'Archived', value: 'archived' },
    { label: 'All', value: 'all' },
  ];

  return (
    <div className="flex rounded-lg border border-gray-300 bg-gray-50 p-0.5">
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          className={`h-7 rounded-md px-3 text-xs font-bold ${
            value === option.value ? 'bg-black text-white' : 'text-gray-500 hover:bg-white hover:text-gray-900'
          }`}
          onClick={() => onChange(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}



function TrainingJobsSkeleton() {
  return (
    <div className="space-y-4">
      {[0, 1].map((item) => (
        <div key={item} className="animate-pulse rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
          <div className="flex items-center justify-between gap-4">
            <div className="h-5 w-48 rounded bg-gray-200" />
            <div className="h-7 w-24 rounded-full bg-gray-200" />
          </div>
          <div className="mt-4 grid gap-3 md:grid-cols-4">
            <div className="h-10 rounded bg-gray-100" />
            <div className="h-10 rounded bg-gray-100" />
            <div className="h-10 rounded bg-gray-100" />
            <div className="h-10 rounded bg-gray-100" />
          </div>
          <div className="mt-4 h-20 rounded bg-gray-100" />
        </div>
      ))}
    </div>
  );
}

function TrainingJobRow({
  job,
  onRefresh,
  refreshing,
  onDownload,
  downloading,
  onCancel,
  cancelling,
  onRetry,
  retrying,
}: {
  job: TrainingJob;
  onRefresh: (id: number) => void;
  refreshing: boolean;
  onDownload: (id: number) => void;
  downloading: boolean;
  onCancel: () => void;
  cancelling: boolean;
  onRetry: () => void;
  retrying: boolean;
}) {
  const { selectedModel } = useModelSelection();
  const isArchived = job.is_deleted;
  const backendLabel = job.training_backend || 'sagemaker';
  const isActive = ACTIVE_STATUSES.includes(job.status);
  const canRetry = job.status === 'failed' || job.status === 'cancelled';

  const elapsed = () => {
    if (job.completed_at && job.started_at) {
      return (new Date(job.completed_at).getTime() - new Date(job.started_at).getTime()) / 1000;
    }
    if (job.started_at && ['pending', 'uploading', 'running'].includes(job.status)) {
      return (new Date().getTime() - new Date(job.started_at).getTime()) / 1000;
    }
    return job.runtime_seconds || null;
  };
  const durationStr = (() => {
    const s = elapsed();
    if (!s) return '-';
    const hrs = Math.floor(s / 3600);
    const mins = Math.floor((s % 3600) / 60);
    const secs = Math.floor(s % 60);
    if (hrs > 0) return `${hrs}h ${mins}m`;
    if (mins > 0) return `${mins}m ${secs}s`;
    return `${secs}s`;
  })();

  const getAccentBorder = () => {
    if (isArchived) return 'border-l-4 border-l-gray-400 opacity-70 grayscale-[0.5]';
    if (job.status === 'completed') return 'border-l-4 border-l-emerald-500';
    if (job.status === 'failed') return 'border-l-4 border-l-red-500';
    if (job.status === 'cancelled') return 'border-l-4 border-l-amber-500';
    if (job.status === 'running') return 'border-l-4 border-l-blue-500';
    return 'border-l-4 border-l-gray-300';
  };

  return (
    <div className={`rounded-xl border border-gray-200 bg-white shadow-sm p-4 flex flex-col md:flex-row md:items-center justify-between gap-4 transition-all hover:shadow-md ${getAccentBorder()}`}>
      <div className="flex-1 min-w-0 flex flex-col gap-1.5">
        <div className="flex items-center gap-2.5">
          <Link to={selectedModel ? `/dashboard/model-training/${selectedModel.id}/job/${job.id}` : '#'} className="text-lg font-bold text-gray-900 hover:text-blue-600 hover:underline truncate">
            {job.name}
          </Link>
          <span className="rounded bg-gray-100 px-2 py-0.5 text-xs font-bold text-gray-600 border border-gray-200 shrink-0">
            {job.model_version}
          </span>
          <span className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider ${
             isArchived ? 'bg-gray-100 text-gray-600' :
             job.status === 'completed' ? 'bg-emerald-50 text-emerald-700' :
             job.status === 'failed' ? 'bg-red-50 text-red-700' :
             job.status === 'cancelled' ? 'bg-amber-50 text-amber-700' :
             job.status === 'running' ? 'bg-blue-50 text-blue-700 ring-1 ring-blue-200' :
             'bg-gray-50 text-gray-700'
          }`}>
             {isArchived ? 'Archived' : job.status}
          </span>
        </div>
        
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs font-medium text-gray-500">
           <span className="flex items-center gap-1"><Cpu className="w-3 h-3"/> {backendLabel}</span>
           <span className="flex items-center gap-1"><HardDrive className="w-3 h-3"/> {job.vcpu} vCPU, {job.memory / 1024} GB</span>
           {job.accelerator_type !== 'none' && (
             <span className="flex items-center gap-1 text-purple-600"><Rocket className="w-3 h-3"/> {job.accelerator_type.toUpperCase()} x{job.accelerator_count}</span>
           )}
           <span className="flex items-center gap-1"><Clock3 className="w-3 h-3"/> {durationStr} / {job.max_runtime_seconds}s</span>
        </div>
      </div>

      <div className="flex shrink-0 items-center gap-2">
         {!isArchived && (
           <Button
             variant="secondary"
             size="sm"
             icon={<RefreshCw className="h-4 w-4" />}
             loading={refreshing}
             onClick={() => onRefresh(job.id)}
           >
             Refresh
           </Button>
         )}
         {!isArchived && job.status === 'completed' && (
           <Button
             variant="secondary"
             size="sm"
             icon={<Download className="h-4 w-4" />}
             loading={downloading}
             onClick={() => onDownload(job.id)}
           >
             Download
           </Button>
         )}
         {!isArchived && isActive && (
           <Button
             variant="danger"
             size="sm"
             loading={cancelling}
             onClick={onCancel}
           >
             Cancel
           </Button>
         )}
         {!isArchived && canRetry && (
           <Button
             variant="secondary"
             size="sm"
             loading={retrying}
             onClick={onRetry}
           >
             Retry
           </Button>
         )}
         <Link to={selectedModel ? `/dashboard/model-training/${selectedModel.id}/job/${job.id}` : '#'}>
           <Button
             variant="primary"
             size="sm"
             icon={<Eye className="h-4 w-4" />}
           >
             View details
           </Button>
         </Link>
      </div>
    </div>
  );
}

