import type { UserId } from '../domain/users/user';
import type {
  Withdrawal,
  WithdrawalLimit,
  WithdrawalRefundRequest,
  WithdrawalStatus,
} from '../domain/wallet/withdrawal';

/** Retrait à créer (statut CREATED) avec la clé d'idempotence de la demande du joueur. */
export interface CreateWithdrawalCommand {
  withdrawal: Withdrawal;
  idempotencyKey: string;
}

/** Acceptation par le fournisseur : référence connue, statut non final. */
export interface WithdrawalAcceptance {
  providerReference: string;
  providerStatus: string;
  notifyTokenHash?: string;
  feeAmount?: number;
}

/** Issue FINALE confirmée par le fournisseur (statut relu). */
export type WithdrawalSettlement =
  | {
      status: 'SUCCEEDED';
      providerReference: string;
      providerStatus: string;
      feeAmount?: number;
    }
  | {
      status: 'FAILED';
      failureCode: string;
      providerReference?: string;
      providerStatus?: string;
    };

export interface WithdrawalQuotaUsage {
  limit: WithdrawalLimit;
  /** Retraits comptés dans la fenêtre courante (ou au total si la période est illimitée). */
  used: number;
  /** Plus ancien retrait compté de la fenêtre : la place se libère à `oldest + période`. */
  oldestCountedAt: Date | null;
}

/** Proposition de remboursement manuel (D-076), après relecture du transfert. */
export interface CreateRefundRequestCommand {
  id: string;
  withdrawalId: string;
  providerTicket: string;
  justification: string;
  /** Statut relu chez le fournisseur à la proposition (`NOT_FOUND`, `FAILED`). */
  providerStatus: string;
  actorId: UserId;
  auditId: string;
  now: Date;
}

/** Décision sur une proposition : approbation (remboursement unique) ou rejet. */
export interface DecideRefundRequestCommand {
  requestId: string;
  withdrawalId: string;
  approve: boolean;
  /** Statut relu chez le fournisseur à la décision (obligatoire pour une approbation). */
  providerStatus?: string;
  note?: string;
  actorId: UserId;
  auditId: string;
  now: Date;
}

export interface AdminWithdrawalQuery {
  page: number;
  limit: number;
  status?: WithdrawalStatus;
  userId?: string;
  from?: Date;
  to?: Date;
  /** Référence : identifiant du retrait, référence marchande ou référence CinetPay. */
  q?: string;
}

export interface AdminWithdrawalRow extends Withdrawal {
  username: string | null;
  walletTransactionStatus: 'pending' | 'succeeded' | 'failed';
}

/**
 * Persistance des retraits (D-075). Toute écriture qui touche au solde passe par le
 * règlement idempotent du compte de jeu (`settleWalletTransaction`) dans la MÊME transaction
 * SQL : un retrait n'est jamais débité ni remboursé deux fois.
 */
export interface WithdrawalRepository {
  /**
   * Dans UNE transaction : verrou du portefeuille → quota (compté sous ce verrou) → solde
   * disponible → transaction `withdrawal` en attente + débit → ligne `withdrawals`.
   * Lève WithdrawalLimitReachedError, InsufficientBalanceError ou DuplicateIdempotencyKeyError
   * (rien n'est écrit).
   */
  create(command: CreateWithdrawalCommand): Promise<void>;

  findById(id: string): Promise<Withdrawal | null>;
  findByIdForUser(id: string, userId: UserId): Promise<Withdrawal | null>;
  findByIdempotencyKey(userId: UserId, idempotencyKey: string): Promise<Withdrawal | null>;
  findByMerchantTransactionId(merchantTransactionId: string): Promise<Withdrawal | null>;
  listForUser(userId: UserId, limit: number): Promise<Withdrawal[]>;

  quotaUsage(userId: UserId, now: Date): Promise<WithdrawalQuotaUsage>;

  /**
   * Revendique un envoi : seulement si le retrait est CREATED et que le nombre d'envois vaut
   * `expectedAttempts` (UPDATE conditionnel). Renvoie le retrait revendiqué, ou `null` si un
   * autre processus l'a déjà revendiqué ou si le retrait n'est plus CREATED.
   */
  claimSubmission(id: string, expectedAttempts: number, now: Date): Promise<Withdrawal | null>;

  /** CREATED → PROCESSING (ou mise à jour d'un PROCESSING) ; sans effet sur un retrait final. */
  recordAcceptance(id: string, acceptance: WithdrawalAcceptance, now: Date): Promise<Withdrawal>;

  /** Vérification sans issue finale : statut fournisseur et/ou erreur technique notés. */
  recordCheck(
    id: string,
    check: { providerStatus?: string; errorCode?: string },
    now: Date,
  ): Promise<void>;

  /**
   * Règlement FINAL, une seule fois : SUCCEEDED (transaction du compte de jeu réussie) ou
   * FAILED (remboursement unique). Un retrait déjà final est renvoyé tel quel.
   */
  settle(
    id: string,
    settlement: WithdrawalSettlement,
    now: Date,
  ): Promise<{ withdrawal: Withdrawal; changed: boolean }>;

  /** Retraits non finaux à revérifier (réconciliation), les moins récemment vérifiés d'abord. */
  findOpenForReconciliation(options: {
    limit: number;
    createdBefore: Date;
    lastCheckedBefore: Date;
    excludeIds: readonly string[];
  }): Promise<Withdrawal[]>;

  getLimit(): Promise<WithdrawalLimit & { updatedAt: Date | null }>;
  /** Réglage du quota et son audit dans UNE transaction ; identique : `changed: false`. */
  setLimit(command: {
    limit: WithdrawalLimit;
    actorId: UserId;
    auditId: string;
    now: Date;
  }): Promise<{ limit: WithdrawalLimit; updatedAt: Date | null; changed: boolean }>;

  /** Annule une revendication d'envoi quand AUCUNE requête de transfert n'est partie. */
  releaseSubmission(id: string, claimedAttempts: number, now: Date): Promise<void>;

  /** Anomalie notée sur un retrait, même final (ex. payé après remboursement). */
  recordAnomaly(id: string, code: string, now: Date): Promise<void>;

  listRefundRequests(withdrawalId: string): Promise<WithdrawalRefundRequest[]>;
  /**
   * Proposition (retrait ouvert, une seule en attente) et son audit, dans UNE transaction.
   * Lève WithdrawalRefundRefusedError (`NOT_OPEN`, `PENDING_REQUEST_EXISTS`).
   */
  createRefundRequest(command: CreateRefundRequestCommand): Promise<WithdrawalRefundRequest>;
  /**
   * Décision, dans UNE transaction : approbation par un AUTRE administrateur → règlement FAILED
   * et remboursement unique ; rejet → rien ne bouge. Audit compris.
   */
  decideRefundRequest(
    command: DecideRefundRequestCommand,
  ): Promise<{ request: WithdrawalRefundRequest; withdrawal: Withdrawal }>;

  listForAdmin(query: AdminWithdrawalQuery): Promise<{ total: number; items: AdminWithdrawalRow[] }>;
  findForAdmin(id: string): Promise<AdminWithdrawalRow | null>;
}
