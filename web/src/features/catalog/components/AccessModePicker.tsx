import type { ModelAccessMode } from '@/features/catalog/types';

export function AccessModePicker({
  value,
  onChange,
}: {
  value: ModelAccessMode;
  onChange: (value: ModelAccessMode) => void;
}) {
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {(['private', 'public'] as ModelAccessMode[]).map((mode) => (
        <button
          key={mode}
          type="button"
          onClick={() => onChange(mode)}
          className={`rounded-2xl border px-4 py-4 text-left transition-colors ${
            value === mode
              ? 'border-primary bg-primary text-primary-foreground'
              : 'border-border bg-surface text-foreground hover:border-primary'
          }`}
        >
          <span className="text-sm font-bold capitalize">{mode} API</span>
          <p className={`mt-1 text-xs ${value === mode ? 'text-muted-foreground' : 'text-muted-foreground'}`}>
            {mode === 'private' ? 'Requires JWT or API key.' : 'Allows public prediction requests.'}
          </p>
        </button>
      ))}
    </div>
  );
}
