import { AlertTriangle, Ban, Inbox, Info, RotateCw } from 'lucide-react';
import type { ReactNode } from 'react';

import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { messageOf } from '@/lib/api/errors';
import { cn } from '@/lib/utils';

function Shell({
  icon,
  title,
  children,
  tone,
  className,
}: {
  icon: ReactNode;
  title: ReactNode;
  children?: ReactNode;
  tone: 'muted' | 'danger' | 'info';
  className?: string;
}) {
  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center gap-2 px-6 py-10 text-center',
        className,
      )}
    >
      <span
        className={cn(
          'flex size-10 items-center justify-center rounded-full [&_svg]:size-5',
          tone === 'danger' && 'bg-danger-soft text-danger',
          tone === 'info' && 'bg-info-soft text-info',
          tone === 'muted' && 'bg-surface-muted text-faint',
        )}
      >
        {icon}
      </span>
      <p className="text-ink text-sm font-medium">{title}</p>
      {children && <div className="text-muted max-w-md text-sm">{children}</div>}
    </div>
  );
}

export function EmptyState({ title, children }: { title: ReactNode; children?: ReactNode }) {
  return (
    <Shell icon={<Inbox />} title={title} tone="muted">
      {children}
    </Shell>
  );
}

export function ErrorState({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  return (
    <Shell icon={<AlertTriangle />} title="Les données n’ont pas pu être chargées" tone="danger">
      <p>{messageOf(error)}</p>
      {onRetry && (
        <Button variant="secondary" size="sm" className="mt-3" onClick={onRetry}>
          <RotateCw /> Réessayer
        </Button>
      )}
    </Shell>
  );
}

/** Fonction non prise en charge par le backend : jamais simulée. */
export function UnavailableNotice({
  title,
  children,
  className,
}: {
  title: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      role="note"
      className={cn(
        'border-line-strong bg-surface-muted flex gap-3 rounded-lg border border-dashed px-4 py-3',
        className,
      )}
    >
      <Ban className="text-faint mt-0.5 size-4 shrink-0" aria-hidden />
      <div className="text-sm">
        <p className="text-ink-soft font-medium">{title}</p>
        <div className="text-muted mt-0.5">{children}</div>
      </div>
    </div>
  );
}

export function InfoNote({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div
      role="note"
      className={cn(
        'bg-info-soft/60 text-ink-soft flex gap-3 rounded-lg px-4 py-3 text-sm',
        className,
      )}
    >
      <Info className="text-info mt-0.5 size-4 shrink-0" aria-hidden />
      <div>{children}</div>
    </div>
  );
}

export function LoadingRows({ rows = 5 }: { rows?: number }) {
  return (
    <div className="space-y-3 p-5" aria-busy="true" aria-label="Chargement">
      {Array.from({ length: rows }, (_, i) => (
        <Skeleton key={i} className="h-8 w-full" />
      ))}
    </div>
  );
}
