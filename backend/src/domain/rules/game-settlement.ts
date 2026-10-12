import { cardFromId } from '../cards/card';
import type { Game } from '../game/game';
import type { PlayerId } from '../game/game-id';
import { TRICKS_PER_GAME } from './rule-set';
import { GAME_STAKE_BALANCE_MULTIPLIER } from './stake';

/**
 * Règlement financier d'une partie ORDINAIRE (D-074, révisée par D-080) : fonctions PURES,
 * sans base ni portefeuille. Le serveur les applique à l'état OFFICIEL et persisté de la
 * partie ; aucun montant, résultat ou type de victoire ne vient du client.
 *
 * Règle (propriétaire du projet, octobre 2026) : la commission est prélevée sur les mises des
 * PERDANTS ; le gagnant récupère sa propre mise et reçoit le reste.
 * - M : mise unitaire de la partie ; N : participants réglés ; C : taux de la tranche de M
 *   (barème configurable, figé au démarrage dans `game_settlements.commission_bps`).
 * - Victoire simple : chaque perdant perd M ; brut = M × (N − 1).
 * - Victoire par Kora : chaque perdant perd KORA_LOSS_MULTIPLIER × M ; brut = 2M × (N − 1).
 *   Seule la BASE double : le taux reste C (D-080, le doublement du taux de D-074 est retiré).
 * - Commission = floor(brut × C), en points de base entiers (en faveur du joueur, comme la
 *   commission des tournois, D-054) ; gain net du gagnant = brut − commission.
 * - Sans gagnant : commission 0, aucune mise consommée, aucun gain.
 *
 * Exemple : 2 joueurs, M = 500, C = 6 %. Simple : commission 30, le gagnant reçoit 470, le
 * perdant perd 500. Kora : commission 6 % × 1 000 = 60, le gagnant reçoit 940, le perdant
 * perd 1 000.
 *
 * Cohérence comptable : Σ mises consommées (perdants) = brut = gain net + commission.
 * Variation nette : perdant −M (ou −2M), gagnant +gain net, plateforme +commission.
 */

/** Une tranche du barème : mises de `minStake` à `maxStake` inclus (null : sans plafond). */
export interface GameCommissionTier {
  minStake: number;
  maxStake: number | null;
  percent: number;
}

/**
 * Barème initial (propriétaire du projet, octobre 2026), modifiable dans l'administration.
 * Bornes rendues contiguës à sa demande (le tableau d'origine omettait 100 et chevauchait
 * 351-400 et 1 000).
 */
export const DEFAULT_GAME_COMMISSION_SCHEDULE: readonly GameCommissionTier[] = [
  { minStake: 1, maxStake: 5, percent: 0 },
  { minStake: 6, maxStake: 100, percent: 1 },
  { minStake: 101, maxStake: 200, percent: 2 },
  { minStake: 201, maxStake: 300, percent: 3 },
  { minStake: 301, maxStake: 400, percent: 4 },
  { minStake: 401, maxStake: 500, percent: 6 },
  { minStake: 501, maxStake: 700, percent: 7 },
  { minStake: 701, maxStake: 999, percent: 8 },
  { minStake: 1000, maxStake: null, percent: 10 },
];

/**
 * La victoire par Kora multiplie la PERTE de chaque perdant (base de la commission), jamais
 * le taux (D-080). C'est aussi la perte maximale couverte par l'engagement du démarrage.
 */
export const KORA_LOSS_MULTIPLIER = GAME_STAKE_BALANCE_MULTIPLIER;
/**
 * Bornes du taux d'une tranche : 0 % à 100 %, 2 décimales au plus (stocké en points de base).
 * Le taux n'est plus doublé par la Kora (D-080) : le plafond de 50 % de D-074 n'a plus lieu
 * d'être ; à 100 %, la commission absorbe tout le brut et le gain net vaut 0 (jamais négatif).
 */
export const GAME_COMMISSION_LIMITS = { min: 0, max: 100 } as const;
/** Nombre maximal de tranches du barème. */
export const GAME_COMMISSION_MAX_TIERS = 50;
const BPS_PER_PERCENT = 100;
const BPS_FULL = 10_000;

export type GameVictoryType = 'SIMPLE' | 'KORA';

/** Kora : valeur de la carte qui doit remporter le dernier tour. */
export const KORA_CARD_VALUE = 3;

/** Taux en % valide : nombre fini entre 0 et 50, au plus 2 décimales. */
export function isValidCommissionPercent(value: unknown): value is number {
  return (
    typeof value === 'number' &&
    Number.isFinite(value) &&
    value >= GAME_COMMISSION_LIMITS.min &&
    value <= GAME_COMMISSION_LIMITS.max &&
    Math.abs(value * BPS_PER_PERCENT - Math.round(value * BPS_PER_PERCENT)) < 1e-9
  );
}

/** 5 → 500 points de base. Précondition : `isValidCommissionPercent(percent)`. */
export function commissionPercentToBps(percent: number): number {
  return Math.round(percent * BPS_PER_PERCENT);
}

export function commissionBpsToPercent(bps: number): number {
  return bps / BPS_PER_PERCENT;
}

/** Commission entière : floor(brut × bps / 10 000), sans nombre flottant. */
export function commissionOf(gross: number, commissionBps: number): number {
  return Number((BigInt(gross) * BigInt(commissionBps)) / BigInt(BPS_FULL));
}

/**
 * Erreur de forme du barème, ou null s'il est valide : tableau de 1 à 50 tranches, la première
 * commence à 1, chacune commence juste après la précédente (aucun trou, aucun chevauchement),
 * seule la dernière est sans plafond, bornes entières, taux valides. Toute mise > 0 a ainsi
 * exactement une tranche.
 */
export function commissionScheduleError(value: unknown): string | null {
  if (!Array.isArray(value) || value.length === 0)
    return 'Barème attendu : liste de tranches non vide.';
  if (value.length > GAME_COMMISSION_MAX_TIERS) {
    return `Barème limité à ${GAME_COMMISSION_MAX_TIERS} tranches.`;
  }
  let expectedMin = 1;
  for (const [index, tier] of value.entries()) {
    const n = index + 1;
    if (typeof tier !== 'object' || tier === null || Array.isArray(tier)) {
      return `Tranche ${n} : objet { minStake, maxStake, percent } attendu.`;
    }
    const { minStake, maxStake, percent, ...rest } = tier as Record<string, unknown>;
    if (Object.keys(rest).length > 0)
      return `Tranche ${n} : champ inconnu (${Object.keys(rest).join(', ')}).`;
    if (minStake !== expectedMin) {
      return n === 1
        ? 'Tranche 1 : la mise minimale doit être 1.'
        : `Tranche ${n} : la mise minimale doit être ${expectedMin} (juste après la tranche précédente).`;
    }
    const last = index === value.length - 1;
    if (last) {
      if (maxStake !== null)
        return `Tranche ${n} : la dernière tranche est sans plafond (maxStake null).`;
    } else if (!Number.isSafeInteger(maxStake) || (maxStake as number) < minStake) {
      return `Tranche ${n} : mise maximale entière, au moins égale à ${minStake}.`;
    }
    if (!isValidCommissionPercent(percent)) {
      return `Tranche ${n} : taux entre ${GAME_COMMISSION_LIMITS.min} et ${GAME_COMMISSION_LIMITS.max} %, deux décimales au plus.`;
    }
    if (!last) expectedMin = (maxStake as number) + 1;
  }
  return null;
}

export function isValidCommissionSchedule(value: unknown): value is GameCommissionTier[] {
  return commissionScheduleError(value) === null;
}

/** Copie normalisée (taux arrondis aux points de base) : 5 et 5.00 sont la même valeur. */
export function normalizeCommissionSchedule(
  schedule: readonly GameCommissionTier[],
): GameCommissionTier[] {
  return schedule.map(({ minStake, maxStake, percent }) => ({
    minStake,
    maxStake,
    percent: commissionBpsToPercent(commissionPercentToBps(percent)),
  }));
}

/** Taux (points de base) de la tranche qui contient la mise. Précondition : barème valide. */
export function commissionBpsForStake(
  schedule: readonly GameCommissionTier[],
  stake: number,
): number {
  const tier = schedule.find(
    (t) => stake >= t.minStake && (t.maxStake === null || stake <= t.maxStake),
  );
  if (!tier) throw new RangeError(`Aucune tranche de commission pour la mise ${stake}`);
  return commissionPercentToBps(tier.percent);
}

/**
 * Engagement par joueur au démarrage : perte maximale = 2 × M (Kora). Il n'est PAS déduit du
 * solde ni du disponible affichés (D-080) ; il borne seulement les dépenses pendant la partie.
 */
export function reservedPerPlayer(stake: number): number {
  return GAME_STAKE_BALANCE_MULTIPLIER * stake;
}

/**
 * Type de victoire, décidé sur l'état officiel de la partie TERMINÉE :
 * - KORA : le gagnant termine le jeu en remportant le 5e (dernier) tour avec une carte de
 *   valeur 3, c'est-à-dire que la carte qui détient le contrôle à la fin du dernier tour est
 *   un 3 jouée par le gagnant ;
 * - SIMPLE : toute autre victoire, dont la victoire instantanée (toujours SIMPLE, D-035).
 * Renvoie null si la partie n'a pas de gagnant.
 */
export function victoryTypeOf(game: Game): GameVictoryType | null {
  const winnerId = game.result?.winnerId;
  if (game.status !== 'finished' || !winnerId) return null;
  if (game.result?.method !== 'CONTROL_AFTER_LAST_TRICK') return 'SIMPLE';
  const last = game.play?.completedTricks.at(-1);
  if (!last || last.number !== TRICKS_PER_GAME || last.controllerId !== winnerId) {
    return 'SIMPLE';
  }
  const winning = last.plays.find((p) => p.playerId === winnerId);
  return winning && cardFromId(winning.cardId).value === KORA_CARD_VALUE ? 'KORA' : 'SIMPLE';
}

/**
 * Participants réglés d'une partie : joueurs qui l'ont disputée jusqu'au bout. Les fuyards
 * sont EXCLUS (aucun débit, hors de N) : le coût de la fuite n'est pas défini (R-05) et
 * aucun prélèvement n'est inventé. Exception (D-086) : partie à 2 terminée parce que
 * l'adversaire s'est couché (`OPPONENT_FLED`) : le fuyard est le perdant et paie sa mise.
 */
export function settledParticipants(game: Game): PlayerId[] {
  if (game.result?.method === 'OPPONENT_FLED') return game.players.map((p) => p.playerId);
  return game.players.filter((p) => !p.fledAt).map((p) => p.playerId);
}

export interface GameSettlementPlan {
  victoryType: GameVictoryType;
  winnerId: PlayerId;
  participants: PlayerId[];
  /** Perdants : participants sauf le gagnant. */
  loserIds: PlayerId[];
  /** Perte de chaque perdant : M (simple) ou 2M (Kora). Le gagnant ne perd rien. */
  unitAmount: number;
  /** Somme des mises des perdants : M × (N − 1) ou 2M × (N − 1). */
  grossAmount: number;
  /** Taux de la tranche, figé au démarrage. */
  commissionBps: number;
  /** Taux réellement appliqué : celui de la tranche, quel que soit le type de victoire. */
  appliedCommissionBps: number;
  commissionAmount: number;
  /** Crédit du gagnant : brut − commission. */
  netGain: number;
}

/**
 * Plan de règlement d'une victoire. Précondition : mise entière > 0, taux entier de 0 à
 * 10 000 points de base, gagnant parmi au moins 2 participants distincts. Entiers sûrs :
 * M ≤ 10⁹, N ≤ 4 → brut ≤ 6 × 10⁹. Toute donnée invalide lève : l'appelant annule alors
 * toute la transaction (aucun mouvement partiel).
 */
export function planGameSettlement(input: {
  stake: number;
  commissionBps: number;
  winnerId: PlayerId;
  participants: readonly PlayerId[];
  victoryType: GameVictoryType;
}): GameSettlementPlan {
  const { stake, commissionBps, winnerId, victoryType } = input;
  if (!Number.isSafeInteger(stake) || stake <= 0) {
    throw new RangeError(`Mise invalide : ${stake}`);
  }
  if (!Number.isInteger(commissionBps) || commissionBps < 0 || commissionBps > BPS_FULL) {
    throw new RangeError(`Taux de commission invalide : ${commissionBps}`);
  }
  if (victoryType !== 'SIMPLE' && victoryType !== 'KORA') {
    throw new RangeError(`Type de victoire inconnu : ${String(victoryType)}`);
  }
  if (new Set(input.participants).size !== input.participants.length) {
    throw new RangeError('Participant compté deux fois');
  }
  if (!input.participants.includes(winnerId)) {
    throw new RangeError(`Gagnant ${winnerId} absent des participants`);
  }
  const loserIds = input.participants.filter((id) => id !== winnerId);
  if (loserIds.length === 0) throw new RangeError('Aucun perdant : rien à régler');
  const unitAmount = victoryType === 'KORA' ? KORA_LOSS_MULTIPLIER * stake : stake;
  const grossAmount = unitAmount * loserIds.length;
  if (!Number.isSafeInteger(grossAmount)) {
    throw new RangeError(`Montant brut hors limites : ${grossAmount}`);
  }
  const commissionAmount = commissionOf(grossAmount, commissionBps);
  const netGain = grossAmount - commissionAmount;
  // Défense en profondeur : jamais de commission négative ni supérieure au brut.
  if (commissionAmount < 0 || netGain < 0) {
    throw new RangeError(
      `Règlement incohérent : brut ${grossAmount}, commission ${commissionAmount}`,
    );
  }
  return {
    victoryType,
    winnerId,
    participants: [...input.participants],
    loserIds,
    unitAmount,
    grossAmount,
    commissionBps,
    appliedCommissionBps: commissionBps,
    commissionAmount,
    netGain,
  };
}
