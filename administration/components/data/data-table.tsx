import { ChevronLeft, ChevronRight } from 'lucide-react';
import type { ReactNode } from 'react';

import { EmptyState, ErrorState, LoadingRows } from '@/components/feedback/states';
import { Button } from '@/components/ui/button';
import { formatNumber } from '@/lib/format';
import { cn } from '@/lib/utils';

export interface Column<T> {
  key: string;
  header: ReactNode;
  cell: (row: T) => ReactNode;
  className?: string;
  /** Masquée sur petit écran (le détail reste accessible). */
  hideOnMobile?: boolean;
  align?: 'left' | 'right';
}

/**
 * Tableau de données sobre : en-tête, lignes, états de chargement, vide et erreur. La
 * pagination est faite côté serveur ; ce composant n'affiche que la page reçue.
 */
export function DataTable<T>({
  columns,
  rows,
  rowKey,
  loading,
  error,
  onRetry,
  empty,
  onRowClick,
  caption,
}: {
  columns: Column<T>[];
  rows: T[] | undefined;
  rowKey: (row: T) => string;
  loading?: boolean;
  error?: unknown;
  onRetry?: () => void;
  empty?: ReactNode;
  onRowClick?: (row: T) => void;
  caption: string;
}) {
  if (error) return <ErrorState error={error} onRetry={onRetry} />;
  if (loading && !rows) return <LoadingRows />;
  if (!rows || rows.length === 0) return <EmptyState title={empty ?? 'Aucun résultat'} />;
  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-sm">
        <caption className="sr-only">{caption}</caption>
        <thead>
          <tr className="border-line bg-surface-muted/70 border-b">
            {columns.map((c) => (
              <th
                key={c.key}
                scope="col"
                className={cn(
                  'text-muted px-4 py-2.5 text-left text-xs font-medium whitespace-nowrap',
                  c.align === 'right' && 'text-right',
                  c.hideOnMobile && 'hidden md:table-cell',
                  c.className,
                )}
              >
                {c.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className={cn(loading && 'opacity-60 transition-opacity')}>
          {rows.map((row) => (
            <tr
              key={rowKey(row)}
              className={cn(
                'border-line border-b last:border-0',
                onRowClick && 'hover:bg-surface-muted cursor-pointer transition-colors',
              )}
              onClick={onRowClick ? () => onRowClick(row) : undefined}
            >
              {columns.map((c) => (
                <td
                  key={c.key}
                  className={cn(
                    'text-ink-soft px-4 py-3 align-middle',
                    c.align === 'right' && 'text-right tabular-nums',
                    c.hideOnMobile && 'hidden md:table-cell',
                    c.className,
                  )}
                >
                  {c.cell(row)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function Pagination({
  page,
  limit,
  total,
  onPage,
}: {
  page: number;
  limit: number;
  total: number;
  onPage: (page: number) => void;
}) {
  const pages = Math.max(1, Math.ceil(total / limit));
  if (total === 0) return null;
  const first = (page - 1) * limit + 1;
  const last = Math.min(total, page * limit);
  return (
    <nav
      aria-label="Pagination"
      className="border-line text-muted flex items-center justify-between gap-3 border-t px-4 py-3 text-xs"
    >
      <p>
        {formatNumber(first)}–{formatNumber(last)} sur {formatNumber(total)}
      </p>
      <div className="flex items-center gap-1">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => onPage(page - 1)}
          disabled={page <= 1}
          aria-label="Page précédente"
        >
          <ChevronLeft />
        </Button>
        <span className="px-2 tabular-nums">
          {page} / {pages}
        </span>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => onPage(page + 1)}
          disabled={page >= pages}
          aria-label="Page suivante"
        >
          <ChevronRight />
        </Button>
      </div>
    </nav>
  );
}

/** Liste de définitions (fiches de détail). */
export function DetailList({ items }: { items: [label: ReactNode, value: ReactNode][] }) {
  return (
    <dl className="grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-2">
      {items.map(([label, value], i) => (
        <div key={i} className="min-w-0">
          <dt className="text-muted text-xs">{label}</dt>
          <dd className="text-ink mt-0.5 text-sm break-words">{value}</dd>
        </div>
      ))}
    </dl>
  );
}
