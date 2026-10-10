'use client';

import { useQuery } from '@tanstack/react-query';
import {
  AlertTriangle,
  ArrowLeftRight,
  CheckCircle2,
  Clock,
  Flag,
  Gamepad2,
  Landmark,
  ShieldAlert,
  Trophy,
  UserCheck,
  Users,
  XCircle,
} from 'lucide-react';
import Link from 'next/link';

import { TimeSeriesChart } from '@/components/charts/time-series-chart';
import { StatCard } from '@/components/data/stat-card';
import { StatusBadge } from '@/components/data/status-badge';
import { ErrorState, EmptyState, LoadingRows } from '@/components/feedback/states';
import { PageHeader } from '@/components/layout/page-header';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { AuditEventLine } from '@/features/audit/audit-event-line';
import { isPeriod, PeriodSelect, PERIODS } from '@/features/shared/period';
import { useListState } from '@/hooks/use-list-state';
import { formatDateTime, formatNumber, formatXaf } from '@/lib/format';
import { TOURNAMENT_STATUS } from '@/lib/labels';
import type { Dashboard } from '@/types/admin';

import { dashboardQuery } from './api';

function paymentsBy(data: Dashboard, status: string) {
  return data.payments.find((p) => p.status === status) ?? { count: 0, amount: 0 };
}

function Alerts({ data }: { data: Dashboard }) {
  const items = [
    {
      count: data.alerts.newDetectionAlerts,
      label: 'alertes anti-collusion à examiner',
      href: '/anti-collusion?status=NEW',
      icon: ShieldAlert,
    },
    {
      count: data.alerts.pendingTournamentApprovals,
      label: 'propositions de tournoi à approuver',
      href: '/tournois?status=PENDING_APPROVAL',
      icon: Trophy,
    },
    {
      count: data.alerts.stalePendingPayments,
      label: 'paiements en attente depuis plus de 30 min',
      href: '/paiements?status=PENDING',
      icon: Clock,
    },
    {
      count: data.reconciliationAnomalies.total,
      label: `anomalies de rapprochement (${data.reconciliationAnomalies.critical} critiques)`,
      href: '/rapprochement',
      icon: ArrowLeftRight,
    },
    {
      count: data.alerts.overdueTurns,
      label: 'parties dont l’échéance de tour est dépassée',
      href: '/parties?anomaly=OVERDUE_TURN',
      icon: AlertTriangle,
    },
  ].filter((i) => i.count > 0);
  if (items.length === 0) {
    return (
      <p className="text-success flex items-center gap-2 text-sm">
        <CheckCircle2 className="size-4" aria-hidden /> Aucune alerte technique ou financière.
      </p>
    );
  }
  return (
    <ul className="space-y-2">
      {items.map(({ count, label, href, icon: Icon }) => (
        <li key={href}>
          <Link
            href={href}
            className="border-line hover:bg-surface-muted flex items-center gap-3 rounded-lg border px-3 py-2.5 text-sm transition-colors"
          >
            <Icon className="text-warning size-4 shrink-0" aria-hidden />
            <span className="text-ink font-semibold tabular-nums">{formatNumber(count)}</span>
            <span className="text-ink-soft">{label}</span>
          </Link>
        </li>
      ))}
    </ul>
  );
}

export function DashboardView() {
  const { filters, setFilter } = useListState(['periode'] as const);
  const period = isPeriod(filters.periode) ? filters.periode : '30';
  const query = useQuery(dashboardQuery(Number(period)));
  const data = query.data;
  const periodLabel = PERIODS.find((p) => p.value === period)?.label.toLowerCase();

  return (
    <>
      <PageHeader
        title="Tableau de bord"
        description="Indicateurs calculés par le serveur sur les données réelles de Le Ter."
        actions={<PeriodSelect value={period} onChange={(v) => setFilter('periode', v)} />}
      />
      {query.error ? (
        <Card>
          <ErrorState error={query.error} onRetry={() => query.refetch()} />
        </Card>
      ) : (
        <div className="space-y-6">
          {/* Grille unique de 8 indicateurs : 4 colonnes seulement quand la zone de contenu
              (et non la fenêtre) est assez large, pour que les montants restent lisibles. */}
          <div className="@container">
            <div className="grid grid-cols-1 gap-4 @xl:grid-cols-2 @4xl:grid-cols-4">
              <StatCard
                label="Joueurs inscrits"
                value={formatNumber(data?.players.total)}
                hint={data && `${formatNumber(data.players.newInPeriod)} nouveaux sur la période`}
                icon={Users}
                loading={!data}
              />
              <StatCard
                label="Joueurs actifs"
                value={formatNumber(data?.players.active)}
                hint={`Sur les ${periodLabel}`}
                icon={UserCheck}
                tone="accent"
                loading={!data}
              />
              <StatCard
                label="Parties en cours"
                value={formatNumber(data?.games.inProgress)}
                hint={data && `${formatNumber(data.games.waiting)} en attente de joueurs`}
                icon={Gamepad2}
                tone="info"
                loading={!data}
              />
              <StatCard
                label="Recettes de la plateforme"
                value={formatXaf(data?.platformRevenue)}
                hint="Commissions comptabilisées sur la période"
                icon={Landmark}
                tone="success"
                loading={!data}
              />
              <StatCard
                label="Paiements confirmés"
                value={data ? formatXaf(paymentsBy(data, 'SUCCESS').amount) : '—'}
                hint={
                  data && `${formatNumber(paymentsBy(data, 'SUCCESS').count)} paiements CinetPay`
                }
                icon={CheckCircle2}
                tone="success"
                loading={!data}
              />
              <StatCard
                label="Paiements en attente"
                value={data ? formatNumber(paymentsBy(data, 'PENDING').count) : '—'}
                hint={data && formatXaf(paymentsBy(data, 'PENDING').amount)}
                icon={Clock}
                tone="warning"
                loading={!data}
              />
              <StatCard
                label="Paiements échoués ou expirés"
                value={
                  data
                    ? formatNumber(
                        paymentsBy(data, 'FAILED').count + paymentsBy(data, 'EXPIRED').count,
                      )
                    : '—'
                }
                hint="Aucun crédit effectué"
                icon={XCircle}
                tone="danger"
                loading={!data}
              />
              <StatCard
                label="Parties terminées"
                value={formatNumber(data?.games.finishedInPeriod)}
                hint={data && `${formatNumber(data.games.createdInPeriod)} créées sur la période`}
                icon={Flag}
                loading={!data}
              />
            </div>
          </div>

          <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
            <Card>
              <CardHeader
                title="Joueurs actifs par jour"
                description="Joueurs distincts d’au moins une partie démarrée ce jour-là (Africa/Douala)."
              />
              <CardBody>
                {data ? (
                  <TimeSeriesChart
                    kind="area"
                    color="chart-1"
                    valueLabel="Joueurs actifs"
                    data={data.series.map((d) => ({ day: d.day, value: d.activePlayers }))}
                  />
                ) : (
                  <LoadingRows rows={4} />
                )}
              </CardBody>
            </Card>
            <Card>
              <CardHeader
                title="Paiements confirmés par jour"
                description="Montant des achats CinetPay confirmés par le serveur, en FCFA."
              />
              <CardBody>
                {data ? (
                  <TimeSeriesChart
                    kind="column"
                    color="chart-2"
                    valueLabel="Paiements confirmés"
                    format={formatXaf}
                    data={data.series.map((d) => ({ day: d.day, value: d.paymentsAmount }))}
                  />
                ) : (
                  <LoadingRows rows={4} />
                )}
              </CardBody>
            </Card>
          </div>

          <div className="grid grid-cols-1 gap-6 xl:grid-cols-3">
            <Card>
              <CardHeader
                title="Alertes"
                description="Points à traiter, calculés par le serveur."
              />
              <CardBody>{data ? <Alerts data={data} /> : <LoadingRows rows={3} />}</CardBody>
            </Card>
            <Card>
              <CardHeader
                title="Tournois par statut"
                actions={
                  <Link href="/tournois" className="text-info text-xs hover:underline">
                    Tout voir
                  </Link>
                }
              />
              <CardBody>
                {!data ? (
                  <LoadingRows rows={3} />
                ) : data.tournaments.length === 0 ? (
                  <EmptyState title="Aucun tournoi" />
                ) : (
                  <ul className="space-y-2">
                    {data.tournaments.map((t) => (
                      <li key={t.status} className="flex items-center justify-between gap-3">
                        <StatusBadge map={TOURNAMENT_STATUS} value={t.status} />
                        <span className="text-ink text-sm font-medium tabular-nums">
                          {formatNumber(t.count)}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </CardBody>
            </Card>
            <Card>
              <CardHeader
                title="Activité administrative récente"
                actions={
                  <Link href="/audit" className="text-info text-xs hover:underline">
                    Journal complet
                  </Link>
                }
              />
              <CardBody>
                {!data ? (
                  <LoadingRows rows={3} />
                ) : data.recentAdminActivity.length === 0 ? (
                  <EmptyState title="Aucune action enregistrée" />
                ) : (
                  <ul className="space-y-3">
                    {data.recentAdminActivity.map((e) => (
                      <li key={e.id}>
                        <AuditEventLine event={e} />
                      </li>
                    ))}
                  </ul>
                )}
              </CardBody>
            </Card>
          </div>

          {data && (
            <p className="text-muted text-xs">
              {data.definitions.activePlayer} Données générées le {formatDateTime(data.generatedAt)}
              .
            </p>
          )}
        </div>
      )}
    </>
  );
}
