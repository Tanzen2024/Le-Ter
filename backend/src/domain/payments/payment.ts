/**
 * Paiement d'un achat de jetons (D-050) : le détail fournisseur d'une transaction `deposit`
 * du compte de jeu (D-040). Le compte de jeu reste la seule source de vérité : un paiement
 * ne crédite jamais lui-même, il est réglé avec sa transaction par `settle` (une seule fois).
 */
export type PaymentProvider = 'cinetpay';
export type PaymentStatus = 'PENDING' | 'SUCCESS' | 'FAILED' | 'EXPIRED';
export type PaymentCurrency = 'XAF';

/** Devise unique des achats (Cameroun, FCFA BEAC). */
export const PAYMENT_CURRENCY: PaymentCurrency = 'XAF';

/** Conversion validée (D-050, R-13 pour l'achat) : 1 FCFA = 1 jeton. */
export const TOKENS_PER_XAF = 1;

/** Montants d'achat proposés et acceptés (D-050, R-16 pour l'achat), en FCFA. */
export const DEPOSIT_AMOUNTS_XAF = [500, 1000, 2000, 5000] as const;

export function isAllowedDepositAmount(amount: number): boolean {
  return (DEPOSIT_AMOUNTS_XAF as readonly number[]).includes(amount);
}

/** Jetons crédités pour un montant payé. */
export function tokensForAmount(amountXaf: number): number {
  return amountXaf * TOKENS_PER_XAF;
}

/** Montant à payer pour des jetons (1:1, donc toujours entier). */
export function amountForTokens(tokens: number): number {
  return tokens / TOKENS_PER_XAF;
}

export interface Payment {
  id: string;
  walletTransactionId: string;
  /** Propriétaire (celui de la transaction du compte de jeu). */
  userId: string;
  provider: PaymentProvider;
  /** Notre identifiant chez le fournisseur (30 caractères max). */
  merchantTransactionId: string;
  /** Identifiant du fournisseur, connu après l'initialisation acceptée. */
  providerReference?: string;
  amount: number;
  currency: PaymentCurrency;
  status: PaymentStatus;
  providerStatus?: string;
  paymentMethod?: string;
  paymentUrl?: string;
  /** SHA-256 (hex) du `notify_token` : le jeton lui-même n'est jamais stocké. */
  notifyTokenHash?: string;
  createdAt: Date;
  updatedAt: Date;
  completedAt?: Date;
}

/** Paiement inconnu, ou appartenant à un autre joueur (même réponse : pas de fuite). */
export class PaymentNotFoundError extends Error {
  constructor() {
    super('Paiement introuvable');
    this.name = 'PaymentNotFoundError';
  }
}

/** Notification refusée : jeton ou référence ne correspondent pas au paiement. */
export class PaymentNotificationRejectedError extends Error {
  constructor(readonly reason: string) {
    super(`Notification refusée : ${reason}`);
    this.name = 'PaymentNotificationRejectedError';
  }
}

/**
 * Le statut relu auprès du fournisseur ne correspond pas au paiement enregistré (référence,
 * montant ou devise) : rien n'est crédité.
 */
export class PaymentVerificationError extends Error {
  constructor(readonly reason: string) {
    super(`Vérification du paiement impossible : ${reason}`);
    this.name = 'PaymentVerificationError';
  }
}

/**
 * Le profil ne remplit pas les exigences du fournisseur (CinetPay : prénom et nom de 2 à
 * 255 caractères, alors qu'un compte Le Ter accepte 1 caractère). Détecté AVANT toute
 * écriture : aucune transaction ni aucun paiement n'est créé. Rien n'est inventé ni complété.
 */
export class PaymentProfileIncompleteError extends Error {
  constructor(readonly fields: readonly ('firstName' | 'lastName')[]) {
    super(`Profil incompatible avec le paiement : ${fields.join(', ')}`);
    this.name = 'PaymentProfileIncompleteError';
  }
}
