import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { Button, type ButtonProps } from './Button';

interface IconButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children'> {
  label: string;
  icon: ReactNode;
  variant?: ButtonProps['variant'];
}

export function IconButton({ label, icon, variant = 'ghost', ...props }: IconButtonProps) {
  return (
    <Button size="icon" variant={variant} aria-label={label} title={label} {...props}>
      <span aria-hidden="true">{icon}</span>
    </Button>
  );
}
