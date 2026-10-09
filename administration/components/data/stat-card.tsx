import type { LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';

import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';

/** Indicateur synthétique : une valeur réelle, son libellé et, au besoin, son contexte. */
export function StatCard({
  label,
  value,
  hint,
  icon: Icon,
  tone = 'primary',
  loading,
}: {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  icon?: LucideIcon;
  tone?: 'primary' | 'accent' | 'success' | 'warning' | 'danger' | 'info';
  loading?: boolean;
}) {
  return (
    <div className="border-line bg-surface shadow-card rounded-xl border p-4">
      <div className="flex items-start justify-between gap-3">
        <p className="text-muted text-xs font-medium">{label}</p>
        {Icon && (
          <span
            aria-hidden
            className={cn(
              'flex size-8 items-center justify-center rounded-lg [&_svg]:size-4',
              tone === 'primary' && 'bg-primary-soft text-primary',
              tone === 'accent' && 'bg-accent-soft text-accent',
              tone === 'success' && 'bg-success-soft text-success',
              tone === 'warning' && 'bg-warning-soft text-warning',
              tone === 'danger' && 'bg-danger-soft text-danger',
              tone === 'info' && 'bg-info-soft text-info',
            )}
          >
            <Icon />
          </span>
        )}
      </div>
      {loading ? (
        <Skeleton className="mt-2 h-7 w-24" />
      ) : (
        <p className="text-ink mt-1 text-2xl font-semibold tracking-tight tabular-nums">{value}</p>
      )}
      {hint && <p className="text-muted mt-1 text-xs">{hint}</p>}
    </div>
  );
}
