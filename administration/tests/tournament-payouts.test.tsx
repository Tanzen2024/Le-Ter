import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, within } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { PayoutsCard } from '@/features/tournaments/payouts-card';
import type { TournamentPayoutReport } from '@/types/admin';

const get = vi.fn();
vi.mock('@/lib/api/client', () => ({
  api: { get: (path: string) => get(path), patch: vi.fn(), post: vi.fn() },
  downloadUrl: (path: string) => path,
  idempotencyKey: () => 'k',
}));

/** Récompenses réelles d'un tournoi (D-112) : rapport du serveur affiché tel quel. */
function report(over: Partial<TournamentPayoutReport> = {}): TournamentPayoutReport {
  return {
    tournamentId: 't-1',
    status: 'DISTRIBUTING_PRIZES',
    financialState: 'PAYMENT_FAILED',
    pool: {
      participants: 20,
      grossPool: 20_000,
      platformFee: 2_000,
      platformFeePercent: 10,
      prizePool: 18_000,
      unallocatedPrize: 0,
    },
    prizeRules: [
      { rank: 1, percent: 50 },
      { rank: 2, percent: 30 },
      { rank: 3, percent: 20 },
    ],
    planValidatedAt: '2026-10-15T10:00:00.000Z',
    blocked: null,
    dueTotal: 18_000,
    creditedTotal: 12_600,
    payouts: [
      {
        rank: 1,
        username: 'ana',
        amount: 9_000,
        status: 'CREDITED',
        reference: 'tournament-prize:t-1:1',
        walletTransactionId: 'aaaaaaaa-0000-4000-8000-000000000001',
        attempts: 1,
        lastError: null,
        lastAttemptAt: '2026-10-15T10:00:01.000Z',
        creditedAt: '2026-10-15T10:00:01.000Z',
      },
      {
        rank: 2,
        username: 'ben',
        amount: 5_400,
        status: 'FAILED',
        reference: 'tournament-prize:t-1:2',
        walletTransactionId: null,
        attempts: 2,
        lastError: 'panne du compte de jeu',
        lastAttemptAt: '2026-10-15T10:01:00.000Z',
        creditedAt: null,
      },
      {
        rank: 3,
        username: 'cid',
        amount: 3_600,
        status: 'CREDITED',
        reference: 'tournament-prize:t-1:3',
        walletTransactionId: 'aaaaaaaa-0000-4000-8000-000000000003',
        attempts: 1,
        lastError: null,
        lastAttemptAt: '2026-10-15T10:00:02.000Z',
        creditedAt: '2026-10-15T10:00:02.000Z',
      },
    ],
    ...over,
  };
}

function wrap(ui: ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

beforeEach(() => get.mockReset());

describe('récompenses réelles (administration)', () => {
  it('cagnotte, commission, distribuable, crédité / dû ; échec visible avec ses tentatives', async () => {
    get.mockResolvedValue(report());
    wrap(<PayoutsCard id="t-1" enabled />);
    expect(await screen.findByText('Versement en échec')).toBeInTheDocument();
    expect(get).toHaveBeenCalledWith('tournaments/t-1/payouts');
    for (const label of ['Fonds capturés', 'Commission', 'Cagnotte distribuable', 'Crédité / dû']) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }
    const table = screen.getByRole('table');
    const rows = within(table).getAllByRole('row').slice(1);
    expect(rows).toHaveLength(3);
    expect(within(rows[1]!).getByText('Échec (reprise automatique)')).toBeInTheDocument();
    expect(within(rows[1]!).getByText(/2 tentatives · panne du compte de jeu/)).toBeInTheDocument();
    expect(within(rows[0]!).getByText('Crédité')).toBeInTheDocument();
    expect(within(rows[0]!).getByText('tournament-prize:t-1:1')).toBeInTheDocument();
  });

  it('versements bloqués : motifs du serveur en clair', async () => {
    get.mockResolvedValue(
      report({
        status: 'RESULTS_VALIDATED',
        financialState: 'BLOCKED',
        planValidatedAt: null,
        creditedTotal: 0,
        blocked: {
          at: '2026-10-15T10:00:00.000Z',
          reasons: ['TOURNAMENT_FEE_ENTRY_MISMATCH', 'CODE_INCONNU'],
        },
      }),
    );
    wrap(<PayoutsCard id="t-1" enabled />);
    expect(await screen.findByText('Versements bloqués')).toBeInTheDocument();
    expect(
      screen.getByText('Écriture de commission différente de la commission figée'),
    ).toBeInTheDocument();
    expect(screen.getByText('CODE_INCONNU')).toBeInTheDocument();
    expect(screen.getByText('Plan non encore validé')).toBeInTheDocument();
  });

  it('tous les gains crédités : finalisé', async () => {
    get.mockResolvedValue(
      report({
        status: 'COMPLETED',
        financialState: 'FINALIZED',
        creditedTotal: 18_000,
        payouts: report().payouts.map((p) => ({ ...p, status: 'CREDITED' as const })),
      }),
    );
    wrap(<PayoutsCard id="t-1" enabled />);
    expect(await screen.findByText('Finalisé : tous les gains crédités')).toBeInTheDocument();
  });
});
