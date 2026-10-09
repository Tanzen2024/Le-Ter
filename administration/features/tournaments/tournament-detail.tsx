'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Ban, Check, Download, X } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { toast } from 'sonner';

import { DataTable, DetailList, type Column } from '@/components/data/data-table';
import { StatCard } from '@/components/data/stat-card';
import { StatusBadge } from '@/components/data/status-badge';
import { ConfirmDialog } from '@/components/feedback/confirm-dialog';
import { ErrorState, InfoNote, LoadingRows } from '@/components/feedback/states';
import { PageHeader } from '@/components/layout/page-header';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { downloadUrl } from '@/lib/api/client';
import { formatDateTime, formatNumber, formatXaf } from '@/lib/format';
import { CANCELLATION_REASON, label, RESERVATION_STATUS, TOURNAMENT_STATUS } from '@/lib/labels';
import type { TournamentRegistration, TournamentResult } from '@/types/admin';

import {
  availableActions,
  registrationsQuery,
  RESULT_STATUSES,
  resultsQuery,
  runTournamentAction,
  tournamentLabel,
  tournamentQuery,
  type TournamentAction,
} from './api';

const ACTIONS: Record<
  TournamentAction,
  {
    label: string;
    title: string;
    description: string;
    tone: 'primary' | 'danger';
    icon: typeof Check;
  }
> = {
  approve: {
    label: 'Approuver',
    title: 'Approuver cette proposition ?',
    description:
      'Le tournoi sera publié : les inscriptions ouvriront selon son calendrier. La commission et les poids du classement en vigueur y seront copiés.',
    tone: 'primary',
    icon: Check,
  },
  reject: {
    label: 'Refuser',
    title: 'Refuser cette proposition ?',
    description:
      'La proposition sera refusée et son créateur en sera informé. Cette décision est définitive.',
    tone: 'danger',
    icon: X,
  },
  cancel: {
    label: 'Annuler le tournoi',
    title: 'Annuler ce tournoi ?',
    description:
      'Possible uniquement avant le démarrage : toutes les réservations des inscrits sont libérées. Cette décision est définitive.',
    tone: 'danger',
    icon: Ban,
  },
};

const registrationColumns: Column<TournamentRegistration>[] = [
  {
    key: 'user',
    header: 'Joueur',
    cell: (r) => <span className="text-ink font-medium">{r.username}</span>,
  },
  {
    key: 'status',
    header: 'Inscription',
    cell: (r) =>
      r.status === 'REGISTERED' ? <Badge tone="success">Inscrit</Badge> : <Badge>Désinscrit</Badge>,
  },
  {
    key: 'reservation',
    header: 'Réservation',
    cell: (r) =>
      r.reservation ? <StatusBadge map={RESERVATION_STATUS} value={r.reservation.status} /> : '—',
  },
  {
    key: 'amount',
    header: 'Montant',
    align: 'right',
    cell: (r) => formatXaf(r.reservation?.amount),
  },
  { key: 'date', header: 'Date', hideOnMobile: true, cell: (r) => formatDateTime(r.registeredAt) },
];

const resultColumns: Column<TournamentResult>[] = [
  {
    key: 'rank',
    header: 'Rang',
    cell: (r) => <span className="text-ink font-semibold">{r.rank}</span>,
  },
  { key: 'user', header: 'Joueur', cell: (r) => r.username },
  {
    key: 'tokens',
    header: 'Jetons restants',
    align: 'right',
    cell: (r) => formatNumber(r.remainingTokens),
  },
  {
    key: 'games',
    header: 'Parties',
    align: 'right',
    hideOnMobile: true,
    cell: (r) => `${r.gamesWon} / ${r.gamesPlayed}`,
  },
  {
    key: 'score',
    header: 'Score',
    align: 'right',
    hideOnMobile: true,
    cell: (r) => (r.score === undefined ? '—' : r.score.toFixed(2)),
  },
  { key: 'prize', header: 'Gain', align: 'right', cell: (r) => formatXaf(r.prizeAmount) },
  {
    key: 'paid',
    header: 'Versé',
    cell: (r) =>
      r.prizeAmount > 0 ? (
        r.paid ? (
          <Badge tone="success">Oui</Badge>
        ) : (
          <Badge tone="warning">En attente</Badge>
        )
      ) : (
        '—'
      ),
  },
];

export function TournamentDetailView({ id }: { id: string }) {
  const client = useQueryClient();
  const query = useQuery(tournamentQuery(id));
  const registrations = useQuery(registrationsQuery(id));
  const [pending, setPending] = useState<TournamentAction | null>(null);
  const t = query.data?.tournament;
  const results = useQuery(resultsQuery(id, Boolean(t && RESULT_STATUSES.includes(t.status))));

  if (query.error) {
    return (
      <Card>
        <ErrorState error={query.error} onRetry={() => query.refetch()} />
      </Card>
    );
  }
  if (!t) return <LoadingRows rows={8} />;
  const actions = availableActions(t.status);

  async function run(action: TournamentAction) {
    await runTournamentAction(id, action);
    toast.success(`${ACTIONS[action].label} : opération enregistrée et auditée.`);
    await client.invalidateQueries({ queryKey: ['admin', 'tournament'] });
    await client.invalidateQueries({ queryKey: ['admin', 'tournaments'] });
  }

  return (
    <>
      <PageHeader
        title={tournamentLabel(t)}
        description={`${t.creatorType === 'PLAYER' ? `Proposé par ${t.creatorName ?? 'un joueur'}` : 'Créé par l’administration'} · fuseau ${t.timezone}`}
        actions={
          <>
            <Button variant="secondary" asChild>
              <Link href="/tournois">
                <ArrowLeft /> Tournois
              </Link>
            </Button>
            {actions.map((a) => {
              const Icon = ACTIONS[a].icon;
              return (
                <Button
                  key={a}
                  variant={ACTIONS[a].tone === 'danger' ? 'danger' : 'primary'}
                  onClick={() => setPending(a)}
                >
                  <Icon /> {ACTIONS[a].label}
                </Button>
              );
            })}
          </>
        }
      />
      <div className="space-y-6">
        <div className="flex flex-wrap items-center gap-2">
          <StatusBadge map={TOURNAMENT_STATUS} value={t.status} />
          {t.cancellationReason && (
            <Badge tone="danger">{label(CANCELLATION_REASON, t.cancellationReason)}</Badge>
          )}
        </div>
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          <StatCard
            label="Inscrits"
            value={formatNumber(t.registeredCount ?? t.pool?.participants)}
            hint={`Minimum ${t.minimumPlayers}, maximum ${t.maximumPlayers ?? 'illimité'}`}
          />
          <StatCard
            label="Cagnotte brute"
            value={formatXaf(t.pool?.grossPool)}
            hint={t.pool ? `${t.pool.participants} participants` : 'Figée au démarrage'}
            tone="info"
          />
          <StatCard
            label="Commission plateforme"
            value={formatXaf(t.pool?.platformFee)}
            hint={
              t.platformFeePercent === undefined
                ? 'Copiée à la publication'
                : `${t.platformFeePercent} %`
            }
            tone="success"
          />
          <StatCard
            label="Cagnotte des gains"
            value={formatXaf(t.pool?.prizePool)}
            hint={
              t.pool?.unallocatedPrize
                ? `Non attribué : ${formatXaf(t.pool.unallocatedPrize)}`
                : undefined
            }
            tone="accent"
          />
        </div>
        <div className="grid grid-cols-1 gap-6 xl:grid-cols-3">
          <Card className="xl:col-span-2">
            <CardHeader title="Calendrier et règles" />
            <CardBody>
              <DetailList
                items={[
                  ['Début', formatDateTime(t.startsAt)],
                  ['Fin', formatDateTime(t.endsAt)],
                  ['Clôture des inscriptions', formatDateTime(t.registrationClosesAt)],
                  ['Prix d’entrée', formatXaf(t.entryFee)],
                  ['Jetons de tournoi au départ', formatNumber(t.initialTournamentTokens)],
                  ['Mise par partie', formatNumber(t.stakePerGame)],
                  [
                    'Classement',
                    t.rankingWeights
                      ? `Jetons ${t.rankingWeights.tokensPercent} % · parties ${t.rankingWeights.gamesPercent} %`
                      : 'Classement historique (jetons, puis parties)',
                  ],
                  ['Créé le', formatDateTime(t.createdAt)],
                ]}
              />
            </CardBody>
          </Card>
          <Card>
            <CardHeader title="Répartition des gains" />
            <CardBody>
              <ul className="space-y-1.5 text-sm">
                {t.prizeRules.map((r) => (
                  <li key={r.rank} className="flex justify-between">
                    <span className="text-ink-soft">Rang {r.rank}</span>
                    <span className="text-ink font-medium tabular-nums">{r.percent} %</span>
                  </li>
                ))}
              </ul>
            </CardBody>
          </Card>
        </div>

        <Card>
          <CardHeader
            title="Classement et résultats"
            description="Classement final figé par le serveur ; gains versés au compte de jeu des joueurs."
            actions={
              results.data && results.data.results.length > 0 ? (
                <Button variant="secondary" size="sm" asChild>
                  <a href={downloadUrl(`tournaments/${id}/results.csv`)} download>
                    <Download /> Exporter (CSV)
                  </a>
                </Button>
              ) : undefined
            }
          />
          <DataTable
            caption="Résultats du tournoi"
            columns={resultColumns}
            rows={RESULT_STATUSES.includes(t.status) ? results.data?.results : []}
            rowKey={(r) => String(r.rank)}
            loading={results.isFetching}
            error={results.error}
            onRetry={() => results.refetch()}
            empty="Les résultats sont publiés après la validation du classement par le serveur"
          />
        </Card>

        <Card>
          <CardHeader title="Inscriptions et réservations" />
          <DataTable
            caption="Inscriptions au tournoi"
            columns={registrationColumns}
            rows={registrations.data?.registrations}
            rowKey={(r) => `${r.username}-${r.registeredAt}`}
            loading={registrations.isFetching}
            error={registrations.error}
            onRetry={() => registrations.refetch()}
            empty="Aucune inscription"
          />
        </Card>

        <InfoNote>
          Les incidents de tournoi (démarrage bloqué, tables fermées) sont gérés automatiquement par
          le serveur et visibles par le statut, le motif d’annulation et le journal d’audit. Un
          tournoi en cours n’est jamais modifié par l’administration.
        </InfoNote>
      </div>
      {pending && (
        <ConfirmDialog
          open
          onOpenChange={(open) => !open && setPending(null)}
          title={ACTIONS[pending].title}
          description={ACTIONS[pending].description}
          confirmLabel={ACTIONS[pending].label}
          tone={ACTIONS[pending].tone}
          onConfirm={() => run(pending)}
        />
      )}
    </>
  );
}
