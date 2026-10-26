'use client';

import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { AlertTriangle } from 'lucide-react';
import { useState } from 'react';

import { Pagination } from '@/components/data/data-table';
import { EmptyState, ErrorState, InfoNote, LoadingRows } from '@/components/feedback/states';
import { PageHeader } from '@/components/layout/page-header';
import { Card } from '@/components/ui/card';
import { useListState } from '@/hooks/use-list-state';
import { api } from '@/lib/api/client';
import { formatDateTime, formatNumber } from '@/lib/format';
import type { Paged, ServerErrorGroup } from '@/types/admin';

/**
 * Pannes du serveur condensées (D-168) : les applications n'affichent plus aucun message
 * d'erreur système ; chaque réponse 5xx de l'API est regroupée ici (même méthode, route, statut,
 * code et type), avec son nombre d'occurrences. Lecture seule.
 */
export function ServerErrorsView() {
  const { page, setPage } = useListState([] as const);
  const [open, setOpen] = useState<string | null>(null);
  const query = useQuery({
    queryKey: ['admin', 'server-errors', page],
    queryFn: () => api.get<Paged<ServerErrorGroup>>('server-errors', { page, limit: 25 }),
    placeholderData: keepPreviousData,
  });
  const data = query.data;

  return (
    <>
      <PageHeader
        title="Erreurs"
        description="Pannes du serveur rencontrées par les joueurs. Les applications ne leur affichent plus aucun message d’erreur système : elles sont regroupées ici, la plus récente d’abord."
      />
      <InfoNote className="mb-4">
        Une ligne par panne distincte (méthode, route, statut, code et type d’erreur), avec son
        nombre d’occurrences. Ni corps de requête, ni en-tête, ni jeton, ni mot de passe ne sont
        enregistrés. La référence de requête permet de retrouver l’événement dans les journaux du
        serveur.
      </InfoNote>
      <Card>
        {query.error ? (
          <ErrorState error={query.error} onRetry={() => query.refetch()} />
        ) : !data ? (
          <LoadingRows />
        ) : data.items.length === 0 ? (
          <EmptyState title="Aucune panne enregistrée" />
        ) : (
          <ul
            className={
              query.isFetching ? 'divide-line divide-y opacity-60' : 'divide-line divide-y'
            }
          >
            {data.items.map((e) => {
              const expanded = open === e.fingerprint;
              return (
                <li key={e.fingerprint}>
                  <button
                    type="button"
                    onClick={() => setOpen(expanded ? null : e.fingerprint)}
                    aria-expanded={expanded}
                    className="hover:bg-surface-muted flex w-full flex-wrap items-center gap-x-4 gap-y-1 px-4 py-3 text-left transition-colors"
                  >
                    <AlertTriangle className="text-danger size-4" aria-hidden />
                    <span className="text-danger w-10 text-sm font-semibold tabular-nums">
                      {e.status}
                    </span>
                    <span className="text-ink min-w-48 flex-1 font-mono text-sm">
                      {`${e.method} ${e.route}`}
                    </span>
                    <span className="text-muted text-xs">{e.code ?? e.errorName}</span>
                    <span
                      className="text-ink-soft w-24 text-right text-sm tabular-nums"
                      aria-label={`${e.occurrences} occurrences`}
                    >
                      {`× ${formatNumber(e.occurrences)}`}
                    </span>
                    <span className="text-muted w-36 text-right text-xs tabular-nums">
                      {formatDateTime(e.lastSeenAt)}
                    </span>
                  </button>
                  {expanded && (
                    <div className="bg-surface-muted grid gap-3 px-4 py-3 sm:grid-cols-2">
                      <div className="space-y-2 text-xs">
                        <div>
                          <p className="text-muted">Dernier message</p>
                          <p className="text-ink-soft break-words">{e.message || '—'}</p>
                        </div>
                        <div>
                          <p className="text-muted">Type</p>
                          <p className="text-ink-soft font-mono">{e.errorName}</p>
                        </div>
                        <div>
                          <p className="text-muted">Première / dernière occurrence</p>
                          <p className="text-ink-soft tabular-nums">
                            {`${formatDateTime(e.firstSeenAt)} → ${formatDateTime(e.lastSeenAt)}`}
                          </p>
                        </div>
                        {e.lastRequestId && (
                          <div>
                            <p className="text-muted">Dernière référence de requête</p>
                            <p className="text-ink-soft font-mono">{e.lastRequestId}</p>
                          </div>
                        )}
                      </div>
                      <div className="min-w-0">
                        <p className="text-muted mb-1 text-xs">Dernière trace</p>
                        {e.lastStack ? (
                          <pre className="text-ink-soft max-h-64 overflow-auto text-[11px] leading-snug whitespace-pre-wrap">
                            {e.lastStack}
                          </pre>
                        ) : (
                          <p className="text-faint text-xs">—</p>
                        )}
                      </div>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
        {data && <Pagination page={page} limit={data.limit} total={data.total} onPage={setPage} />}
      </Card>
    </>
  );
}
