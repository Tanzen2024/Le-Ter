import { operatorOfPhone } from '../payments/payment';
import type { UserId } from '../users/user';

/**
 * Retrait Mobile Money (D-075) : jetons du compte de jeu → compte Mobile Money personnel du
 * joueur, c'est-à-dire son numéro d'INSCRIPTION (D-040), jamais un numéro saisi. L'opérateur
 * est DÉDUIT par le serveur de ce numéro (`withdrawalOperatorOfPhone`) : un opérateur envoyé
 * par le client n'est jamais pris en compte.
 *
 * Le transfert passe par l'API de transfert CinetPay v1 (`POST /v1/transfer`), distincte de
 * la collecte. Seul un statut FINAL relu chez CinetPay règle un retrait ; une acceptation de
 * la demande n'est jamais un paiement réussi.
 */

/** Montant minimal d'un retrait, en jetons (décision du propriétaire, D-075). */
export const MIN_WITHDRAWAL_TOKENS = 1_000;
/** Plafond d'un transfert CinetPay v1 (SDK officiel : 100 à 1 500 000). */
export const MAX_WITHDRAWAL_TOKENS = 1_500_000;
/** Conversion du retrait (R-13 tranchée pour le retrait, D-075) : 1 jeton = 1 FCFA. */
export const WITHDRAWAL_CURRENCY = 'XAF' as const;
export const amountForWithdrawal = (tokens: number): number => tokens;

/**
 * Opérateurs CinetPay en XAF (code pays CM). Les autres opérateurs du SDK utilisent d'autres
 * devises (XOF, GNF, CDF…) que le compte de jeu ne gère pas.
 */
export const WITHDRAWAL_OPERATORS = ['OM_CM', 'MTN_CM'] as const;
export type WithdrawalOperator = (typeof WITHDRAWAL_OPERATORS)[number];
export const WITHDRAWAL_OPERATOR_LABELS: Readonly<Record<WithdrawalOperator, string>> = {
  OM_CM: 'Orange Money',
  MTN_CM: 'MTN Mobile Money',
};
/** Indicatif des numéros pris en charge (Cameroun). */
export const WITHDRAWAL_PHONE_PREFIX = '+237';

export const isWithdrawalOperator = (value: unknown): value is WithdrawalOperator =>
  typeof value === 'string' && (WITHDRAWAL_OPERATORS as readonly string[]).includes(value);

/** Numéro d'inscription utilisable pour un transfert CinetPay en XAF : +237 et 9 chiffres. */
export const isSupportedWithdrawalPhone = (phone: string): boolean =>
  /^\+237\d{9}$/.test(phone);

export type WithdrawalOperatorResolution =
  | { ok: true; operator: WithdrawalOperator }
  /** Numéro hors +237, ou opérateur indéterminable d'après le plan de numérotation. */
  | { ok: false; reason: 'PHONE_UNSUPPORTED' }
  /** Opérateur identifié, mais pas parmi les opérateurs de retrait autorisés. */
  | { ok: false; reason: 'OPERATOR_NOT_ALLOWED' };

/**
 * Opérateur d'un retrait, déduit du numéro d'INSCRIPTION par la règle existante du plan de
 * numérotation camerounais (`operatorOfPhone`, D-090), puis vérifié contre les opérateurs de
 * retrait autorisés. Aucune bascule vers un autre opérateur en cas de doute : refus.
 */
export function withdrawalOperatorOfPhone(
  phone: string,
  allowed: readonly WithdrawalOperator[] = WITHDRAWAL_OPERATORS,
): WithdrawalOperatorResolution {
  if (!isSupportedWithdrawalPhone(phone)) return { ok: false, reason: 'PHONE_UNSUPPORTED' };
  const operator = operatorOfPhone(phone);
  if (!operator) return { ok: false, reason: 'PHONE_UNSUPPORTED' };
  if (!isWithdrawalOperator(operator) || !allowed.includes(operator)) {
    return { ok: false, reason: 'OPERATOR_NOT_ALLOWED' };
  }
  return { ok: true, operator };
}

/**
 * - CREATED : débité ; transfert pas encore accepté, ou issue de l'envoi inconnue (jamais
 *   renvoyé à l'aveugle) ;
 * - PROCESSING : accepté par CinetPay, en attente du statut final ;
 * - SUCCEEDED : SUCCESS relu chez CinetPay ;
 * - FAILED : échec définitif confirmé, jetons remboursés une seule fois.
 * Aucune annulation : un transfert envoyé ne peut pas être rappelé.
 */
export type WithdrawalStatus = 'CREATED' | 'PROCESSING' | 'SUCCEEDED' | 'FAILED';
export const WITHDRAWAL_STATUSES: readonly WithdrawalStatus[] = [
  'CREATED',
  'PROCESSING',
  'SUCCEEDED',
  'FAILED',
];
export const isFinalWithdrawalStatus = (status: WithdrawalStatus): boolean =>
  status === 'SUCCEEDED' || status === 'FAILED';

export interface Withdrawal {
  id: string;
  userId: UserId;
  walletTransactionId: string;
  provider: 'cinetpay';
  operator: WithdrawalOperator;
  msisdnMasked: string;
  tokens: number;
  amount: number;
  currency: typeof WITHDRAWAL_CURRENCY;
  status: WithdrawalStatus;
  merchantTransactionId: string;
  providerReference?: string;
  providerStatus?: string;
  feeAmount?: number;
  notifyTokenHash?: string;
  failureCode?: string;
  lastErrorCode?: string;
  lastErrorAt?: Date;
  submissionAttemptedAt?: Date;
  /** Envois revendiqués, toujours avec la même référence marchande. */
  submissionAttempts: number;
  lastCheckedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
  completedAt?: Date;
}

/**
 * Quota de retraits par joueur (paramètres d'administration). `null` = illimité (∞).
 *
 * - `count` nul : aucune limite, quelle que soit la période ;
 * - `count` = n, `periodMinutes` = t : au plus n retraits dans toute fenêtre glissante de t ;
 * - `count` = n, `periodMinutes` nul : au plus n retraits au total (aucune fenêtre).
 *
 * Comptent : les retraits ENREGISTRÉS non échoués (CREATED, PROCESSING, SUCCEEDED), en
 * attente compris, pour qu'aucune demande simultanée ne dépasse le quota. Ne comptent pas :
 * les demandes refusées avant création (montant, solde, quota…) et les retraits FAILED
 * (échec confirmé, jetons remboursés). Aucune annulation n'existe.
 */
export interface WithdrawalLimit {
  count: number | null;
  periodMinutes: number | null;
}

export const UNLIMITED_WITHDRAWALS: WithdrawalLimit = { count: null, periodMinutes: null };
/** Bornes de saisie : 1 à 1 000 retraits ; 1 minute à 365 jours. */
export const WITHDRAWAL_LIMIT_MAX_COUNT = 1_000;
export const WITHDRAWAL_LIMIT_MAX_PERIOD_MINUTES = 365 * 24 * 60;

const isLimitValue = (value: unknown, max: number): value is number | null =>
  value === null ||
  (typeof value === 'number' && Number.isSafeInteger(value) && value >= 1 && value <= max);

export function isValidWithdrawalLimit(value: unknown): value is WithdrawalLimit {
  if (typeof value !== 'object' || value === null) return false;
  const { count, periodMinutes } = value as Record<string, unknown>;
  return (
    isLimitValue(count, WITHDRAWAL_LIMIT_MAX_COUNT) &&
    isLimitValue(periodMinutes, WITHDRAWAL_LIMIT_MAX_PERIOD_MINUTES)
  );
}

/** Début de la fenêtre comptée, ou `null` si tous les retraits comptent (période ∞). */
export function quotaWindowStart(limit: WithdrawalLimit, now: Date): Date | null {
  return limit.periodMinutes === null
    ? null
    : new Date(now.getTime() - limit.periodMinutes * 60_000);
}

/** Statuts CinetPay finaux d'un transfert → issue du retrait. Les autres : en traitement. */
export function finalOutcomeOfTransferStatus(
  providerStatus: string,
): 'SUCCEEDED' | 'FAILED' | undefined {
  if (providerStatus === 'SUCCESS') return 'SUCCEEDED';
  // FAILED : échec final ; INSUFFICIENT_BALANCE : solde MARCHAND insuffisant, final (SDK).
  if (providerStatus === 'FAILED' || providerStatus === 'INSUFFICIENT_BALANCE') return 'FAILED';
  return undefined;
}

// --- Erreurs métier ----------------------------------------------------------------------------

/** Quota de retraits atteint pour la période configurée. */
export class WithdrawalLimitReachedError extends Error {
  constructor(
    readonly limit: WithdrawalLimit,
    readonly used: number,
  ) {
    super('Nombre maximal de retraits atteint');
    this.name = 'WithdrawalLimitReachedError';
  }
}

/** Numéro d'inscription non pris en charge par les opérateurs de retrait (hors +237). */
export class WithdrawalPhoneUnsupportedError extends Error {
  constructor() {
    super('Numéro Mobile Money non pris en charge pour le retrait');
    this.name = 'WithdrawalPhoneUnsupportedError';
  }
}

/** Opérateur du numéro d'inscription identifié, mais non autorisé pour les retraits. */
export class WithdrawalOperatorNotAllowedError extends Error {
  constructor() {
    super('Opérateur Mobile Money non autorisé pour le retrait');
    this.name = 'WithdrawalOperatorNotAllowedError';
  }
}

/** Compte désactivé : aucun retrait. */
export class WithdrawalAccountBlockedError extends Error {
  constructor() {
    super('Compte non autorisé à retirer');
    this.name = 'WithdrawalAccountBlockedError';
  }
}

/** Retrait inconnu ou d'un autre joueur (même réponse : aucune fuite d'existence). */
export class WithdrawalNotFoundError extends Error {
  constructor() {
    super('Retrait introuvable');
    this.name = 'WithdrawalNotFoundError';
  }
}

/** Notification de transfert refusée (jeton ou référence invalide). */
export class WithdrawalNotificationRejectedError extends Error {
  constructor(readonly reason: string) {
    super('Notification de transfert refusée');
    this.name = 'WithdrawalNotificationRejectedError';
  }
}

/** Statut relu incohérent avec le retrait enregistré (références, montant, devise). */
export class WithdrawalVerificationError extends Error {
  constructor(readonly reason: string) {
    super('Retrait non vérifiable');
    this.name = 'WithdrawalVerificationError';
  }
}

// --- Rapprochement administratif (D-076) -------------------------------------------------------

/**
 * Délai minimal depuis la création ou le dernier envoi avant qu'un remboursement manuel
 * puisse être PROPOSÉ : laisse au fournisseur le temps de finaliser et de notifier.
 */
export const MANUAL_REFUND_MIN_AGE_MS = 24 * 60 * 60_000;
/** Code d'échec d'un retrait remboursé par rapprochement à double validation. */
export const MANUAL_REFUND_FAILURE_CODE = 'MANUAL_REFUND_CONFIRMED';
/** Anomalie : CinetPay annonce un transfert réussi pour un retrait déjà remboursé. */
export const PAID_AFTER_REFUND = 'PAID_AFTER_REFUND';

export type RefundRequestStatus = 'PENDING' | 'APPROVED' | 'REJECTED';

export interface WithdrawalRefundRequest {
  id: string;
  withdrawalId: string;
  status: RefundRequestStatus;
  providerTicket: string;
  justification: string;
  proposedBy: UserId;
  proposedAt: Date;
  providerStatusAtProposal: string;
  decidedBy?: UserId;
  decidedAt?: Date;
  decisionNote?: string;
  providerStatusAtDecision?: string;
}

export type RefundRefusalReason =
  | 'NOT_OPEN'
  | 'TOO_RECENT'
  | 'TRANSFER_EXISTS'
  | 'TRANSFER_SUCCEEDED'
  | 'PENDING_REQUEST_EXISTS'
  | 'SAME_ADMIN'
  | 'REQUEST_NOT_PENDING';

/** Remboursement manuel refusé : la preuve exigée n'est pas réunie (rien n'est écrit). */
export class WithdrawalRefundRefusedError extends Error {
  constructor(readonly reason: RefundRefusalReason) {
    super(`Remboursement manuel refusé : ${reason}`);
    this.name = 'WithdrawalRefundRefusedError';
  }
}

/** Relecture du transfert impossible (non configurée ou fournisseur injoignable). */
export class WithdrawalProviderUnavailableError extends Error {
  constructor() {
    super('Relecture du transfert chez le fournisseur impossible');
    this.name = 'WithdrawalProviderUnavailableError';
  }
}
