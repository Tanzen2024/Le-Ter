import type { UserId } from '../users/user';

/**
 * Compte de jeu (D-040) : jetons utilisables dans Le Ter. À ne pas confondre avec le compte
 * Mobile Money personnel du joueur (numéro d'inscription), vers ou depuis lequel le
 * fournisseur transfère l'argent.
 *
 * Le serveur est la seule source de vérité financière : le solde ne change que par une
 * transaction enregistrée, jamais par le client, et ne devient jamais négatif.
 */
/**
 * `tournament_entry` : capture d'une réservation d'inscription (débit définitif) ;
 * `tournament_prize` : gain de tournoi (D-054).
 */
export type WalletTransactionKind =
  'deposit' | 'withdrawal' | 'tournament_entry' | 'tournament_prize';
export type WalletTransactionStatus = 'pending' | 'succeeded' | 'failed';

export interface WalletTransaction {
  id: string;
  userId: UserId;
  kind: WalletTransactionKind;
  status: WalletTransactionStatus;
  tokens: number;
  idempotencyKey: string;
  failureCode?: string;
  providerReference?: string;
  createdAt: Date;
  updatedAt: Date;
  completedAt?: Date;
}

/**
 * Plafond technique d'une opération (entier sûr en JavaScript et en `bigint`). Les montants
 * minimum et maximum MÉTIER (R-16) ne sont pas définis : seul « > 0 » est appliqué.
 */
export const MAX_TOKENS_PER_OPERATION = 1_000_000_000;

export function isValidTokenAmount(value: unknown): value is number {
  return (
    typeof value === 'number' &&
    Number.isSafeInteger(value) &&
    value > 0 &&
    value <= MAX_TOKENS_PER_OPERATION
  );
}

/**
 * Numéro Mobile Money affichable : indicatif et 3 derniers chiffres seulement
 * (« +23*******271 »). Le numéro complet ne quitte jamais le serveur.
 */
export function maskPhone(phone: string): string {
  if (phone.length <= 6) return '*'.repeat(phone.length);
  return `${phone.slice(0, 3)}${'*'.repeat(phone.length - 6)}${phone.slice(-3)}`;
}

/** Retrait supérieur au solde du compte de jeu. */
export class InsufficientBalanceError extends Error {
  constructor(
    readonly balance: number,
    readonly requested: number,
  ) {
    super(`Solde insuffisant : ${balance} < ${requested}`);
    this.name = 'InsufficientBalanceError';
  }
}

/** Même Idempotency-Key réutilisée pour une autre opération. */
export class IdempotencyKeyReusedError extends Error {
  constructor() {
    super('Idempotency-Key déjà utilisée pour une autre opération');
    this.name = 'IdempotencyKeyReusedError';
  }
}

/** Le fournisseur Mobile Money n'est pas configuré ou est injoignable. */
export class MobileMoneyUnavailableError extends Error {
  constructor(readonly transactionId?: string) {
    super('Fournisseur Mobile Money indisponible');
    this.name = 'MobileMoneyUnavailableError';
  }
}

/** Transaction inconnue (règlement par le fournisseur). */
export class WalletTransactionNotFoundError extends Error {
  constructor(readonly transactionId: string) {
    super(`Transaction ${transactionId} introuvable`);
    this.name = 'WalletTransactionNotFoundError';
  }
}
