import { forwardRef, useId, type InputHTMLAttributes, type ReactNode } from 'react';
import { cn } from '@/shared/lib/cn';

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  error?: string;
  helperText?: string;
  icon?: ReactNode;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { label, error, helperText, icon, className, id, ...props },
  ref,
) {
  const generatedId = useId();
  const inputId = id || generatedId;
  const messageId = `${inputId}-message`;
  return (
    <div className="flex w-full flex-col gap-2">
      {label && <label htmlFor={inputId} className="text-sm font-medium text-foreground">{label}</label>}
      <div className="relative">
        {icon && <span className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-muted-foreground" aria-hidden="true">{icon}</span>}
        <input
          ref={ref}
          id={inputId}
          aria-invalid={Boolean(error) || undefined}
          aria-describedby={error || helperText ? messageId : undefined}
          className={cn(
            `h-14 w-full px-4 rounded-2xl 
            border border-input bg-surface
            text-sm text-foreground outline-none transition-colors 
            placeholder:text-muted-foreground hover:border-primary 
            focus:border-primary focus:ring-2 focus:ring-ring/15 
            disabled:cursor-not-allowed disabled:bg-muted disabled:text-muted-foreground`,
            icon && 'pl-11',
            error && 'border-danger focus:border-danger focus:ring-danger/15',
            className,
          )}
          {...props}
        />
      </div>
      {(error || helperText) && (
        <span id={messageId} role={error ? 'alert' : undefined} className={cn('text-xs', error ? 'text-danger' : 'text-muted-foreground')}>
          {error || helperText}
        </span>
      )}
    </div>
  );
});

export const InputPassword = forwardRef<HTMLInputElement, InputProps>(function InputPassword(props, ref) {
  return <Input ref={ref} {...props} type="password" />;
});
