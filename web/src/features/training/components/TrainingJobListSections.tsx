import { Link } from 'react-router-dom';
import { Clock3, Cpu, Download, Eye, HardDrive, RefreshCw, Rocket } from 'lucide-react';

import { Button } from '@/shared/ui/Button';
import { useModelSelection } from '@/features/catalog/hooks/useModelSelection';
import type { TrainingJob, TrainingJobStatus } from '@/features/training/types';

export type JobVisibilityFilter = 'active' | 'archived' | 'all';

const activeStatuses: TrainingJobStatus[] = ['pending', 'uploading', 'running'];

export function SegmentedJobFilter({
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
    <div
      aria-label="Training job visibility"
      className="flex rounded-lg border border-[var(--color-border)] bg-[var(--color-muted)] p-0.5"
      role="group"
    >
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          aria-pressed={value === option.value}
          className={`h-7 rounded-md px-3 text-xs font-bold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-ring)] ${
            value === option.value
              ? 'bg-[var(--color-foreground)] text-[var(--color-background)]'
              : 'text-[var(--color-muted-foreground)] hover:bg-[var(--color-surface)] hover:text-[var(--color-foreground)]'
          }`}
          onClick={() => onChange(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

export function TrainingJobsSkeleton() {
  return (
    <div className="space-y-4" aria-label="Loading training jobs" aria-live="polite">
      {[0, 1].map((item) => (
        <div
          key={item}
          className="animate-pulse rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-5 shadow-sm"
        >
          <div className="flex items-center justify-between gap-4">
            <div className="h-5 w-48 rounded bg-[var(--color-muted)]" />
            <div className="h-7 w-24 rounded-full bg-[var(--color-muted)]" />
          </div>
          <div className="mt-4 grid gap-3 md:grid-cols-4">
            {[0, 1, 2, 3].map((metric) => (
              <div key={metric} className="h-10 rounded bg-[var(--color-muted)]" />
            ))}
          </div>
          <div className="mt-4 h-20 rounded bg-[var(--color-muted)]" />
        </div>
      ))}
    </div>
  );
}

interface TrainingJobRowProps {
  job: TrainingJob;
  onRefresh: () => void;
  refreshing: boolean;
  onDownload: () => void;
  downloading: boolean;
  onCancel: () => void;
  cancelling: boolean;
  onRetry: () => void;
  retrying: boolean;
}

export function TrainingJobRow({
  job,
  onRefresh,
  refreshing,
  onDownload,
  downloading,
  onCancel,
  cancelling,
  onRetry,
  retrying,
}: TrainingJobRowProps) {
  const { selectedModel } = useModelSelection();
  const isArchived = job.is_deleted;
  const backendLabel = job.training_backend || 'kubeflow';
  const isActive = activeStatuses.includes(job.status);
  const canRetry = job.status === 'failed' || job.status === 'cancelled';
  const detailsUrl = selectedModel
    ? `/dashboard/model-training/${selectedModel.id}/job/${job.id}`
    : '#';

  const elapsedSeconds = (() => {
    if (job.completed_at && job.started_at) {
      return (new Date(job.completed_at).getTime() - new Date(job.started_at).getTime()) / 1000;
    }
    return job.runtime_seconds || null;
  })();

  const duration = (() => {
    if (!elapsedSeconds) return '-';
    const hours = Math.floor(elapsedSeconds / 3600);
    const minutes = Math.floor((elapsedSeconds % 3600) / 60);
    const seconds = Math.floor(elapsedSeconds % 60);
    if (hours > 0) return `${hours}h ${minutes}m`;
    if (minutes > 0) return `${minutes}m ${seconds}s`;
    return `${seconds}s`;
  })();

  const accentClass = (() => {
    if (isArchived) return 'border-l-4 border-l-[var(--color-muted-foreground)] opacity-70 grayscale-[0.5]';
    if (job.status === 'completed') return 'border-l-4 border-l-[var(--color-success)]';
    if (job.status === 'failed') return 'border-l-4 border-l-[var(--color-danger)]';
    if (job.status === 'cancelled') return 'border-l-4 border-l-[var(--color-warning)]';
    if (job.status === 'running') return 'border-l-4 border-l-[var(--color-primary)]';
    return 'border-l-4 border-l-[var(--color-input)]';
  })();

  const statusClass = isArchived
    ? 'bg-[var(--color-muted)] text-[var(--color-muted-foreground)]'
    : job.status === 'completed'
      ? 'bg-[var(--color-success-subtle)] text-[var(--color-success)]'
      : job.status === 'failed'
        ? 'bg-[var(--color-danger-subtle)] text-[var(--color-danger)]'
        : job.status === 'cancelled'
          ? 'bg-[var(--color-warning-subtle)] text-[var(--color-warning)]'
          : job.status === 'running'
            ? 'bg-[var(--color-primary-subtle)] text-[var(--color-primary)] ring-1 ring-[var(--color-primary)]/20'
            : 'bg-[var(--color-muted)] text-[var(--color-muted-foreground)]';

  return (
    <article
      className={`flex flex-col justify-between gap-4 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-4 shadow-sm transition-shadow hover:shadow-md md:flex-row md:items-center ${accentClass}`}
    >
      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        <div className="flex items-center gap-2.5">
          <Link
            to={detailsUrl}
            className="truncate text-lg font-bold text-[var(--color-foreground)] hover:text-[var(--color-primary)] hover:underline"
          >
            {job.name}
          </Link>
          <span className="shrink-0 rounded border border-[var(--color-border)] bg-[var(--color-muted)] px-2 py-0.5 text-xs font-bold text-[var(--color-muted-foreground)]">
            {job.model_version}
          </span>
          <span className={`rounded px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider ${statusClass}`}>
            {isArchived ? 'Archived' : job.status}
          </span>
        </div>

        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs font-medium text-[var(--color-muted-foreground)]">
          <span className="flex items-center gap-1"><Cpu className="h-3 w-3" /> {backendLabel}</span>
          <span className="flex items-center gap-1"><HardDrive className="h-3 w-3" /> {job.vcpu} vCPU, {job.memory / 1024} GB</span>
          {job.accelerator_type !== 'none' ? (
            <span className="flex items-center gap-1 text-[var(--color-primary)]"><Rocket className="h-3 w-3" /> {job.accelerator_type.toUpperCase()} x{job.accelerator_count}</span>
          ) : null}
          <span className="flex items-center gap-1"><Clock3 className="h-3 w-3" /> {duration} / {job.max_runtime_seconds}s</span>
        </div>
      </div>

      <div className="flex shrink-0 flex-wrap items-center gap-2">
        {!isArchived ? (
          <Button variant="secondary" size="sm" icon={<RefreshCw className="h-4 w-4" />} loading={refreshing} onClick={onRefresh}>
            Refresh
          </Button>
        ) : null}
        {!isArchived && job.status === 'completed' ? (
          <Button variant="secondary" size="sm" icon={<Download className="h-4 w-4" />} loading={downloading} onClick={onDownload}>
            Download
          </Button>
        ) : null}
        {!isArchived && isActive ? (
          <Button variant="danger" size="sm" loading={cancelling} onClick={onCancel}>Cancel</Button>
        ) : null}
        {!isArchived && canRetry ? (
          <Button variant="secondary" size="sm" loading={retrying} onClick={onRetry}>Retry</Button>
        ) : null}
        <Link to={detailsUrl}>
          <Button variant="primary" size="sm" icon={<Eye className="h-4 w-4" />}>View details</Button>
        </Link>
      </div>
    </article>
  );
}
