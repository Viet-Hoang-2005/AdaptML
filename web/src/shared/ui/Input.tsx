import { Eye, EyeOff } from 'lucide-react';
import { forwardRef, useId, useState, type InputHTMLAttributes, type ReactNode } from 'react';
import { cn } from '@/shared/lib/cn';
import { useTranslation } from 'react-i18next';

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
        {icon && <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" aria-hidden="true">{icon}</span>}
        <input
          ref={ref}
          id={inputId}
          aria-invalid={Boolean(error) || undefined}
          aria-describedby={error || helperText ? messageId : undefined}
          className={cn(
            'h-14 w-full rounded-[16px] border border-input bg-surface px-4 text-sm text-foreground outline-none transition-colors placeholder:text-muted-foreground hover:border-primary focus:border-primary focus:ring-2 focus:ring-ring/15 disabled:cursor-not-allowed disabled:bg-muted disabled:text-muted-foreground',
            icon && 'pl-10',
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
  const { t } = useTranslation('common');
  const [visible, setVisible] = useState(false);
  return (
    <div className="relative">
      <Input ref={ref} {...props} type={visible ? 'text' : 'password'} className={cn('pr-12', props.className)} />
      <button
        type="button"
        onClick={() => setVisible((current) => !current)}
        className="absolute right-2 top-9 flex h-9 w-9 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground"
        aria-label={visible ? t('accessibility.hidePassword') : t('accessibility.showPassword')}
      >
        {visible ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
      </button>
    </div>
  );
});
