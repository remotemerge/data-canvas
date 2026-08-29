import type { LabelHTMLAttributes } from 'react';
import { cn } from '@/shared/class-names.ts';

export const Label = ({ className, ...props }: LabelHTMLAttributes<HTMLLabelElement>): React.JSX.Element => (
  <label className={cn('grid gap-1 text-xs font-medium text-foreground', className)} {...props} />
);
