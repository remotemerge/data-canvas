import type { LabelHTMLAttributes } from 'react';
import { cn } from '@/shared/class-names.ts';

/*
 * `htmlFor` is required rather than optional so every use names the control it labels. The
 * association cannot be checked inside this component, since the control is supplied by the caller.
 */
interface LabelProps extends LabelHTMLAttributes<HTMLLabelElement> {
  htmlFor: string;
}

export const Label = ({ className, ...props }: LabelProps): React.JSX.Element => (
  <label className={cn('grid gap-1 text-xs font-medium text-foreground', className)} {...props} />
);
