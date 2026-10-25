import type { AuditEntry } from '../domain/admin/admin';
import type {
  ReferralCampaign,
  ReferralCampaignStatus,
  ReferralReviewStatus,
  ReferralRules,
  ReferralSource,
} from '../domain/referrals/referral';
import type { NewUser, User, UserId } from '../domain/users/user';

/** Filleul tel que vu par son parrain : pseudo public et progression bornée au seuil. */
export interface ReferralRefereeView {
  id: string;
  username: string;
  attributedAt: Date;
  /** Achats confirmés comptés, plafonnés au seuil (le montant au-delà n'est pas révélé). */
  progress: number;
  qualifiedAt: Date | null;
  /** Compte dans les paliers (qualifié, non écarté par un contrôle, compte actif). */
  counted: boolean;
  reviewStatus: ReferralReviewStatus;
  refereeActive: boolean;
}

export interface ReferralRewardRecord {
  id: string;
  tier: number;
  amount: number;
  rulesVersion: number;
  referralsRequired: number;
  walletTransactionId: string;
  idempotencyKey: string;
  countedRefereeIds: string[];
  creditedAt: Date;
}

export interface PlayerReferralSnapshot {
  campaign: ReferralCampaign;
  code: string;
  referees: ReferralRefereeView[];
  rewards: ReferralRewardRecord[];
  /** Une évaluation est en attente pour ce parrain (achat confirmé non encore traité). */
  evaluationPending: boolean;
}

export interface EvaluationResult {
  qualified: number;
  credited: { tier: number; amount: number; rewardId: string }[];
  /** Paliers atteints mais non crédités (campagne suspendue, parrain inactif). */
  withheld: number;
}

export interface QueuedEvaluation {
  referrerId: UserId;
  seq: string;
}

// --- Administration ------------------------------------------------------------------------------

export interface ReferralOverview {
  campaign: ReferralCampaign;
  activeCodes: number;
  referrers: number;
  attributed: number;
  qualified: number;
  counted: number;
  rewardsCredited: number;
  tokensDistributed: number;
  /** Parrains dont un palier est atteint mais pas encore crédité. */
  referrersWithWithheldTiers: number;
  queue: { pending: number; failing: number };
  flaggedAttributions: number;
  disabledReferees: number;
}

export interface ReferrerListQuery {
  page: number;
  limit: number;
  q?: string;
}

export interface ReferrerListItem {
  userId: string;
  username: string;
  playerNumber: number;
  code: string;
  attributed: number;
  qualified: number;
  counted: number;
  tiers: number;
  tokensCredited: number;
  lastAttributionAt: Date | null;
}

export interface AdminRefereeDetail {
  attributionId: string;
  refereeId: string;
  username: string;
  playerNumber: number;
  refereeStatus: string;
  source: ReferralSource;
  referralCode: string;
  attributedAt: Date;
  confirmedDeposits: number;
  deposits: { walletTransactionId: string; tokens: number; completedAt: Date | null }[];
  qualifiedAt: Date | null;
  qualificationRulesVersion: number | null;
  qualificationTotal: number | null;
  counted: boolean;
  reviewStatus: ReferralReviewStatus;
  reviewReason: string | null;
  reviewedAt: Date | null;
}

export interface ReferrerDetail {
  user: { id: string; username: string; playerNumber: number; status: string; createdAt: Date };
  code: string;
  codeCreatedAt: Date;
  referees: AdminRefereeDetail[];
  rewards: ReferralRewardRecord[];
  queue: { seq: string; enqueuedAt: Date; attempts: number; lastError: string | null } | null;
}

export interface ReferralAuditItem extends AuditEntry {
  actorUsername: string | null;
}

export interface AttentionCase {
  kind: 'FLAGGED_ATTRIBUTION' | 'EVALUATION_FAILING' | 'TIER_WITHHELD' | 'REFEREE_DISABLED';
  referrerId: string;
  referrerUsername: string;
  attributionId?: string;
  detail?: string;
  since: Date;
}

export type ReviewDecision = 'FLAG' | 'CLEAR' | 'REJECT';

/**
 * Parrainage (D-161) dans PostgreSQL. Attribution, qualification et crédit sont écrits sous
 * verrou, dans une transaction ; aucune méthode ne crédite un montant fourni par l'appelant.
 */
export interface ReferralRepository {
  getCampaign(): Promise<ReferralCampaign>;
  /** Code du joueur, créé s'il n'existe pas ; null : compte non éligible (admin, inactif). */
  ensureCode(userId: UserId, now: Date): Promise<string | null>;
  checkCode(code: string): Promise<'OK' | 'UNKNOWN_CODE' | 'CAMPAIGN_SUSPENDED'>;
  /**
   * Crée le compte ET son attribution dans UNE transaction ; code refusé : rien n'est créé
   * (`ReferralCodeRejectedError`). Doublon de compte : `DuplicateUserError`.
   */
  createAccountWithAttribution(
    user: NewUser,
    attribution: { code: string; source: ReferralSource; attributionId: string },
  ): Promise<User>;
  playerSnapshot(userId: UserId): Promise<PlayerReferralSnapshot | null>;
  /**
   * Relit le registre, qualifie, crédite les paliers dus (une seule fois chacun). Avec `seq`,
   * retire la demande de la file si elle n'a pas été renouvelée entre-temps.
   */
  evaluate(referrerId: UserId, now: Date, seq?: string): Promise<EvaluationResult>;
  queued(limit: number, retryBefore: Date): Promise<QueuedEvaluation[]>;
  recordFailure(referrerId: UserId, seq: string, error: string, now: Date): Promise<void>;
  isQueued(referrerId: UserId): Promise<boolean>;

  overview(): Promise<ReferralOverview>;
  listReferrers(query: ReferrerListQuery): Promise<{ total: number; items: ReferrerListItem[] }>;
  referrerDetail(userId: UserId): Promise<ReferrerDetail | null>;
  ruleVersions(): Promise<ReferralRules[]>;
  auditLog(limit: number, referrerId?: UserId): Promise<ReferralAuditItem[]>;
  attentionCases(limit: number): Promise<AttentionCase[]>;
  updateRules(command: {
    rules: Pick<
      ReferralRules,
      'referralsPerTier' | 'qualificationThreshold' | 'rewardPerTier' | 'maxTiers'
    >;
    reason: string;
    actorId: UserId;
    auditId: string;
    now: Date;
  }): Promise<{ campaign: ReferralCampaign; changed: boolean }>;
  setStatus(command: {
    status: ReferralCampaignStatus;
    reason: string;
    actorId: UserId;
    auditId: string;
    now: Date;
  }): Promise<{ campaign: ReferralCampaign; changed: boolean }>;
  reviewAttribution(command: {
    attributionId: string;
    decision: ReviewDecision;
    reason: string;
    actorId: UserId;
    auditId: string;
    now: Date;
  }): Promise<{ reviewStatus: ReferralReviewStatus; changed: boolean; referrerId: string }>;
  requestReevaluation(command: {
    referrerId: UserId;
    actorId: UserId;
    auditId: string;
    now: Date;
  }): Promise<boolean>;
  recordReferrerViewed(entry: AuditEntry): Promise<void>;
}
