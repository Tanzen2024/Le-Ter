import type { SqlClient, SqlExecutor } from '../database/sql-client';
import type { AuditEntry } from '../domain/admin/admin';
import {
  LOOKUP_STATUSES,
  moneyFromSql,
  RESERVING_STATUSES,
  type BeneficiaryStatus,
  type PayoutBeneficiary,
  type PlatformPayout,
  type PlatformPayoutStatus,
  type PlayerObligations,
  type RevenueFacts,
  type TreasuryObservation,
} from '../domain/platform-finance/platform-finance';
import type { UserId } from '../domain/users/user';
import type {
  PayoutChanges,
  PlatformFinanceRepository,
  PlatformFinanceStore,
  PlatformPayoutEvent,
  PlatformPayoutListQuery,
  PlatformPayoutRow,
} from './platform-finance.repository';
import { insertAuditRow } from './admin-audit.repository';

const d = (v: Date | string | null | undefined): Date | undefined =>
  v === null || v === undefined ? undefined : new Date(v);
const uid = (v: string | null): UserId | undefined => (v ?? undefined) as UserId | undefined;
const opt = <T>(v: T | null): T | undefined => v ?? undefined;

type ObservationRow = {
  id: string;
  source: 'CINETPAY_API';
  environment: 'test' | 'live';
  status: 'VALID' | 'INVALID' | 'ERROR';
  available_amount: unknown;
  currency: string | null;
  error_code: string | null;
  requested_by: string | null;
  observed_at: Date;
};

function observationOf(r: ObservationRow): TreasuryObservation {
  return {
    id: r.id,
    source: r.source,
    environment: r.environment,
    status: r.status,
    ...(r.available_amount !== null && {
      availableAmount: moneyFromSql(r.available_amount, 'trésorerie'),
    }),
    ...(r.currency !== null && { currency: r.currency }),
    ...(r.error_code !== null && { errorCode: r.error_code }),
    ...(r.requested_by !== null && { requestedBy: r.requested_by as UserId }),
    observedAt: new Date(r.observed_at),
  };
}

type BeneficiaryRow = {
  id: string;
  label: string;
  operator: 'MTN_CM';
  msisdn: string;
  msisdn_masked: string;
  status: BeneficiaryStatus;
  created_by: string;
  created_at: Date;
  verified_by: string | null;
  verified_at: Date | null;
  verification_note: string | null;
  disabled_by: string | null;
  disabled_at: Date | null;
  created_by_username?: string | null;
  verified_by_username?: string | null;
};

function beneficiaryOf(r: BeneficiaryRow): PayoutBeneficiary {
  return {
    id: r.id,
    label: r.label,
    operator: r.operator,
    msisdnMasked: r.msisdn_masked,
    status: r.status,
    createdBy: r.created_by as UserId,
    createdAt: new Date(r.created_at),
    ...(r.verified_by && { verifiedBy: r.verified_by as UserId }),
    ...(r.verified_at && { verifiedAt: new Date(r.verified_at) }),
    ...(r.verification_note && { verificationNote: r.verification_note }),
    ...(r.disabled_by && { disabledBy: r.disabled_by as UserId }),
    ...(r.disabled_at && { disabledAt: new Date(r.disabled_at) }),
  };
}

type PayoutDbRow = {
  id: string;
  merchant_transaction_id: string;
  beneficiary_id: string;
  operator: 'MTN_CM';
  msisdn_masked: string;
  amount: unknown;
  currency: 'XAF';
  estimated_fee: unknown;
  final_amount: unknown;
  final_fee: unknown;
  purpose: string;
  status: PlatformPayoutStatus;
  initiated_by: string;
  created_at: Date;
  updated_at: Date;
  approved_by: string | null;
  approved_at: Date | null;
  released_by: string | null;
  released_at: Date | null;
  decided_by: string | null;
  decision_note: string | null;
  provider_reference: string | null;
  provider_status: string | null;
  notify_token_hash: string | null;
  submission_attempts: number;
  submission_claimed_at: Date | null;
  last_checked_at: Date | null;
  not_found_checks: number;
  last_error_code: string | null;
  last_error_at: Date | null;
  reconciliation_result: string | null;
  completed_at: Date | null;
  version: number;
  creation_key: string;
};

function payoutOf(r: PayoutDbRow): PlatformPayout {
  const payout: PlatformPayout = {
    id: r.id,
    merchantTransactionId: r.merchant_transaction_id,
    beneficiaryId: r.beneficiary_id,
    operator: r.operator,
    msisdnMasked: r.msisdn_masked,
    amount: moneyFromSql(r.amount, 'montant'),
    currency: r.currency,
    estimatedFee: moneyFromSql(r.estimated_fee, 'frais estimés'),
    purpose: r.purpose,
    status: r.status,
    initiatedBy: r.initiated_by as UserId,
    createdAt: new Date(r.created_at),
    updatedAt: new Date(r.updated_at),
    submissionAttempts: Number(r.submission_attempts),
    notFoundChecks: Number(r.not_found_checks),
    version: Number(r.version),
    creationKey: r.creation_key,
  };
  const optional: Partial<PlatformPayout> = {
    finalAmount:
      r.final_amount === null ? undefined : moneyFromSql(r.final_amount, 'montant final'),
    finalFee: r.final_fee === null ? undefined : moneyFromSql(r.final_fee, 'frais finaux'),
    approvedBy: uid(r.approved_by),
    approvedAt: d(r.approved_at),
    releasedBy: uid(r.released_by),
    releasedAt: d(r.released_at),
    decidedBy: uid(r.decided_by),
    decisionNote: opt(r.decision_note),
    providerReference: opt(r.provider_reference),
    providerStatus: opt(r.provider_status),
    notifyTokenHash: opt(r.notify_token_hash),
    submissionClaimedAt: d(r.submission_claimed_at),
    lastCheckedAt: d(r.last_checked_at),
    lastErrorCode: opt(r.last_error_code),
    lastErrorAt: d(r.last_error_at),
    reconciliationResult: opt(r.reconciliation_result),
    completedAt: d(r.completed_at),
  };
  for (const [key, value] of Object.entries(optional)) {
    if (value !== undefined) (payout as unknown as Record<string, unknown>)[key] = value;
  }
  return payout;
}

const PAYOUT_ROW_SELECT = `
  SELECT p.*, b.label AS beneficiary_label,
         ui.username AS initiated_by_username, ua.username AS approved_by_username,
         ud.username AS decided_by_username, ur.username AS released_by_username
  FROM platform_payouts p
  JOIN platform_payout_beneficiaries b ON b.id = p.beneficiary_id
  JOIN users ui ON ui.id = p.initiated_by
  LEFT JOIN users ua ON ua.id = p.approved_by
  LEFT JOIN users ud ON ud.id = p.decided_by
  LEFT JOIN users ur ON ur.id = p.released_by`;

type PayoutJoinedRow = PayoutDbRow & {
  beneficiary_label: string;
  initiated_by_username: string | null;
  approved_by_username: string | null;
  decided_by_username: string | null;
  released_by_username: string | null;
};

function payoutRowOf(r: PayoutJoinedRow): PlatformPayoutRow {
  return {
    ...payoutOf(r),
    beneficiaryLabel: r.beneficiary_label,
    initiatedByUsername: r.initiated_by_username,
    approvedByUsername: r.approved_by_username,
    decidedByUsername: r.decided_by_username,
    releasedByUsername: r.released_by_username,
  };
}

/** Colonne SQL de chaque champ modifiable (liste blanche : aucun nom venu de l'extérieur). */
const CHANGE_COLUMNS: Record<keyof PayoutChanges, string> = {
  status: 'status',
  approvedBy: 'approved_by',
  approvedAt: 'approved_at',
  releasedBy: 'released_by',
  releasedAt: 'released_at',
  decidedBy: 'decided_by',
  decisionNote: 'decision_note',
  providerReference: 'provider_reference',
  providerStatus: 'provider_status',
  notifyTokenHash: 'notify_token_hash',
  submissionAttempts: 'submission_attempts',
  submissionClaimedAt: 'submission_claimed_at',
  lastCheckedAt: 'last_checked_at',
  notFoundChecks: 'not_found_checks',
  lastErrorCode: 'last_error_code',
  lastErrorAt: 'last_error_at',
  reconciliationResult: 'reconciliation_result',
  finalAmount: 'final_amount',
  finalFee: 'final_fee',
  completedAt: 'completed_at',
};

const sqlValue = (v: unknown): unknown => (v instanceof Date ? v.toISOString() : (v ?? null));

class Store implements PlatformFinanceStore {
  constructor(private readonly db: SqlExecutor) {}

  async revenueFacts(): Promise<RevenueFacts> {
    const ledger = await this.db.query<{ kind: string; amount: unknown; entries: number }>(
      `SELECT kind, COALESCE(sum(amount), 0)::text AS amount, count(*)::int AS entries
       FROM platform_ledger GROUP BY kind ORDER BY kind`,
    );
    const { rows } = await this.db.query<{
      player_fees: unknown;
      executed_amount: unknown;
      executed_fees: unknown;
      executed_count: number;
      reserved_amount: unknown;
      reserved_count: number;
      last_entry: Date | null;
    }>(
      `SELECT
         -- Frais (2 décimales possibles) arrondis au franc supérieur : jamais sous-estimés.
         (SELECT COALESCE(ceil(sum(fee_amount)), 0)::bigint::text FROM withdrawals
           WHERE status = 'SUCCEEDED' AND fee_amount IS NOT NULL) AS player_fees,
         (SELECT COALESCE(sum(amount), 0)::text FROM platform_payouts
           WHERE status = 'SUCCEEDED') AS executed_amount,
         (SELECT COALESCE(sum(COALESCE(final_fee, estimated_fee)), 0)::text FROM platform_payouts
           WHERE status = 'SUCCEEDED') AS executed_fees,
         (SELECT count(*)::int FROM platform_payouts WHERE status = 'SUCCEEDED') AS executed_count,
         (SELECT COALESCE(sum(amount + estimated_fee), 0)::text FROM platform_payouts
           WHERE status = ANY($1)) AS reserved_amount,
         (SELECT count(*)::int FROM platform_payouts WHERE status = ANY($1)) AS reserved_count,
         (SELECT max(created_at) FROM platform_ledger) AS last_entry`,
      [RESERVING_STATUSES],
    );
    const r = rows[0]!;
    return {
      ledgerByKind: ledger.rows.map((k) => ({
        kind: k.kind,
        amount: moneyFromSql(k.amount, `recettes ${k.kind}`),
        entries: Number(k.entries),
      })),
      playerTransferFees: moneyFromSql(r.player_fees, 'frais des retraits joueurs'),
      executedPayouts: {
        amount: moneyFromSql(r.executed_amount, 'retraits exécutés'),
        fees: moneyFromSql(r.executed_fees, 'frais des retraits exécutés'),
        count: Number(r.executed_count),
      },
      reservedPayouts: {
        amount: moneyFromSql(r.reserved_amount, 'retraits engagés'),
        count: Number(r.reserved_count),
      },
      lastLedgerEntryAt: r.last_entry ? new Date(r.last_entry) : null,
    };
  }

  async playerObligations(): Promise<PlayerObligations> {
    const { rows } = await this.db.query<{
      balances: unknown;
      open_withdrawals: unknown;
      entries: unknown;
      prizes: unknown;
      tournament_ledger: unknown;
    }>(
      `SELECT
         (SELECT COALESCE(sum(balance), 0)::text FROM wallets) AS balances,
         (SELECT COALESCE(sum(amount), 0)::text FROM withdrawals
           WHERE status IN ('CREATED', 'PROCESSING')) AS open_withdrawals,
         (SELECT COALESCE(sum(tokens), 0)::text FROM wallet_transactions
           WHERE kind = 'tournament_entry' AND status = 'succeeded') AS entries,
         (SELECT COALESCE(sum(tokens), 0)::text FROM wallet_transactions
           WHERE kind = 'tournament_prize' AND status = 'succeeded') AS prizes,
         (SELECT COALESCE(sum(amount), 0)::text FROM platform_ledger
           WHERE tournament_id IS NOT NULL) AS tournament_ledger`,
    );
    const r = rows[0]!;
    return {
      walletBalances: moneyFromSql(r.balances, 'soldes des joueurs'),
      openWithdrawals: moneyFromSql(r.open_withdrawals, 'retraits des joueurs ouverts'),
      // Inscriptions capturées − gains versés − part acquise à la plateforme (commission et
      // part non attribuée) : ce qui reste dû aux joueurs d'un tournoi non réglé.
      tournamentFundsHeld:
        moneyFromSql(r.entries, 'inscriptions') -
        moneyFromSql(r.prizes, 'gains de tournoi') -
        moneyFromSql(r.tournament_ledger, 'recettes de tournoi'),
    };
  }

  async insertObservation(o: TreasuryObservation): Promise<void> {
    await this.db.query(
      `INSERT INTO treasury_observations (id, source, environment, status, available_amount,
         currency, error_code, requested_by, observed_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [
        o.id,
        o.source,
        o.environment,
        o.status,
        o.availableAmount ?? null,
        o.currency ?? null,
        o.errorCode ?? null,
        o.requestedBy ?? null,
        o.observedAt.toISOString(),
      ],
    );
  }

  async lastObservation(): Promise<TreasuryObservation | null> {
    const { rows } = await this.db.query<ObservationRow>(
      'SELECT * FROM treasury_observations ORDER BY seq DESC LIMIT 1',
    );
    return rows[0] ? observationOf(rows[0]) : null;
  }

  async lastValidObservation(): Promise<TreasuryObservation | null> {
    const { rows } = await this.db.query<ObservationRow>(
      `SELECT * FROM treasury_observations WHERE status = 'VALID'
       ORDER BY seq DESC LIMIT 1`,
    );
    return rows[0] ? observationOf(rows[0]) : null;
  }

  async listObservations(limit: number): Promise<TreasuryObservation[]> {
    const { rows } = await this.db.query<ObservationRow>(
      'SELECT * FROM treasury_observations ORDER BY seq DESC LIMIT $1',
      [limit],
    );
    return rows.map(observationOf);
  }

  async insertBeneficiary(b: PayoutBeneficiary & { msisdn: string }): Promise<void> {
    await this.db.query(
      `INSERT INTO platform_payout_beneficiaries (id, label, operator, msisdn, msisdn_masked,
         status, created_by, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        b.id,
        b.label,
        b.operator,
        b.msisdn,
        b.msisdnMasked,
        b.status,
        b.createdBy,
        b.createdAt.toISOString(),
      ],
    );
  }

  async findBeneficiary(id: string) {
    const { rows } = await this.db.query<BeneficiaryRow>(
      'SELECT * FROM platform_payout_beneficiaries WHERE id = $1',
      [id],
    );
    return rows[0] ? { ...beneficiaryOf(rows[0]), msisdn: rows[0].msisdn } : null;
  }

  async listBeneficiaries() {
    const { rows } = await this.db.query<BeneficiaryRow>(
      `SELECT b.*, uc.username AS created_by_username, uv.username AS verified_by_username
       FROM platform_payout_beneficiaries b
       JOIN users uc ON uc.id = b.created_by
       LEFT JOIN users uv ON uv.id = b.verified_by
       ORDER BY b.created_at DESC, b.id`,
    );
    return rows.map((r) => ({
      ...beneficiaryOf(r),
      createdByUsername: r.created_by_username ?? null,
      verifiedByUsername: r.verified_by_username ?? null,
    }));
  }

  async updateBeneficiary(
    id: string,
    expected: BeneficiaryStatus,
    changes: Partial<
      Pick<
        PayoutBeneficiary,
        'status' | 'verifiedBy' | 'verifiedAt' | 'verificationNote' | 'disabledBy' | 'disabledAt'
      >
    >,
  ): Promise<boolean> {
    const columns: Record<string, string> = {
      status: 'status',
      verifiedBy: 'verified_by',
      verifiedAt: 'verified_at',
      verificationNote: 'verification_note',
      disabledBy: 'disabled_by',
      disabledAt: 'disabled_at',
    };
    const sets: string[] = [];
    const params: unknown[] = [id, expected];
    for (const [key, value] of Object.entries(changes)) {
      const column = columns[key];
      if (!column) continue;
      params.push(sqlValue(value));
      sets.push(`${column} = $${params.length}`);
    }
    if (sets.length === 0) return false;
    const { rowCount } = await this.db.query(
      `UPDATE platform_payout_beneficiaries SET ${sets.join(', ')} WHERE id = $1 AND status = $2`,
      params,
    );
    return rowCount === 1;
  }

  async insertPayout(p: PlatformPayout): Promise<void> {
    await this.db.query(
      `INSERT INTO platform_payouts (id, merchant_transaction_id, beneficiary_id, operator,
         msisdn_masked, amount, currency, estimated_fee, purpose, status, initiated_by,
         created_at, updated_at, version, creation_key)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $12, 1, $13)`,
      [
        p.id,
        p.merchantTransactionId,
        p.beneficiaryId,
        p.operator,
        p.msisdnMasked,
        p.amount,
        p.currency,
        p.estimatedFee,
        p.purpose,
        p.status,
        p.initiatedBy,
        p.createdAt.toISOString(),
        p.creationKey,
      ],
    );
  }

  async findPayoutByCreationKey(initiatedBy: string, creationKey: string) {
    const { rows } = await this.db.query<PayoutJoinedRow>(
      `${PAYOUT_ROW_SELECT} WHERE p.initiated_by = $1 AND p.creation_key = $2`,
      [initiatedBy, creationKey],
    );
    return rows[0] ? payoutRowOf(rows[0]) : null;
  }

  async insertAudit(entry: AuditEntry): Promise<void> {
    await insertAuditRow(this.db, entry);
  }

  async findPayout(id: string): Promise<PlatformPayoutRow | null> {
    const { rows } = await this.db.query<PayoutJoinedRow>(`${PAYOUT_ROW_SELECT} WHERE p.id = $1`, [
      id,
    ]);
    return rows[0] ? payoutRowOf(rows[0]) : null;
  }

  async findPayoutByReference(merchantTransactionId: string): Promise<PlatformPayout | null> {
    const { rows } = await this.db.query<PayoutDbRow>(
      'SELECT * FROM platform_payouts WHERE merchant_transaction_id = $1',
      [merchantTransactionId],
    );
    return rows[0] ? payoutOf(rows[0]) : null;
  }

  async listPayouts(query: PlatformPayoutListQuery) {
    const where = query.status ? 'WHERE p.status = $1' : '';
    const params: unknown[] = query.status ? [query.status] : [];
    const total = await this.db.query<{ count: number }>(
      `SELECT count(*)::int AS count FROM platform_payouts p ${where}`,
      params,
    );
    const { rows } = await this.db.query<PayoutJoinedRow>(
      `${PAYOUT_ROW_SELECT} ${where} ORDER BY p.created_at DESC, p.id
       LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      [...params, query.limit, (query.page - 1) * query.limit],
    );
    return { total: Number(total.rows[0]?.count ?? 0), items: rows.map(payoutRowOf) };
  }

  async updatePayout(
    id: string,
    expected: { status: PlatformPayoutStatus; version: number },
    changes: PayoutChanges,
    now: Date,
  ): Promise<PlatformPayout | null> {
    const params: unknown[] = [id, expected.status, expected.version, now.toISOString()];
    const sets = ['updated_at = $4', 'version = version + 1'];
    for (const [key, value] of Object.entries(changes) as [keyof PayoutChanges, unknown][]) {
      const column = CHANGE_COLUMNS[key];
      if (!column) continue;
      params.push(sqlValue(value));
      sets.push(`${column} = $${params.length}`);
    }
    const { rows } = await this.db.query<PayoutDbRow>(
      `UPDATE platform_payouts SET ${sets.join(', ')}
       WHERE id = $1 AND status = $2 AND version = $3 RETURNING *`,
      params,
    );
    return rows[0] ? payoutOf(rows[0]) : null;
  }

  async insertEvent(e: PlatformPayoutEvent): Promise<void> {
    await this.db.query(
      `INSERT INTO platform_payout_events (id, payout_id, actor_id, event, from_status,
         to_status, details, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        e.id,
        e.payoutId,
        e.actorId,
        e.event,
        e.fromStatus,
        e.toStatus,
        JSON.stringify(e.details),
        e.createdAt.toISOString(),
      ],
    );
  }

  async listEvents(payoutId: string): Promise<PlatformPayoutEvent[]> {
    const { rows } = await this.db.query<{
      id: string;
      payout_id: string;
      actor_id: string | null;
      actor_username: string | null;
      event: string;
      from_status: PlatformPayoutStatus | null;
      to_status: PlatformPayoutStatus | null;
      details: Record<string, unknown> | string;
      created_at: Date;
    }>(
      `SELECT e.*, u.username AS actor_username FROM platform_payout_events e
       LEFT JOIN users u ON u.id = e.actor_id
       WHERE e.payout_id = $1 ORDER BY e.seq`,
      [payoutId],
    );
    return rows.map((r) => ({
      id: r.id,
      payoutId: r.payout_id,
      actorId: r.actor_id as UserId | null,
      actorUsername: r.actor_username,
      event: r.event,
      fromStatus: r.from_status,
      toStatus: r.to_status,
      details: typeof r.details === 'string' ? JSON.parse(r.details) : r.details,
      createdAt: new Date(r.created_at),
    }));
  }

  async findReady(limit: number): Promise<PlatformPayout[]> {
    const { rows } = await this.db.query<PayoutDbRow>(
      `SELECT * FROM platform_payouts WHERE status = 'READY'
       ORDER BY released_at, id LIMIT $1`,
      [limit],
    );
    return rows.map(payoutOf);
  }

  async findForLookup(input: { limit: number; checkedBefore: Date }): Promise<PlatformPayout[]> {
    const { rows } = await this.db.query<PayoutDbRow>(
      `SELECT * FROM platform_payouts
       WHERE status = ANY($1) AND (last_checked_at IS NULL OR last_checked_at < $2)
       ORDER BY last_checked_at NULLS FIRST, id LIMIT $3`,
      [LOOKUP_STATUSES, input.checkedBefore.toISOString(), input.limit],
    );
    return rows.map(payoutOf);
  }

  async findStaleSubmitting(claimedBefore: Date): Promise<PlatformPayout[]> {
    const { rows } = await this.db.query<PayoutDbRow>(
      `SELECT * FROM platform_payouts
       WHERE status = 'SUBMITTING' AND submission_claimed_at < $1 ORDER BY id`,
      [claimedBefore.toISOString()],
    );
    return rows.map(payoutOf);
  }
}

export class PostgresPlatformFinanceRepository extends Store implements PlatformFinanceRepository {
  constructor(private readonly sql: SqlClient) {
    super(sql);
  }

  get executor(): SqlExecutor {
    return this.sql;
  }

  withFundsLock<T>(work: (store: PlatformFinanceStore) => Promise<T>): Promise<T> {
    return this.sql.transaction(async (tx) => {
      // Mode qui s'exclut lui-même et exclut les écritures concurrentes sur les retraits, mais
      // laisse les lectures : les engagements de fonds se suivent, sur toutes les instances.
      await tx.query('LOCK TABLE platform_payouts IN SHARE ROW EXCLUSIVE MODE');
      return work(new Store(tx));
    });
  }
}
