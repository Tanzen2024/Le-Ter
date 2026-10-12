import type { SqlClient, SqlExecutor } from '../database/sql-client';
import type { Payment } from '../domain/payments/payment';
import { WalletTransactionNotFoundError } from '../domain/wallet/wallet';
import type {
  NewPayment,
  PaymentInitialization,
  PaymentRepository,
  PaymentSettlement,
  PaymentSettlementResult,
  PendingReconciliationQuery,
} from './payment.repository';
import { settleWalletTransaction } from './postgres-wallet.repository';

interface PaymentRow {
  id: string;
  wallet_transaction_id: string;
  user_id: string;
  provider: Payment['provider'];
  merchant_transaction_id: string;
  provider_reference: string | null;
  amount: string | number;
  currency: Payment['currency'];
  status: Payment['status'];
  provider_status: string | null;
  payment_method: string | null;
  payment_url: string | null;
  notify_token_hash: string | null;
  metadata: Record<string, unknown> | null;
  created_at: Date;
  updated_at: Date;
  completed_at: Date | null;
}

/** Le propriétaire d'un paiement est celui de sa transaction du compte de jeu. */
const SELECT_PAYMENT = `
  SELECT p.*, t.user_id
  FROM payments p JOIN wallet_transactions t ON t.id = p.wallet_transaction_id`;

/** Code d'échec enregistré sur la transaction du compte de jeu, par statut de paiement. */
const FAILURE_CODES = { FAILED: 'PAYMENT_FAILED', EXPIRED: 'PAYMENT_EXPIRED' } as const;

function toPayment(row: PaymentRow): Payment {
  return {
    id: row.id,
    walletTransactionId: row.wallet_transaction_id,
    userId: row.user_id,
    provider: row.provider,
    merchantTransactionId: row.merchant_transaction_id,
    ...(row.provider_reference !== null && { providerReference: row.provider_reference }),
    amount: Number(row.amount),
    currency: row.currency,
    status: row.status,
    ...(row.provider_status !== null && { providerStatus: row.provider_status }),
    ...(row.payment_method !== null && { paymentMethod: row.payment_method }),
    ...(row.payment_url !== null && { paymentUrl: row.payment_url }),
    ...(row.notify_token_hash !== null && { notifyTokenHash: row.notify_token_hash }),
    ...(row.provider_reference === null &&
      row.metadata?.initialization === 'UNCERTAIN' && { initializationUncertain: true }),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    ...(row.completed_at && { completedAt: row.completed_at }),
  };
}

async function selectOne(
  db: SqlExecutor,
  where: string,
  params: readonly unknown[],
): Promise<Payment | null> {
  const { rows } = await db.query<PaymentRow>(`${SELECT_PAYMENT} WHERE ${where}`, params);
  return rows[0] ? toPayment(rows[0]) : null;
}

export class PostgresPaymentRepository implements PaymentRepository {
  constructor(private readonly db: SqlClient) {}

  async create(p: NewPayment): Promise<void> {
    await this.db.query(
      `INSERT INTO payments (id, wallet_transaction_id, provider, merchant_transaction_id,
         amount, currency, status, payment_method, metadata, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, 'PENDING', $7,
         CASE WHEN $9::boolean THEN jsonb_build_object('initialization', 'UNCERTAIN')
              ELSE '{}'::jsonb END,
         $8, $8)`,
      [
        p.id,
        p.walletTransactionId,
        p.provider,
        p.merchantTransactionId,
        p.amount,
        p.currency,
        p.paymentMethod ?? null,
        p.createdAt.toISOString(),
        p.initializationUncertain === true,
      ],
    );
  }

  async recordInitialization(
    paymentId: string,
    data: PaymentInitialization,
    now: Date,
  ): Promise<void> {
    await this.db.query(
      `UPDATE payments
       SET provider_reference = $2, payment_url = $3, notify_token_hash = $4,
           provider_status = $5, updated_at = $6,
           -- Référence reçue : l'initialisation n'est plus incertaine (D-091).
           metadata = (metadata - 'initialization') || jsonb_strip_nulls(jsonb_build_object(
             'initialStatus', $7::text, 'mustBeRedirected', $8::boolean))
       WHERE id = $1 AND status = 'PENDING'`,
      [
        paymentId,
        data.providerReference,
        data.paymentUrl ?? null,
        data.notifyTokenHash,
        data.providerStatus ?? null,
        now.toISOString(),
        data.initialStatus ?? null,
        data.mustBeRedirected ?? null,
      ],
    );
  }

  async markInitializationFailed(paymentId: string, reason: string, now: Date): Promise<void> {
    await this.db.query(
      `UPDATE payments
       SET status = 'FAILED', metadata = metadata || jsonb_build_object('failure', $2::text),
           updated_at = $3, completed_at = $3
       WHERE id = $1 AND status = 'PENDING'`,
      [paymentId, reason, now.toISOString()],
    );
  }

  async markInitializationUncertain(paymentId: string, reason: string, now: Date): Promise<void> {
    await this.db.query(
      `UPDATE payments
       SET metadata = metadata || jsonb_build_object('initialization', 'UNCERTAIN',
             'initializationError', $2::text),
           updated_at = $3
       WHERE id = $1 AND status = 'PENDING' AND provider_reference IS NULL`,
      [paymentId, reason, now.toISOString()],
    );
  }

  async recordRecoveredReference(
    paymentId: string,
    providerReference: string,
    now: Date,
  ): Promise<boolean> {
    const { rows } = await this.db.query<{ id: string }>(
      `UPDATE payments
       SET provider_reference = $2,
           metadata = metadata || jsonb_build_object('initialization', 'RECOVERED'),
           updated_at = $3
       WHERE id = $1 AND status = 'PENDING' AND provider_reference IS NULL
         AND metadata->>'initialization' = 'UNCERTAIN'
       RETURNING id`,
      [paymentId, providerReference, now.toISOString()],
    );
    return rows.length > 0;
  }

  findById(paymentId: string): Promise<Payment | null> {
    return selectOne(this.db, 'p.id = $1', [paymentId]);
  }

  findByIdForUser(paymentId: string, userId: string): Promise<Payment | null> {
    return selectOne(this.db, 'p.id = $1 AND t.user_id = $2', [paymentId, userId]);
  }

  findByWalletTransactionId(walletTransactionId: string): Promise<Payment | null> {
    return selectOne(this.db, 'p.wallet_transaction_id = $1', [walletTransactionId]);
  }

  findByMerchantTransactionId(
    provider: Payment['provider'],
    merchantTransactionId: string,
  ): Promise<Payment | null> {
    return selectOne(this.db, 'p.provider = $1 AND p.merchant_transaction_id = $2', [
      provider,
      merchantTransactionId,
    ]);
  }

  async findPendingForReconciliation(query: PendingReconciliationQuery): Promise<Payment[]> {
    const { rows } = await this.db.query<PaymentRow>(
      `${SELECT_PAYMENT}
       WHERE p.status = 'PENDING'
         AND (p.provider_reference IS NOT NULL OR p.metadata->>'initialization' = 'UNCERTAIN')
         AND p.created_at <= $1 AND p.created_at > $2 AND p.updated_at <= $3
         AND NOT (p.id::text = ANY($4::text[]))
       ORDER BY p.updated_at, p.id
       LIMIT $5`,
      [
        query.createdBefore.toISOString(),
        query.createdAfter.toISOString(),
        query.lastCheckedBefore.toISOString(),
        [...query.excludeIds],
        query.limit,
      ],
    );
    return rows.map(toPayment);
  }

  async recordProviderStatus(paymentId: string, providerStatus: string, now: Date): Promise<void> {
    await this.db.query(
      `UPDATE payments SET provider_status = $2, updated_at = $3
       WHERE id = $1 AND status = 'PENDING'`,
      [paymentId, providerStatus, now.toISOString()],
    );
  }

  settle(
    paymentId: string,
    settlement: PaymentSettlement,
    now: Date,
  ): Promise<PaymentSettlementResult> {
    return this.db.transaction(async (tx) => {
      // 1. Verrou sur le paiement : deux notifications simultanées se suivent.
      const locked = await tx.query<{ wallet_transaction_id: string; status: string }>(
        'SELECT wallet_transaction_id, status FROM payments WHERE id = $1 FOR UPDATE',
        [paymentId],
      );
      const row = locked.rows[0];
      if (!row) throw new WalletTransactionNotFoundError(paymentId);

      // 2. Règlement du compte de jeu par le code commun de `settle` (crédit une seule fois).
      const { transaction, changed } = await settleWalletTransaction(
        tx,
        row.wallet_transaction_id,
        settlement.status === 'SUCCESS'
          ? { status: 'succeeded' }
          : { status: 'failed', failureCode: FAILURE_CODES[settlement.status] },
        now,
      );

      // 3. Statut du paiement, seulement s'il était encore en attente. Il suit TOUJOURS l'issue
      //    réelle du compte de jeu : jamais « SUCCESS » sans crédit.
      if (row.status === 'PENDING') {
        const status = changed
          ? settlement.status
          : transaction.status === 'succeeded'
            ? 'SUCCESS'
            : settlement.status === 'SUCCESS'
              ? 'FAILED'
              : settlement.status;
        // Payé chez le fournisseur alors que l'achat était déjà abandonné : à rapprocher
        // manuellement (aucun crédit automatique hors du chemin normal).
        const anomaly =
          !changed && settlement.status === 'SUCCESS' && transaction.status !== 'succeeded'
            ? 'PAID_AFTER_WALLET_FAILURE'
            : null;
        await tx.query(
          `UPDATE payments
           SET status = $2, provider_status = $3, payment_method = COALESCE($4, payment_method),
               metadata = metadata || jsonb_strip_nulls(jsonb_build_object(
                 'anomaly', $6::text, 'settledBy', $7::text)),
               updated_at = $5, completed_at = $5
           WHERE id = $1`,
          [
            paymentId,
            status,
            settlement.providerStatus,
            settlement.paymentMethod ?? null,
            now.toISOString(),
            anomaly,
            settlement.settledBy ?? null,
          ],
        );
      }
      const payment = await selectOne(tx, 'p.id = $1', [paymentId]);
      return { payment: payment!, transaction, changed: row.status === 'PENDING' };
    });
  }
}
