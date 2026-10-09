'use client';

import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { CheckCircle2, XCircle } from 'lucide-react';
import { Fragment, useState } from 'react';

import { Pagination } from '@/components/data/data-table';
import { FilterBar, SearchInput } from '@/components/data/filter-bar';
import { EmptyState, ErrorState, InfoNote, LoadingRows } from '@/components/feedback/states';
import { PageHeader } from '@/components/layout/page-header';
import { Card } from '@/components/ui/card';
import { Input, Select } from '@/components/ui/form-controls';
import { useListState } from '@/hooks/use-list-state';
import { api } from '@/lib/api/client';
import { formatDateTime, localDayStartIso } from '@/lib/format';
import { AUDIT_ACTION, AUDIT_TARGET, label } from '@/lib/labels';
import type { AuditEvent, Paged } from '@/types/admin';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function nextDay(day: string) {
  const d = new Date(`${day}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

/** Détails lisibles d'un événement (identifiants, statuts, motifs : jamais de secret). */
function Details({ details }: { details: Record<string, unknown> }) {
  const entries = Object.entries(details);
  if (entries.length === 0) return <span className="text-faint">—</span>;
  return (
    <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-xs">
      {entries.map(([k, v]) => (
        <Fragment key={k}>
          <dt className="text-muted">{k}</dt>
          <dd className="text-ink-soft break-all">
            {typeof v === 'object' ? JSON.stringify(v) : String(v)}
          </dd>
        </Fragment>
      ))}
    </dl>
  );
}

export function AuditLogView() {
  const { filters, page, setFilter, setPage, reset } = useListState([
    'action',
    'outcome',
    'targetType',
    'targetId',
    'du',
    'au',
  ] as const);
  const [open, setOpen] = useState<string | null>(null);
  const query = useQuery({
    queryKey: ['admin', 'audit', filters, page],
    queryFn: () =>
      api.get<Paged<AuditEvent>>('audit-log', {
        page,
        limit: 25,
        action: filters.action,
        outcome: filters.outcome,
        targetType: filters.targetType,
        targetId: UUID.test(filters.targetId) ? filters.targetId : undefined,
        from: filters.du ? localDayStartIso(filters.du) : undefined,
        to: filters.au ? localDayStartIso(nextDay(filters.au)) : undefined,
      }),
    placeholderData: keepPreviousData,
  });
  const data = query.data;

  return (
    <>
      <PageHeader
        title="Journal d’audit"
        description="Actions administratives enregistrées par le serveur. Le journal est en lecture seule : aucune entrée ne peut être modifiée ni supprimée."
      />
      <InfoNote className="mb-4">
        Le journal ne contient jamais de mot de passe, de jeton, d’adresse IP ni de donnée de
        paiement sensible. Les listes consultées ne sont pas journalisées ; les fiches joueur et
        paiement le sont.
      </InfoNote>
      <Card>
        <FilterBar onReset={reset}>
          <Select
            aria-label="Action"
            value={filters.action}
            onChange={(e) => setFilter('action', e.target.value)}
            className="w-auto"
          >
            <option value="">Toutes les actions</option>
            {Object.entries(AUDIT_ACTION).map(([v, t]) => (
              <option key={v} value={v}>
                {t}
              </option>
            ))}
          </Select>
          <Select
            aria-label="Résultat"
            value={filters.outcome}
            onChange={(e) => setFilter('outcome', e.target.value)}
            className="w-auto"
          >
            <option value="">Tous les résultats</option>
            <option value="SUCCESS">Réussites</option>
            <option value="FAILURE">Échecs</option>
          </Select>
          <Select
            aria-label="Cible"
            value={filters.targetType}
            onChange={(e) => setFilter('targetType', e.target.value)}
            className="w-auto"
          >
            <option value="">Toutes les cibles</option>
            {Object.entries(AUDIT_TARGET).map(([v, t]) => (
              <option key={v} value={v}>
                {t}
              </option>
            ))}
          </Select>
          <SearchInput
            value={filters.targetId}
            onChange={(v) => setFilter('targetId', v)}
            placeholder="Référence de la cible (UUID)"
            label="Rechercher par référence"
          />
          <label className="text-muted flex items-center gap-1.5 text-xs">
            Du{' '}
            <Input
              type="date"
              value={filters.du}
              onChange={(e) => setFilter('du', e.target.value)}
              className="w-auto"
            />
          </label>
          <label className="text-muted flex items-center gap-1.5 text-xs">
            au{' '}
            <Input
              type="date"
              value={filters.au}
              onChange={(e) => setFilter('au', e.target.value)}
              className="w-auto"
            />
          </label>
        </FilterBar>
        {query.error ? (
          <ErrorState error={query.error} onRetry={() => query.refetch()} />
        ) : !data ? (
          <LoadingRows />
        ) : data.items.length === 0 ? (
          <EmptyState title="Aucun événement pour ces critères" />
        ) : (
          <ul
            className={
              query.isFetching ? 'divide-line divide-y opacity-60' : 'divide-line divide-y'
            }
          >
            {data.items.map((e) => {
              const failed = e.outcome === 'FAILURE';
              const expanded = open === e.id;
              return (
                <li key={e.id}>
                  <button
                    type="button"
                    onClick={() => setOpen(expanded ? null : e.id)}
                    aria-expanded={expanded}
                    className="hover:bg-surface-muted flex w-full flex-wrap items-center gap-x-4 gap-y-1 px-4 py-3 text-left transition-colors"
                  >
                    {failed ? (
                      <XCircle className="text-danger size-4" aria-label="Échec" />
                    ) : (
                      <CheckCircle2 className="text-success size-4" aria-label="Réussite" />
                    )}
                    <span className="text-ink min-w-48 flex-1 text-sm font-medium">
                      {label(AUDIT_ACTION, e.action)}
                    </span>
                    <span className="text-ink-soft text-sm">
                      {e.actor?.username ?? (e.actor ? 'Administrateur' : 'Compte inconnu')}
                    </span>
                    <span className="text-muted text-xs">
                      {label(AUDIT_TARGET, e.target.type)}
                      {e.target.id ? ` · ${e.target.id.slice(0, 8)}` : ''}
                    </span>
                    <span className="text-muted w-36 text-right text-xs tabular-nums">
                      {formatDateTime(e.createdAt)}
                    </span>
                  </button>
                  {expanded && (
                    <div className="bg-surface-muted grid gap-3 px-4 py-3 sm:grid-cols-2">
                      <div className="text-xs">
                        <p className="text-muted">Référence de l’événement</p>
                        <p className="text-ink-soft font-mono">{e.id}</p>
                        {e.target.id && (
                          <>
                            <p className="text-muted mt-2">Cible</p>
                            <p className="text-ink-soft font-mono">{e.target.id}</p>
                          </>
                        )}
                      </div>
                      <div>
                        <p className="text-muted mb-1 text-xs">Détails et motif</p>
                        <Details details={e.details} />
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
