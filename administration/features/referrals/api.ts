import { keepPreviousData, queryOptions } from '@tanstack/react-query';

import { api, type Query } from '@/lib/api/client';
import type { Paged } from '@/types/admin';

/**
 * Parrainage (D-161) : `/api/admin/referrals/*`. Autorisation entièrement vérifiée par le
 * backend (rôle admin, session d'administration). Aucune route ne crédite un montant choisi :
 * les écritures se limitent aux règles, au statut, au contrôle d'une attribution et à la
 * demande de réévaluation (file idempotente).
 */

export type CampaignStatus = 'ACTIVE' | 'SUSPENDED';
export type ReviewStatus = 'NONE' | 'FLAGGED' | 'CLEARED' | 'REJECTED';

export interface ReferralRules {
  version: number;
  referralsPerTier: number;
  qualificationThreshold: number;
  rewardPerTier: number;
  maxTiers: number | null;
}

export interface ReferralCampaignView {
  status: CampaignStatus;
  rules: ReferralRules;
  updatedAt: string;
}

export interface AttentionCase {
  kind: 'FLAGGED_ATTRIBUTION' | 'EVALUATION_FAILING' | 'TIER_WITHHELD' | 'REFEREE_DISABLED';
  referrerId: string;
  referrerUsername: string;
  attributionId?: string;
  detail?: string;
  since: string;
}

export interface ReferralOverview {
  campaign: ReferralCampaignView;
  activeCodes: number;
  referrers: number;
  attributed: number;
  qualified: number;
  counted: number;
  rewardsCredited: number;
  tokensDistributed: number;
  referrersWithWithheldTiers: number;
  queue: { pending: number; failing: number };
  flaggedAttributions: number;
  disabledReferees: number;
  attention: AttentionCase[];
}

export interface ReferrerRow {
  userId: string;
  username: string;
  playerNumber: number;
  code: string;
  attributed: number;
  qualified: number;
  counted: number;
  tiers: number;
  tokensCredited: number;
  lastAttributionAt: string | null;
}

export interface RefereeDetail {
  attributionId: string;
  refereeId: string;
  username: string;
  playerNumber: number;
  refereeStatus: string;
  source: 'LINK' | 'MANUAL';
  referralCode: string;
  attributedAt: string;
  confirmedDeposits: number;
  deposits: { walletTransactionId: string; tokens: number; completedAt: string | null }[];
  qualifiedAt: string | null;
  qualificationRulesVersion: number | null;
  qualificationTotal: number | null;
  counted: boolean;
  reviewStatus: ReviewStatus;
  reviewReason: string | null;
  reviewedAt: string | null;
}

export interface RewardRecord {
  id: string;
  tier: number;
  amount: number;
  rulesVersion: number;
  referralsRequired: number;
  walletTransactionId: string;
  idempotencyKey: string;
  countedRefereeIds: string[];
  creditedAt: string;
}

export interface ReferralAuditItem {
  id: string;
  actorId: string | null;
  actorUsername: string | null;
  action: string;
  targetType: string;
  targetId: string | null;
  details: Record<string, unknown>;
  createdAt: string;
}

export interface ReferrerDetail {
  user: { id: string; username: string; playerNumber: number; status: string; createdAt: string };
  code: string;
  codeCreatedAt: string;
  referees: RefereeDetail[];
  rewards: RewardRecord[];
  queue: { seq: string; enqueuedAt: string; attempts: number; lastError: string | null } | null;
  campaign: ReferralCampaignView;
  nextTier: { tier: number; referralsRequired: number; remaining: number; reward: number } | null;
  withheldTiers: number;
  history: ReferralAuditItem[];
}

export interface CampaignSettings {
  campaign: ReferralCampaignView;
  versions: (ReferralRules & { createdAt: string; createdBy: string | null })[];
  history: ReferralAuditItem[];
}

export type RulesInput = Omit<ReferralRules, 'version'> & { reason: string };

export const referralKeys = {
  all: ['admin', 'referrals'] as const,
};

export function referralOverviewQuery() {
  return queryOptions({
    queryKey: [...referralKeys.all, 'overview'],
    queryFn: () => api.get<ReferralOverview>('referrals/overview'),
  });
}

export function referrersQuery(query: Query) {
  return queryOptions({
    queryKey: [...referralKeys.all, 'referrers', query],
    queryFn: () => api.get<Paged<ReferrerRow>>('referrals/referrers', { limit: 25, ...query }),
    placeholderData: keepPreviousData,
  });
}

/** Détail d'un parrain : chaque consultation est inscrite au journal d'audit par le serveur. */
export function referrerQuery(userId: string) {
  return queryOptions({
    queryKey: [...referralKeys.all, 'referrer', userId],
    queryFn: () => api.get<ReferrerDetail>(`referrals/referrers/${userId}`),
    staleTime: Infinity,
  });
}

export function campaignSettingsQuery() {
  return queryOptions({
    queryKey: [...referralKeys.all, 'campaign'],
    queryFn: () => api.get<CampaignSettings>('referrals/campaign'),
  });
}

export function updateRules(input: RulesInput) {
  return api.patch<{ campaign: ReferralCampaignView; changed: boolean }>(
    'referrals/campaign/rules',
    input,
  );
}

export function setCampaignStatus(status: CampaignStatus, reason: string) {
  return api.post<{ campaign: ReferralCampaignView; changed: boolean }>('referrals/campaign/status', {
    status,
    reason,
  });
}

export function reviewAttribution(attributionId: string, decision: 'FLAG' | 'CLEAR' | 'REJECT', reason: string) {
  return api.post<{ reviewStatus: ReviewStatus; changed: boolean }>(
    `referrals/attributions/${attributionId}/review`,
    { decision, reason },
  );
}

export function requestReevaluation(userId: string) {
  return api.post<{ queued: boolean }>(`referrals/referrers/${userId}/reevaluate`, {});
}
