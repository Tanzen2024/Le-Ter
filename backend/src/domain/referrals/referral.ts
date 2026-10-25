import { randomInt } from 'node:crypto';

import type { UserId } from '../users/user';

/**
 * Programme de parrainage (D-161). Le serveur est la seule autorité : l'application affiche
 * ce qu'il calcule, jamais l'inverse. Ce module ne contient que des règles pures (code
 * personnel, paliers) ; la qualification et le crédit sont faits sous verrou par le dépôt.
 */

export const REFERRAL_CAMPAIGN_CODE = 'LE_TER_REFERRAL';
export const DEFAULT_REFERRAL_CAMPAIGN_ID = 'a0e1f7c2-5b1d-4c3e-9f00-000000000001';

export type ReferralCampaignStatus = 'ACTIVE' | 'SUSPENDED';
export type ReferralSource = 'LINK' | 'MANUAL';
export type ReferralReviewStatus = 'NONE' | 'FLAGGED' | 'CLEARED' | 'REJECTED';

/** Règles d'une version de campagne (immuable une fois enregistrée). */
export interface ReferralRules {
  version: number;
  /** Filleuls qualifiés par palier complet (défaut : 10). */
  referralsPerTier: number;
  /** Achats confirmés cumulés exigés de CHAQUE filleul (défaut : 1 000 jetons). */
  qualificationThreshold: number;
  /** Jetons crédités par palier complet (défaut : 5 000). */
  rewardPerTier: number;
  /** Nombre maximal de paliers ; null : aucun plafond. */
  maxTiers: number | null;
  createdAt: Date;
  createdBy: UserId | null;
}

export const DEFAULT_REFERRAL_RULES = {
  referralsPerTier: 10,
  qualificationThreshold: 1000,
  rewardPerTier: 5000,
  maxTiers: null,
} as const;

/** Bornes des réglages de l'administration (miroir des contraintes SQL). */
export const REFERRAL_RULE_BOUNDS = {
  referralsPerTier: { min: 1, max: 1000 },
  qualificationThreshold: { min: 1, max: 1_000_000_000 },
  rewardPerTier: { min: 1, max: 1_000_000_000 },
  maxTiers: { min: 1, max: 100_000 },
} as const;

export interface ReferralCampaign {
  id: string;
  code: string;
  status: ReferralCampaignStatus;
  rules: ReferralRules;
  updatedAt: Date;
}

// --- Code personnel ------------------------------------------------------------------------------

/** 32 caractères sans 0/O ni 1/I : un code dicté ou recopié ne prête pas à confusion. */
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export const REFERRAL_CODE_LENGTH = 8;
const CODE_PATTERN = /^[A-HJ-NP-Z2-9]{8}$/;

/** Code tiré au hasard (CSPRNG) : il ne dérive d'aucune donnée du joueur. */
export function generateReferralCode(): string {
  let code = '';
  for (let i = 0; i < REFERRAL_CODE_LENGTH; i += 1) {
    code += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)];
  }
  return code;
}

/**
 * Saisie normalisée : majuscules, espaces et tirets retirés. null si la forme est impossible
 * (le serveur vérifie ensuite que le code existe).
 */
export function normalizeReferralCode(raw: string): string | null {
  const code = raw.toUpperCase().replace(/[\s-]/g, '');
  return CODE_PATTERN.test(code) ? code : null;
}

// --- Paliers -------------------------------------------------------------------------------------

/** Palier déjà crédité : seul son seuil cumulé sert au palier suivant. */
export interface CreditedTier {
  tier: number;
  referralsRequired: number;
}

export interface DueTier {
  tier: number;
  referralsRequired: number;
  amount: number;
}

/**
 * Paliers dus, au-delà de ceux déjà crédités, pour `qualifiedCount` filleuls qualifiés comptés.
 * Le palier n+1 exige « seuil du palier n + taille de palier en vigueur » : un changement de
 * règles ne réécrit jamais un palier acquis. Défauts : 10 → 5 000, 20 → +5 000, 30 → +5 000…
 */
export function dueTiers(
  rules: Pick<ReferralRules, 'referralsPerTier' | 'rewardPerTier' | 'maxTiers'>,
  credited: readonly CreditedTier[],
  qualifiedCount: number,
): DueTier[] {
  const last = credited.reduce<CreditedTier>(
    (best, t) => (t.tier > best.tier ? t : best),
    { tier: 0, referralsRequired: 0 },
  );
  const due: DueTier[] = [];
  let tier = last.tier;
  let required = last.referralsRequired;
  while (rules.maxTiers === null || tier < rules.maxTiers) {
    const next = required + rules.referralsPerTier;
    if (qualifiedCount < next) break;
    tier += 1;
    required = next;
    due.push({ tier, referralsRequired: required, amount: rules.rewardPerTier });
  }
  return due;
}

/** Progression vers le prochain palier, telle que montrée au joueur. */
export function nextTierProgress(
  rules: Pick<ReferralRules, 'referralsPerTier' | 'rewardPerTier' | 'maxTiers'>,
  credited: readonly CreditedTier[],
  qualifiedCount: number,
): {
  tier: number;
  referralsRequired: number;
  remaining: number;
  reward: number;
} | null {
  const lastTier = credited.reduce((max, t) => Math.max(max, t.tier), 0);
  const lastRequired = credited.reduce((max, t) => Math.max(max, t.referralsRequired), 0);
  if (rules.maxTiers !== null && lastTier >= rules.maxTiers) return null;
  const referralsRequired = lastRequired + rules.referralsPerTier;
  return {
    tier: lastTier + 1,
    referralsRequired,
    remaining: Math.max(0, referralsRequired - qualifiedCount),
    reward: rules.rewardPerTier,
  };
}

// --- Erreurs -------------------------------------------------------------------------------------

/** Code refusé à l'inscription : inconnu, parrain inactif ou campagne suspendue. */
export class ReferralCodeRejectedError extends Error {
  constructor(readonly reason: 'UNKNOWN_CODE' | 'CAMPAIGN_SUSPENDED') {
    super(
      reason === 'CAMPAIGN_SUSPENDED'
        ? 'Le programme de parrainage est suspendu : retirez le code pour continuer.'
        : 'Ce code de parrainage est inconnu. Vérifiez-le ou laissez le champ vide.',
    );
    this.name = 'ReferralCodeRejectedError';
  }
}

/** Programme réservé aux comptes joueurs actifs. */
export class ReferralNotEligibleError extends Error {
  constructor() {
    super('Le parrainage est réservé aux comptes joueurs actifs.');
    this.name = 'ReferralNotEligibleError';
  }
}

export class ReferralAttributionNotFoundError extends Error {
  constructor() {
    super('Attribution introuvable.');
    this.name = 'ReferralAttributionNotFoundError';
  }
}

export class ReferralReferrerNotFoundError extends Error {
  constructor() {
    super('Parrain introuvable.');
    this.name = 'ReferralReferrerNotFoundError';
  }
}
