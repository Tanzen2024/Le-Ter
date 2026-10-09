import type { Payment, PaymentStatus } from '../domain/payments/payment';
import type { WalletTransaction } from '../domain/wallet/wallet';

/** Nouveau paiement : son propriétaire est celui de sa transaction du compte de jeu. */
export type NewPayment = Pick<
  Payment,
  | 'id'
  | 'walletTransactionId'
  | 'provider'
  | 'merchantTransactionId'
  | 'amount'
  | 'currency'
  | 'createdAt'
>;

/** Données posées quand le fournisseur accepte l'initialisation du paiement. */
export interface PaymentInitialization {
  providerReference: string;
  paymentUrl: string;
  notifyTokenHash: string;
  providerStatus?: string;
}

/** Issue finale vérifiée auprès du fournisseur. */
export interface PaymentSettlement {
  status: Exclude<PaymentStatus, 'PENDING'>;
  providerStatus: string;
  paymentMethod?: string;
}

export interface PaymentSettlementResult {
  payment: Payment;
  transaction: WalletTransaction;
  /** Faux si le paiement était déjà réglé : rien n'a changé (notification rejouée). */
  changed: boolean;
}

/**
 * Persistance des paiements (D-050). Un paiement est le détail fournisseur d'une transaction
 * `deposit` du compte de jeu ; son règlement passe par le règlement idempotent du compte de
 * jeu (`settle`), dans la même transaction SQL.
 */
export interface PaymentRepository {
  /** Paiement PENDING, sans référence fournisseur (avant l'appel au fournisseur). */
  create(payment: NewPayment): Promise<void>;

  /** Références renvoyées par le fournisseur ; seulement pour un paiement encore PENDING. */
  recordInitialization(paymentId: string, data: PaymentInitialization, now: Date): Promise<void>;

  /** Initialisation refusée par le fournisseur : FAILED, aucun crédit. */
  markInitializationFailed(paymentId: string, reason: string, now: Date): Promise<void>;

  findById(paymentId: string): Promise<Payment | null>;

  /** Paiement de CE joueur seulement (null sinon : même réponse qu'un paiement inconnu). */
  findByIdForUser(paymentId: string, userId: string): Promise<Payment | null>;

  findByWalletTransactionId(walletTransactionId: string): Promise<Payment | null>;

  findByMerchantTransactionId(
    provider: Payment['provider'],
    merchantTransactionId: string,
  ): Promise<Payment | null>;

  /** Dernier statut brut du fournisseur pour un paiement encore PENDING. */
  recordProviderStatus(paymentId: string, providerStatus: string, now: Date): Promise<void>;

  /**
   * Règle un paiement PENDING et sa transaction du compte de jeu dans UNE transaction SQL
   * (verrou sur le paiement, puis règlement idempotent du compte de jeu). SUCCESS → crédit
   * une seule fois ; FAILED / EXPIRED → aucun crédit. Un paiement déjà réglé est renvoyé
   * tel quel (`changed: false`). Toute erreur annule l'ensemble (ROLLBACK).
   */
  settle(
    paymentId: string,
    settlement: PaymentSettlement,
    now: Date,
  ): Promise<PaymentSettlementResult>;
}
