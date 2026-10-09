import type { UserId } from '../domain/users/user';
import type { WalletTransaction } from '../domain/wallet/wallet';

/** Issue d'une transaction en attente, décidée par le fournisseur Mobile Money. */
export type SettlementOutcome =
  | { status: 'succeeded'; providerReference?: string }
  | { status: 'failed'; failureCode: string; providerReference?: string };

/** Une transaction existe déjà pour ce couple (joueur, Idempotency-Key). */
export class DuplicateIdempotencyKeyError extends Error {
  constructor() {
    super('Idempotency-Key déjà enregistrée');
    this.name = 'DuplicateIdempotencyKeyError';
  }
}

/**
 * Persistance du compte de jeu (D-040). Chaque écriture est UNE transaction SQL qui verrouille
 * la ligne du portefeuille (`FOR UPDATE`) : deux opérations d'un même joueur s'exécutent l'une
 * après l'autre sur toutes les instances, et le solde ne peut pas devenir négatif.
 */
export interface WalletRepository {
  /** Solde en jetons (0 si le joueur n'a encore aucun portefeuille). */
  getBalance(userId: UserId): Promise<number>;

  /** Solde, montant réservé (inscriptions aux tournois, D-054) et disponible = solde − réservé. */
  getBalances(userId: UserId): Promise<{ balance: number; reserved: number; available: number }>;

  findById(transactionId: string): Promise<WalletTransaction | null>;

  findByIdempotencyKey(userId: UserId, idempotencyKey: string): Promise<WalletTransaction | null>;

  /** Achat en attente du paiement : aucun crédit avant la confirmation du fournisseur. */
  createPendingDeposit(transaction: WalletTransaction): Promise<void>;

  /**
   * Retrait en attente : vérifie le solde et DÉBITE sous verrou, dans la même transaction.
   * Lève InsufficientBalanceError (rien n'est écrit) ou DuplicateIdempotencyKeyError.
   */
  createPendingWithdrawal(transaction: WalletTransaction): Promise<void>;

  /**
   * Règle une transaction EN ATTENTE, une seule fois : achat réussi → crédit ; retrait échoué
   * → remboursement. Une transaction déjà réglée est renvoyée telle quelle (idempotent).
   */
  settle(transactionId: string, outcome: SettlementOutcome, now: Date): Promise<WalletTransaction>;
}
