'use client';

import { useQuery } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useMemo } from 'react';

import { DataTable, Pagination, type Column } from '@/components/data/data-table';
import { FilterBar } from '@/components/data/filter-bar';
import { StatusBadge } from '@/components/data/status-badge';
import { PageHeader } from '@/components/layout/page-header';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input, Select } from '@/components/ui/form-controls';
import { useListState } from '@/hooks/use-list-state';
import { formatDateTime, formatNumber, formatXaf, localDayStartIso } from '@/lib/format';
import { TOURNAMENT_STATUS } from '@/lib/labels';
import type { TournamentSummary } from '@/types/admin';

import { tournamentLabel, tournamentsQuery } from './api';

const PAGE = 25;

const columns: Column<TournamentSummary>[] = [
  {
    key: 'name',
    header: 'Tournoi',
    cell: (t) => (
      <span>
        <span className="text-ink font-medium">{tournamentLabel(t)}</span>
        <span className="text-muted block text-xs">
          {t.creatorType === 'PLAYER'
            ? `Proposé par ${t.creatorName ?? 'un joueur'}`
            : 'Créé par l’administration'}
        </span>
      </span>
    ),
  },
  {
    key: 'status',
    header: 'Statut',
    cell: (t) => <StatusBadge map={TOURNAMENT_STATUS} value={t.status} />,
  },
  {
    key: 'players',
    header: 'Inscrits',
    align: 'right',
    cell: (t) => (
      <span>
        {formatNumber(t.registeredCount ?? t.pool?.participants)}
        <span className="text-muted text-xs">
          {' '}
          / {t.minimumPlayers}–{t.maximumPlayers ?? '∞'}
        </span>
      </span>
    ),
  },
  {
    key: 'fee',
    header: 'Entrée',
    align: 'right',
    cell: (t) => formatXaf(t.entryFee),
    hideOnMobile: true,
  },
  { key: 'end', header: 'Fin', cell: (t) => formatDateTime(t.endsAt), hideOnMobile: true },
];

export function TournamentsList() {
  const router = useRouter();
  const { filters, page, setFilter, setPage, reset } = useListState([
    'status',
    'du',
    'au',
  ] as const);
  const query = useQuery(tournamentsQuery(filters.status || undefined));
  // L'API existante filtre par statut ; la période est filtrée ici, sur la date de début.
  const filtered = useMemo(() => {
    const from = filters.du ? new Date(localDayStartIso(filters.du)).getTime() : -Infinity;
    const to = filters.au
      ? new Date(localDayStartIso(filters.au)).getTime() + 86_400_000
      : Infinity;
    return (query.data?.tournaments ?? [])
      .filter((t) => {
        const start = new Date(t.startsAt).getTime();
        return start >= from && start < to;
      })
      .sort((a, b) => b.startsAt.localeCompare(a.startsAt));
  }, [query.data, filters.du, filters.au]);
  const rows = filtered.slice((page - 1) * PAGE, page * PAGE);

  return (
    <>
      <PageHeader
        title="Tournois"
        description="Gestion selon les règles du serveur : durée de 30 à 120 minutes, 20 à 1 000 participants, aucun chevauchement."
        actions={
          <Button asChild>
            <Link href="/tournois/nouveau">
              <Plus /> Créer un tournoi
            </Link>
          </Button>
        }
      />
      <Card>
        <FilterBar onReset={reset}>
          <Select
            aria-label="Statut"
            value={filters.status}
            onChange={(e) => setFilter('status', e.target.value)}
            className="w-auto"
          >
            <option value="">Tous les statuts</option>
            {Object.entries(TOURNAMENT_STATUS).map(([value, [text]]) => (
              <option key={value} value={value}>
                {text}
              </option>
            ))}
          </Select>
          <label className="text-muted flex items-center gap-1.5 text-xs">
            Début du
            <Input
              type="date"
              value={filters.du}
              onChange={(e) => setFilter('du', e.target.value)}
              className="w-auto"
            />
          </label>
          <label className="text-muted flex items-center gap-1.5 text-xs">
            au
            <Input
              type="date"
              value={filters.au}
              onChange={(e) => setFilter('au', e.target.value)}
              className="w-auto"
            />
          </label>
        </FilterBar>
        <DataTable
          caption="Liste des tournois"
          columns={columns}
          rows={query.data ? rows : undefined}
          rowKey={(t) => t.tournamentId}
          loading={query.isFetching}
          error={query.error}
          onRetry={() => query.refetch()}
          empty="Aucun tournoi ne correspond à ces critères"
          onRowClick={(t) => router.push(`/tournois/${t.tournamentId}`)}
        />
        <Pagination page={page} limit={PAGE} total={filtered.length} onPage={setPage} />
      </Card>
      <p className="text-muted mt-3 text-xs">
        L’API des tournois renvoie les 100 tournois les plus récemment créés ; le filtre de période
        s’applique sur cette liste.
      </p>
    </>
  );
}
