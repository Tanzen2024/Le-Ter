'use client';

import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { Download } from 'lucide-react';

import { DataTable, type Column } from '@/components/data/data-table';
import { InfoNote } from '@/components/feedback/states';
import { PageHeader } from '@/components/layout/page-header';
import { Button } from '@/components/ui/button';
import { Card, CardHeader } from '@/components/ui/card';
import { Select } from '@/components/ui/form-controls';
import { isPeriod, PeriodSelect, periodRange } from '@/features/shared/period';
import { useListState } from '@/hooks/use-list-state';
import { api, downloadUrl } from '@/lib/api/client';
import { formatDateTime } from '@/lib/format';
import type { Report, ReportName } from '@/types/admin';

const REPORTS: { value: ReportName; label: string }[] = [
  { value: 'players', label: 'Activité des joueurs' },
  { value: 'games', label: 'Parties' },
  { value: 'tournaments', label: 'Tournois' },
  { value: 'payments', label: 'Paiements et recettes' },
  { value: 'commissions', label: 'Commissions (compte de la plateforme)' },
  { value: 'reconciliation', label: 'Anomalies de rapprochement' },
  { value: 'admin-activity', label: 'Actions administratives' },
];

const COLUMN_LABELS: Record<string, string> = {
  day: 'Jour',
  newPlayers: 'Nouveaux joueurs',
  activePlayers: 'Joueurs actifs',
  gamesStarted: 'Parties démarrées',
  paymentsSucceeded: 'Paiements confirmés',
  paymentsAmount: 'Montant confirmé (FCFA)',
  platformRevenue: 'Recettes plateforme (FCFA)',
  id: 'Identifiant',
  name: 'Tournoi',
  status: 'Statut',
  startsAt: 'Début',
  endsAt: 'Fin',
  entryFee: 'Entrée (FCFA)',
  registered: 'Inscrits',
  participants: 'Participants',
  grossPool: 'Cagnotte brute',
  platformFee: 'Commission',
  prizePool: 'Cagnotte des gains',
  createdAt: 'Date',
  kind: 'Écriture',
  amount: 'Montant',
  feeBps: 'Taux (pb)',
  tournamentId: 'Tournoi (id)',
  tournamentName: 'Tournoi',
  date: 'Date',
  type: 'Type',
  severity: 'Gravité',
  reference: 'Référence',
  referenceId: 'Identifiant',
  explanation: 'Explication',
  action: 'Action',
  outcome: 'Résultat',
  actor: 'Administrateur',
  targetType: 'Cible',
  targetId: 'Identifiant cible',
};

const DATE_COLUMNS = new Set(['startsAt', 'endsAt', 'createdAt', 'date']);

export function ReportsView() {
  const { filters, setFilter } = useListState(['rapport', 'periode'] as const);
  const report = (REPORTS.find((r) => r.value === filters.rapport)?.value ??
    'players') as ReportName;
  const period = isPeriod(filters.periode) ? filters.periode : '30';
  const range = periodRange(Number(period));
  const query = useQuery({
    queryKey: ['admin', 'report', report, range.from, range.to],
    queryFn: () => api.get<Report>(`reports/${report}`, range),
    placeholderData: keepPreviousData,
  });
  const data = query.data;
  const columns: Column<Record<string, string | number | null>>[] = (data?.columns ?? []).map(
    (c) => ({
      key: c,
      header: COLUMN_LABELS[c] ?? c,
      cell: (row) => {
        const v = row[c];
        if (v === null || v === undefined) return '—';
        if (DATE_COLUMNS.has(c) && typeof v === 'string') return formatDateTime(v);
        return typeof v === 'number' ? v.toLocaleString('fr-FR') : v;
      },
    }),
  );

  return (
    <>
      <PageHeader
        title="Rapports"
        description="Rapports calculés par le serveur sur des données réelles, avec leurs critères de calcul. L’export est inscrit au journal d’audit."
        actions={
          <>
            <Select
              aria-label="Rapport"
              value={report}
              onChange={(e) => setFilter('rapport', e.target.value)}
              className="w-auto"
            >
              {REPORTS.map((r) => (
                <option key={r.value} value={r.value}>
                  {r.label}
                </option>
              ))}
            </Select>
            <PeriodSelect value={period} onChange={(v) => setFilter('periode', v)} />
            <Button variant="secondary" asChild>
              <a href={downloadUrl(`reports/${report}/csv`, range)} download>
                <Download /> Exporter (CSV)
              </a>
            </Button>
          </>
        }
      />
      {data && (
        <InfoNote className="mb-4">
          <span className="font-medium">Critères :</span> {data.criteria} Période du{' '}
          {formatDateTime(data.period.from)} au {formatDateTime(data.period.to)} (fuseau{' '}
          {data.period.timezone}). Généré le {formatDateTime(data.generatedAt)}.
        </InfoNote>
      )}
      <Card>
        <CardHeader
          title={REPORTS.find((r) => r.value === report)?.label}
          description={data ? `${data.rows.length.toLocaleString('fr-FR')} ligne(s)` : undefined}
        />
        <DataTable
          caption="Rapport"
          columns={columns}
          rows={data?.rows}
          rowKey={(row) => JSON.stringify(row)}
          loading={query.isFetching}
          error={query.error}
          onRetry={() => query.refetch()}
          empty="Aucune donnée pour ce rapport sur la période"
        />
      </Card>
    </>
  );
}
