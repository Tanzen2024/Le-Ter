import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { SettingsView } from '@/features/settings/settings-view';
import { TournamentDetailView } from '@/features/tournaments/tournament-detail';
import type { TournamentSettings, TournamentSummary } from '@/types/admin';

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

/** Jetons de départ et mise : coefficients des Paramètres, lecture seule à l'approbation (D-071). */
const settings: TournamentSettings = {
  platformFeePercent: 15,
  initialTokensCoefficient: 10,
  stakePerGameCoefficient: 0.5,
  maximumPendingTournamentsPerPlayer: 1,
  tournamentTransitionMinutes: 0,
  rankingTokensWeightPercent: 60,
  rankingGamesWeightPercent: 40,
};

const proposal: TournamentSummary = {
  tournamentId: 't-1',
  status: 'PENDING_APPROVAL',
  creatorType: 'PLAYER',
  timezone: 'Africa/Douala',
  startsAt: '2026-10-13T17:00:00.000Z',
  endsAt: '2026-10-13T18:00:00.000Z',
  registrationClosesAt: '2026-10-13T17:00:00.000Z',
  entryFee: 1000,
  currency: 'XAF',
  minimumPlayers: 20,
  initialTournamentTokens: 10_000,
  stakePerGame: 500,
  tokenCoefficients: { initialTokensCoefficient: 10, stakePerGameCoefficient: 0.5 },
  prizeRules: [{ rank: 1, percent: 100 }],
};

function wrap(ui: ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

function serve(routes: Record<string, unknown>) {
  get.mockImplementation((path: string) =>
    path in routes ? Promise.resolve(routes[path]) : new Promise(() => {}),
  );
}

beforeEach(() => {
  get.mockReset();
  patch.mockReset();
});

describe('page d’approbation', () => {
  it('valeurs calculées par le serveur en lecture seule, avec leur origine ; aucun bouton Enregistrer', async () => {
    serve({
      'tournaments/t-1': { tournament: proposal },
      'tournaments/t-1/registrations': { registrations: [] },
    });
    wrap(<TournamentDetailView id="t-1" />);
    expect(await screen.findByText('10 000')).toBeInTheDocument();
    expect(screen.getByText('500')).toBeInTheDocument();
    expect(
      screen.getByText('Prix d’entrée × 10 (Paramètres) · figé à l’approbation.'),
    ).toBeInTheDocument();
    expect(
      screen.getByText('Prix d’entrée × 0,5 (Paramètres) · figé à l’approbation.'),
    ).toBeInTheDocument();
    expect(screen.queryByRole('textbox')).toBeNull();
    expect(screen.queryByLabelText('Jetons de tournoi au départ')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Enregistrer' })).toBeNull();
    expect(screen.getByRole('button', { name: /Approuver/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Refuser/ })).toBeInTheDocument();
    expect(patch).not.toHaveBeenCalled();
  });

  it('tournoi publié : valeurs figées', async () => {
    serve({
      'tournaments/t-1': {
        tournament: {
          ...proposal,
          status: 'REGISTRATION_OPEN',
          initialTournamentTokens: 8000,
          tokenCoefficients: undefined,
        },
      },
      'tournaments/t-1/registrations': { registrations: [] },
    });
    wrap(<TournamentDetailView id="t-1" />);
    expect(await screen.findByText('8 000')).toBeInTheDocument();
    expect(screen.getAllByText('Figé à la publication.')).toHaveLength(2);
  });

  it('plus aucune règle de calcul locale (10 × le prix, moitié du prix) ni formulaire', () => {
    const dir = join(__dirname, '..', 'features', 'tournaments');
    const source = ['tournament-detail.tsx', 'token-setup-value.tsx', 'api.ts']
      .map((f) => readFileSync(join(dir, f), 'utf8'))
      .join('\n');
    expect(source).not.toMatch(/10 ×|moitié du prix|Math\.floor|entryFee \*|\* 10\b|\/ 2\b/);
    expect(source).not.toMatch(/TokenSetupForm|updateTokenSetup|canEditTokenSetup/);
    const validation = readFileSync(
      join(__dirname, '..', 'lib', 'validation', 'tournament.ts'),
      'utf8',
    );
    expect(validation).not.toMatch(/tokenSetupSchema|stakePerGame|initialTournamentTokens/);
  });
});

describe('Paramètres des tournois', () => {
  it('coefficients et aides affichés, valeurs décimales à la virgule', async () => {
    serve({ 'tournaments/settings': { settings } });
    wrap(<SettingsView />);
    const tokens = (await screen.findByLabelText(
      'Coefficient de jetons de tournoi au départ',
    )) as HTMLInputElement;
    const stake = screen.getByLabelText(
      'Coefficient de mise par partie de tournoi',
    ) as HTMLInputElement;
    expect(tokens.value).toBe('10');
    expect(stake.value).toBe('0,5');
    expect(
      (screen.getByLabelText('Commission de la plateforme (%)') as HTMLInputElement).value,
    ).toBe('15');
    expect((screen.getByLabelText('Poids des jetons restants (%)') as HTMLInputElement).value).toBe(
      '60',
    );
    expect((screen.getByLabelText('Poids des parties jouées (%)') as HTMLInputElement).value).toBe(
      '40',
    );
    expect(
      screen.getByText(
        'Multiplié par le prix d’entrée pour calculer les jetons de départ des prochains tournois publiés.',
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        'Multiplié par le prix d’entrée pour calculer la mise par partie des prochains tournois publiés.',
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        'Commission de la plateforme appliquée selon les règles financières du tournoi.',
      ),
    ).toBeInTheDocument();
    expect(screen.getAllByText('Le total des deux poids doit être égal à 100 %.')).toHaveLength(2);
    expect(screen.queryByText('Jetons de tournoi au départ')).toBeNull();
  });

  it('coefficient décimal saisi avec la virgule : envoyé comme nombre, seul champ modifié', async () => {
    serve({ 'tournaments/settings': { settings } });
    patch.mockResolvedValue({ settings: { ...settings, stakePerGameCoefficient: 0.25 } });
    wrap(<SettingsView />);
    const stake = await screen.findByLabelText('Coefficient de mise par partie de tournoi');
    fireEvent.change(stake, { target: { value: '0,25' } });
    fireEvent.click(screen.getByRole('button', { name: 'Enregistrer' }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Enregistrer' }));
    await waitFor(() =>
      expect(patch).toHaveBeenCalledWith('tournaments/settings', { stakePerGameCoefficient: 0.25 }),
    );
  });

  it('saisie non numérique refusée sans appel', async () => {
    serve({ 'tournaments/settings': { settings } });
    wrap(<SettingsView />);
    const tokens = await screen.findByLabelText('Coefficient de jetons de tournoi au départ');
    fireEvent.change(tokens, { target: { value: 'dix' } });
    fireEvent.click(screen.getByRole('button', { name: 'Enregistrer' }));
    expect(await screen.findByText('Nombre attendu.')).toBeInTheDocument();
    expect(patch).not.toHaveBeenCalled();
  });
});
