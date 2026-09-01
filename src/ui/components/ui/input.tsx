import type { InputHTMLAttributes } from 'react';
import { cn } from '@/shared/class-names.ts';

export const Input = ({ className, type, ...props }: InputHTMLAttributes<HTMLInputElement>): React.JSX.Element => (
  <input
    type={type}
    className={cn(
      'h-8 w-full rounded-md border border-input bg-background px-2.5 text-[13px] text-foreground outline-none placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50',
      className,
    )}
    {...props}
  />
);
