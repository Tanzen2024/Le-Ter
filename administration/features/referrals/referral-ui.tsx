import { Badge } from '@/components/ui/badge';
import { formatDateTime, formatTokens } from '@/lib/format';

import type { CampaignStatus, ReferralAuditItem, ReferralRules, ReviewStatus } from './api';

export function CampaignBadge({ status }: { status: CampaignStatus }) {
  return status === 'ACTIVE' ? (
    <Badge tone="success" dot>
      Campagne active
    </Badge>
  ) : (
    <Badge tone="warning" dot>
      Campagne suspendue
    </Badge>
  );
}

export function describeRules(r: Omit<ReferralRules, 'version'>): string {
  const cap = r.maxTiers === null ? 'sans plafond' : `${r.maxTiers} palier(s) au plus`;
  return `${r.referralsPerTier} filleuls qualifiés par palier · ${formatTokens(r.qualificationThreshold)} de recharges confirmées par filleul · ${formatTokens(r.rewardPerTier)} par palier · ${cap}`;
}

export const REVIEW_LABEL: Record<ReviewStatus, [string, 'neutral' | 'warning' | 'success' | 'danger']> = {
  NONE: ['Aucun contrôle', 'neutral'],
  FLAGGED: ['En vérification', 'warning'],
  CLEARED: ['Contrôlé, validé', 'success'],
  REJECTED: ['Écarté', 'danger'],
};

const ACTION_LABEL: Record<string, string> = {
  REFERRAL_RULES_UPDATED: 'Règles modifiées',
  REFERRAL_CAMPAIGN_SUSPENDED: 'Campagne suspendue',
  REFERRAL_CAMPAIGN_ACTIVATED: 'Campagne réactivée',
  REFERRAL_ATTRIBUTION_REVIEWED: 'Attribution contrôlée',
  REFERRAL_REEVALUATION_REQUESTED: 'Réévaluation demandée',
  REFERRAL_REFERRER_VIEWED: 'Fiche consultée',
};

/** Lignes du journal d'audit (lecture seule). */
export function AuditLines({ items }: { items: ReferralAuditItem[] }) {
  if (items.length === 0) return <p className="text-muted text-sm">Aucune entrée.</p>;
  return (
    <ul className="divide-line divide-y text-sm">
      {items.map((a) => (
        <li key={a.id} className="flex flex-wrap gap-2 py-2">
          <span className="text-ink font-medium">{ACTION_LABEL[a.action] ?? a.action}</span>
          <span className="text-muted">par {a.actorUsername ?? 'système'}</span>
          {typeof a.details.reason === 'string' && (
            <span className="text-ink-soft">« {a.details.reason} »</span>
          )}
          <span className="text-faint ml-auto text-xs">{formatDateTime(a.createdAt)}</span>
        </li>
      ))}
    </ul>
  );
}
