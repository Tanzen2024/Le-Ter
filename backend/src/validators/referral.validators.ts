import {
  REFERRAL_RULE_BOUNDS,
  type ReferralCampaignStatus,
  type ReferralRules,
} from '../domain/referrals/referral';
import type { ReferrerListQuery, ReviewDecision } from '../repositories/referral.repository';
import { ADMIN_PAGE } from './admin.validators';
import { ValidationError } from './validation-error';

/**
 * Entrées de l'administration du parrainage (D-161). Champ inconnu refusé : aucun `actorId`,
 * montant à créditer ou statut de filleul ne peut être glissé dans une requête.
 */

const MIN_REASON = 3;
const MAX_REASON = 500;

function record(body: unknown, allowed: readonly string[], fields: Record<string, string>) {
  const source =
    typeof body === 'object' && body !== null && !Array.isArray(body)
      ? (body as Record<string, unknown>)
      : {};
  for (const key of Object.keys(source)) {
    if (!allowed.includes(key)) fields[key] = 'Champ non autorisé.';
  }
  return source;
}

function reason(value: unknown, fields: Record<string, string>): string {
  const text = typeof value === 'string' ? value.trim() : '';
  if (text.length < MIN_REASON || text.length > MAX_REASON) {
    fields.reason = `Motif obligatoire (${MIN_REASON} à ${MAX_REASON} caractères).`;
  }
  return text;
}

function integer(
  value: unknown,
  key: string,
  bounds: { min: number; max: number },
  fields: Record<string, string>,
): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < bounds.min || value > bounds.max) {
    fields[key] = `Entier attendu entre ${bounds.min} et ${bounds.max}.`;
    return 0;
  }
  return value;
}

export function parseReferralRulesChange(body: unknown): {
  rules: Pick<ReferralRules, 'referralsPerTier' | 'qualificationThreshold' | 'rewardPerTier' | 'maxTiers'>;
  reason: string;
} {
  const fields: Record<string, string> = {};
  const source = record(
    body,
    ['referralsPerTier', 'qualificationThreshold', 'rewardPerTier', 'maxTiers', 'reason'],
    fields,
  );
  const rules = {
    referralsPerTier: integer(source.referralsPerTier, 'referralsPerTier', REFERRAL_RULE_BOUNDS.referralsPerTier, fields),
    qualificationThreshold: integer(
      source.qualificationThreshold,
      'qualificationThreshold',
      REFERRAL_RULE_BOUNDS.qualificationThreshold,
      fields,
    ),
    rewardPerTier: integer(source.rewardPerTier, 'rewardPerTier', REFERRAL_RULE_BOUNDS.rewardPerTier, fields),
    // null ou absent : aucun plafond du nombre de paliers.
    maxTiers:
      source.maxTiers === null || source.maxTiers === undefined
        ? null
        : integer(source.maxTiers, 'maxTiers', REFERRAL_RULE_BOUNDS.maxTiers, fields),
  };
  const text = reason(source.reason, fields);
  if (Object.keys(fields).length > 0) throw new ValidationError(fields);
  return { rules, reason: text };
}

export function parseReferralStatusChange(body: unknown): {
  status: ReferralCampaignStatus;
  reason: string;
} {
  const fields: Record<string, string> = {};
  const source = record(body, ['status', 'reason'], fields);
  if (source.status !== 'ACTIVE' && source.status !== 'SUSPENDED') {
    fields.status = 'Statut attendu : ACTIVE ou SUSPENDED.';
  }
  const text = reason(source.reason, fields);
  if (Object.keys(fields).length > 0) throw new ValidationError(fields);
  return { status: source.status as ReferralCampaignStatus, reason: text };
}

export function parseReferralReview(body: unknown): { decision: ReviewDecision; reason: string } {
  const fields: Record<string, string> = {};
  const source = record(body, ['decision', 'reason'], fields);
  if (!['FLAG', 'CLEAR', 'REJECT'].includes(source.decision as string)) {
    fields.decision = 'Décision attendue : FLAG, CLEAR ou REJECT.';
  }
  const text = reason(source.reason, fields);
  if (Object.keys(fields).length > 0) throw new ValidationError(fields);
  return { decision: source.decision as ReviewDecision, reason: text };
}

export function parseReferrerListQuery(query: Record<string, unknown>): ReferrerListQuery {
  const fields: Record<string, string> = {};
  record(query, ['page', 'limit', 'q'], fields);
  const int = (key: string, fallback: number, max: number) => {
    const raw = query[key];
    if (raw === undefined) return fallback;
    const value = typeof raw === 'string' && /^\d+$/.test(raw) ? Number(raw) : NaN;
    if (!Number.isSafeInteger(value) || value < 1 || value > max) {
      fields[key] = `Entier attendu entre 1 et ${max}.`;
      return fallback;
    }
    return value;
  };
  const page = int('page', 1, ADMIN_PAGE.maxPage);
  const limit = int('limit', ADMIN_PAGE.defaultLimit, ADMIN_PAGE.maxLimit);
  const rawQ = query.q;
  let q: string | undefined;
  if (rawQ !== undefined) {
    if (typeof rawQ !== 'string' || rawQ.trim().length > 40) {
      fields.q = 'Recherche limitée à 40 caractères.';
    } else if (rawQ.trim() !== '') {
      q = rawQ.trim();
    }
  }
  if (Object.keys(fields).length > 0) throw new ValidationError(fields);
  return { page, limit, ...(q && { q }) };
}
