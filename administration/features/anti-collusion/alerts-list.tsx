'use client';

import { useQuery } from '@tanstack/react-query';
import { ShieldCheck, ShieldOff } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';

import { DataTable, Pagination, type Column } from '@/components/data/data-table';
import { FilterBar } from '@/components/data/filter-bar';
import { IdText, StatusBadge } from '@/components/data/status-badge';
import { InfoNote } from '@/components/feedback/states';
import { PageHeader } from '@/components/layout/page-header';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input, Select } from '@/components/ui/form-controls';
import { useListState } from '@/hooks/use-list-state';
import { formatDateTime, localDayStartIso } from '@/lib/format';
import { ALERT_LEVEL, ALERT_STATUS } from '@/lib/labels';
import type { AlertSummary } from '@/types/admin';

import { alertsQuery, detectionSettingQuery } from './api';

const SCOPE: Record<string, string> = { PLAYER: 'Joueur', PAIR: 'Paire', GROUP: 'Groupe' };

const columns: Column<AlertSummary>[] = [
  { key: 'date', header: 'Signalée le', cell: (a) => formatDateTime(a.createdAt) },
  {
    key: 'status',
    header: 'Suivi',
    cell: (a) => <StatusBadge map={ALERT_STATUS} value={a.status} />,
  },
  {
    key: 'level',
    header: 'Niveau',
    cell: (a) => <StatusBadge map={ALERT_LEVEL} value={a.level} />,
  },
  {
    key: 'score',
    header: 'Score',
    align: 'right',
    cell: (a) => <span className="text-ink font-medium">{a.score} / 100</span>,
  },
  {
    key: 'subject',
    header: 'Sujet',
    hideOnMobile: true,
    cell: (a) =>
      `${SCOPE[a.subject.scope] ?? a.subject.scope} · ${a.subject.playerIds.length} joueur(s)`,
  },
  { key: 'game', header: 'Partie', hideOnMobile: true, cell: (a) => <IdText id={a.gameId} /> },
  {
    key: 'priority',
    header: '',
    cell: (a) => (a.priority === 'PRIORITY' ? <Badge tone="danger">Prioritaire</Badge> : null),
  },
];

function nextDay(day: string) {
  const d = new Date(`${day}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

export function AlertsList() {
  const router = useRouter();
  const setting = useQuery(detectionSettingQuery());
  const { filters, page, setFilter, setPage, reset } = useListState([
    'status',
    'level',
    'sort',
    'du',
    'au',
  ] as const);
  const query = useQuery(
    alertsQuery({
      page,
      status: filters.status,
      level: filters.level,
      sort: filters.sort || 'created_at_desc',
      from: filters.du ? localDayStartIso(filters.du) : undefined,
      to: filters.au ? localDayStartIso(nextDay(filters.au)) : undefined,
    }),
  );
  const enabled = setting.data?.enabled;
  return (
    <>
      <PageHeader
        title="Anti-collusion"
        description="Signaux de comportements à examiner. Une alerte n’est jamais une preuve de tricherie."
        actions={
          <Button variant="secondary" asChild>
            <Link href="/parametres#detection">
              {enabled ? (
                <ShieldCheck className="text-success" />
              ) : (
                <ShieldOff className="text-faint" />
              )}
              Détection {enabled === undefined ? '…' : enabled ? 'activée' : 'désactivée'}
            </Link>
          </Button>
        }
      />
      <InfoNote className="mb-4">
        Le score combine des signaux techniques (positions, comportements de jeu) calculés par le
        serveur. Le suivi d’une alerte (en examen, écartée, traitée) n’entraîne aucune sanction,
        aucune modification de partie, de compte ni de gain.
      </InfoNote>
      <Card>
        <FilterBar onReset={reset}>
          <Select
            aria-label="Suivi"
            value={filters.status}
            onChange={(e) => setFilter('status', e.target.value)}
            className="w-auto"
          >
            <option value="">Tous les suivis</option>
            {Object.entries(ALERT_STATUS).map(([v, [t]]) => (
              <option key={v} value={v}>
                {t}
              </option>
            ))}
          </Select>
          <Select
            aria-label="Niveau"
            value={filters.level}
            onChange={(e) => setFilter('level', e.target.value)}
            className="w-auto"
          >
            <option value="">Tous les niveaux</option>
            <option value="high">Élevé</option>
            <option value="very_high">Très élevé</option>
          </Select>
          <Select
            aria-label="Tri"
            value={filters.sort || 'created_at_desc'}
            onChange={(e) => setFilter('sort', e.target.value)}
            className="w-auto"
          >
            <option value="created_at_desc">Plus récentes</option>
            <option value="created_at_asc">Plus anciennes</option>
            <option value="score_desc">Score décroissant</option>
            <option value="score_asc">Score croissant</option>
          </Select>
          <label className="text-muted flex items-center gap-1.5 text-xs">
            Du
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
          caption="Alertes anti-collusion"
          columns={columns}
          rows={query.data?.items}
          rowKey={(a) => a.alertId}
          loading={query.isFetching}
          error={query.error}
          onRetry={() => query.refetch()}
          empty="Aucune alerte ne correspond à ces critères"
          onRowClick={(a) => router.push(`/anti-collusion/${a.alertId}`)}
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
