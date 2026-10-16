/**
 * Plan de versement des récompenses RÉELLES d'un tournoi (D-112). Fonctions pures : aucune
 * entrée-sortie. Les récompenses sont des écritures internes du compte de jeu (1 FCFA = 1
 * jeton du compte de jeu), jamais un paiement CinetPay, et n'ont aucun lien avec les jetons
 * FICTIFS du tournoi (classement seulement).
 */
import type { PrizeRule, TournamentId } from './tournament';
import { computePrizes } from './tournament';

/** PENDING : dû, pas encore crédité ; CREDITED : écriture réussie (définitif) ; FAILED : à reprendre. */
export type TournamentPayoutStatus = 'PENDING' | 'CREDITED' | 'FAILED';

export interface TournamentPayout {
  tournamentId: TournamentId;
  rank: number;
  playerId: string;
  amount: number;
  idempotencyKey: string;
  status: TournamentPayoutStatus;
  walletTransactionId?: string;
  attempts: number;
  lastError?: string;
  lastAttemptAt?: Date;
  createdAt: Date;
  creditedAt?: Date;
}

/** Ligne de plan à écrire avec le classement officiel. */
export interface TournamentPayoutDraft {
  rank: number;
  playerId: string;
  amount: number;
  idempotencyKey: string;
}

/**
 * Délai avant une nouvelle tentative d'un versement en échec (le planificateur repasse toutes
 * les 15 s) : une panne durable ne fait pas boucler le crédit ni les journaux.
 */
export const PAYOUT_RETRY_DELAY_MS = 60_000;

/**
 * Référence UNIQUE d'un crédit : celle que l'ancien versement (D-054) utilisait déjà, pour
 * qu'un gain versé avant D-112 ne puisse jamais être versé une seconde fois.
 */
export function payoutIdempotencyKey(tournamentId: TournamentId | string, rank: number): string {
  return `tournament-prize:${tournamentId}:${rank}`;
}

/**
 * Plan issu du classement officiel : une ligne par rang récompensé (montant > 0). Le
 * classement est un ordre TOTAL (D-062, D-106 : départage jusqu'à l'identifiant) : il n'y a
 * jamais d'ex æquo pour un rang, donc jamais de partage de récompense entre deux joueurs.
 */
export function planPayouts(
  tournamentId: TournamentId,
  results: readonly { rank: number; playerId: string; amount: number }[],
): TournamentPayoutDraft[] {
  return results
    .filter((r) => r.amount > 0)
    .map((r) => ({
      rank: r.rank,
      playerId: r.playerId,
      amount: r.amount,
      idempotencyKey: payoutIdempotencyKey(tournamentId, r.rank),
    }));
}

/** Motifs de blocage du versement (contrôles du plan lui-même). */
export type PayoutPlanAnomaly =
  | 'PRIZE_POOL_MISSING'
  | 'PRIZE_RULES_MISSING'
  | 'RANKING_NOT_CONTIGUOUS'
  | 'PLAN_ROW_MISSING'
  | 'PLAN_ROW_UNEXPECTED'
  | 'PLAN_AMOUNT_MISMATCH'
  | 'PLAN_BENEFICIARY_MISMATCH'
  | 'PLAN_DUPLICATE_BENEFICIARY'
  | 'PLAN_RULES_MISMATCH'
  | 'PLAN_TOTAL_MISMATCH'
  | 'PLAN_EXCEEDS_POOL';

/**
 * Contrôles du plan AVANT tout crédit (D-112). Le plan doit être exactement la répartition
 * officielle de la cagnotte distribuable (`computePrizes`, arrondi inférieur, reste au 1er
 * rang) sur le classement validé : un rang = un bénéficiaire, somme des gains + part non
 * attribuée = cagnotte distribuable, jamais au-delà. Renvoie les motifs, vide si le plan est sûr.
 */
export function payoutPlanAnomalies(input: {
  prizePool: number | undefined;
  unallocatedPrize: number | undefined;
  prizeRules: readonly PrizeRule[];
  results: readonly { rank: number; playerId: string; prizeAmount: number }[];
  payouts: readonly { rank: number; playerId: string; amount: number }[];
}): PayoutPlanAnomaly[] {
  const out = new Set<PayoutPlanAnomaly>();
  const { prizePool, results, payouts } = input;
  if (prizePool === undefined || !Number.isSafeInteger(prizePool) || prizePool < 0) {
    return ['PRIZE_POOL_MISSING'];
  }
  if (prizePool > 0 && input.prizeRules.length === 0) out.add('PRIZE_RULES_MISSING');

  const ranks = [...results].map((r) => r.rank).sort((a, b) => a - b);
  if (ranks.some((rank, index) => rank !== index + 1)) out.add('RANKING_NOT_CONTIGUOUS');

  // Répartition officielle recalculée sur la cagnotte et le nombre de classés.
  const official = computePrizes(prizePool, [...input.prizeRules], results.length);
  const officialByRank = new Map(official.prizes.map((p) => [p.rank, p.amount]));
  const resultByRank = new Map(results.map((r) => [r.rank, r]));
  for (const r of results) {
    if ((officialByRank.get(r.rank) ?? 0) !== r.prizeAmount) out.add('PLAN_RULES_MISMATCH');
  }
  if ((input.unallocatedPrize ?? 0) !== official.unallocated) out.add('PLAN_RULES_MISMATCH');

  const payoutByRank = new Map(payouts.map((p) => [p.rank, p]));
  for (const r of results) {
    if (r.prizeAmount > 0 && !payoutByRank.has(r.rank)) out.add('PLAN_ROW_MISSING');
  }
  const beneficiaries = new Set<string>();
  for (const p of payouts) {
    const result = resultByRank.get(p.rank);
    if (!result || result.prizeAmount <= 0) {
      out.add('PLAN_ROW_UNEXPECTED');
      continue;
    }
    if (result.prizeAmount !== p.amount || !Number.isSafeInteger(p.amount) || p.amount <= 0) {
      out.add('PLAN_AMOUNT_MISMATCH');
    }
    if (result.playerId !== p.playerId) out.add('PLAN_BENEFICIARY_MISMATCH');
    if (beneficiaries.has(p.playerId)) out.add('PLAN_DUPLICATE_BENEFICIARY');
    beneficiaries.add(p.playerId);
  }
  const total = payouts.reduce((sum, p) => sum + p.amount, 0);
  if (total > prizePool) out.add('PLAN_EXCEEDS_POOL');
  if (total + (input.unallocatedPrize ?? 0) !== prizePool) out.add('PLAN_TOTAL_MISMATCH');
  return [...out];
}

/**
 * État financier d'un tournoi pour l'administration et le joueur (D-112) : dérivé du statut
 * du tournoi et de son plan, jamais saisi.
 */
export type TournamentFinancialState =
  | 'NOT_STARTED'
  | 'CANCELLED'
  | 'IN_PROGRESS'
  | 'PLAN_PENDING_VALIDATION'
  | 'BLOCKED'
  | 'PAYING'
  | 'PAYMENT_FAILED'
  | 'FINALIZED';

export function tournamentFinancialState(input: {
  status: string;
  blocked: boolean;
  payouts: readonly { status: TournamentPayoutStatus }[];
}): TournamentFinancialState {
  const { status } = input;
  if (status === 'CANCELLED') return 'CANCELLED';
  if (status === 'COMPLETED') {
    return input.payouts.every((p) => p.status === 'CREDITED') ? 'FINALIZED' : 'PAYMENT_FAILED';
  }
  if (input.blocked) return 'BLOCKED';
  if (status === 'RESULTS_VALIDATED') return 'PLAN_PENDING_VALIDATION';
  if (status === 'DISTRIBUTING_PRIZES') {
    return input.payouts.some((p) => p.status === 'FAILED') ? 'PAYMENT_FAILED' : 'PAYING';
  }
  if (status === 'IN_PROGRESS' || status === 'CALCULATING_RESULTS') return 'IN_PROGRESS';
  return 'NOT_STARTED';
}
