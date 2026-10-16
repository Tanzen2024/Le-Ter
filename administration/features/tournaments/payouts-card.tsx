'use client';

import { queryOptions, useQuery } from '@tanstack/react-query';

import { DataTable, type Column } from '@/components/data/data-table';
import { IdText } from '@/components/data/status-badge';
import { StatCard } from '@/components/data/stat-card';
import { InfoNote } from '@/components/feedback/states';
import { Badge, type BadgeTone } from '@/components/ui/badge';
import { Card, CardHeader } from '@/components/ui/card';
import { api } from '@/lib/api/client';
import { formatDateTime, formatXaf } from '@/lib/format';
import type {
  TournamentFinancialState,
  TournamentPayout,
  TournamentPayoutReport,
} from '@/types/admin';

/**
 * Rapport financier d'un tournoi (D-112), lu tel quel sur le serveur : aucune règle recopiée,
 * aucune action financière ici (les versements sont faits et repris par le serveur seul).
 */
export function payoutsQuery(id: string, enabled = true) {
  return queryOptions({
    enabled,
    queryKey: ['admin', 'tournament', id, 'payouts'],
    queryFn: () => api.get<TournamentPayoutReport>(`tournaments/${id}/payouts`),
  });
}

export const FINANCIAL_STATE: Record<TournamentFinancialState, readonly [string, BadgeTone]> = {
  NOT_STARTED: ['Avant le démarrage', 'neutral'],
  CANCELLED: ['Annulé : réservations libérées', 'neutral'],
  IN_PROGRESS: ['Tournoi en cours', 'info'],
  PLAN_PENDING_VALIDATION: ['Plan en validation', 'info'],
  BLOCKED: ['Versements bloqués', 'danger'],
  PAYING: ['Versements en cours', 'warning'],
  PAYMENT_FAILED: ['Versement en échec', 'danger'],
  FINALIZED: ['Finalisé : tous les gains crédités', 'success'],
};

const PAYOUT_STATUS: Record<TournamentPayout['status'], readonly [string, BadgeTone]> = {
  PENDING: ['En attente', 'warning'],
  CREDITED: ['Crédité', 'success'],
  FAILED: ['Échec (reprise automatique)', 'danger'],
};

/** Motifs de blocage (contrôles du serveur) en clair ; un code inconnu est affiché tel quel. */
const BLOCK_REASONS: Record<string, string> = {
  LEDGER_FACTS_MISSING: 'Données comptables du tournoi introuvables',
  TOURNAMENT_FEE_ENTRY_MISSING: 'Écriture de commission absente du compte de la plateforme',
  TOURNAMENT_FEE_ENTRY_MISMATCH: 'Écriture de commission différente de la commission figée',
  TOURNAMENT_FEE_FORMULA: 'Commission différente de la formule (taux figé, arrondi inférieur)',
  TOURNAMENT_ENTRIES_MISMATCH: 'Cagnotte brute différente des inscriptions réellement capturées',
  TOURNAMENT_POOL_SPLIT: 'Cagnotte brute ≠ commission + cagnotte distribuable',
  TOURNAMENT_PRIZES_MISMATCH: 'Gains attribués + part non attribuée ≠ cagnotte distribuable',
  TOURNAMENT_UNALLOCATED_ENTRY: 'Part non attribuée et son écriture ne concordent pas',
  PRIZE_POOL_MISSING: 'Cagnotte distribuable absente',
  PRIZE_RULES_MISSING: 'Répartition des gains absente',
  RANKING_NOT_CONTIGUOUS: 'Classement incomplet (rangs manquants)',
  PLAN_ROW_MISSING: 'Gain du classement absent du plan',
  PLAN_ROW_UNEXPECTED: 'Ligne du plan sans gain au classement',
  PLAN_AMOUNT_MISMATCH: 'Montant du plan différent du classement',
  PLAN_BENEFICIARY_MISMATCH: 'Bénéficiaire du plan différent du classement',
  PLAN_DUPLICATE_BENEFICIARY: 'Bénéficiaire présent deux fois',
  PLAN_RULES_MISMATCH: 'Gains différents de la répartition officielle',
  PLAN_TOTAL_MISMATCH: 'Total du plan + part non attribuée ≠ cagnotte distribuable',
  PLAN_EXCEEDS_POOL: 'Total du plan supérieur à la cagnotte distribuable',
};

export function payoutColumns(): Column<TournamentPayout>[] {
  return [
    { key: 'rank', header: 'Rang', cell: (p) => <span className="font-semibold">{p.rank}</span> },
    { key: 'user', header: 'Bénéficiaire', cell: (p) => p.username },
    { key: 'amount', header: 'Montant dû', align: 'right', cell: (p) => formatXaf(p.amount) },
    {
      key: 'status',
      header: 'Versement',
      cell: (p) => {
        const [text, tone] = PAYOUT_STATUS[p.status];
        return (
          <Badge tone={tone} dot>
            {text}
          </Badge>
        );
      },
    },
    {
      key: 'credited',
      header: 'Crédité le',
      hideOnMobile: true,
      cell: (p) => (p.creditedAt ? formatDateTime(p.creditedAt) : '—'),
    },
    {
      key: 'transaction',
      header: 'Transaction',
      hideOnMobile: true,
      cell: (p) => <IdText id={p.walletTransactionId} />,
    },
    {
      key: 'reference',
      header: 'Référence',
      hideOnMobile: true,
      cell: (p) => <span className="text-ink-soft font-mono text-xs">{p.reference}</span>,
    },
    {
      key: 'error',
      header: 'Dernier échec',
      hideOnMobile: true,
      cell: (p) =>
        p.lastError ? (
          <span className="text-danger text-xs" title={p.lastError}>
            {p.attempts} tentative{p.attempts > 1 ? 's' : ''} · {p.lastError.slice(0, 80)}
          </span>
        ) : (
          '—'
        ),
    },
  ];
}

/** Carte « Récompenses réelles » : cagnotte, plan de versement et finalisation financière. */
export function PayoutsCard({ id, enabled }: { id: string; enabled: boolean }) {
  const report = useQuery(payoutsQuery(id, enabled));
  const data = report.data;
  const [stateText, stateTone] = data ? FINANCIAL_STATE[data.financialState] : ['—', 'neutral'];
  return (
    <Card>
      <CardHeader
        title="Récompenses réelles"
        description="Versées au compte de jeu des gagnants (écritures internes, jamais CinetPay), d’après le classement validé. Les jetons de tournoi n’ont aucune valeur monétaire."
        actions={
          data ? (
            <Badge tone={stateTone as BadgeTone} dot>
              {stateText}
            </Badge>
          ) : undefined
        }
      />
      {data && (
        <div className="grid gap-3 p-4 sm:grid-cols-2 xl:grid-cols-4">
          <StatCard
            label="Fonds capturés"
            value={formatXaf(data.pool.grossPool)}
            hint={`${data.pool.participants} participants`}
          />
          <StatCard
            label="Commission"
            value={formatXaf(data.pool.platformFee)}
            hint={`${data.pool.platformFeePercent} %`}
            tone="accent"
          />
          <StatCard
            label="Cagnotte distribuable"
            value={formatXaf(data.pool.prizePool)}
            hint={
              data.pool.unallocatedPrize
                ? `Non attribué : ${formatXaf(data.pool.unallocatedPrize)}`
                : `Répartition : ${data.prizeRules.map((r) => `${r.percent} %`).join(' / ') || '—'}`
            }
            tone="info"
          />
          <StatCard
            label="Crédité / dû"
            value={`${formatXaf(data.creditedTotal)} / ${formatXaf(data.dueTotal)}`}
            hint={
              data.planValidatedAt
                ? `Plan validé le ${formatDateTime(data.planValidatedAt)}`
                : 'Plan non encore validé'
            }
            tone={data.creditedTotal === data.dueTotal ? 'success' : 'warning'}
          />
        </div>
      )}
      {data?.blocked && (
        <div className="px-4 pb-4">
          <InfoNote>
            <strong>Versements bloqués depuis le {formatDateTime(data.blocked.at)}</strong> : aucun
            crédit tant que les données financières sont incohérentes. Les contrôles sont rejoués
            automatiquement.
            <ul className="mt-1 list-disc pl-5">
              {data.blocked.reasons.map((r) => (
                <li key={r}>{BLOCK_REASONS[r] ?? r}</li>
              ))}
            </ul>
          </InfoNote>
        </div>
      )}
      <DataTable
        caption="Plan de versement des récompenses"
        columns={payoutColumns()}
        rows={enabled ? data?.payouts : []}
        rowKey={(p) => String(p.rank)}
        loading={report.isFetching}
        error={report.error}
        onRetry={() => report.refetch()}
        empty="Le plan de versement est écrit avec le classement officiel"
      />
    </Card>
  );
}
