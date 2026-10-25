/**
 * Programme de parrainage (D-161), tel que renvoyé par GET /api/referrals/me. Tout est calculé
 * par le serveur : l'application n'en déduit ni qualification, ni palier, ni montant.
 */
export type ReferralCampaignStatus = 'ACTIVE' | 'SUSPENDED';

/** IN_PROGRESS : moins que le seuil ; UNDER_REVIEW : contrôle en cours ; NOT_COUNTED : écarté. */
export type RefereeStatus = 'IN_PROGRESS' | 'QUALIFIED' | 'UNDER_REVIEW' | 'NOT_COUNTED';

export interface ReferralRules {
  version: number;
  referralsPerTier: number;
  qualificationThreshold: number;
  rewardPerTier: number;
  maxTiers: number | null;
}

export interface ReferralReferee {
  id: string;
  /** Pseudo public (déjà visible en jeu) ; aucune autre donnée personnelle. */
  username: string;
  attributedAt: string;
  /** Achats confirmés comptés, plafonnés au seuil : le montant réel n'est jamais montré. */
  progress: number;
  threshold: number;
  status: RefereeStatus;
  qualifiedAt: string | null;
}

export interface ReferralProgram {
  campaign: { status: ReferralCampaignStatus; rules: ReferralRules; updatedAt: string };
  code: string;
  /** `invite` : page de téléchargement (null si non configurée) ; `app` : lien direct. */
  links: { invite: string | null; app: string };
  summary: {
    attributed: number;
    qualified: number;
    counted: number;
    tiersReached: number;
    tokensCredited: number;
  };
  nextTier: { tier: number; referralsRequired: number; remaining: number; reward: number } | null;
  /** Paliers atteints pendant une suspension : crédités à la reprise. */
  withheldTiers: number;
  evaluationPending: boolean;
  referees: ReferralReferee[];
  rewards: { tier: number; amount: number; creditedAt: string }[];
}
