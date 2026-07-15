import { cn } from '@/shared/lib/cn';

export interface SegmentedControlOption<T extends string | number> {
  value: T;
  title: string;
}

export interface SwitchProps<T extends string | number> {
  value: T;
  onChange: (value: T) => void;
  options: readonly SegmentedControlOption<T>[];
  className?: string;
  ariaLabel?: string;
}

export function Switch<T extends string | number>({
  value,
  onChange,
  options,
  className,
  ariaLabel,
}: SwitchProps<T>) {
  return (
    <div className="flex justify-center">
      <div 
        className={cn('inline-flex rounded-sm shadow-sm w-100', className)} 
        role="tablist" 
        aria-label={ariaLabel}
      >
        {options.map((option, index) => {
          const isSelected = value === option.value;
          return (
            <button
              key={String(option.value)}
              type="button"
              role="tab"
              aria-selected={isSelected}
              onClick={() => onChange(option.value)}
              className={cn(
                'flex-1 px-4 py-2.5 text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:z-10 border',
                index === 0 ? 'rounded-l-sm' : index === options.length - 1 ? 'rounded-r-sm -ml-px' : '-ml-px',
                isSelected
                  ? 'bg-primary border-primary text-primary-foreground z-10'
                  : 'bg-surface border-border text-muted-foreground hover:bg-muted hover:text-foreground'
              )}
            >
              {option.title}
            </button>
          );
        })}
      </div>
    </div>
  );
}
