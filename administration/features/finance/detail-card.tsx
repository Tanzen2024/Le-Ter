import type { LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';

import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';

/**
 * Carte de détail des finances (rangée complémentaire) : même hiérarchie que `StatCard`
 * (libellé, valeur, contexte), fond teinté pour la distinguer des indicateurs principaux,
 * puis une liste de lignes. La liste défile au-delà de sa hauteur ; elle reste atteignable
 * au clavier (zone focalisable nommée).
 */
export function DetailCard({
  label,
  value,
  hint,
  icon: Icon,
  loading,
  listLabel,
  children,
  footer,
}: {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  icon?: LucideIcon;
  loading?: boolean;
  listLabel: string;
  children?: ReactNode;
  footer?: ReactNode;
}) {
  return (
    <div className="border-line bg-surface-muted shadow-card flex h-full min-w-0 flex-col rounded-xl border border-dashed p-4">
      <div className="flex items-start justify-between gap-3">
        <h3 className="text-muted min-w-0 text-xs leading-snug font-medium">{label}</h3>
        {Icon && (
          <span
            aria-hidden
            className="bg-surface text-ink-soft flex size-8 shrink-0 items-center justify-center rounded-lg [&_svg]:size-4"
          >
            <Icon />
          </span>
        )}
      </div>
      {loading ? (
        <Skeleton className="mt-2 h-7 w-24" />
      ) : (
        <p className="text-ink mt-2 text-2xl leading-tight font-semibold tracking-tight [overflow-wrap:anywhere] tabular-nums">
          {value}
        </p>
      )}
      {hint && <p className="text-muted mt-1.5 text-xs leading-snug">{hint}</p>}
      {!loading && children && (
        <div
          role="region"
          aria-label={listLabel}
          tabIndex={0}
          className="border-line focus-visible:ring-accent/25 mt-3 max-h-56 overflow-y-auto border-t pt-2 focus-visible:ring-2 focus-visible:outline-none"
        >
          {children}
        </div>
      )}
      {!loading && footer && <div className="mt-auto pt-3 text-xs">{footer}</div>}
    </div>
  );
}

/** Ligne d'une carte de détail : libellé à gauche, valeurs à droite (retour à la ligne permis). */
export function DetailRow({
  label,
  value,
  sub,
  tone,
}: {
  label: ReactNode;
  value: ReactNode;
  sub?: ReactNode;
  tone?: 'danger' | 'warning' | 'success';
}) {
  return (
    <li className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5 py-1 text-xs">
      <span className="text-ink-soft min-w-0">{label}</span>
      <span
        className={cn(
          'text-ink text-right font-medium [overflow-wrap:anywhere] tabular-nums',
          tone === 'danger' && 'text-danger',
          tone === 'warning' && 'text-warning',
          tone === 'success' && 'text-success',
        )}
      >
        {value}
        {sub && <span className="text-muted block font-normal">{sub}</span>}
      </span>
    </li>
  );
}

export function DetailHeading({ children }: { children: ReactNode }) {
  return (
    <li className="text-muted pt-2 text-[11px] font-semibold tracking-wide uppercase first:pt-0">
      {children}
    </li>
  );
}
