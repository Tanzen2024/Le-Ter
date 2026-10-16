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
import { formatDateTime, localDayStartIso } from '@/lib/format';
import type { ComplaintRow } from '@/types/complaints';

import { complaintsQuery } from './api';
import { COMPLAINT_CATEGORY, COMPLAINT_PRIORITY, COMPLAINT_STATUS } from './labels';

function nextDay(day: string) {
  const d = new Date(`${day}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

export const complaintColumns: Column<ComplaintRow>[] = [
  {
    key: 'ref',
    header: 'Référence',
    cell: (c) => <span className="text-ink font-mono text-xs">{c.reference}</span>,
  },
  {
    key: 'priority',
    header: 'Priorité',
    cell: (c) => <StatusBadge map={COMPLAINT_PRIORITY} value={c.priority} />,
  },
  {
    key: 'status',
    header: 'Statut',
    cell: (c) => <StatusBadge map={COMPLAINT_STATUS} value={c.status} />,
  },
  {
    key: 'subject',
    header: 'Objet',
    cell: (c) => (
      <span>
        <span className="text-ink">{c.title}</span>
        <span className="text-muted block text-xs">
          {COMPLAINT_CATEGORY[c.category] ?? c.category}
        </span>
      </span>
    ),
  },
  { key: 'player', header: 'Joueur', cell: (c) => c.player.username ?? '—' },
  {
    key: 'assignee',
    header: 'Responsable',
    hideOnMobile: true,
    cell: (c) => c.assignee?.username ?? <span className="text-faint">Non assignée</span>,
  },
  {
    key: 'created',
    header: 'Déposée',
    hideOnMobile: true,
    cell: (c) => formatDateTime(c.createdAt),
  },
];

/** File des réclamations (D-114) : filtres par statut, catégorie, priorité, joueur et période. */
export function ComplaintsList() {
  const router = useRouter();
  const { filters, page, setFilter, setPage, reset } = useListState([
    'joueur',
    'reference',
    'status',
    'category',
    'priority',
    'du',
    'au',
  ] as const);
  const query = useQuery(
    complaintsQuery({
      page,
      player: filters.joueur,
      reference: filters.reference,
      status: filters.status,
      category: filters.category,
      priority: filters.priority,
      from: filters.du ? localDayStartIso(filters.du) : undefined,
      to: filters.au ? localDayStartIso(nextDay(filters.au)) : undefined,
    }),
  );
  return (
    <>
      <PageHeader
        title="Réclamations"
        description="Dossiers déposés par les joueurs, avec ou sans l’assistant automatisé. La consultation d’un dossier est inscrite au journal d’audit."
      />
      <InfoNote className="mb-4">
        Traiter une réclamation ne modifie jamais un solde, une partie ou une récompense : une
        correction passe par le module concerné (paiements, retraits, tournois), puis la décision du
        dossier la consigne.
      </InfoNote>
      <Card>
        <FilterBar onReset={reset}>
          <SearchInput
            value={filters.joueur}
            onChange={(v) => setFilter('joueur', v)}
            placeholder="Pseudo ou identifiant du joueur"
            label="Rechercher un joueur"
          />
          <SearchInput
            value={filters.reference}
            onChange={(v) => setFilter('reference', v)}
            placeholder="RCL-…"
            label="Référence"
          />
          <Select
            aria-label="Statut"
            value={filters.status}
            onChange={(e) => setFilter('status', e.target.value)}
            className="w-auto"
          >
            <option value="">Tous les statuts</option>
            {Object.entries(COMPLAINT_STATUS).map(([v, [t]]) => (
              <option key={v} value={v}>
                {t}
              </option>
            ))}
          </Select>
          <Select
            aria-label="Catégorie"
            value={filters.category}
            onChange={(e) => setFilter('category', e.target.value)}
            className="w-auto"
          >
            <option value="">Toutes les catégories</option>
            {Object.entries(COMPLAINT_CATEGORY).map(([v, t]) => (
              <option key={v} value={v}>
                {t}
              </option>
            ))}
          </Select>
          <Select
            aria-label="Priorité"
            value={filters.priority}
            onChange={(e) => setFilter('priority', e.target.value)}
            className="w-auto"
          >
            <option value="">Toutes les priorités</option>
            {Object.entries(COMPLAINT_PRIORITY).map(([v, [t]]) => (
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
          caption="Réclamations"
          columns={complaintColumns}
          rows={query.data?.items}
          rowKey={(c) => c.id}
          loading={query.isFetching}
          error={query.error}
          onRetry={() => query.refetch()}
          empty="Aucune réclamation ne correspond à ces critères"
          onRowClick={(c) => router.push(`/reclamations/${c.id}`)}
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
