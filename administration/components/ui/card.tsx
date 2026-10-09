import type { ComponentProps, ReactNode } from 'react';

import { cn } from '@/lib/utils';

export function Card({ className, ...props }: ComponentProps<'section'>) {
  return (
    <section
      className={cn('border-line bg-surface shadow-card rounded-xl border', className)}
      {...props}
    />
  );
}

export function CardHeader({
  title,
  description,
  actions,
  className,
}: {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  className?: string;
}) {
  return (
    <header
      className={cn(
        'border-line flex flex-wrap items-start justify-between gap-3 border-b px-5 py-4',
        className,
      )}
    >
      <div className="min-w-0">
        <h2 className="text-ink text-sm font-semibold">{title}</h2>
        {description && <p className="text-muted mt-0.5 text-xs">{description}</p>}
      </div>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </header>
  );
}

export function CardBody({ className, ...props }: ComponentProps<'div'>) {
  return <div className={cn('px-5 py-4', className)} {...props} />;
}
