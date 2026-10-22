'use client';

import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';

import { DataTable, Pagination, type Column } from '@/components/data/data-table';
import { FilterBar, SearchInput } from '@/components/data/filter-bar';
import { StatusBadge } from '@/components/data/status-badge';
import { PageHeader } from '@/components/layout/page-header';
import { Card } from '@/components/ui/card';
import { Select } from '@/components/ui/form-controls';
import { useListState } from '@/hooks/use-list-state';
import { formatDate, formatDateTime, formatNumber, formatTokens } from '@/lib/format';
import { ROLE } from '@/lib/labels';
import type { PlayerRow } from '@/types/admin';

import { playersQuery } from './api';
import { AccountBadges, PlayerRowActions } from './player-actions';

const columns: Column<PlayerRow>[] = [
  {
    key: 'player',
    header: 'Joueur',
    cell: (p) => (
      <div className="min-w-0">
        <p className="text-ink font-medium">{p.username}</p>
        <p className="text-muted truncate text-xs">
          {p.firstName} {p.lastName} · {p.email ?? p.phone}
        </p>
      </div>
    ),
  },
  { key: 'phone', header: 'Téléphone', cell: (p) => p.phone, hideOnMobile: true },
  {
    key: 'status',
    header: 'Compte',
    cell: (p) => <AccountBadges player={p} />,
  },
  {
    key: 'role',
    header: 'Rôle',
    cell: (p) => <StatusBadge map={ROLE} value={p.role} />,
    hideOnMobile: true,
  },
  {
    key: 'games',
    header: 'Parties',
    cell: (p) => formatNumber(p.gamesPlayed),
    align: 'right',
    hideOnMobile: true,
  },
  { key: 'balance', header: 'Solde', cell: (p) => formatTokens(p.balance), align: 'right' },
  {
    key: 'last',
    header: 'Dernière partie',
    cell: (p) => formatDateTime(p.lastGameAt),
    hideOnMobile: true,
  },
  {
    key: 'created',
    header: 'Inscription',
    cell: (p) => formatDate(p.createdAt),
    hideOnMobile: true,
  },
  {
    key: 'actions',
    header: <span className="sr-only">Actions</span>,
    cell: (p) => <PlayerRowActions player={p} />,
    align: 'right',
  },
];

export function PlayersList() {
  const router = useRouter();
  const { filters, page, setFilter, setPage, reset } = useListState([
    'q',
    'status',
    'role',
    'sort',
  ] as const);
  const query = useQuery(
    playersQuery({
      page,
      q: filters.q,
      status: filters.status,
      role: filters.role,
      sort: filters.sort || 'created_desc',
    }),
  );
  return (
    <>
      <PageHeader
        title="Joueurs"
        description="Comptes Le Ter. La consultation d’une fiche et chaque action de modération sont inscrites au journal d’audit."
      />
      <Card>
        <FilterBar onReset={reset}>
          <SearchInput
            value={filters.q}
            onChange={(v) => setFilter('q', v)}
            placeholder="Pseudo, nom, e-mail, téléphone, identifiant"
            label="Rechercher un joueur"
          />
          <Select
            aria-label="Statut du compte"
            value={filters.status}
            onChange={(e) => setFilter('status', e.target.value)}
            className="w-auto"
          >
            <option value="">Tous les comptes</option>
            <option value="active">Actifs</option>
            <option value="disabled">Désactivés</option>
            <option value="suspended">Suspendus</option>
          </Select>
          <Select
            aria-label="Rôle"
            value={filters.role}
            onChange={(e) => setFilter('role', e.target.value)}
            className="w-auto"
          >
            <option value="">Tous les rôles</option>
            <option value="user">Joueurs</option>
            <option value="admin">Super administrateurs</option>
          </Select>
          <Select
            aria-label="Tri"
            value={filters.sort || 'created_desc'}
            onChange={(e) => setFilter('sort', e.target.value)}
            className="w-auto"
          >
            <option value="created_desc">Plus récents</option>
            <option value="created_asc">Plus anciens</option>
            <option value="username_asc">Pseudo (A → Z)</option>
          </Select>
        </FilterBar>
        <DataTable
          caption="Liste des joueurs"
          columns={columns}
          rows={query.data?.items}
          rowKey={(p) => p.id}
          loading={query.isFetching}
          error={query.error}
          onRetry={() => query.refetch()}
          empty="Aucun joueur ne correspond à ces critères"
          onRowClick={(p) => router.push(`/joueurs/${p.id}`)}
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
