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
    tone === 'success' ? 'text-emerald-600' :
    tone === 'error' ? 'text-red-600' :
    tone === 'warning' ? 'text-amber-600' :
    tone === 'info' ? 'text-blue-500' :
    'text-gray-500';

  return (
    <div className="rounded-lg border border-gray-300 bg-white p-4">
      <div className="flex items-center justify-between">
        <p className="text-xs font-semibold uppercase tracking-wide text-gray-400">{label}</p>
        <div className={iconColor}>{icon}</div>
      </div>
      <p className="mt-2 text-xl font-bold text-gray-900 truncate" title={typeof value === 'string' ? value : undefined}>{value}</p>
      {helper && <p className="mt-1 text-xs text-gray-500 truncate" title={helper}>{helper}</p>}
    </div>
  );
}
