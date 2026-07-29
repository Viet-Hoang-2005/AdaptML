import { cva, type VariantProps } from 'class-variance-authority';
import type { HTMLAttributes } from 'react';
import { cn } from '@/shared/lib/cn';

const badgeVariants = cva('inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-semibold', {
  variants: {
    variant: {
      neutral: 'border-border bg-muted text-muted-foreground',
      primary: 'border-primary/20 bg-primary/10 text-primary',
      success: 'border-success/20 bg-success/10 text-success',
      warning: 'border-warning/20 bg-warning/10 text-warning',
      danger: 'border-danger/20 bg-danger/10 text-danger',
    },
  },
  defaultVariants: { variant: 'neutral' },
});

export function Badge({ className, variant, ...props }: HTMLAttributes<HTMLSpanElement> & VariantProps<typeof badgeVariants>) {
  return <span className={cn(badgeVariants({ variant }), className)} {...props} />;
}
