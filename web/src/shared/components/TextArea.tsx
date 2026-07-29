import { forwardRef, useId, type TextareaHTMLAttributes } from "react";
import { cn } from "@/shared/lib/cn";

export interface TextAreaProps extends Omit<
  TextareaHTMLAttributes<HTMLTextAreaElement>,
  "onChange"
> {
  label?: string;
  error?: string;
  helperText?: string;
  minHeight?: string;
  onChange?: (value: string) => void;
}

export const TextArea = forwardRef<HTMLTextAreaElement, TextAreaProps>(
  function TextArea(
    {
      id,
      label,
      error,
      helperText,
      minHeight = "min-h-24",
      className,
      onChange,
      ...props
    },
    ref,
  ) {
    const generatedId = useId();
    const inputId = id || generatedId;
    const messageId = `${inputId}-message`;
    return (
      <div className="flex w-full flex-col gap-2">
        {label && (
          <label
            htmlFor={inputId}
            className="text-sm font-medium text-foreground"
          >
            {label}
          </label>
        )}
        <textarea
          ref={ref}
          id={inputId}
          aria-invalid={Boolean(error) || undefined}
          aria-describedby={error || helperText ? messageId : undefined}
          onChange={(event) => onChange?.(event.target.value)}
          className={cn(
            minHeight,
            "w-full resize-y rounded-xl border border-input bg-surface px-4 py-3 text-sm text-foreground shadow-sm outline-none transition-colors placeholder:text-foreground-subtle hover:border-input-hover focus:border-ring focus:ring-2 focus:ring-ring/20 disabled:cursor-not-allowed disabled:border-border disabled:bg-surface-disabled disabled:text-foreground-disabled disabled:hover:border-border",
            error && "border-danger hover:border-danger focus:border-danger focus:ring-danger/20",
            className,
          )}
          {...props}
        />
        {(error || helperText) && (
          <span
            id={messageId}
            role={error ? "alert" : undefined}
            className={cn(
              "text-xs",
              error ? "text-danger" : "text-foreground-subtle",
            )}
          >
            {error || helperText}
          </span>
        )}
      </div>
    );
  },
);
