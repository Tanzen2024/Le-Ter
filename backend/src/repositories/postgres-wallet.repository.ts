import {
  isPgError,
  PG_UNIQUE_VIOLATION,
  type SqlClient,
  type SqlExecutor,
} from '../database/sql-client';
import type { UserId } from '../domain/users/user';
import {
  InsufficientBalanceError,
  WalletTransactionNotFoundError,
  type WalletTransaction,
} from '../domain/wallet/wallet';
import {
  DuplicateIdempotencyKeyError,
  type SettlementOutcome,
  type WalletRepository,
} from './wallet.repository';
import { lockWalletBalances, readWalletBalances } from './wallet-reservations';

interface TransactionRow {
  id: string;
  user_id: string;
  kind: WalletTransaction['kind'];
  status: WalletTransaction['status'];
  tokens: string | number;
  idempotency_key: string;
  failure_code: string | null;
  provider_reference: string | null;
  created_at: Date;
  updated_at: Date;
  completed_at: Date | null;
}

const IDEMPOTENCY_CONSTRAINT = 'wallet_transactions_idempotency';

function toTransaction(row: TransactionRow): WalletTransaction {
  return {
    id: row.id,
    userId: row.user_id as UserId,
    kind: row.kind,
    status: row.status,
    tokens: Number(row.tokens),
    idempotencyKey: row.idempotency_key,
    ...(row.failure_code !== null && { failureCode: row.failure_code }),
    ...(row.provider_reference !== null && { providerReference: row.provider_reference }),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    ...(row.completed_at && { completedAt: row.completed_at }),
  };
}

/** Portefeuille créé à la première opération, puis verrouillé ; renvoie son solde. */
async function lockWallet(tx: SqlExecutor, userId: UserId, now: Date): Promise<number> {
  await tx.query(
    `INSERT INTO wallets (user_id, balance, created_at, updated_at) VALUES ($1, 0, $2, $2)
     ON CONFLICT (user_id) DO NOTHING`,
    [userId, now.toISOString()],
  );
  const { rows } = await tx.query<{ balance: string | number }>(
    'SELECT balance FROM wallets WHERE user_id = $1 FOR UPDATE',
    [userId],
  );
  return Number(rows[0]?.balance ?? 0);
}

async function adjustBalance(tx: SqlExecutor, userId: UserId, delta: number, now: Date) {
  await tx.query('UPDATE wallets SET balance = balance + $2, updated_at = $3 WHERE user_id = $1', [
    userId,
    delta,
    now.toISOString(),
  ]);
}

async function insertTransaction(tx: SqlExecutor, t: WalletTransaction): Promise<void> {
  await tx.query(
    `INSERT INTO wallet_transactions (id, user_id, kind, status, tokens, idempotency_key,
       created_at, updated_at)
     VALUES ($1, $2, $3, 'pending', $4, $5, $6, $6)`,
    [t.id, t.userId, t.kind, t.tokens, t.idempotencyKey, t.createdAt.toISOString()],
  );
}

function translate(err: unknown): unknown {
  if (
    isPgError(err, PG_UNIQUE_VIOLATION) &&
    (err as { constraint?: string }).constraint === IDEMPOTENCY_CONSTRAINT
  ) {
    return new DuplicateIdempotencyKeyError();
  }
  return err;
}

export class PostgresWalletRepository implements WalletRepository {
  constructor(private readonly db: SqlClient) {}

  async getBalance(userId: UserId): Promise<number> {
    const { rows } = await this.db.query<{ balance: string | number }>(
      'SELECT balance FROM wallets WHERE user_id = $1',
      [userId],
    );
    return Number(rows[0]?.balance ?? 0);
  }

  getBalances(userId: UserId) {
    return readWalletBalances(this.db, userId);
  }

  async findById(transactionId: string): Promise<WalletTransaction | null> {
    const { rows } = await this.db.query<TransactionRow>(
      'SELECT * FROM wallet_transactions WHERE id = $1',
      [transactionId],
    );
    return rows[0] ? toTransaction(rows[0]) : null;
  }

  async findByIdempotencyKey(
    userId: UserId,
    idempotencyKey: string,
  ): Promise<WalletTransaction | null> {
    const { rows } = await this.db.query<TransactionRow>(
      'SELECT * FROM wallet_transactions WHERE user_id = $1 AND idempotency_key = $2',
      [userId, idempotencyKey],
    );
    return rows[0] ? toTransaction(rows[0]) : null;
  }

  async createPendingDeposit(transaction: WalletTransaction): Promise<void> {
    try {
      await this.db.transaction(async (tx) => {
        await lockWallet(tx, transaction.userId, transaction.createdAt);
        await insertTransaction(tx, transaction);
      });
    } catch (err) {
      throw translate(err);
    }
  }

  async createPendingWithdrawal(transaction: WalletTransaction): Promise<void> {
    try {
      await this.db.transaction(async (tx) => {
        // Seul le DISPONIBLE (solde − réservé, D-054) peut être retiré.
        const { available } = await lockWalletBalances(
          tx,
          transaction.userId,
          transaction.createdAt,
        );
        if (available < transaction.tokens) {
          throw new InsufficientBalanceError(available, transaction.tokens);
        }
        await insertTransaction(tx, transaction);
        await adjustBalance(tx, transaction.userId, -transaction.tokens, transaction.createdAt);
      });
    } catch (err) {
      throw translate(err);
    }
  }

  settle(transactionId: string, outcome: SettlementOutcome, now: Date): Promise<WalletTransaction> {
    return this.db.transaction(
      async (tx) => (await settleWalletTransaction(tx, transactionId, outcome, now)).transaction,
    );
  }
}

/**
 * Corps de `settle`, DANS la transaction SQL de l'appelant : un paiement (D-050) change son
 * statut et règle sa transaction du compte de jeu dans le même COMMIT (ou le même ROLLBACK).
 * Idempotent : une transaction déjà réglée est renvoyée telle quelle (`changed: false`) et le
 * solde n'est modifié qu'au passage `pending` → réglé, sous verrou `FOR UPDATE`.
 */
export async function settleWalletTransaction(
  tx: SqlExecutor,
  transactionId: string,
  outcome: SettlementOutcome,
  now: Date,
): Promise<{ transaction: WalletTransaction; changed: boolean }> {
  const found = await tx.query<TransactionRow>(
    'SELECT user_id FROM wallet_transactions WHERE id = $1',
    [transactionId],
  );
  const userId = found.rows[0]?.user_id as UserId | undefined;
  if (!userId) throw new WalletTransactionNotFoundError(transactionId);
  // Même ordre de verrouillage que les créations : portefeuille, puis transaction.
  await lockWallet(tx, userId, now);
  const { rows } = await tx.query<TransactionRow>(
    'SELECT * FROM wallet_transactions WHERE id = $1 FOR UPDATE',
    [transactionId],
  );
  const current = toTransaction(rows[0]!);
  if (current.status !== 'pending') {
    return { transaction: current, changed: false };
  }
  if (outcome.status === 'succeeded' && current.kind === 'deposit') {
    await adjustBalance(tx, userId, current.tokens, now);
  }
  if (outcome.status === 'failed' && current.kind === 'withdrawal') {
    await adjustBalance(tx, userId, current.tokens, now);
  }
  const updated = await tx.query<TransactionRow>(
    `UPDATE wallet_transactions
     SET status = $2, failure_code = $3, provider_reference = COALESCE($4, provider_reference),
         updated_at = $5, completed_at = $5
     WHERE id = $1 RETURNING *`,
    [
      transactionId,
      outcome.status,
      outcome.status === 'failed' ? outcome.failureCode : null,
      outcome.providerReference ?? null,
      now.toISOString(),
    ],
  );
  return { transaction: toTransaction(updated.rows[0]!), changed: true };
}
