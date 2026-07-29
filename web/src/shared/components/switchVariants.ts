import { cva } from 'class-variance-authority';

export const switchVariants = cva(
  'inline-flex items-center justify-center whitespace-nowrap transition-[background-color,border-color,color,box-shadow,opacity] duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:z-10 font-semibold border',
  {
    variants: {
      size: {
        sm: 'h-8 px-3 text-xs',
        md: 'h-10 px-4 text-sm',
        lg: 'h-12 px-5 text-sm',
      },
      selected: {
        true: 'bg-primary-subtle border-primary text-foreground z-10',
        false: 'bg-surface border-border text-foreground-muted hover:bg-surface-hover hover:text-foreground active:bg-surface-active',
      }
    },
    defaultVariants: {
      size: 'md',
      selected: false,
    },
  }
);
