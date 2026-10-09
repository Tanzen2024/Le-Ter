'use client';

import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';

import { DataTable, Pagination } from '@/components/data/data-table';
import { FilterBar, SearchInput } from '@/components/data/filter-bar';
import { InfoNote } from '@/components/feedback/states';
import { PageHeader } from '@/components/layout/page-header';
import { Card } from '@/components/ui/card';
import { Input, Select } from '@/components/ui/form-controls';
import { useListState } from '@/hooks/use-list-state';
import { localDayStartIso } from '@/lib/format';

import { gamesQuery } from './api';
import { gameColumns } from './columns';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Jour local suivant (borne exclusive d'une période « jusqu'au »). */
function nextDay(day: string): string {
  const d = new Date(`${day}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

export function GamesList() {
  const router = useRouter();
  const { filters, page, setFilter, setPage, reset } = useListState([
    'status',
    'anomaly',
    'du',
    'au',
    'gameId',
    'playerId',
    'tournamentId',
  ] as const);
  const gameId = UUID.test(filters.gameId) ? filters.gameId : undefined;
  const query = useQuery(
    gamesQuery({
      page,
      status: filters.status,
      anomaly: filters.anomaly,
      gameId,
      playerId: filters.playerId,
      tournamentId: filters.tournamentId,
      from: filters.du ? localDayStartIso(filters.du) : undefined,
      to: filters.au ? localDayStartIso(nextDay(filters.au)) : undefined,
    }),
  );
  return (
    <>
      <PageHeader
        title="Parties"
        description="Parties multijoueurs, en lecture seule. La consultation ne modifie jamais l’état d’une partie."
      />
      <InfoNote className="mb-4">
        Les mains, le paquet et les cartes ne sont jamais transmis à l’administration, y compris
        pour les parties terminées. Aucune action sur une partie n’est proposée : ses règles et ses
        effets ne sont pas définis.
      </InfoNote>
      <Card>
        <FilterBar onReset={reset}>
          <SearchInput
            value={filters.gameId}
            onChange={(v) => setFilter('gameId', v)}
            placeholder="Identifiant de partie (complet)"
            label="Rechercher une partie par identifiant"
          />
          <Select
            aria-label="Statut"
            value={filters.status}
            onChange={(e) => setFilter('status', e.target.value)}
            className="w-auto"
          >
            <option value="">Tous les statuts</option>
            <option value="waiting">En attente</option>
            <option value="in_progress">En cours</option>
            <option value="finished">Terminées</option>
          </Select>
          <Select
            aria-label="Anomalie"
            value={filters.anomaly}
            onChange={(e) => setFilter('anomaly', e.target.value)}
            className="w-auto"
          >
            <option value="">Toutes</option>
            <option value="LONG_RUNNING">En cours depuis plus d’1 h</option>
            <option value="OVERDUE_TURN">Échéance de tour dépassée</option>
            <option value="STALE_WAITING">En attente depuis plus de 24 h</option>
          </Select>
          <label className="text-muted flex items-center gap-1.5 text-xs">
            Du
            <Input
              type="date"
              value={filters.du}
              onChange={(e) => setFilter('du', e.target.value)}
              className="w-auto"
              aria-label="Créées à partir du"
            />
          </label>
          <label className="text-muted flex items-center gap-1.5 text-xs">
            au
            <Input
              type="date"
              value={filters.au}
              onChange={(e) => setFilter('au', e.target.value)}
              className="w-auto"
              aria-label="Créées jusqu’au"
            />
          </label>
        </FilterBar>
        {filters.gameId && !gameId && (
          <p className="text-warning px-4 pt-3 text-xs">
            Saisissez l’identifiant complet de la partie (UUID).
          </p>
        )}
        <DataTable
          caption="Liste des parties"
          columns={gameColumns}
          rows={query.data?.items}
          rowKey={(g) => g.id}
          loading={query.isFetching}
          error={query.error}
          onRetry={() => query.refetch()}
          empty="Aucune partie ne correspond à ces critères"
          onRowClick={(g) => router.push(`/parties/${g.id}`)}
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
