import type { ReactNode } from 'react';
import { useModelSelection } from '@/features/catalog/hooks/useModelSelection';

export interface PlaceholderProps {
  title: string;
  description: string;
  icon: ReactNode;
  action?: ReactNode;
  showModelName?: boolean;
}

export function Placeholder({ title, description, icon, action, showModelName = true }: PlaceholderProps) {
  const { selectedModel } = useModelSelection();

  return (
    <section className="flex-1 rounded-lg border border-dashed border-border bg-surface px-8 py-10">
      <div className="flex h-full flex-col items-center justify-center text-center">
        <div className="mb-5 flex h-12 w-12 items-center justify-center rounded-lg bg-muted text-foreground">
          {icon}
        </div>
        {showModelName && (
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            {selectedModel ? selectedModel.name : 'No model selected'}
          </p>
        )}
        <h1 className="mb-3 text-2xl font-bold text-foreground">{title}</h1>
        <p className="max-w-lg text-sm leading-6 text-muted-foreground">{description}</p>
        {action && <div className="mt-6">{action}</div>}
      </div>
    </section>
  );
}
