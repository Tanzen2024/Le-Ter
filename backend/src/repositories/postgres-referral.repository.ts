import { randomUUID } from 'node:crypto';

import {
  isPgError,
  PG_UNIQUE_VIOLATION,
  type SqlClient,
  type SqlExecutor,
} from '../database/sql-client';
import type { AuditEntry } from '../domain/admin/admin';
import {
  DEFAULT_REFERRAL_CAMPAIGN_ID,
  DEFAULT_REFERRAL_RULES,
  dueTiers,
  generateReferralCode,
  REFERRAL_CAMPAIGN_CODE,
  ReferralAttributionNotFoundError,
  ReferralCodeRejectedError,
  type ReferralCampaign,
  type ReferralCampaignStatus,
  type ReferralReviewStatus,
  type ReferralRules,
  type ReferralSource,
} from '../domain/referrals/referral';
import type { NewUser, User, UserId } from '../domain/users/user';
import { auditEntryOf, insertAuditRow, type AuditRow } from './admin-audit.repository';
import { PostgresUserRepository } from './postgres-user.repository';
import type {
  AdminRefereeDetail,
  AttentionCase,
  EvaluationResult,
  PlayerReferralSnapshot,
  QueuedEvaluation,
  ReferralAuditItem,
  ReferralOverview,
  ReferralRepository,
  ReferralRewardRecord,
  ReferrerDetail,
  ReferrerListItem,
  ReferrerListQuery,
} from './referral.repository';
import { lockWalletBalances } from './wallet-reservations';

const iso = (d: Date) => d.toISOString();
const num = (v: unknown) => Number(v ?? 0);
const date = (v: Date | string) => new Date(v);
const dateOrNull = (v: Date | string | null) => (v === null ? null : new Date(v));

/** Collisions de code (8 caractères parmi 32) : improbables, réessayées. */
const CODE_ATTEMPTS = 5;

interface CampaignRow {
  id: string;
  code: string;
  status: ReferralCampaignStatus;
  updated_at: Date;
  version: number;
  referrals_per_tier: number;
  qualification_threshold: string | number;
  reward_per_tier: string | number;
  max_tiers: number | null;
  rules_created_at: Date;
  created_by: string | null;
}

interface RuleRow {
  version: number;
  referrals_per_tier: number;
  qualification_threshold: string | number;
  reward_per_tier: string | number;
  max_tiers: number | null;
  created_at: Date;
  created_by: string | null;
}

function toRules(row: RuleRow): ReferralRules {
  return {
    version: Number(row.version),
    referralsPerTier: Number(row.referrals_per_tier),
    qualificationThreshold: num(row.qualification_threshold),
    rewardPerTier: num(row.reward_per_tier),
    maxTiers: row.max_tiers === null ? null : Number(row.max_tiers),
    createdAt: date(row.created_at),
    createdBy: (row.created_by as UserId | null) ?? null,
  };
}

function toCampaign(row: CampaignRow): ReferralCampaign {
  return {
    id: row.id,
    code: row.code,
    status: row.status,
    updatedAt: date(row.updated_at),
    rules: toRules({ ...row, created_at: row.rules_created_at }),
  };
}

/**
 * Campagne et règles en vigueur (version la plus élevée). La campagne par défaut est recréée
 * si elle manque (base neuve, tables vidées) : jamais des règles inventées, celles de D-161.
 */
async function readCampaign(tx: SqlExecutor, lock: '' | 'FOR SHARE' | 'FOR UPDATE' = '') {
  const select = async () =>
    (
      await tx.query<CampaignRow>(
        `SELECT c.id, c.code, c.status, c.updated_at, v.version, v.referrals_per_tier,
                v.qualification_threshold, v.reward_per_tier, v.max_tiers,
                v.created_at AS rules_created_at, v.created_by
         FROM referral_campaigns c
         JOIN referral_rule_versions v ON v.campaign_id = c.id
         WHERE c.id = $1
         ORDER BY v.version DESC LIMIT 1 ${lock ? `${lock} OF c` : ''}`,
        [DEFAULT_REFERRAL_CAMPAIGN_ID],
      )
    ).rows[0];
  let row = await select();
  if (!row) {
    const now = iso(new Date());
    await tx.query(
      `INSERT INTO referral_campaigns (id, code, status, created_at, updated_at)
       VALUES ($1, $2, 'ACTIVE', $3, $3) ON CONFLICT (id) DO NOTHING`,
      [DEFAULT_REFERRAL_CAMPAIGN_ID, REFERRAL_CAMPAIGN_CODE, now],
    );
    await tx.query(
      `INSERT INTO referral_rule_versions (campaign_id, version, referrals_per_tier,
         qualification_threshold, reward_per_tier, max_tiers, created_at)
       VALUES ($1, 1, $2, $3, $4, $5, $6) ON CONFLICT DO NOTHING`,
      [
        DEFAULT_REFERRAL_CAMPAIGN_ID,
        DEFAULT_REFERRAL_RULES.referralsPerTier,
        DEFAULT_REFERRAL_RULES.qualificationThreshold,
        DEFAULT_REFERRAL_RULES.rewardPerTier,
        DEFAULT_REFERRAL_RULES.maxTiers,
        now,
      ],
    );
    row = await select();
  }
  return toCampaign(row!);
}

interface RewardRow {
  id: string;
  tier: number;
  amount: string | number;
  rules_version: number;
  referrals_required: number;
  wallet_transaction_id: string;
  idempotency_key: string;
  counted_referee_ids: string[];
  credited_at: Date;
}

const toReward = (r: RewardRow): ReferralRewardRecord => ({
  id: r.id,
  tier: Number(r.tier),
  amount: num(r.amount),
  rulesVersion: Number(r.rules_version),
  referralsRequired: Number(r.referrals_required),
  walletTransactionId: r.wallet_transaction_id,
  idempotencyKey: r.idempotency_key,
  countedRefereeIds: r.counted_referee_ids ?? [],
  creditedAt: date(r.credited_at),
});

async function readRewards(tx: SqlExecutor, campaignId: string, referrerId: string) {
  const { rows } = await tx.query<RewardRow>(
    `SELECT id, tier, amount, rules_version, referrals_required, wallet_transaction_id,
            idempotency_key, counted_referee_ids, credited_at
     FROM referral_rewards WHERE campaign_id = $1 AND referrer_id = $2 ORDER BY tier`,
    [campaignId, referrerId],
  );
  return rows.map(toReward);
}

interface RefereeRow {
  id: string;
  referee_id: string;
  username: string;
  player_number: string | number;
  referee_status: string;
  referral_code: string;
  source: ReferralSource;
  attributed_at: Date;
  qualified_at: Date | null;
  qualification_rules_version: number | null;
  qualification_total: string | number | null;
  review_status: ReferralReviewStatus;
  review_reason: string | null;
  reviewed_at: Date | null;
  /** Somme des achats CONFIRMÉS (`deposit` réglé `succeeded`) du compte du filleul. */
  confirmed: string | number;
}

/** Achats confirmés : la seule source du cumul (aucun montant client, aucun paiement en attente). */
const CONFIRMED_DEPOSITS = `COALESCE((SELECT sum(t.tokens) FROM wallet_transactions t
   WHERE t.user_id = a.referee_id AND t.kind = 'deposit' AND t.status = 'succeeded'), 0)`;

async function readReferees(
  tx: SqlExecutor,
  campaignId: string,
  referrerId: string,
): Promise<RefereeRow[]> {
  const { rows } = await tx.query<RefereeRow>(
    `SELECT a.id, a.referee_id, u.username, u.player_number, u.status AS referee_status,
            a.referral_code, a.source, a.attributed_at, a.qualified_at,
            a.qualification_rules_version, a.qualification_total, a.review_status,
            a.review_reason, a.reviewed_at, ${CONFIRMED_DEPOSITS} AS confirmed
     FROM referral_attributions a JOIN users u ON u.id = a.referee_id
     WHERE a.campaign_id = $1 AND a.referrer_id = $2
     ORDER BY a.attributed_at, a.id`,
    [campaignId, referrerId],
  );
  return rows;
}

/** Compté dans les paliers : qualifié, non écarté par un contrôle, compte du filleul actif. */
const isCounted = (r: Pick<RefereeRow, 'qualified_at' | 'review_status' | 'referee_status'>) =>
  r.qualified_at !== null &&
  (r.review_status === 'NONE' || r.review_status === 'CLEARED') &&
  r.referee_status === 'active';

/** SQL équivalent de `isCounted`, sur l'alias `a` (attribution) et `u` (filleul). */
const COUNTED_SQL = `a.qualified_at IS NOT NULL AND a.review_status IN ('NONE', 'CLEARED')
  AND u.status = 'active'`;

async function enqueue(tx: SqlExecutor, referrerIds: 'ALL' | readonly string[], now: Date) {
  const source =
    referrerIds === 'ALL'
      ? `SELECT DISTINCT referrer_id FROM referral_attributions WHERE campaign_id = $2`
      : `SELECT unnest($2::uuid[])`;
  await tx.query(
    `INSERT INTO referral_evaluation_queue (referrer_id, seq, enqueued_at)
     SELECT r, nextval('referral_evaluation_seq'), $1 FROM (${source}) AS s(r)
     ON CONFLICT (referrer_id) DO UPDATE
       SET seq = EXCLUDED.seq, enqueued_at = EXCLUDED.enqueued_at,
           attempts = 0, last_error = NULL, last_attempt_at = NULL`,
    [iso(now), referrerIds === 'ALL' ? DEFAULT_REFERRAL_CAMPAIGN_ID : [...referrerIds]],
  );
}

export class PostgresReferralRepository implements ReferralRepository {
  /**
   * `rewardsEnabled` (D-169, `REFERRAL_REWARDS_ENABLED`) : faux = paliers dus retenus comme pour
   * une campagne suspendue, mais attributions et qualifications continuent ; crédités dès
   * l'activation. Vrai par défaut ICI : le défaut prudent est posé par la configuration.
   */
  constructor(
    private readonly db: SqlClient,
    private readonly options: { rewardsEnabled?: boolean } = {},
  ) {}

  getCampaign(): Promise<ReferralCampaign> {
    return readCampaign(this.db);
  }

  async ensureCode(userId: UserId, now: Date): Promise<string | null> {
    const existing = await this.db.query<{ code: string }>(
      'SELECT code FROM referral_codes WHERE user_id = $1',
      [userId],
    );
    if (existing.rows[0]) return existing.rows[0].code;
    const eligible = await this.db.query<{ ok: boolean }>(
      `SELECT (role = 'user' AND status = 'active') AS ok FROM users WHERE id = $1`,
      [userId],
    );
    if (!eligible.rows[0]?.ok) return null;
    for (let attempt = 0; attempt < CODE_ATTEMPTS; attempt += 1) {
      try {
        // Deux premières lectures simultanées : une seule ligne (clé primaire user_id), le
        // code déjà enregistré l'emporte (jamais modifié).
        const { rows } = await this.db.query<{ code: string }>(
          `INSERT INTO referral_codes (user_id, code, created_at) VALUES ($1, $2, $3)
           ON CONFLICT (user_id) DO NOTHING RETURNING code`,
          [userId, generateReferralCode(), iso(now)],
        );
        if (rows[0]) return rows[0].code;
        const kept = await this.db.query<{ code: string }>(
          'SELECT code FROM referral_codes WHERE user_id = $1',
          [userId],
        );
        return kept.rows[0]!.code;
      } catch (err) {
        // Code déjà attribué à un autre joueur : nouveau tirage.
        if (!isPgError(err, PG_UNIQUE_VIOLATION)) throw err;
      }
    }
    throw new Error('Impossible de générer un code de parrainage unique');
  }

  async checkCode(code: string): Promise<'OK' | 'UNKNOWN_CODE' | 'CAMPAIGN_SUSPENDED'> {
    const campaign = await readCampaign(this.db);
    const { rows } = await this.db.query<{ ok: boolean }>(
      `SELECT (u.role = 'user' AND u.status = 'active') AS ok
       FROM referral_codes c JOIN users u ON u.id = c.user_id WHERE c.code = $1`,
      [code],
    );
    if (!rows[0]?.ok) return 'UNKNOWN_CODE';
    return campaign.status === 'ACTIVE' ? 'OK' : 'CAMPAIGN_SUSPENDED';
  }

  createAccountWithAttribution(
    user: NewUser,
    attribution: { code: string; source: ReferralSource; attributionId: string },
  ): Promise<User> {
    return this.db.transaction(async (tx) => {
      // Le code et son parrain sont relus SOUS VERROU : ni suspension ni désactivation
      // concurrente ne laisse passer une attribution refusée.
      const campaign = await readCampaign(tx, 'FOR SHARE');
      const { rows } = await tx.query<{ user_id: string; ok: boolean }>(
        `SELECT c.user_id, (u.role = 'user' AND u.status = 'active') AS ok
         FROM referral_codes c JOIN users u ON u.id = c.user_id
         WHERE c.code = $1 FOR SHARE OF c, u`,
        [attribution.code],
      );
      const referrer = rows[0];
      if (!referrer?.ok) throw new ReferralCodeRejectedError('UNKNOWN_CODE');
      if (campaign.status !== 'ACTIVE') throw new ReferralCodeRejectedError('CAMPAIGN_SUSPENDED');
      const created = await new PostgresUserRepository(tx).insert(user);
      // Même instant que la création du compte : vérifié en base (aucun compte existant).
      await tx.query(
        `INSERT INTO referral_attributions (id, campaign_id, referrer_id, referee_id,
           referral_code, source, attributed_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [
          attribution.attributionId,
          campaign.id,
          referrer.user_id,
          created.id,
          attribution.code,
          attribution.source,
          iso(user.createdAt),
        ],
      );
      return created;
    });
  }

  async playerSnapshot(userId: UserId): Promise<PlayerReferralSnapshot | null> {
    const code = await this.db.query<{ code: string }>(
      'SELECT code FROM referral_codes WHERE user_id = $1',
      [userId],
    );
    if (!code.rows[0]) return null;
    const campaign = await readCampaign(this.db);
    const [referees, rewards, queued] = await Promise.all([
      readReferees(this.db, campaign.id, userId),
      readRewards(this.db, campaign.id, userId),
      this.isQueued(userId),
    ]);
    return {
      campaign,
      code: code.rows[0].code,
      referees: referees.map((r) => ({
        id: r.id,
        username: r.username,
        attributedAt: date(r.attributed_at),
        // Plafonnée au seuil : le montant acheté au-delà n'est jamais révélé au parrain.
        progress:
          r.qualified_at !== null
            ? campaign.rules.qualificationThreshold
            : Math.min(num(r.confirmed), campaign.rules.qualificationThreshold),
        qualifiedAt: dateOrNull(r.qualified_at),
        counted: isCounted(r),
        reviewStatus: r.review_status,
        refereeActive: r.referee_status === 'active',
      })),
      rewards,
      evaluationPending: queued,
    };
  }

  evaluate(referrerId: UserId, now: Date, seq?: string): Promise<EvaluationResult> {
    return this.db.transaction(async (tx) => {
      // Sérialise TOUTES les évaluations d'un parrain (instances, file, lecture du joueur).
      const owner = await tx.query<{ status: string }>(
        `SELECT u.status FROM referral_codes c JOIN users u ON u.id = c.user_id
         WHERE c.user_id = $1 FOR UPDATE OF c`,
        [referrerId],
      );
      const result: EvaluationResult = { qualified: 0, credited: [], withheld: 0 };
      if (owner.rows[0]) {
        // Règles relues sous verrou partagé : un changement de règles attend la fin.
        const campaign = await readCampaign(tx, 'FOR SHARE');
        const { rules } = campaign;
        const referees = await readReferees(tx, campaign.id, referrerId);
        for (const r of referees) {
          if (r.qualified_at === null && num(r.confirmed) >= rules.qualificationThreshold) {
            await tx.query(
              `UPDATE referral_attributions
               SET qualified_at = $2, qualification_rules_version = $3, qualification_total = $4
               WHERE id = $1 AND qualified_at IS NULL`,
              [r.id, iso(now), rules.version, num(r.confirmed)],
            );
            r.qualified_at = now;
            result.qualified += 1;
          }
        }
        const counted = referees.filter(isCounted);
        const rewards = await readRewards(tx, campaign.id, referrerId);
        const due = dueTiers(rules, rewards, counted.length);
        const rewardsEnabled = this.options.rewardsEnabled ?? true;
        if (!rewardsEnabled || campaign.status !== 'ACTIVE' || owner.rows[0].status !== 'active') {
          result.withheld = due.length;
        } else {
          for (const tier of due) {
            const rewardId = await this.creditTier(tx, {
              campaignId: campaign.id,
              referrerId,
              tier: tier.tier,
              referralsRequired: tier.referralsRequired,
              amount: tier.amount,
              rulesVersion: rules.version,
              countedRefereeIds: counted.map((r) => r.referee_id),
              now,
            });
            result.credited.push({ tier: tier.tier, amount: tier.amount, rewardId });
          }
        }
      }
      if (seq !== undefined) {
        // Renouvelée pendant l'évaluation (nouvel achat) : la demande reste dans la file.
        await tx.query('DELETE FROM referral_evaluation_queue WHERE referrer_id = $1 AND seq = $2', [
          referrerId,
          seq,
        ]);
      }
      return result;
    });
  }

  /**
   * Crédit d'UN palier, dans la transaction de l'évaluation : écriture du registre, solde,
   * récompense et notification ensemble. Clé unique par palier (`wallet_transactions` et
   * `referral_rewards`) : un second crédit est impossible, même sans le verrou.
   */
  private async creditTier(
    tx: SqlExecutor,
    t: {
      campaignId: string;
      referrerId: UserId;
      tier: number;
      referralsRequired: number;
      amount: number;
      rulesVersion: number;
      countedRefereeIds: string[];
      now: Date;
    },
  ): Promise<string> {
    const rewardId = randomUUID();
    const transactionId = randomUUID();
    // Parrain dans la clé : `referral_rewards.idempotency_key` est unique sur toute la table.
    const key = `referral-reward:${t.campaignId}:${t.referrerId}:${t.tier}`;
    await lockWalletBalances(tx, t.referrerId, t.now);
    await tx.query(
      `INSERT INTO wallet_transactions (id, user_id, kind, status, tokens, idempotency_key,
         created_at, updated_at, completed_at)
       VALUES ($1, $2, 'referral_reward', 'succeeded', $3, $4, $5, $5, $5)`,
      [transactionId, t.referrerId, t.amount, key, iso(t.now)],
    );
    await tx.query('UPDATE wallets SET balance = balance + $2, updated_at = $3 WHERE user_id = $1', [
      t.referrerId,
      t.amount,
      iso(t.now),
    ]);
    await tx.query(
      `INSERT INTO referral_rewards (id, campaign_id, referrer_id, tier, rules_version,
         referrals_required, amount, status, wallet_transaction_id, idempotency_key,
         counted_referee_ids, credited_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, 'CREDITED', $8, $9, $10::uuid[], $11)`,
      [
        rewardId,
        t.campaignId,
        t.referrerId,
        t.tier,
        t.rulesVersion,
        t.referralsRequired,
        t.amount,
        transactionId,
        key,
        t.countedRefereeIds,
        iso(t.now),
      ],
    );
    await tx.query(
      `INSERT INTO notifications (id, user_id, type, payload, dedupe_key, created_at)
       VALUES ($1, $2, 'REFERRAL_REWARD_CREDITED', $3::jsonb, $4, $5)
       ON CONFLICT (user_id, dedupe_key) DO NOTHING`,
      [
        randomUUID(),
        t.referrerId,
        JSON.stringify({ amount: t.amount, tier: t.tier }),
        `referral-reward:${rewardId}`,
        iso(t.now),
      ],
    );
    return rewardId;
  }

  async queued(limit: number, retryBefore: Date): Promise<QueuedEvaluation[]> {
    const { rows } = await this.db.query<{ referrer_id: string; seq: string }>(
      `SELECT referrer_id, seq::text AS seq FROM referral_evaluation_queue
       WHERE last_attempt_at IS NULL OR last_attempt_at <= $2
       ORDER BY enqueued_at, seq LIMIT $1`,
      [limit, iso(retryBefore)],
    );
    return rows.map((r) => ({ referrerId: r.referrer_id as UserId, seq: r.seq }));
  }

  async recordFailure(referrerId: UserId, seq: string, error: string, now: Date): Promise<void> {
    await this.db.query(
      `UPDATE referral_evaluation_queue
       SET attempts = attempts + 1, last_error = $3, last_attempt_at = $4
       WHERE referrer_id = $1 AND seq = $2`,
      [referrerId, seq, error.slice(0, 500), iso(now)],
    );
  }

  async isQueued(referrerId: UserId): Promise<boolean> {
    const { rows } = await this.db.query(
      'SELECT 1 FROM referral_evaluation_queue WHERE referrer_id = $1',
      [referrerId],
    );
    return rows.length > 0;
  }

  // --- Administration ----------------------------------------------------------------------------

  async overview(): Promise<ReferralOverview> {
    const campaign = await readCampaign(this.db);
    const { rows } = await this.db.query<Record<string, string | number>>(
      `SELECT
         (SELECT count(*) FROM referral_codes c JOIN users u ON u.id = c.user_id
           WHERE u.status = 'active') AS active_codes,
         (SELECT count(DISTINCT referrer_id) FROM referral_attributions
           WHERE campaign_id = $1) AS referrers,
         (SELECT count(*) FROM referral_attributions WHERE campaign_id = $1) AS attributed,
         (SELECT count(*) FROM referral_attributions
           WHERE campaign_id = $1 AND qualified_at IS NOT NULL) AS qualified,
         (SELECT count(*) FROM referral_attributions a JOIN users u ON u.id = a.referee_id
           WHERE a.campaign_id = $1 AND ${COUNTED_SQL}) AS counted,
         (SELECT count(*) FROM referral_rewards WHERE campaign_id = $1) AS rewards,
         (SELECT COALESCE(sum(amount), 0) FROM referral_rewards WHERE campaign_id = $1) AS tokens,
         (SELECT count(*) FROM referral_evaluation_queue) AS queue_pending,
         (SELECT count(*) FROM referral_evaluation_queue WHERE last_error IS NOT NULL) AS queue_failing,
         (SELECT count(*) FROM referral_attributions
           WHERE campaign_id = $1 AND review_status = 'FLAGGED') AS flagged,
         (SELECT count(*) FROM referral_attributions a JOIN users u ON u.id = a.referee_id
           WHERE a.campaign_id = $1 AND u.status <> 'active') AS disabled_referees`,
      [campaign.id],
    );
    const r = rows[0]!;
    const withheld = await this.withheldReferrers(this.db, campaign, 1_000_000);
    return {
      campaign,
      activeCodes: num(r.active_codes),
      referrers: num(r.referrers),
      attributed: num(r.attributed),
      qualified: num(r.qualified),
      counted: num(r.counted),
      rewardsCredited: num(r.rewards),
      tokensDistributed: num(r.tokens),
      referrersWithWithheldTiers: withheld.length,
      queue: { pending: num(r.queue_pending), failing: num(r.queue_failing) },
      flaggedAttributions: num(r.flagged),
      disabledReferees: num(r.disabled_referees),
    };
  }

  /** Parrains dont le prochain palier est atteint mais pas crédité (règles en vigueur). */
  private async withheldReferrers(db: SqlExecutor, campaign: ReferralCampaign, limit: number) {
    const { rows } = await db.query<{ referrer_id: string; username: string; since: Date }>(
      `WITH counted AS (
         SELECT a.referrer_id, count(*) AS n, max(a.qualified_at) AS since
         FROM referral_attributions a JOIN users u ON u.id = a.referee_id
         WHERE a.campaign_id = $1 AND ${COUNTED_SQL}
         GROUP BY a.referrer_id),
       last AS (
         SELECT referrer_id, max(referrals_required) AS required, max(tier) AS tier
         FROM referral_rewards WHERE campaign_id = $1 GROUP BY referrer_id)
       SELECT c.referrer_id, u.username, c.since
       FROM counted c LEFT JOIN last l USING (referrer_id) JOIN users u ON u.id = c.referrer_id
       WHERE c.n >= COALESCE(l.required, 0) + $2
         AND ($3::int IS NULL OR COALESCE(l.tier, 0) < $3)
       ORDER BY c.since LIMIT $4`,
      [campaign.id, campaign.rules.referralsPerTier, campaign.rules.maxTiers, limit],
    );
    return rows;
  }

  async listReferrers(query: ReferrerListQuery) {
    const campaign = await readCampaign(this.db);
    const params: unknown[] = [campaign.id];
    let filter = '';
    if (query.q) {
      params.push(`%${query.q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`, query.q.toUpperCase());
      filter = `AND (u.username ILIKE $2 OR c.code = $3)`;
    }
    const base = `FROM referral_codes c JOIN users u ON u.id = c.user_id
      WHERE EXISTS (SELECT 1 FROM referral_attributions x
                    WHERE x.referrer_id = c.user_id AND x.campaign_id = $1) ${filter}`;
    const count = await this.db.query<{ n: number }>(`SELECT count(*)::int AS n ${base}`, params);
    params.push(query.limit, (query.page - 1) * query.limit);
    const { rows } = await this.db.query<Record<string, unknown>>(
      `SELECT c.user_id, u.username, u.player_number, c.code,
         (SELECT count(*) FROM referral_attributions a
           WHERE a.referrer_id = c.user_id AND a.campaign_id = $1) AS attributed,
         (SELECT count(*) FROM referral_attributions a
           WHERE a.referrer_id = c.user_id AND a.campaign_id = $1
             AND a.qualified_at IS NOT NULL) AS qualified,
         (SELECT count(*) FROM referral_attributions a JOIN users u ON u.id = a.referee_id
           WHERE a.referrer_id = c.user_id AND a.campaign_id = $1 AND ${COUNTED_SQL}) AS counted,
         (SELECT count(*) FROM referral_rewards r
           WHERE r.referrer_id = c.user_id AND r.campaign_id = $1) AS tiers,
         (SELECT COALESCE(sum(amount), 0) FROM referral_rewards r
           WHERE r.referrer_id = c.user_id AND r.campaign_id = $1) AS tokens,
         (SELECT max(attributed_at) FROM referral_attributions a
           WHERE a.referrer_id = c.user_id AND a.campaign_id = $1) AS last_attribution_at
       ${base}
       ORDER BY last_attribution_at DESC NULLS LAST, c.user_id
       LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params,
    );
    const items: ReferrerListItem[] = rows.map((r) => ({
      userId: r.user_id as string,
      username: r.username as string,
      playerNumber: num(r.player_number),
      code: r.code as string,
      attributed: num(r.attributed),
      qualified: num(r.qualified),
      counted: num(r.counted),
      tiers: num(r.tiers),
      tokensCredited: num(r.tokens),
      lastAttributionAt: r.last_attribution_at ? date(r.last_attribution_at as Date) : null,
    }));
    return { total: count.rows[0]?.n ?? 0, items };
  }

  async referrerDetail(userId: UserId): Promise<ReferrerDetail | null> {
    const owner = await this.db.query<{
      id: string;
      username: string;
      player_number: string;
      status: string;
      created_at: Date;
      code: string;
      code_created_at: Date;
    }>(
      `SELECT u.id, u.username, u.player_number, u.status, u.created_at, c.code,
              c.created_at AS code_created_at
       FROM referral_codes c JOIN users u ON u.id = c.user_id WHERE c.user_id = $1`,
      [userId],
    );
    const o = owner.rows[0];
    if (!o) return null;
    const campaign = await readCampaign(this.db);
    const [referees, rewards, queue] = await Promise.all([
      readReferees(this.db, campaign.id, userId),
      readRewards(this.db, campaign.id, userId),
      this.db.query<{ seq: string; enqueued_at: Date; attempts: number; last_error: string | null }>(
        `SELECT seq::text AS seq, enqueued_at, attempts, last_error
         FROM referral_evaluation_queue WHERE referrer_id = $1`,
        [userId],
      ),
    ]);
    const deposits = await this.db.query<{
      user_id: string;
      id: string;
      tokens: string | number;
      completed_at: Date | null;
    }>(
      `SELECT user_id, id, tokens, completed_at FROM wallet_transactions
       WHERE user_id = ANY($1::uuid[]) AND kind = 'deposit' AND status = 'succeeded'
       ORDER BY completed_at, id`,
      [referees.map((r) => r.referee_id)],
    );
    const q = queue.rows[0];
    return {
      user: {
        id: o.id,
        username: o.username,
        playerNumber: num(o.player_number),
        status: o.status,
        createdAt: date(o.created_at),
      },
      code: o.code,
      codeCreatedAt: date(o.code_created_at),
      referees: referees.map(
        (r): AdminRefereeDetail => ({
          attributionId: r.id,
          refereeId: r.referee_id,
          username: r.username,
          playerNumber: num(r.player_number),
          refereeStatus: r.referee_status,
          source: r.source,
          referralCode: r.referral_code,
          attributedAt: date(r.attributed_at),
          confirmedDeposits: num(r.confirmed),
          deposits: deposits.rows
            .filter((d) => d.user_id === r.referee_id)
            .map((d) => ({
              walletTransactionId: d.id,
              tokens: num(d.tokens),
              completedAt: dateOrNull(d.completed_at),
            })),
          qualifiedAt: dateOrNull(r.qualified_at),
          qualificationRulesVersion:
            r.qualification_rules_version === null ? null : Number(r.qualification_rules_version),
          qualificationTotal: r.qualification_total === null ? null : num(r.qualification_total),
          counted: isCounted(r),
          reviewStatus: r.review_status,
          reviewReason: r.review_reason,
          reviewedAt: dateOrNull(r.reviewed_at),
        }),
      ),
      rewards,
      queue: q
        ? {
            seq: q.seq,
            enqueuedAt: date(q.enqueued_at),
            attempts: Number(q.attempts),
            lastError: q.last_error,
          }
        : null,
    };
  }

  async ruleVersions(): Promise<ReferralRules[]> {
    await readCampaign(this.db);
    const { rows } = await this.db.query<RuleRow>(
      `SELECT version, referrals_per_tier, qualification_threshold, reward_per_tier, max_tiers,
              created_at, created_by
       FROM referral_rule_versions WHERE campaign_id = $1 ORDER BY version DESC`,
      [DEFAULT_REFERRAL_CAMPAIGN_ID],
    );
    return rows.map(toRules);
  }

  async auditLog(limit: number, referrerId?: UserId): Promise<ReferralAuditItem[]> {
    const params: unknown[] = [limit];
    let filter = '';
    if (referrerId) {
      params.push(referrerId);
      filter = `AND (a.target_id = $2 OR a.details ->> 'referrerId' = $2::text)`;
    }
    const { rows } = await this.db.query<AuditRow & { actor_username: string | null }>(
      `SELECT a.id, a.actor_id, a.action, a.target_type, a.target_id, a.outcome, a.details,
              a.created_at, u.username AS actor_username
       FROM admin_audit_log a LEFT JOIN users u ON u.id = a.actor_id
       WHERE a.action LIKE 'REFERRAL\\_%' ${filter}
       ORDER BY a.created_at DESC, a.id DESC LIMIT $1`,
      params,
    );
    return rows.map((row) => ({ ...auditEntryOf(row), actorUsername: row.actor_username }));
  }

  async attentionCases(limit: number): Promise<AttentionCase[]> {
    const campaign = await readCampaign(this.db);
    const flagged = await this.db.query<{
      id: string;
      referrer_id: string;
      username: string;
      reason: string | null;
      since: Date;
    }>(
      `SELECT a.id, a.referrer_id, u.username, a.review_reason AS reason, a.reviewed_at AS since
       FROM referral_attributions a JOIN users u ON u.id = a.referrer_id
       WHERE a.campaign_id = $1 AND a.review_status = 'FLAGGED'
       ORDER BY a.reviewed_at LIMIT $2`,
      [campaign.id, limit],
    );
    const failing = await this.db.query<{
      referrer_id: string;
      username: string;
      last_error: string;
      since: Date;
    }>(
      `SELECT q.referrer_id, u.username, q.last_error, q.enqueued_at AS since
       FROM referral_evaluation_queue q JOIN users u ON u.id = q.referrer_id
       WHERE q.last_error IS NOT NULL ORDER BY q.enqueued_at LIMIT $1`,
      [limit],
    );
    const disabled = await this.db.query<{
      id: string;
      referrer_id: string;
      username: string;
      since: Date;
    }>(
      `SELECT a.id, a.referrer_id, r.username, a.attributed_at AS since
       FROM referral_attributions a
       JOIN users u ON u.id = a.referee_id JOIN users r ON r.id = a.referrer_id
       WHERE a.campaign_id = $1 AND u.status <> 'active'
       ORDER BY a.attributed_at LIMIT $2`,
      [campaign.id, limit],
    );
    const withheld = await this.withheldReferrers(this.db, campaign, limit);
    const cases: AttentionCase[] = [
      ...flagged.rows.map((r) => ({
        kind: 'FLAGGED_ATTRIBUTION' as const,
        referrerId: r.referrer_id,
        referrerUsername: r.username,
        attributionId: r.id,
        ...(r.reason && { detail: r.reason }),
        since: date(r.since),
      })),
      ...failing.rows.map((r) => ({
        kind: 'EVALUATION_FAILING' as const,
        referrerId: r.referrer_id,
        referrerUsername: r.username,
        detail: r.last_error,
        since: date(r.since),
      })),
      ...withheld.map((r) => ({
        kind: 'TIER_WITHHELD' as const,
        referrerId: r.referrer_id,
        referrerUsername: r.username,
        since: date(r.since),
      })),
      ...disabled.rows.map((r) => ({
        kind: 'REFEREE_DISABLED' as const,
        referrerId: r.referrer_id,
        referrerUsername: r.username,
        attributionId: r.id,
        since: date(r.since),
      })),
    ];
    return cases.slice(0, limit);
  }

  updateRules(command: Parameters<ReferralRepository['updateRules']>[0]) {
    return this.db.transaction(async (tx) => {
      const current = await readCampaign(tx, 'FOR UPDATE');
      const next = command.rules;
      const same =
        current.rules.referralsPerTier === next.referralsPerTier &&
        current.rules.qualificationThreshold === next.qualificationThreshold &&
        current.rules.rewardPerTier === next.rewardPerTier &&
        current.rules.maxTiers === next.maxTiers;
      if (same) return { campaign: current, changed: false };
      const version = current.rules.version + 1;
      await tx.query(
        `INSERT INTO referral_rule_versions (campaign_id, version, referrals_per_tier,
           qualification_threshold, reward_per_tier, max_tiers, created_at, created_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [
          current.id,
          version,
          next.referralsPerTier,
          next.qualificationThreshold,
          next.rewardPerTier,
          next.maxTiers,
          iso(command.now),
          command.actorId,
        ],
      );
      await tx.query('UPDATE referral_campaigns SET updated_at = $2 WHERE id = $1', [
        current.id,
        iso(command.now),
      ]);
      await insertAuditRow(tx, {
        id: command.auditId,
        actorId: command.actorId,
        action: 'REFERRAL_RULES_UPDATED',
        targetType: 'REFERRAL_CAMPAIGN',
        targetId: current.id,
        outcome: 'SUCCESS',
        details: {
          reason: command.reason,
          fromVersion: current.rules.version,
          toVersion: version,
          from: rulesDetails(current.rules),
          to: rulesDetails(next),
        },
        createdAt: command.now,
      });
      // Les nouvelles règles valent pour la suite : tous les parrains sont réévalués.
      await enqueue(tx, 'ALL', command.now);
      return { campaign: await readCampaign(tx), changed: true };
    });
  }

  setStatus(command: Parameters<ReferralRepository['setStatus']>[0]) {
    return this.db.transaction(async (tx) => {
      const current = await readCampaign(tx, 'FOR UPDATE');
      if (current.status === command.status) return { campaign: current, changed: false };
      await tx.query('UPDATE referral_campaigns SET status = $2, updated_at = $3 WHERE id = $1', [
        current.id,
        command.status,
        iso(command.now),
      ]);
      await insertAuditRow(tx, {
        id: command.auditId,
        actorId: command.actorId,
        action:
          command.status === 'SUSPENDED' ? 'REFERRAL_CAMPAIGN_SUSPENDED' : 'REFERRAL_CAMPAIGN_ACTIVATED',
        targetType: 'REFERRAL_CAMPAIGN',
        targetId: current.id,
        outcome: 'SUCCESS',
        details: { reason: command.reason, from: current.status, to: command.status },
        createdAt: command.now,
      });
      // Reprise : les paliers atteints pendant la suspension sont crédités par la file.
      if (command.status === 'ACTIVE') await enqueue(tx, 'ALL', command.now);
      return { campaign: await readCampaign(tx), changed: true };
    });
  }

  reviewAttribution(command: Parameters<ReferralRepository['reviewAttribution']>[0]) {
    return this.db.transaction(async (tx) => {
      const { rows } = await tx.query<{ referrer_id: string; review_status: ReferralReviewStatus }>(
        'SELECT referrer_id, review_status FROM referral_attributions WHERE id = $1 FOR UPDATE',
        [command.attributionId],
      );
      const row = rows[0];
      if (!row) throw new ReferralAttributionNotFoundError();
      const target: ReferralReviewStatus =
        command.decision === 'FLAG' ? 'FLAGGED' : command.decision === 'CLEAR' ? 'CLEARED' : 'REJECTED';
      if (row.review_status === target) {
        return { reviewStatus: target, changed: false, referrerId: row.referrer_id };
      }
      await tx.query(
        `UPDATE referral_attributions
         SET review_status = $2, review_reason = $3, reviewed_at = $4, reviewed_by = $5
         WHERE id = $1`,
        [command.attributionId, target, command.reason, iso(command.now), command.actorId],
      );
      await insertAuditRow(tx, {
        id: command.auditId,
        actorId: command.actorId,
        action: 'REFERRAL_ATTRIBUTION_REVIEWED',
        targetType: 'REFERRAL_ATTRIBUTION',
        targetId: command.attributionId,
        outcome: 'SUCCESS',
        details: {
          reason: command.reason,
          from: row.review_status,
          to: target,
          referrerId: row.referrer_id,
        },
        createdAt: command.now,
      });
      await enqueue(tx, [row.referrer_id], command.now);
      return { reviewStatus: target, changed: true, referrerId: row.referrer_id };
    });
  }

  enqueueWithheld(now: Date): Promise<number> {
    return this.db.transaction(async (tx) => {
      const campaign = await readCampaign(tx);
      const withheld = await this.withheldReferrers(tx, campaign, 1_000_000);
      if (withheld.length > 0) await enqueue(tx, withheld.map((r) => r.referrer_id), now);
      return withheld.length;
    });
  }

  requestReevaluation(command: Parameters<ReferralRepository['requestReevaluation']>[0]) {
    return this.db.transaction(async (tx) => {
      const exists = await tx.query('SELECT 1 FROM referral_codes WHERE user_id = $1', [
        command.referrerId,
      ]);
      if (exists.rows.length === 0) return false;
      await enqueue(tx, [command.referrerId], command.now);
      await insertAuditRow(tx, {
        id: command.auditId,
        actorId: command.actorId,
        action: 'REFERRAL_REEVALUATION_REQUESTED',
        targetType: 'USER',
        targetId: command.referrerId,
        outcome: 'SUCCESS',
        details: { referrerId: command.referrerId },
        createdAt: command.now,
      });
      return true;
    });
  }

  recordReferrerViewed(entry: AuditEntry): Promise<void> {
    return insertAuditRow(this.db, entry);
  }
}

function rulesDetails(
  r: Pick<ReferralRules, 'referralsPerTier' | 'qualificationThreshold' | 'rewardPerTier' | 'maxTiers'>,
) {
  return {
    referralsPerTier: r.referralsPerTier,
    qualificationThreshold: r.qualificationThreshold,
    rewardPerTier: r.rewardPerTier,
    maxTiers: r.maxTiers,
  };
}
