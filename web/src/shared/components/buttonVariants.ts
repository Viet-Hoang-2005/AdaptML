import { cva } from 'class-variance-authority';

export const buttonVariants = cva(
  'inline-flex select-none items-center justify-center whitespace-nowrap border font-semibold transition-[background-color,border-color,color,box-shadow] duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:pointer-events-none disabled:cursor-not-allowed disabled:border-border disabled:bg-surface-disabled disabled:text-foreground-disabled',
  {
    variants: {
      variant: {
        primary: 'border-primary bg-primary text-primary-foreground hover:border-primary-hover hover:bg-primary-hover active:border-primary-active active:bg-primary-active',
        secondary: 'border-border bg-surface text-foreground shadow-sm hover:border-border-strong hover:bg-surface-hover active:bg-surface-active',
        outline: 'border-border bg-transparent text-foreground hover:border-border-strong hover:bg-surface-hover active:bg-surface-active',
        ghost: 'border-transparent bg-transparent text-foreground-muted hover:bg-surface-hover hover:text-foreground active:bg-surface-active',
        info: 'border-info bg-info text-info-foreground shadow-sm hover:border-info-hover hover:bg-info-hover active:border-info-active active:bg-info-active',
        success: 'border-success bg-success text-success-foreground shadow-sm hover:border-success-hover hover:bg-success-hover active:border-success-active active:bg-success-active',
        warning: 'border-warning bg-warning text-warning-foreground shadow-sm hover:border-warning-hover hover:bg-warning-hover active:border-warning-active active:bg-warning-active',
        danger: 'border-danger bg-danger text-danger-foreground shadow-sm hover:border-danger-hover hover:bg-danger-hover active:border-danger-active active:bg-danger-active',
        'danger-outline': 'border-danger-border bg-danger-subtle text-danger hover:border-danger hover:bg-danger hover:text-danger-foreground active:border-danger-active active:bg-danger-active',
      },
      size: {
        sm: 'h-8 gap-1.5 rounded-control px-3 text-xs',
        md: 'h-10 gap-2 rounded-control px-4 text-sm',
        lg: 'h-12 gap-2 rounded-control px-5 text-sm',
        icon: 'h-10 w-10 rounded-surface p-0',
      },
    },
    defaultVariants: { variant: 'primary', size: 'lg' },
  },
);
