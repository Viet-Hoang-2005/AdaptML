import type { ReactNode } from 'react';

export function SummaryCard({
  label,
  value,
  helper,
  icon,
  tone = 'default',
}: {
  label: string;
  value: ReactNode;
  helper?: string;
  icon?: ReactNode;
  tone?: 'default' | 'success' | 'warning' | 'error' | 'info';
}) {
  const iconColor =
    tone === 'success' ? 'text-success' :
    tone === 'error' ? 'text-danger' :
    tone === 'warning' ? 'text-warning' :
    tone === 'info' ? 'text-primary' :
    'text-muted-foreground';

  return (
    <div className="rounded-lg border border-border bg-surface p-4">
      <div className="flex items-center justify-between">
        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{label}</p>
        <div className={iconColor}>{icon}</div>
      </div>
      <p className="mt-2 text-xl font-bold text-foreground truncate" title={typeof value === 'string' ? value : undefined}>{value}</p>
      {helper && <p className="mt-1 text-xs text-muted-foreground truncate" title={helper}>{helper}</p>}
    </div>
  );
}
