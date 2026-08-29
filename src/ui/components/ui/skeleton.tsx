import type { HTMLAttributes } from 'react';
import { cn } from '@/shared/class-names.ts';

export const Skeleton = ({ className, ...props }: HTMLAttributes<HTMLDivElement>): React.JSX.Element => (
  <div className={cn('animate-pulse rounded-md bg-secondary motion-reduce:animate-none', className)} {...props} />
);
