import type { PlayerId } from '../game/game-id';
import { MAX_TOKENS_PER_OPERATION } from '../wallet/wallet';
import { UnresolvedRuleError } from './unresolved-rule';

/**
 * Domaine minimal des mises : il traduit un résultat de partie en transferts
 * théoriques entre joueurs. Aucun mouvement d'argent n'est exécuté ici (pas de
 * portefeuille, pas de Mobile Money). Aucune commission de la plateforme n'est prélevée sur
 * les parties ordinaires : cette règle n'est pas définie (R-37, D-060).
 */
export type PayoutKind = 'SIMPLE' | 'KORA' | 'DOUBLE_KORA';

export interface StakeTransfer {
  from: PlayerId;
  to: PlayerId;
  amount: number;
}

/**
 * Détection de la Kora et de la Double Kora. Leur déclencheur n'est pas défini
 * (R-02) : aucune implémentation n'est fournie.
 */
export interface KoraDetector {
  payoutKind(context: { winnerId: PlayerId }): PayoutKind;
}

/** Une mise est un montant entier positif ou nul ; son unité (FCFA ou jetons) reste à définir (R-13). */
export function assertValidStake(amount: number): void {
  if (!Number.isInteger(amount) || amount < 0) {
    throw new RangeError(`Mise invalide : ${amount}`);
  }
}

/**
 * Mise d'une partie ORDINAIRE (D-073) : entier strictement positif, en jetons du compte de
 * jeu. Plafond technique = plafond d'une opération du compte de jeu, pour que le double de la
 * mise reste un entier sûr (aucune perte de précision, aucun dépassement).
 */
export const MAX_GAME_STAKE = MAX_TOKENS_PER_OPERATION;

/** Solde disponible exigé pour jouer : au moins deux fois la mise (D-073). */
export const GAME_STAKE_BALANCE_MULTIPLIER = 2;

/** Mise valide d'une partie ordinaire : nombre entier, > 0, ≤ MAX_GAME_STAKE. */
export function isValidGameStake(value: unknown): value is number {
  return (
    typeof value === 'number' &&
    Number.isSafeInteger(value) &&
    value > 0 &&
    value <= MAX_GAME_STAKE
  );
}

/** Solde disponible minimal pour jouer avec cette mise (valide) : 2 × mise. */
export function requiredBalanceForStake(stake: number): number {
  return GAME_STAKE_BALANCE_MULTIPLIER * stake;
}

/** `soldeDisponible >= 2 × mise`, en entiers sûrs. */
export function hasBalanceForStake(available: number, stake: number): boolean {
  return Number.isSafeInteger(available) && available >= requiredBalanceForStake(stake);
}

/** Mise absente, nulle, négative ou malformée pour une partie ordinaire (D-073). */
export class InvalidGameStakeError extends Error {
  constructor(readonly stake: unknown) {
    super(`Mise de partie invalide : ${String(stake)}`);
    this.name = 'InvalidGameStakeError';
  }
}

/** Solde disponible inférieur à 2 × la mise (D-073). Le solde n'est pas exposé. */
export class InsufficientBalanceForStakeError extends Error {
  readonly required: number;

  constructor(readonly stake: number) {
    super(`Solde disponible inférieur à ${requiredBalanceForStake(stake)} pour une mise de ${stake}`);
    this.name = 'InsufficientBalanceForStakeError';
    this.required = requiredBalanceForStake(stake);
  }
}

/**
 * Au démarrage, le disponible d'un joueur ne couvre plus le séquestre de 2 × mise (D-074) :
 * il l'a utilisé entre son arrivée et le démarrage (retrait, inscription à un tournoi). Le
 * démarrage est refusé et rien n'est réservé. Le solde n'est pas exposé.
 */
export class StakeNotCoveredAtStartError extends Error {
  readonly required: number;

  constructor(
    readonly playerId: PlayerId,
    readonly stake: number,
  ) {
    super(`Séquestre de ${GAME_STAKE_BALANCE_MULTIPLIER * stake} non couvert pour ${playerId}`);
    this.name = 'StakeNotCoveredAtStartError';
    this.required = GAME_STAKE_BALANCE_MULTIPLIER * stake;
  }
}

/**
 * Spec §5.1 « Gagné simple » : chaque perdant verse la mise au gagnant.
 * Qui compte comme perdant (fuyard compris ou non) est décidé par l'appelant (R-05).
 * Kora et Double Kora : montants connus pour une mise de 100 FCFA seulement (200 et
 * 300), sans savoir s'il s'agit de multiples ou de montants fixes (R-02).
 */
export function stakeTransfers(
  kind: PayoutKind,
  stakeAmount: number,
  winnerId: PlayerId,
  loserIds: readonly PlayerId[],
): StakeTransfer[] {
  assertValidStake(stakeAmount);
  if (kind !== 'SIMPLE') {
    throw new UnresolvedRuleError('R-02', `montant à verser en cas de ${kind} non défini`);
  }
  return loserIds
    .filter((id) => id !== winnerId)
    .map((from) => ({ from, to: winnerId, amount: stakeAmount }));
}
