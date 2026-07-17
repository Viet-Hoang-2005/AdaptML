import { cva } from 'class-variance-authority';

export const buttonVariants = cva(
  'inline-flex select-none items-center justify-center whitespace-nowrap border font-semibold transition-[background-color,border-color,color,box-shadow,opacity] duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50',
  {
    variants: {
      variant: {
        primary: 'border-primary bg-primary text-primary-foreground hover:border-primary-hover hover:bg-primary-hover active:opacity-70',
        secondary: 'border-border bg-surface text-foreground shadow-sm hover:bg-muted active:bg-muted/80',
        outline: 'border-border bg-transparent text-foreground hover:bg-muted',
        ghost: 'border-transparent bg-transparent text-muted-foreground hover:bg-muted hover:text-foreground',
        danger: 'border-danger bg-danger text-white shadow-sm hover:opacity-90',
        'danger-outline': 'border-danger/30 bg-danger-subtle text-danger hover:border-danger hover:bg-danger hover:text-white',
      },
      size: {
        sm: 'h-8 gap-1.5 rounded-lg px-3 text-xs',
        md: 'h-10 gap-2 rounded-lg px-4 text-sm',
        lg: 'h-12 gap-2 rounded-lg px-5 text-sm',
        icon: 'h-10 w-10 rounded-[8px] p-0',
      },
    },
    defaultVariants: { variant: 'primary', size: 'lg' },
  },
);
