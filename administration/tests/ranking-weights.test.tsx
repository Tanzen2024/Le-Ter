import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { SettingsView } from '@/features/settings/settings-view';
import type { TournamentSettings } from '@/types/admin';

const get = vi.fn();
const patch = vi.fn();
vi.mock('@/lib/api/client', () => ({
  api: {
    get: (path: string, query?: unknown) => get(path, query),
    patch: (path: string, body: unknown) => patch(path, body),
    post: vi.fn(),
  },
  downloadUrl: (path: string) => path,
  idempotencyKey: () => 'k',
}));

/** Poids du classement (D-062, D-106) : contrôle immédiat, le serveur reste juge. */
const settings: TournamentSettings = {
  platformFeePercent: 15,
  initialTokensCoefficient: 10,
  stakePerGameCoefficient: 0.5,
  maximumPendingTournamentsPerPlayer: 1,
  tournamentTransitionMinutes: 0,
  rankingTokensWeightPercent: 60,
  rankingGamesWeightPercent: 40,
  tournamentMinimumPlayers: 20,
  tournamentMaximumPlayers: null,
  tournamentMinimumDurationMinutes: 45,
  tournamentMaximumDurationMinutes: 120,
  tournamentMinimumEntryFee: 500,
};

function wrap(ui: ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

beforeEach(() => {
  get.mockReset();
  patch.mockReset();
  get.mockImplementation((path: string) =>
    path === 'tournaments/settings' ? Promise.resolve({ settings }) : new Promise(() => {}),
  );
});

describe('poids du classement', () => {
  it('somme différente de 100 % : refusée sur les deux champs, aucun appel', async () => {
    wrap(<SettingsView />);
    fireEvent.change(await screen.findByLabelText('Poids des jetons restants (%)'), {
      target: { value: '70' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Enregistrer' }));
    expect(
      await screen.findAllByText('La somme des poids doit être exactement 100 %.'),
    ).toHaveLength(2);
    expect(patch).not.toHaveBeenCalled();
  });

  it('poids hors de 0 à 100 : refusé, aucun appel', async () => {
    wrap(<SettingsView />);
    fireEvent.change(await screen.findByLabelText('Poids des jetons restants (%)'), {
      target: { value: '120' },
    });
    fireEvent.change(screen.getByLabelText('Poids des parties jouées (%)'), {
      target: { value: '0' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Enregistrer' }));
    expect(await screen.findByText('Entre 0 et 100 %.')).toBeInTheDocument();
    expect(patch).not.toHaveBeenCalled();
  });

  it('somme exacte (70 / 30) : envoyée au serveur', async () => {
    patch.mockResolvedValue({
      settings: { ...settings, rankingTokensWeightPercent: 70, rankingGamesWeightPercent: 30 },
    });
    wrap(<SettingsView />);
    fireEvent.change(await screen.findByLabelText('Poids des jetons restants (%)'), {
      target: { value: '70' },
    });
    fireEvent.change(screen.getByLabelText('Poids des parties jouées (%)'), {
      target: { value: '30' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Enregistrer' }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Enregistrer' }));
    await waitFor(() => expect(patch).toHaveBeenCalledTimes(1));
    expect(patch.mock.calls[0]![1]).toMatchObject({
      rankingTokensWeightPercent: 70,
      rankingGamesWeightPercent: 30,
    });
  });
});
