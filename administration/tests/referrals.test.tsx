import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { ReferralOverview, ReferrerDetail } from '@/features/referrals/api';
import { ReferralsView } from '@/features/referrals/referrals-view';
import { ReferrerDetailView } from '@/features/referrals/referrer-detail';

/**
 * Parrainage dans l'administration (D-161) : valeurs du serveur affichées telles quelles,
 * historique complet, aucune action de crédit de jetons.
 */
const get = vi.fn();
vi.mock('@/lib/api/client', () => ({
  api: { get: (path: string, query?: unknown) => get(path, query), post: vi.fn(), patch: vi.fn() },
  idempotencyKey: () => 'k',
}));
vi.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams(),
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
  usePathname: () => '/parrainage',
}));
vi.mock('@/hooks/use-hydrated', () => ({ useHydrated: () => true }));

const CAMPAIGN = {
  status: 'ACTIVE' as const,
  rules: { version: 1, referralsPerTier: 10, qualificationThreshold: 1000, rewardPerTier: 5000, maxTiers: null },
  updatedAt: '2026-10-20T08:00:00Z',
};

const OVERVIEW: ReferralOverview = {
  campaign: CAMPAIGN,
  activeCodes: 40,
  referrers: 3,
  attributed: 25,
  qualified: 12,
  counted: 11,
  rewardsCredited: 1,
  tokensDistributed: 5000,
  referrersWithWithheldTiers: 0,
  queue: { pending: 1, failing: 0 },
  flaggedAttributions: 1,
  disabledReferees: 0,
  attention: [
    { kind: 'FLAGGED_ATTRIBUTION', referrerId: 'u1', referrerUsername: 'roly', attributionId: 'a1', detail: 'Même appareil', since: '2026-10-21T08:00:00Z' },
  ],
};

const DETAIL: ReferrerDetail = {
  user: { id: 'u1', username: 'roly', playerNumber: 7, status: 'active', createdAt: '2026-10-01T08:00:00Z' },
  code: 'K7M9P2QR',
  codeCreatedAt: '2026-10-01T08:00:00Z',
  referees: [
    {
      attributionId: 'a1',
      refereeId: 'r1',
      username: 'awa_1',
      playerNumber: 8,
      refereeStatus: 'active',
      source: 'LINK',
      referralCode: 'K7M9P2QR',
      attributedAt: '2026-10-02T08:00:00Z',
      confirmedDeposits: 600,
      deposits: [{ walletTransactionId: 'wt-1', tokens: 600, completedAt: '2026-10-03T08:00:00Z' }],
      qualifiedAt: null,
      qualificationRulesVersion: null,
      qualificationTotal: null,
      counted: false,
      reviewStatus: 'NONE',
      reviewReason: null,
      reviewedAt: null,
    },
  ],
  rewards: [
    {
      id: 'rw1',
      tier: 1,
      amount: 5000,
      rulesVersion: 1,
      referralsRequired: 10,
      walletTransactionId: 'wt-reward-1',
      idempotencyKey: 'referral-reward:c:1',
      countedRefereeIds: [],
      creditedAt: '2026-10-10T08:00:00Z',
    },
  ],
  queue: null,
  campaign: CAMPAIGN,
  nextTier: { tier: 2, referralsRequired: 20, remaining: 9, reward: 5000 },
  withheldTiers: 0,
  history: [
    {
      id: 'h1',
      actorId: 'adm',
      actorUsername: 'admin',
      action: 'REFERRAL_ATTRIBUTION_REVIEWED',
      targetType: 'REFERRAL_ATTRIBUTION',
      targetId: 'a1',
      details: { reason: 'Contrôle de routine' },
      createdAt: '2026-10-11T08:00:00Z',
    },
  ],
};

function wrap(children: ReactNode) {
  return (
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      {children}
    </QueryClientProvider>
  );
}

beforeEach(() => {
  get.mockReset();
  get.mockImplementation(async (path: string) => {
    if (path === 'referrals/overview') return OVERVIEW;
    if (path === 'referrals/referrers') return { page: 1, limit: 25, total: 0, items: [] };
    if (path === 'referrals/campaign') return { campaign: CAMPAIGN, versions: [{ ...CAMPAIGN.rules, createdAt: '2026-10-01T08:00:00Z', createdBy: null }], history: [] };
    if (path === 'referrals/referrers/u1') return DETAIL;
    throw new Error(`inattendu : ${path}`);
  });
});

describe('page Parrainage', () => {
  it('vue d’ensemble, cas à vérifier, réglages ; aucun bouton de crédit', async () => {
    render(wrap(<ReferralsView />));
    expect(await screen.findByText('Attribution en vérification')).toBeInTheDocument();
    expect(screen.getAllByText('Campagne active').length).toBeGreaterThan(0);
    expect(await screen.findByText('Suspendre la campagne')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /créditer/i })).toBeNull();
  });

  it('détail d’un parrain : progression, recharges, références du registre et historique (29)', async () => {
    render(wrap(<ReferrerDetailView id="u1" />));
    expect(await screen.findByText('Parrain : roly')).toBeInTheDocument();
    expect(screen.getByRole('progressbar', { name: 'Recharges confirmées de awa_1' })).toHaveAttribute('aria-valuenow', '600');
    expect(screen.getByText('referral-reward:c:1')).toBeInTheDocument();
    expect(screen.getByText('Attribution contrôlée')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /créditer/i })).toBeNull();
  });
});
