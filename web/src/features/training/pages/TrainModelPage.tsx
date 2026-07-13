import { useNavigate } from 'react-router-dom';
import { Archive, FileCode2, RefreshCw, Rocket } from 'lucide-react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/shared/ui/Button';
import {
  cancelTrainingJob,
  getTrainingJobDownloadUrl,
  getTrainingUsage,
  listTrainingJobs,
  refreshTrainingJobStatus,
  retryTrainingJob,
} from '@/features/training/api/trainingApi';
import { getApiErrorMessage } from '@/shared/api/errors';
import { trainingQueryKeys } from '@/features/training/queryKeys';
import { toast } from '@/shared/ui/toastStore';
import { formatDuration } from '@/shared/lib/formatDuration';
import { useModelSelection } from '@/features/catalog/hooks/useModelSelection';
import type { TrainingJob, TrainingJobStatus } from '@/features/training/types';
import {
  SegmentedJobFilter,
  TrainingJobRow,
  TrainingJobsSkeleton,
  type JobVisibilityFilter,
} from '@/features/training/components/TrainingJobListSections';

const statusLabels: Record<TrainingJobStatus, string> = {
  pending: 'Pending',
  queued: 'Queued',
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

type JobSortMode = 'newest' | 'oldest' | 'status' | 'name';

const statusRank: Record<TrainingJobStatus, number> = {
  running: 0,
  uploading: 1,
  queued: 2,
  pending: 3,
  failed: 4,
  cancelled: 5,
  completed: 6,
};

const sortTrainingJobs = (jobs: TrainingJob[], sortMode: JobSortMode) => {
  const nextJobs = [...jobs];
  if (sortMode === 'oldest') {
    return nextJobs.sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
  }
  if (sortMode === 'status') {
    return nextJobs.sort((a, b) => statusRank[a.status] - statusRank[b.status] || b.id.localeCompare(a.id));
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
  const { t } = useTranslation('training');
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const { selectedModel } = useModelSelection();

  const [refreshingJobId, setRefreshingJobId] = useState<string | null>(null);
  const [confirmAction, setConfirmAction] = useState<{ type: 'cancel' | 'retry'; job: TrainingJob } | null>(null);
  const [visibilityFilter, setVisibilityFilter] = useState<JobVisibilityFilter>('active');
  const [sortMode, setSortMode] = useState<JobSortMode>('newest');
  const statusNotificationRef = useRef<Record<string, TrainingJobStatus>>({});
  const {
    data,
    error: jobsError,
    isError,
    isFetching,
    isLoading,
    refetch,
  } = useQuery({
    queryKey: trainingQueryKeys.jobs(),
    queryFn: () => listTrainingJobs(true),
  });
  const { data: usage, isLoading: isUsageLoading } = useQuery({
    queryKey: trainingQueryKeys.usage(),
    queryFn: getTrainingUsage,
    refetchInterval: 15000,
  });
  const allTrainingJobs = useMemo(() => data?.training_jobs ?? [], [data?.training_jobs]);
  const activeTrainingJobs = useMemo(
    () => allTrainingJobs.filter((job) => !job.is_deleted && Boolean(job.id) && isActiveJob(job)),
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
    () => queryClient.invalidateQueries({ queryKey: trainingQueryKeys.jobs() }),
    [queryClient],
  );
  const invalidateUsage = useCallback(
    () => queryClient.invalidateQueries({ queryKey: trainingQueryKeys.usage() }),
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
          queryClient.setQueryData(trainingQueryKeys.jobs(), (oldData: { training_jobs: TrainingJob[] } | undefined) => {
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
      queryClient.setQueryData(trainingQueryKeys.jobs(), (current: { training_jobs: TrainingJob[] } | undefined) => ({
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
      queryClient.setQueryData(trainingQueryKeys.jobs(), (current: { training_jobs: TrainingJob[] } | undefined) => ({
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
      queryClient.setQueryData(trainingQueryKeys.jobs(), (current: { training_jobs: TrainingJob[] } | undefined) => ({
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
      <div className="flex flex-col gap-4 border-b border-border pb-5 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground">{t('title')}</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {t('description')}
          </p>
        </div>
        <Button
          icon={<Rocket className="h-4 w-4" />}
          onClick={() => navigate(selectedModel ? `/dashboard/model-training/${selectedModel.id}/new` : '/dashboard/model-training')}
        >
          {t('newJob')}
        </Button>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <div className="md:col-span-2 rounded-xl border border-border bg-surface p-5 shadow-sm">
          <div className="mb-4 flex items-center justify-between">
            <div>
              <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground">{t('quota')}</p>
              <div className="mt-1 flex items-baseline gap-2">
                <span className="text-2xl font-bold text-foreground">
                  {isUsageLoading ? '...' : formatDuration(usage?.monthly_runtime_seconds)}
                </span>
                <span className="text-sm font-medium text-muted-foreground">
                  {t('used', { duration: formatDuration(usage?.monthly_quota_seconds || 43200) })}
                </span>
              </div>
            </div>
            <div className="text-right">
              <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground">{t('remaining')}</p>
              <p className={`mt-1 text-lg font-bold ${
                usage && usage.remaining_seconds < (usage.monthly_quota_seconds * 0.1) 
                  ? 'text-danger'
                  : usage && usage.remaining_seconds < (usage.monthly_quota_seconds * 0.3) 
                    ? 'text-warning'
                    : 'text-success'
              }`}>
                {isUsageLoading ? '...' : formatDuration(usage?.remaining_seconds)}
              </p>
            </div>
          </div>
          <div className="h-2.5 w-full overflow-hidden rounded-full bg-muted">
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
            ? 'border-primary/20 bg-primary-subtle'
            : 'border-border bg-surface'
        }`}>
          <p className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-muted-foreground">
            <Rocket className="h-4 w-4" />
            {t('activeJobs')}
          </p>
          <div className="mt-3 flex items-baseline gap-2">
            <span className={`text-3xl font-bold ${
              activeUsageCount > 0 ? 'text-primary' : 'text-foreground'
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
        <div className="rounded-lg border border-danger/20 bg-danger-subtle p-5">
          <h2 className="text-base font-bold text-danger">{t('loadFailed')}</h2>
          <p className="mt-1 text-sm text-danger">{getApiErrorMessage(jobsError, t('checkApi'))}</p>
          <Button className="mt-4" variant="secondary" size="sm" icon={<RefreshCw className="h-4 w-4" />} onClick={() => refetch()}>
            {t('retry')}
          </Button>
        </div>
      ) : allTrainingJobs.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border bg-surface p-10 text-center">
          <FileCode2 className="mx-auto h-8 w-8 text-muted-foreground" />
          <h2 className="mt-3 text-base font-bold text-foreground">{t('noJobs')}</h2>
          <p className="mt-1 text-sm text-muted-foreground">{t('noJobsDescription')}</p>
          <Button className="mt-4" icon={<Rocket className="h-4 w-4" />} onClick={() => navigate(selectedModel ? `/dashboard/model-training/${selectedModel.id}/new` : '/dashboard/model-training')}>
            {t('firstJob')}
          </Button>
        </div>
      ) : (
        <div className="space-y-4">
          <div className="flex flex-col gap-4 rounded-xl border border-border bg-muted/50 p-4 sm:flex-row sm:items-center sm:justify-between shadow-sm">
            <div>
              <h2 className="text-sm font-bold text-foreground">{t('history')}</h2>
              <p className="mt-1 text-xs text-muted-foreground">
                {t('historyCount', { shown: trainingJobs.length, total: allTrainingJobs.length })}
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <SegmentedJobFilter value={visibilityFilter} onChange={setVisibilityFilter} />
              <label className="flex items-center gap-2 text-xs font-semibold text-muted-foreground">
                {t('sort')}
                <select
                  className="h-8 rounded-lg border border-border bg-surface px-2 text-xs font-semibold text-foreground"
                  value={sortMode}
                  onChange={(event) => setSortMode(event.target.value as JobSortMode)}
                >
                  <option value="newest">{t('newest')}</option>
                  <option value="oldest">{t('oldest')}</option>
                  <option value="status">{t('status')}</option>
                  <option value="name">{t('name')}</option>
                </select>
              </label>
            </div>
            {isFetching && <span className="text-xs font-semibold text-muted-foreground">{t('refreshing')}</span>}
          </div>
          {trainingJobs.length === 0 ? (
            <div className="rounded-lg border border-dashed border-border bg-surface p-8 text-center">
              <Archive className="mx-auto h-7 w-7 text-muted-foreground" />
              <h2 className="mt-3 text-sm font-bold text-foreground">{t('noView')}</h2>
              <p className="mt-1 text-sm text-muted-foreground">{t('noViewDescription')}</p>
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
          <div className="w-full max-w-md rounded-xl bg-surface p-5 shadow-xl">
            <h3 className="text-base font-bold text-foreground">
              {confirmAction.type === 'cancel' ? t('cancelTitle') : t('retryTitle')}
            </h3>
            <p className="mt-2 text-sm text-muted-foreground">
              {confirmAction.type === 'cancel'
                ? t('cancelDescription', { job: jobLabel(confirmAction.job) })
                : t('retryDescription', { job: jobLabel(confirmAction.job) })}
            </p>
            <div className="mt-5 flex justify-end gap-2">
              <Button variant="secondary" size="sm" onClick={() => setConfirmAction(null)}>
                {t('close')}
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
                {confirmAction.type === 'cancel' ? t('cancelJob') : t('retryJob')}
              </Button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}

