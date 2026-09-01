import type { ButtonHTMLAttributes } from 'react';
import { cn } from '@/shared/class-names.ts';

type ButtonVariant = 'default' | 'secondary' | 'outline' | 'ghost' | 'destructive';
type ButtonSize = 'default' | 'sm' | 'icon';

const base =
  'inline-flex shrink-0 items-center justify-center gap-1.5 rounded-md text-[13px] font-medium transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:pointer-events-none disabled:opacity-50 motion-reduce:transition-none';

const variants: Record<ButtonVariant, string> = {
  default: 'bg-primary text-primary-foreground hover:bg-[var(--primary-hover)] active:bg-[var(--primary-active)]',
  secondary: 'bg-secondary text-secondary-foreground hover:bg-[var(--table-hover)]',
  outline: 'border border-border-strong bg-background text-foreground hover:bg-secondary',
  ghost: 'text-foreground hover:bg-secondary',
  destructive: 'bg-destructive text-destructive-foreground hover:brightness-95',
};

const sizes: Record<ButtonSize, string> = {
  default: 'h-8 px-3',
  sm: 'h-7 px-2 text-xs',
  icon: 'size-8 px-0',
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
}

export const Button = ({
  className,
  variant = 'default',
  size = 'default',
  type = 'button',
  ...props
}: ButtonProps): React.JSX.Element => (
  <button type={type} className={cn(base, variants[variant], sizes[size], className)} {...props} />
);
