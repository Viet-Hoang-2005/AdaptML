import type { ElementType } from 'react';
import type { TrainingJobEvent } from '@/features/training/types';
import { Badge } from '@/shared/ui/Badge';

export type MilestoneState = 'pending' | 'active' | 'completed' | 'failed' | 'cancelled' | 'skipped';

export interface TrainingMilestone {
  id: string;
  label: string;
  state: MilestoneState;
  icon: ElementType;
  timestamp: string;
  helper?: string;
}

export function MetadataRow({ label, value, monospace = false }: { label: string; value: string; monospace?: boolean }) {
  return (
    <div className="flex flex-col gap-1.5 py-1">
      <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{label}</span>
      <span className={monospace ? 'w-fit rounded-lg border border-border bg-muted px-2 py-1 font-mono text-sm text-foreground' : 'text-sm font-medium text-foreground'}>{value}</span>
    </div>
  );
}

export function LiveStatusBadge() {
  return <Badge variant="success"><span className="h-1.5 w-1.5 animate-pulse rounded-full bg-current" />Live polling</Badge>;
}

const milestoneTone: Record<MilestoneState, string> = {
  pending: 'border-border bg-surface text-muted-foreground',
  active: 'border-primary bg-primary/10 text-primary ring-4 ring-primary/10',
  completed: 'border-success bg-success/10 text-success',
  failed: 'border-danger bg-danger-subtle text-danger ring-4 ring-danger/10',
  cancelled: 'border-warning bg-warning/10 text-warning ring-4 ring-warning/10',
  skipped: 'border-border bg-muted text-muted-foreground opacity-60',
};

export function MilestoneTracker({ milestones }: { milestones: TrainingMilestone[] }) {
  return (
    <ol className="flex min-w-150 w-full items-start justify-between" aria-label="Training progress">
      {milestones.map((milestone, index) => {
        const Icon = milestone.icon;
        const isLast = index === milestones.length - 1;
        const finished = milestone.state === 'completed';
        return (
          <li key={milestone.id} className={`relative flex ${isLast ? 'flex-none' : 'flex-1'} flex-col`} aria-current={milestone.state === 'active' ? 'step' : undefined}>
            <div className="flex w-full items-center">
              <span className={`relative z-10 flex h-10 w-10 shrink-0 items-center justify-center rounded-full border-2 transition-all ${milestoneTone[milestone.state]}`}>
                <Icon className={milestone.state === 'active' ? 'h-5 w-5 animate-pulse' : 'h-5 w-5'} />
              </span>
              {!isLast && <span className={`mx-2 h-1 flex-1 rounded-full ${finished ? 'bg-success' : 'bg-border'}`} />}
            </div>
            <div className="mt-4 w-36 pr-4">
              <span className="text-sm font-semibold text-foreground">{milestone.label}</span>
              <span className="mt-1 block text-xs text-muted-foreground">{milestone.timestamp}</span>
              {milestone.helper && <span className="mt-1 block text-xs text-muted-foreground">{milestone.helper}</span>}
            </div>
          </li>
        );
      })}
    </ol>
  );
}

export function TrainingEventHistory({ events }: { events: TrainingJobEvent[] }) {
  if (!events.length) {
    return <div className="mt-6 rounded-xl border border-dashed border-border bg-muted/50 p-4 text-sm text-muted-foreground">Event history will appear as the backend records lifecycle updates.</div>;
  }
  return (
    <section className="mt-6 rounded-xl border border-border bg-muted/50 p-4" aria-labelledby="training-event-history-title">
      <h3 id="training-event-history-title" className="mb-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Event history</h3>
      <ol className="space-y-3">
        {events.map((event) => (
          <li key={event.id} className="flex gap-3 text-sm">
            <time className="w-36 shrink-0 text-muted-foreground" dateTime={event.created_at}>{new Date(event.created_at).toLocaleString()}</time>
            <div className="min-w-0"><p className="font-semibold text-foreground">{event.event_type.replace(/_/g, ' ')}</p><p className="wrap-break-words text-muted-foreground">{event.message}</p></div>
          </li>
        ))}
      </ol>
    </section>
  );
}
