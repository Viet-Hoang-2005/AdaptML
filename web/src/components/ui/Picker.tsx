import type { ModelAccessMode } from '../../types/models';

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
              ? 'border-black bg-black text-white'
              : 'border-gray-300 bg-white text-gray-700 hover:border-black'
          }`}
        >
          <span className="text-sm font-bold capitalize">{mode} API</span>
          <p className={`mt-1 text-xs ${value === mode ? 'text-gray-300' : 'text-gray-500'}`}>
            {mode === 'private' ? 'Requires JWT or API key.' : 'Allows public prediction requests.'}
          </p>
        </button>
      ))}
    </div>
  );
}
