'use client';

import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';

import { DataTable, Pagination, type Column } from '@/components/data/data-table';
import { FilterBar, SearchInput } from '@/components/data/filter-bar';
import { StatusBadge } from '@/components/data/status-badge';
import { InfoNote } from '@/components/feedback/states';
import { PageHeader } from '@/components/layout/page-header';
import { Card } from '@/components/ui/card';
import { Input, Select } from '@/components/ui/form-controls';
import { useListState } from '@/hooks/use-list-state';
import { formatDateTime, formatTokens, localDayStartIso } from '@/lib/format';
import { WITHDRAWAL_STATUS } from '@/lib/labels';
import type { WithdrawalRow } from '@/types/admin';

import { withdrawalsQuery } from './api';

function nextDay(day: string) {
  const d = new Date(`${day}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

const columns: Column<WithdrawalRow>[] = [
  {
    key: 'ref',
    header: 'Référence',
    cell: (w) => <span className="text-ink font-mono text-xs">{w.reference}</span>,
  },
  { key: 'player', header: 'Joueur', cell: (w) => w.user.username ?? '—' },
  {
    key: 'status',
    header: 'Statut',
    cell: (w) => <StatusBadge map={WITHDRAWAL_STATUS} value={w.status} />,
  },
  {
    key: 'tokens',
    header: 'Montant',
    align: 'right',
    cell: (w) => <span className="text-ink font-medium">−{formatTokens(w.tokens)}</span>,
  },
  {
    key: 'recipient',
    header: 'Destinataire',
    hideOnMobile: true,
    cell: (w) => (
      <span>
        <span className="text-ink">{w.operatorLabel}</span>
        <span className="text-muted block font-mono text-xs">{w.msisdn}</span>
      </span>
    ),
  },
  {
    key: 'error',
    header: 'Dernière erreur',
    hideOnMobile: true,
    cell: (w) => w.failureCode ?? w.lastErrorCode ?? '—',
  },
  { key: 'created', header: 'Créé', hideOnMobile: true, cell: (w) => formatDateTime(w.createdAt) },
];

/** Retraits Mobile Money (D-075) : lecture seule, filtres par statut, période et référence. */
export function WithdrawalsList() {
  const router = useRouter();
  const { filters, page, setFilter, setPage, reset } = useListState([
    'q',
    'status',
    'du',
    'au',
  ] as const);
  const query = useQuery(
    withdrawalsQuery({
      page,
      q: filters.q,
      status: filters.status,
      from: filters.du ? localDayStartIso(filters.du) : undefined,
      to: filters.au ? localDayStartIso(nextDay(filters.au)) : undefined,
    }),
  );
  return (
    <>
      <PageHeader
        title="Retraits Mobile Money"
        description="Transferts du compte de jeu vers le numéro d’inscription du joueur (1 jeton = 1 FCFA). La consultation d’un retrait est inscrite au journal d’audit."
      />
      <InfoNote className="mb-4">
        Un retrait n’est confirmé ou échoué qu’après relecture de son statut chez CinetPay par le
        serveur. Aucune action ne permet de le déclarer réussi manuellement.
      </InfoNote>
      <Card>
        <FilterBar onReset={reset}>
          <SearchInput
            value={filters.q}
            onChange={(v) => setFilter('q', v)}
            placeholder="Référence de retrait, CinetPay ou identifiant"
            label="Rechercher un retrait"
          />
          <Select
            aria-label="Statut"
            value={filters.status}
            onChange={(e) => setFilter('status', e.target.value)}
            className="w-auto"
          >
            <option value="">Tous les statuts</option>
            {Object.entries(WITHDRAWAL_STATUS).map(([v, [t]]) => (
              <option key={v} value={v}>
                {t}
              </option>
            ))}
          </Select>
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
        <DataTable
          caption="Retraits Mobile Money"
          columns={columns}
          rows={query.data?.items}
          rowKey={(w) => w.id}
          loading={query.isFetching}
          error={query.error}
          onRetry={() => query.refetch()}
          empty="Aucun retrait ne correspond à ces critères"
          onRowClick={(w) => router.push(`/retraits/${w.id}`)}
        />
        {query.data && (
          <Pagination
            page={page}
            limit={query.data.limit}
            total={query.data.total}
            onPage={setPage}
          />
        )}
      </Card>
    </>
  );
}
