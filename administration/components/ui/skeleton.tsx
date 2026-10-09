import type { ComponentProps } from 'react';

import { cn } from '@/lib/utils';

export function Skeleton({ className, ...props }: ComponentProps<'div'>) {
  return (
    <div aria-hidden className={cn('bg-line/70 animate-pulse rounded-md', className)} {...props} />
  );
}
