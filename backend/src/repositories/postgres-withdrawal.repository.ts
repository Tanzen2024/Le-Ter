import { isPgError, PG_UNIQUE_VIOLATION, type SqlClient, type SqlExecutor } from '../database/sql-client';
import type { UserId } from '../domain/users/user';
import { InsufficientBalanceError } from '../domain/wallet/wallet';
import {
  isValidWithdrawalLimit,
  MANUAL_REFUND_FAILURE_CODE,
  quotaWindowStart,
  UNLIMITED_WITHDRAWALS,
  WithdrawalLimitReachedError,
  WithdrawalNotFoundError,
  WithdrawalRefundRefusedError,
  type Withdrawal,
  type WithdrawalLimit,
  type WithdrawalRefundRequest,
} from '../domain/wallet/withdrawal';
import { insertAuditRow } from './admin-audit.repository';
import { settleWalletTransaction } from './postgres-wallet.repository';
import { lockWalletBalances } from './wallet-reservations';
import { DuplicateIdempotencyKeyError } from './wallet.repository';
import type {
  AdminWithdrawalQuery,
  AdminWithdrawalRow,
  CreateRefundRequestCommand,
  CreateWithdrawalCommand,
  DecideRefundRequestCommand,
  WithdrawalAcceptance,
  WithdrawalQuotaUsage,
  WithdrawalRepository,
  WithdrawalSettlement,
} from './withdrawal.repository';

/** Clés `system_settings` du quota (migration 0031). Valeur : entier ≥ 1, ou JSON `null` (∞). */
export const WITHDRAWAL_LIMIT_COUNT_KEY = 'withdrawal_limit_count';
export const WITHDRAWAL_LIMIT_PERIOD_KEY = 'withdrawal_limit_period';

interface WithdrawalRow {
  id: string;
  user_id: string;
  wallet_transaction_id: string;
  provider: 'cinetpay';
  operator: Withdrawal['operator'];
  msisdn_masked: string;
  tokens: string | number;
  amount: string | number;
  currency: 'XAF';
  status: Withdrawal['status'];
  merchant_transaction_id: string;
  provider_reference: string | null;
  provider_status: string | null;
  fee_amount: string | number | null;
  notify_token_hash: string | null;
  failure_code: string | null;
  last_error_code: string | null;
  last_error_at: Date | null;
  submission_attempted_at: Date | null;
  submission_attempts: number;
  last_checked_at: Date | null;
  created_at: Date;
  updated_at: Date;
  completed_at: Date | null;
}

const date = (value: Date | string) => new Date(value);

function toWithdrawal(row: WithdrawalRow): Withdrawal {
  return {
    id: row.id,
    userId: row.user_id as UserId,
    walletTransactionId: row.wallet_transaction_id,
    provider: row.provider,
    operator: row.operator,
    msisdnMasked: row.msisdn_masked,
    tokens: Number(row.tokens),
    amount: Number(row.amount),
    currency: row.currency,
    status: row.status,
    merchantTransactionId: row.merchant_transaction_id,
    ...(row.provider_reference !== null && { providerReference: row.provider_reference }),
    ...(row.provider_status !== null && { providerStatus: row.provider_status }),
    ...(row.fee_amount !== null && { feeAmount: Number(row.fee_amount) }),
    ...(row.notify_token_hash !== null && { notifyTokenHash: row.notify_token_hash }),
    ...(row.failure_code !== null && { failureCode: row.failure_code }),
    ...(row.last_error_code !== null && { lastErrorCode: row.last_error_code }),
    ...(row.last_error_at && { lastErrorAt: date(row.last_error_at) }),
    ...(row.submission_attempted_at && {
      submissionAttemptedAt: date(row.submission_attempted_at),
    }),
    submissionAttempts: Number(row.submission_attempts),
    ...(row.last_checked_at && { lastCheckedAt: date(row.last_checked_at) }),
    createdAt: date(row.created_at),
    updatedAt: date(row.updated_at),
    ...(row.completed_at && { completedAt: date(row.completed_at) }),
  };
}

const IDEMPOTENCY_CONSTRAINT = 'wallet_transactions_idempotency';

interface SettingRow {
  key: string;
  value: unknown;
  updated_at: Date;
}

/** Valeur enregistrée → quota ; ligne absente, `null` ou valeur invalide : illimité. */
function toLimit(rows: readonly SettingRow[]): WithdrawalLimit & { updatedAt: Date | null } {
  const valueOf = (key: string) => rows.find((r) => r.key === key)?.value ?? null;
  const limit = {
    count: valueOf(WITHDRAWAL_LIMIT_COUNT_KEY),
    periodMinutes: valueOf(WITHDRAWAL_LIMIT_PERIOD_KEY),
  };
  const updated = rows.map((r) => date(r.updated_at).getTime());
  return {
    ...(isValidWithdrawalLimit(limit) ? limit : UNLIMITED_WITHDRAWALS),
    updatedAt: updated.length > 0 ? new Date(Math.max(...updated)) : null,
  };
}

async function readLimit(db: SqlExecutor) {
  const { rows } = await db.query<SettingRow>(
    'SELECT key, value, updated_at FROM system_settings WHERE key = ANY($1::text[])',
    [[WITHDRAWAL_LIMIT_COUNT_KEY, WITHDRAWAL_LIMIT_PERIOD_KEY]],
  );
  return toLimit(rows);
}

/** Retraits comptés par le quota : tous sauf FAILED, dans la fenêtre si elle est bornée. */
async function countTowardsQuota(
  db: SqlExecutor,
  userId: UserId,
  since: Date | null,
): Promise<{ used: number; oldest: Date | null }> {
  const { rows } = await db.query<{ used: string | number; oldest: Date | null }>(
    `SELECT count(*) AS used, min(created_at) AS oldest FROM withdrawals
     WHERE user_id = $1 AND status <> 'FAILED'
       AND ($2::timestamptz IS NULL OR created_at > $2::timestamptz)`,
    [userId, since?.toISOString() ?? null],
  );
  return {
    used: Number(rows[0]?.used ?? 0),
    oldest: rows[0]?.oldest ? date(rows[0].oldest) : null,
  };
}

const ADMIN_COLUMNS = `w.*, u.username, t.status AS wallet_transaction_status`;
const ADMIN_FROM = `FROM withdrawals w
  JOIN wallet_transactions t ON t.id = w.wallet_transaction_id
  LEFT JOIN users u ON u.id = w.user_id`;

type AdminRow = WithdrawalRow & {
  username: string | null;
  wallet_transaction_status: AdminWithdrawalRow['walletTransactionStatus'];
};

const toAdminRow = (row: AdminRow): AdminWithdrawalRow => ({
  ...toWithdrawal(row),
  username: row.username,
  walletTransactionStatus: row.wallet_transaction_status,
});

/**
 * Règlement FINAL d'un retrait déjà verrouillé (`FOR UPDATE`), dans la transaction de
 * l'appelant. Un retrait final est renvoyé tel quel ; sinon la transaction du compte de jeu
 * est réglée par `settleWalletTransaction` (succès = débit définitif ; échec = remboursement
 * UNE fois, idempotent, verrou du portefeuille puis de la transaction), puis le retrait.
 */
async function settleLockedWithdrawal(
  tx: SqlExecutor,
  current: Withdrawal,
  settlement: WithdrawalSettlement,
  now: Date,
): Promise<{ withdrawal: Withdrawal; changed: boolean }> {
  if (current.status === 'SUCCEEDED' || current.status === 'FAILED') {
    return { withdrawal: current, changed: false };
  }
  await settleWalletTransaction(
    tx,
    current.walletTransactionId,
    settlement.status === 'SUCCEEDED'
      ? { status: 'succeeded', providerReference: settlement.providerReference }
      : {
          status: 'failed',
          failureCode: settlement.failureCode,
          ...(settlement.providerReference && { providerReference: settlement.providerReference }),
        },
    now,
  );
  const updated = await tx.query<WithdrawalRow>(
    `UPDATE withdrawals
     SET status = $2, failure_code = $3,
         provider_reference = COALESCE($4, provider_reference),
         provider_status = COALESCE($5, provider_status),
         fee_amount = COALESCE($6, fee_amount),
         last_checked_at = $7, updated_at = $7, completed_at = $7
     WHERE id = $1 RETURNING *`,
    [
      current.id,
      settlement.status,
      settlement.status === 'FAILED' ? settlement.failureCode : null,
      settlement.providerReference ?? null,
      settlement.providerStatus ?? null,
      settlement.status === 'SUCCEEDED' ? (settlement.feeAmount ?? null) : null,
      now.toISOString(),
    ],
  );
  return { withdrawal: toWithdrawal(updated.rows[0]!), changed: true };
}

interface RefundRequestRow {
  id: string;
  withdrawal_id: string;
  status: WithdrawalRefundRequest['status'];
  provider_ticket: string;
  justification: string;
  proposed_by: string;
  proposed_at: Date;
  provider_status_at_proposal: string;
  decided_by: string | null;
  decided_at: Date | null;
  decision_note: string | null;
  provider_status_at_decision: string | null;
}

const toRefundRequest = (row: RefundRequestRow): WithdrawalRefundRequest => ({
  id: row.id,
  withdrawalId: row.withdrawal_id,
  status: row.status,
  providerTicket: row.provider_ticket,
  justification: row.justification,
  proposedBy: row.proposed_by as UserId,
  proposedAt: date(row.proposed_at),
  providerStatusAtProposal: row.provider_status_at_proposal,
  ...(row.decided_by && { decidedBy: row.decided_by as UserId }),
  ...(row.decided_at && { decidedAt: date(row.decided_at) }),
  ...(row.decision_note && { decisionNote: row.decision_note }),
  ...(row.provider_status_at_decision && {
    providerStatusAtDecision: row.provider_status_at_decision,
  }),
});

export class PostgresWithdrawalRepository implements WithdrawalRepository {
  constructor(private readonly db: SqlClient) {}

  async create({ withdrawal: w, idempotencyKey }: CreateWithdrawalCommand): Promise<void> {
    const now = w.createdAt.toISOString();
    try {
      await this.db.transaction(async (tx) => {
        // 1. Verrou du portefeuille : toutes les demandes d'un joueur se suivent, sur toutes
        //    les instances. Le quota et le solde sont lus SOUS ce verrou.
        const { available } = await lockWalletBalances(tx, w.userId, w.createdAt);
        // 2. Quota (fenêtre glissante précédant la demande).
        const limit = await readLimit(tx);
        if (limit.count !== null) {
          const { used } = await countTowardsQuota(
            tx,
            w.userId,
            quotaWindowStart(limit, w.createdAt),
          );
          if (used >= limit.count) {
            throw new WithdrawalLimitReachedError(
              { count: limit.count, periodMinutes: limit.periodMinutes },
              used,
            );
          }
        }
        // 3. Seul le DISPONIBLE (solde − réservé, D-054) peut être retiré.
        if (available < w.tokens) throw new InsufficientBalanceError(available, w.tokens);
        // 4. Transaction du compte de jeu en attente et débit (CHECK balance >= 0 en base).
        await tx.query(
          `INSERT INTO wallet_transactions (id, user_id, kind, status, tokens, idempotency_key,
             created_at, updated_at)
           VALUES ($1, $2, 'withdrawal', 'pending', $3, $4, $5, $5)`,
          [w.walletTransactionId, w.userId, w.tokens, idempotencyKey, now],
        );
        await tx.query(
          'UPDATE wallets SET balance = balance - $2, updated_at = $3 WHERE user_id = $1',
          [w.userId, w.tokens, now],
        );
        // 5. Le retrait lui-même.
        await tx.query(
          `INSERT INTO withdrawals (id, user_id, wallet_transaction_id, provider, operator,
             msisdn_masked, tokens, amount, currency, status, merchant_transaction_id,
             created_at, updated_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'CREATED', $10, $11, $11)`,
          [
            w.id,
            w.userId,
            w.walletTransactionId,
            w.provider,
            w.operator,
            w.msisdnMasked,
            w.tokens,
            w.amount,
            w.currency,
            w.merchantTransactionId,
            now,
          ],
        );
      });
    } catch (err) {
      if (
        isPgError(err, PG_UNIQUE_VIOLATION) &&
        (err as { constraint?: string }).constraint === IDEMPOTENCY_CONSTRAINT
      ) {
        throw new DuplicateIdempotencyKeyError();
      }
      throw err;
    }
  }

  async findById(id: string): Promise<Withdrawal | null> {
    const { rows } = await this.db.query<WithdrawalRow>('SELECT * FROM withdrawals WHERE id = $1', [
      id,
    ]);
    return rows[0] ? toWithdrawal(rows[0]) : null;
  }

  async findByIdForUser(id: string, userId: UserId): Promise<Withdrawal | null> {
    const { rows } = await this.db.query<WithdrawalRow>(
      'SELECT * FROM withdrawals WHERE id = $1 AND user_id = $2',
      [id, userId],
    );
    return rows[0] ? toWithdrawal(rows[0]) : null;
  }

  async findByIdempotencyKey(userId: UserId, idempotencyKey: string): Promise<Withdrawal | null> {
    const { rows } = await this.db.query<WithdrawalRow>(
      `SELECT w.* FROM withdrawals w
       JOIN wallet_transactions t ON t.id = w.wallet_transaction_id
       WHERE t.user_id = $1 AND t.idempotency_key = $2`,
      [userId, idempotencyKey],
    );
    return rows[0] ? toWithdrawal(rows[0]) : null;
  }

  async findByMerchantTransactionId(merchantTransactionId: string): Promise<Withdrawal | null> {
    const { rows } = await this.db.query<WithdrawalRow>(
      `SELECT * FROM withdrawals WHERE provider = 'cinetpay' AND merchant_transaction_id = $1`,
      [merchantTransactionId],
    );
    return rows[0] ? toWithdrawal(rows[0]) : null;
  }

  async listForUser(userId: UserId, limit: number): Promise<Withdrawal[]> {
    const { rows } = await this.db.query<WithdrawalRow>(
      'SELECT * FROM withdrawals WHERE user_id = $1 ORDER BY created_at DESC, id LIMIT $2',
      [userId, limit],
    );
    return rows.map(toWithdrawal);
  }

  async quotaUsage(userId: UserId, now: Date): Promise<WithdrawalQuotaUsage> {
    const setting = await readLimit(this.db);
    const limit = { count: setting.count, periodMinutes: setting.periodMinutes };
    if (limit.count === null) return { limit, used: 0, oldestCountedAt: null };
    const { used, oldest } = await countTowardsQuota(this.db, userId, quotaWindowStart(limit, now));
    return { limit, used, oldestCountedAt: oldest };
  }

  async claimSubmission(
    id: string,
    expectedAttempts: number,
    now: Date,
  ): Promise<Withdrawal | null> {
    const { rows } = await this.db.query<WithdrawalRow>(
      `UPDATE withdrawals
       SET submission_attempts = submission_attempts + 1, submission_attempted_at = $3,
           updated_at = $3
       WHERE id = $1 AND status = 'CREATED' AND submission_attempts = $2
       RETURNING *`,
      [id, expectedAttempts, now.toISOString()],
    );
    return rows[0] ? toWithdrawal(rows[0]) : null;
  }

  async recordAcceptance(
    id: string,
    acceptance: WithdrawalAcceptance,
    now: Date,
  ): Promise<Withdrawal> {
    const { rows } = await this.db.query<WithdrawalRow>(
      `UPDATE withdrawals
       SET status = 'PROCESSING', provider_reference = $2, provider_status = $3,
           notify_token_hash = COALESCE($4, notify_token_hash),
           fee_amount = COALESCE($5, fee_amount),
           last_error_code = NULL, last_error_at = NULL, last_checked_at = $6, updated_at = $6
       WHERE id = $1 AND status IN ('CREATED', 'PROCESSING')
       RETURNING *`,
      [
        id,
        acceptance.providerReference,
        acceptance.providerStatus,
        acceptance.notifyTokenHash ?? null,
        acceptance.feeAmount ?? null,
        now.toISOString(),
      ],
    );
    if (rows[0]) return toWithdrawal(rows[0]);
    // Déjà final (notification simultanée) : rien n'est modifié.
    const current = await this.findById(id);
    if (!current) throw new Error(`Retrait ${id} introuvable`);
    return current;
  }

  async recordCheck(
    id: string,
    check: { providerStatus?: string; errorCode?: string },
    now: Date,
  ): Promise<void> {
    await this.db.query(
      `UPDATE withdrawals
       SET provider_status = COALESCE($2, provider_status),
           last_error_code = CASE WHEN $3::text IS NULL THEN last_error_code ELSE $3 END,
           last_error_at = CASE WHEN $3::text IS NULL THEN last_error_at ELSE $4 END,
           last_checked_at = $4, updated_at = $4
       WHERE id = $1 AND status IN ('CREATED', 'PROCESSING')`,
      [id, check.providerStatus ?? null, check.errorCode ?? null, now.toISOString()],
    );
  }

  settle(
    id: string,
    settlement: WithdrawalSettlement,
    now: Date,
  ): Promise<{ withdrawal: Withdrawal; changed: boolean }> {
    return this.db.transaction(async (tx) => {
      // Verrou du retrait : deux règlements simultanés (notification, réconciliation,
      // administration) se suivent ; le second voit un retrait final.
      const locked = await tx.query<WithdrawalRow>(
        'SELECT * FROM withdrawals WHERE id = $1 FOR UPDATE',
        [id],
      );
      if (!locked.rows[0]) throw new Error(`Retrait ${id} introuvable`);
      return settleLockedWithdrawal(tx, toWithdrawal(locked.rows[0]), settlement, now);
    });
  }

  async releaseSubmission(id: string, claimedAttempts: number, now: Date): Promise<void> {
    await this.db.query(
      `UPDATE withdrawals
       SET submission_attempts = submission_attempts - 1, updated_at = $3
       WHERE id = $1 AND status = 'CREATED' AND submission_attempts = $2 AND $2 > 0`,
      [id, claimedAttempts, now.toISOString()],
    );
  }

  async recordAnomaly(id: string, code: string, now: Date): Promise<void> {
    await this.db.query(
      `UPDATE withdrawals SET last_error_code = $2, last_error_at = $3, updated_at = $3
       WHERE id = $1`,
      [id, code, now.toISOString()],
    );
  }

  async listRefundRequests(withdrawalId: string): Promise<WithdrawalRefundRequest[]> {
    const { rows } = await this.db.query<RefundRequestRow>(
      `SELECT * FROM withdrawal_refund_requests WHERE withdrawal_id = $1
       ORDER BY proposed_at DESC, id`,
      [withdrawalId],
    );
    return rows.map(toRefundRequest);
  }

  async createRefundRequest(command: CreateRefundRequestCommand): Promise<WithdrawalRefundRequest> {
    try {
      return await this.db.transaction(async (tx) => {
        const locked = await tx.query<WithdrawalRow>(
          'SELECT * FROM withdrawals WHERE id = $1 FOR UPDATE',
          [command.withdrawalId],
        );
        const current = locked.rows[0] ? toWithdrawal(locked.rows[0]) : null;
        if (!current) throw new WithdrawalNotFoundError();
        if (current.status !== 'CREATED' && current.status !== 'PROCESSING') {
          throw new WithdrawalRefundRefusedError('NOT_OPEN');
        }
        const { rows } = await tx.query<RefundRequestRow>(
          `INSERT INTO withdrawal_refund_requests (id, withdrawal_id, status, provider_ticket,
             justification, proposed_by, proposed_at, provider_status_at_proposal)
           VALUES ($1, $2, 'PENDING', $3, $4, $5, $6, $7) RETURNING *`,
          [
            command.id,
            command.withdrawalId,
            command.providerTicket,
            command.justification,
            command.actorId,
            command.now.toISOString(),
            command.providerStatus,
          ],
        );
        await insertAuditRow(tx, {
          id: command.auditId,
          actorId: command.actorId,
          action: 'WITHDRAWAL_REFUND_PROPOSED',
          targetType: 'WITHDRAWAL',
          targetId: command.withdrawalId,
          outcome: 'SUCCESS',
          details: {
            requestId: command.id,
            providerTicket: command.providerTicket,
            providerStatus: command.providerStatus,
          },
          createdAt: command.now,
        });
        return toRefundRequest(rows[0]!);
      });
    } catch (err) {
      if (
        isPgError(err, PG_UNIQUE_VIOLATION) &&
        (err as { constraint?: string }).constraint === 'withdrawal_refund_requests_pending_idx'
      ) {
        throw new WithdrawalRefundRefusedError('PENDING_REQUEST_EXISTS');
      }
      throw err;
    }
  }

  decideRefundRequest(
    command: DecideRefundRequestCommand,
  ): Promise<{ request: WithdrawalRefundRequest; withdrawal: Withdrawal }> {
    return this.db.transaction(async (tx) => {
      // Ordre des verrous : demande → retrait → portefeuille. `settle` verrouille retrait puis
      // portefeuille et ne touche jamais aux demandes : aucune attente circulaire.
      const request = await tx.query<RefundRequestRow>(
        `SELECT * FROM withdrawal_refund_requests WHERE id = $1 AND withdrawal_id = $2
         FOR UPDATE`,
        [command.requestId, command.withdrawalId],
      );
      const current = request.rows[0] ? toRefundRequest(request.rows[0]) : null;
      if (!current) throw new WithdrawalNotFoundError();
      if (current.status !== 'PENDING') {
        throw new WithdrawalRefundRefusedError('REQUEST_NOT_PENDING');
      }
      const lockedWithdrawal = await tx.query<WithdrawalRow>(
        'SELECT * FROM withdrawals WHERE id = $1 FOR UPDATE',
        [command.withdrawalId],
      );
      let withdrawal = toWithdrawal(lockedWithdrawal.rows[0]!);
      if (command.approve) {
        if (current.proposedBy === command.actorId) {
          throw new WithdrawalRefundRefusedError('SAME_ADMIN');
        }
        if (withdrawal.status !== 'CREATED' && withdrawal.status !== 'PROCESSING') {
          throw new WithdrawalRefundRefusedError('NOT_OPEN');
        }
        // MÊME règlement que l'échec confirmé : remboursement unique, sous verrous.
        ({ withdrawal } = await settleLockedWithdrawal(
          tx,
          withdrawal,
          {
            status: 'FAILED',
            failureCode: MANUAL_REFUND_FAILURE_CODE,
            ...(command.providerStatus && { providerStatus: command.providerStatus }),
          },
          command.now,
        ));
      }
      const updated = await tx.query<RefundRequestRow>(
        `UPDATE withdrawal_refund_requests
         SET status = $2, decided_by = $3, decided_at = $4, decision_note = $5,
             provider_status_at_decision = $6
         WHERE id = $1 RETURNING *`,
        [
          command.requestId,
          command.approve ? 'APPROVED' : 'REJECTED',
          command.actorId,
          command.now.toISOString(),
          command.note ?? null,
          command.providerStatus ?? null,
        ],
      );
      await insertAuditRow(tx, {
        id: command.auditId,
        actorId: command.actorId,
        action: command.approve ? 'WITHDRAWAL_REFUND_APPROVED' : 'WITHDRAWAL_REFUND_REJECTED',
        targetType: 'WITHDRAWAL',
        targetId: command.withdrawalId,
        outcome: 'SUCCESS',
        details: {
          requestId: command.requestId,
          ...(command.providerStatus && { providerStatus: command.providerStatus }),
          ...(command.note && { note: command.note }),
        },
        createdAt: command.now,
      });
      return { request: toRefundRequest(updated.rows[0]!), withdrawal };
    });
  }

  async findOpenForReconciliation(options: {
    limit: number;
    createdBefore: Date;
    lastCheckedBefore: Date;
    excludeIds: readonly string[];
  }): Promise<Withdrawal[]> {
    const { rows } = await this.db.query<WithdrawalRow>(
      `SELECT * FROM withdrawals
       WHERE status IN ('CREATED', 'PROCESSING')
         AND created_at <= $1
         AND (last_checked_at IS NULL OR last_checked_at <= $2)
         AND NOT (id = ANY($3::uuid[]))
       ORDER BY last_checked_at NULLS FIRST, created_at
       LIMIT $4`,
      [
        options.createdBefore.toISOString(),
        options.lastCheckedBefore.toISOString(),
        [...options.excludeIds],
        options.limit,
      ],
    );
    return rows.map(toWithdrawal);
  }

  getLimit() {
    return readLimit(this.db);
  }

  setLimit(command: { limit: WithdrawalLimit; actorId: UserId; auditId: string; now: Date }) {
    const now = command.now.toISOString();
    return this.db.transaction(async (tx) => {
      // Lignes créées (∞) avant le verrou : deux premiers réglages simultanés se sérialisent.
      for (const key of [WITHDRAWAL_LIMIT_COUNT_KEY, WITHDRAWAL_LIMIT_PERIOD_KEY]) {
        await tx.query(
          `INSERT INTO system_settings (key, value, updated_at) VALUES ($1, 'null'::jsonb, $2)
           ON CONFLICT (key) DO NOTHING`,
          [key, now],
        );
      }
      const locked = await tx.query<SettingRow>(
        `SELECT key, value, updated_at FROM system_settings WHERE key = ANY($1::text[])
         ORDER BY key FOR UPDATE`,
        [[WITHDRAWAL_LIMIT_COUNT_KEY, WITHDRAWAL_LIMIT_PERIOD_KEY]],
      );
      const { updatedAt, ...current } = toLimit(locked.rows);
      const next = command.limit;
      if (current.count === next.count && current.periodMinutes === next.periodMinutes) {
        return { limit: current, updatedAt, changed: false };
      }
      for (const [key, value] of [
        [WITHDRAWAL_LIMIT_COUNT_KEY, next.count],
        [WITHDRAWAL_LIMIT_PERIOD_KEY, next.periodMinutes],
      ] as const) {
        await tx.query(
          `UPDATE system_settings SET value = $2::jsonb, updated_at = $3, updated_by = $4
           WHERE key = $1`,
          [key, JSON.stringify(value), now, command.actorId],
        );
      }
      await tx.query(
        `INSERT INTO admin_audit_log (id, actor_id, action, target_type, target_id, details,
           created_at)
         VALUES ($1, $2, 'WITHDRAWAL_LIMIT_UPDATED', 'SYSTEM_SETTING', NULL, $3, $4)`,
        [
          command.auditId,
          command.actorId,
          JSON.stringify({
            keys: [WITHDRAWAL_LIMIT_COUNT_KEY, WITHDRAWAL_LIMIT_PERIOD_KEY],
            from: current,
            to: next,
          }),
          now,
        ],
      );
      return { limit: next, updatedAt: command.now, changed: true };
    });
  }

  async listForAdmin(
    query: AdminWithdrawalQuery,
  ): Promise<{ total: number; items: AdminWithdrawalRow[] }> {
    const conditions: string[] = [];
    const params: unknown[] = [];
    const add = (sql: string, value: unknown) => {
      params.push(value);
      conditions.push(sql.replace('?', `$${params.length}`));
    };
    if (query.status) add('w.status = ?', query.status);
    if (query.userId) add('w.user_id = ?', query.userId);
    if (query.from) add('w.created_at >= ?', query.from.toISOString());
    if (query.to) add('w.created_at < ?', query.to.toISOString());
    if (query.q) {
      params.push(query.q);
      const p = `$${params.length}`;
      conditions.push(
        `(w.id::text = ${p} OR w.merchant_transaction_id = ${p} OR w.provider_reference = ${p})`,
      );
    }
    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const total = await this.db.query<{ n: string | number }>(
      `SELECT count(*) AS n ${ADMIN_FROM} ${where}`,
      params,
    );
    const { rows } = await this.db.query<AdminRow>(
      `SELECT ${ADMIN_COLUMNS} ${ADMIN_FROM} ${where}
       ORDER BY w.created_at DESC, w.id
       LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      [...params, query.limit, (query.page - 1) * query.limit],
    );
    return { total: Number(total.rows[0]?.n ?? 0), items: rows.map(toAdminRow) };
  }

  async findForAdmin(id: string): Promise<AdminWithdrawalRow | null> {
    const { rows } = await this.db.query<AdminRow>(
      `SELECT ${ADMIN_COLUMNS} ${ADMIN_FROM} WHERE w.id = $1`,
      [id],
    );
    return rows[0] ? toAdminRow(rows[0]) : null;
  }
}
