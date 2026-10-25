import { randomUUID } from 'node:crypto';

import {
  dueTiers,
  nextTierProgress,
  ReferralNotEligibleError,
  ReferralReferrerNotFoundError,
  type ReferralCampaign,
  type ReferralCampaignStatus,
  type ReferralRules,
} from '../../domain/referrals/referral';
import type { UserId } from '../../domain/users/user';
import type {
  ReferralRepository,
  ReferrerListQuery,
  ReviewDecision,
} from '../../repositories/referral.repository';
import type { Logger } from '../../utils/logger';

export interface ReferralServiceDependencies {
  repository: ReferralRepository;
  logger: Logger;
  clock?: () => Date;
  /** Page officielle de téléchargement (REFERRAL_DOWNLOAD_URL) ; absente : aucun lien inventé. */
  downloadUrl?: string;
  /** Schéma de l'application (app.json `scheme`) : lien direct vers l'inscription. */
  appScheme?: string;
  tickMs?: number;
  /** Demandes traitées par tour de file. */
  batchSize?: number;
  /** Délai avant de retenter une évaluation en échec. */
  retryDelayMs?: number;
}

export type RefereeStatus = 'IN_PROGRESS' | 'QUALIFIED' | 'UNDER_REVIEW' | 'NOT_COUNTED';

const DEFAULT_TICK_MS = 15_000;
const DEFAULT_BATCH = 20;
const DEFAULT_RETRY_MS = 60_000;

const rulesView = (r: ReferralRules) => ({
  version: r.version,
  referralsPerTier: r.referralsPerTier,
  qualificationThreshold: r.qualificationThreshold,
  rewardPerTier: r.rewardPerTier,
  maxTiers: r.maxTiers,
});

const campaignView = (c: ReferralCampaign) => ({
  status: c.status,
  rules: rulesView(c.rules),
  updatedAt: c.updatedAt.toISOString(),
});

/**
 * Parrainage (D-161). Qualification et crédit sont décidés ICI, côté serveur, à partir du
 * registre du compte de jeu : aucun montant, aucun statut de filleul et aucun palier ne vient
 * du client. Le traitement est piloté par une file durable alimentée par la base (achat
 * confirmé d'un filleul) : il reprend seul après un redémarrage.
 */
export class ReferralService {
  private readonly clock: () => Date;
  private handle?: NodeJS.Timeout;
  private running = false;

  constructor(private readonly deps: ReferralServiceDependencies) {
    this.clock = deps.clock ?? (() => new Date());
  }

  /** Liens partagés par le parrain ; le code est le seul paramètre (aucun identifiant interne). */
  links(code: string): { invite: string | null; app: string } {
    const app = `${this.deps.appScheme ?? 'leter'}://register?ref=${encodeURIComponent(code)}`;
    if (!this.deps.downloadUrl) return { invite: null, app };
    const url = new URL(this.deps.downloadUrl);
    url.searchParams.set('ref', code);
    return { invite: url.toString(), app };
  }

  /** Section Parrainage d'« Assistance » : tout vient d'ici, rien n'est calculé par l'app. */
  async myProgram(userId: UserId) {
    const code = await this.deps.repository.ensureCode(userId, this.clock());
    if (!code) throw new ReferralNotEligibleError();
    // Achat confirmé encore en file : traité avant la lecture (valeurs à jour).
    if (await this.deps.repository.isQueued(userId)) {
      await this.evaluateQuietly(userId);
    }
    const snapshot = await this.deps.repository.playerSnapshot(userId);
    if (!snapshot) throw new ReferralNotEligibleError();
    const { campaign, referees, rewards } = snapshot;
    const counted = referees.filter((r) => r.counted).length;
    const status = (r: (typeof referees)[number]): RefereeStatus => {
      if (r.reviewStatus === 'FLAGGED') return 'UNDER_REVIEW';
      if (r.qualifiedAt && r.counted) return 'QUALIFIED';
      if (r.qualifiedAt || r.reviewStatus === 'REJECTED' || !r.refereeActive) return 'NOT_COUNTED';
      return 'IN_PROGRESS';
    };
    return {
      campaign: campaignView(campaign),
      code,
      links: this.links(code),
      summary: {
        attributed: referees.length,
        qualified: referees.filter((r) => r.qualifiedAt !== null).length,
        counted,
        tiersReached: rewards.length,
        tokensCredited: rewards.reduce((sum, r) => sum + r.amount, 0),
      },
      nextTier: nextTierProgress(campaign.rules, rewards, counted),
      /** Paliers atteints non crédités (campagne suspendue) : crédités à la reprise. */
      withheldTiers: dueTiers(campaign.rules, rewards, counted).length,
      evaluationPending: snapshot.evaluationPending,
      referees: referees.map((r) => ({
        id: r.id,
        username: r.username,
        attributedAt: r.attributedAt.toISOString(),
        progress: r.progress,
        threshold: campaign.rules.qualificationThreshold,
        status: status(r),
        qualifiedAt: r.qualifiedAt?.toISOString() ?? null,
      })),
      rewards: rewards.map((r) => ({
        tier: r.tier,
        amount: r.amount,
        creditedAt: r.creditedAt.toISOString(),
      })),
    };
  }

  // --- File d'évaluation ------------------------------------------------------------------------

  start(): void {
    if (this.handle) return;
    // Reprise immédiate après un redémarrage : la file est relue dans PostgreSQL.
    void this.processQueue();
    this.handle = setInterval(() => void this.processQueue(), this.deps.tickMs ?? DEFAULT_TICK_MS);
    this.handle.unref();
  }

  stop(): void {
    if (this.handle) clearInterval(this.handle);
    this.handle = undefined;
  }

  /** Un tour de file ; jamais deux à la fois sur cette instance (les autres sont sérialisées en base). */
  async processQueue(): Promise<{ evaluated: number; failed: number; credited: number }> {
    const report = { evaluated: 0, failed: 0, credited: 0 };
    if (this.running) return report;
    this.running = true;
    try {
      const now = this.clock();
      const retryBefore = new Date(now.getTime() - (this.deps.retryDelayMs ?? DEFAULT_RETRY_MS));
      const batch = await this.deps.repository.queued(this.deps.batchSize ?? DEFAULT_BATCH, retryBefore);
      for (const item of batch) {
        try {
          const result = await this.deps.repository.evaluate(item.referrerId, this.clock(), item.seq);
          report.evaluated += 1;
          report.credited += result.credited.length;
          this.logResult(item.referrerId, result);
        } catch (err) {
          report.failed += 1;
          const message = err instanceof Error ? err.message : String(err);
          this.deps.logger.error('referral evaluation failed', {
            action: 'REFERRAL_EVALUATE',
            referrerId: item.referrerId,
            error: message,
          });
          await this.deps.repository
            .recordFailure(item.referrerId, item.seq, message, this.clock())
            .catch(() => undefined);
        }
      }
    } catch (err) {
      this.deps.logger.error('referral queue unavailable', {
        action: 'REFERRAL_EVALUATE',
        error: err instanceof Error ? err.message : String(err),
      });
    } finally {
      this.running = false;
    }
    return report;
  }

  private async evaluateQuietly(userId: UserId): Promise<void> {
    try {
      this.logResult(userId, await this.deps.repository.evaluate(userId, this.clock()));
    } catch (err) {
      // La file reste en place : le tour suivant réessaiera.
      this.deps.logger.warn('referral inline evaluation failed', {
        action: 'REFERRAL_EVALUATE',
        referrerId: userId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  private logResult(referrerId: string, result: Awaited<ReturnType<ReferralRepository['evaluate']>>) {
    for (const credit of result.credited) {
      this.deps.logger.info('referral reward credited', {
        action: 'REFERRAL_REWARD',
        referrerId,
        tier: credit.tier,
        amount: credit.amount,
        rewardId: credit.rewardId,
      });
    }
    if (result.withheld > 0) {
      this.deps.logger.info('referral reward withheld', {
        action: 'REFERRAL_REWARD',
        referrerId,
        withheld: result.withheld,
      });
    }
  }

  // --- Administration ---------------------------------------------------------------------------

  async adminOverview() {
    const [overview, cases] = await Promise.all([
      this.deps.repository.overview(),
      this.deps.repository.attentionCases(50),
    ]);
    return {
      ...overview,
      campaign: campaignView(overview.campaign),
      attention: cases.map((c) => ({ ...c, since: c.since.toISOString() })),
    };
  }

  listReferrers(query: ReferrerListQuery) {
    return this.deps.repository.listReferrers(query);
  }

  async referrerDetail(referrerId: UserId, actorId: UserId) {
    const [detail, campaign, history] = await Promise.all([
      this.deps.repository.referrerDetail(referrerId),
      this.deps.repository.getCampaign(),
      this.deps.repository.auditLog(100, referrerId),
    ]);
    if (!detail) throw new ReferralReferrerNotFoundError();
    await this.deps.repository.recordReferrerViewed({
      id: randomUUID(),
      actorId,
      action: 'REFERRAL_REFERRER_VIEWED',
      targetType: 'USER',
      targetId: referrerId,
      outcome: 'SUCCESS',
      details: { referrerId },
      createdAt: this.clock(),
    });
    const counted = detail.referees.filter((r) => r.counted).length;
    return {
      ...detail,
      campaign: campaignView(campaign),
      nextTier: nextTierProgress(campaign.rules, detail.rewards, counted),
      withheldTiers: dueTiers(campaign.rules, detail.rewards, counted).length,
      history,
    };
  }

  async campaignSettings() {
    const [campaign, versions, history] = await Promise.all([
      this.deps.repository.getCampaign(),
      this.deps.repository.ruleVersions(),
      this.deps.repository.auditLog(50),
    ]);
    return { campaign: campaignView(campaign), versions, history };
  }

  async updateRules(
    actorId: UserId,
    input: {
      rules: Pick<
        ReferralRules,
        'referralsPerTier' | 'qualificationThreshold' | 'rewardPerTier' | 'maxTiers'
      >;
      reason: string;
    },
  ) {
    const { campaign, changed } = await this.deps.repository.updateRules({
      ...input,
      actorId,
      auditId: randomUUID(),
      now: this.clock(),
    });
    this.deps.logger.info('referral rules update', { actorId, changed, version: campaign.rules.version });
    return { campaign: campaignView(campaign), changed };
  }

  async setStatus(actorId: UserId, input: { status: ReferralCampaignStatus; reason: string }) {
    const { campaign, changed } = await this.deps.repository.setStatus({
      ...input,
      actorId,
      auditId: randomUUID(),
      now: this.clock(),
    });
    this.deps.logger.info('referral campaign status', { actorId, changed, status: campaign.status });
    return { campaign: campaignView(campaign), changed };
  }

  reviewAttribution(
    actorId: UserId,
    attributionId: string,
    input: { decision: ReviewDecision; reason: string },
  ) {
    return this.deps.repository.reviewAttribution({
      attributionId,
      ...input,
      actorId,
      auditId: randomUUID(),
      now: this.clock(),
    });
  }

  async requestReevaluation(actorId: UserId, referrerId: UserId) {
    const queued = await this.deps.repository.requestReevaluation({
      referrerId,
      actorId,
      auditId: randomUUID(),
      now: this.clock(),
    });
    if (!queued) throw new ReferralReferrerNotFoundError();
    return { queued };
  }
}
