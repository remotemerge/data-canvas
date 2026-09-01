import type { HTMLAttributes } from 'react';
import { cn } from '@/shared/class-names.ts';

export const Badge = ({ className, ...props }: HTMLAttributes<HTMLSpanElement>): React.JSX.Element => (
  <span
    className={cn(
      'inline-flex h-5 items-center rounded-md border border-border px-1.5 text-[11px] text-muted-foreground',
      className,
    )}
    {...props}
  />
);
