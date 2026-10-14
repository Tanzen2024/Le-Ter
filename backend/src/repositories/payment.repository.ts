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
> &
  /** Opérateur d'un paiement DIRECT (MTN_CM…) ; absent : page CinetPay. */
  Partial<Pick<Payment, 'paymentMethod'>> & {
    /**
     * Paiement direct : « initialisation incertaine » dès la création (D-091), effacée de fait
     * par la référence du fournisseur. Une panne entre l'appel et l'enregistrement laisse ainsi
     * un paiement que la réconciliation recherche chez CinetPay.
     */
    initializationUncertain?: boolean;
  };

/** Données posées quand le fournisseur accepte l'initialisation du paiement. */
export interface PaymentInitialization {
  providerReference: string;
  /** Absente pour un paiement direct lancé sur le téléphone (aucune page à ouvrir). */
  paymentUrl?: string;
  notifyTokenHash: string;
  providerStatus?: string;
  /**
   * Trace de la réponse de création (`details.status`, `details.must_be_redirected`),
   * conservée dans `metadata` : `providerStatus` est ensuite remplacé par les relectures.
   */
  initialStatus?: string;
  mustBeRedirected?: boolean;
}

/** Chemin qui a relu le statut et réglé le paiement (trace, `metadata.settledBy`). */
export type PaymentSettlementSource = 'notification' | 'player_read' | 'reconciliation' | 'admin';

/** Issue finale vérifiée auprès du fournisseur. */
export interface PaymentSettlement {
  status: Exclude<PaymentStatus, 'PENDING'>;
  providerStatus: string;
  paymentMethod?: string;
  settledBy?: PaymentSettlementSource;
}

/** Critères de sélection des paiements à revérifier (réconciliation automatique). */
export interface PendingReconciliationQuery {
  /** Nombre maximal de paiements renvoyés. */
  limit: number;
  /** Créés au plus tard à cette date (laisse au joueur le temps de payer). */
  createdBefore: Date;
  /** Créés après cette date (au-delà, rapprochement manuel par l'administration). */
  createdAfter: Date;
  /** Dernière écriture (initialisation ou statut fournisseur noté) au plus tard à cette date. */
  lastCheckedBefore: Date;
  /** Paiements exclus (nouvelle tentative différée après une erreur). */
  excludeIds: readonly string[];
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

  /**
   * Création de paiement direct envoyée sans réponse exploitable : le paiement RESTE PENDING
   * (aucun crédit, aucun échec déclaré), marqué pour être recherché chez le fournisseur par
   * `merchantTransactionId` (réconciliation).
   */
  markInitializationUncertain(paymentId: string, reason: string, now: Date): Promise<void>;

  /**
   * Référence retrouvée chez le fournisseur pour un paiement à l'initialisation incertaine
   * (sans `notify_token`, jamais renvoyé par la lecture du statut) ; seulement si le paiement
   * est encore PENDING et sans référence. Vrai si la référence a été posée.
   */
  recordRecoveredReference(paymentId: string, providerReference: string, now: Date): Promise<boolean>;

  findById(paymentId: string): Promise<Payment | null>;

  /** Paiement de CE joueur seulement (null sinon : même réponse qu'un paiement inconnu). */
  findByIdForUser(paymentId: string, userId: string): Promise<Payment | null>;

  findByWalletTransactionId(walletTransactionId: string): Promise<Payment | null>;

  findByMerchantTransactionId(
    provider: Payment['provider'],
    merchantTransactionId: string,
  ): Promise<Payment | null>;

  /**
   * Paiements PENDING dont la référence fournisseur est connue, ou dont l'initialisation est
   * incertaine (recherche par `merchantTransactionId`), à revérifier auprès du fournisseur :
   * les moins récemment vérifiés d'abord. Un autre paiement sans référence n'est jamais
   * renvoyé (initialisation refusée : aucune vérification possible).
   */
  findPendingForReconciliation(query: PendingReconciliationQuery): Promise<Payment[]>;

  /**
   * Synthèse des paiements PENDING (surveillance, D-100) : nombre, initialisations incertaines,
   * paiements créés avant `stuckBefore` (bloqués) et date du plus ancien. Lecture seule.
   */
  summarizePending(stuckBefore: Date): Promise<{
    pending: number;
    uncertain: number;
    stuck: number;
    oldestPendingAt?: Date;
  }>;

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
