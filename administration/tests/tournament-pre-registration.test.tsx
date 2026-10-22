import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, within } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { TournamentDetailView } from '@/features/tournaments/tournament-detail';
import type { TournamentRegistration, TournamentSummary } from '@/types/admin';

const get = vi.fn();
vi.mock('@/lib/api/client', () => ({
  api: {
    get: (path: string, query?: unknown) => get(path, query),
    patch: vi.fn(),
    post: vi.fn(),
  },
  downloadUrl: (path: string) => path,
  idempotencyKey: () => 'k',
}));

/** Proposition en attente d'approbation, déjà ouverte aux préinscriptions (D-108). */
const proposal: TournamentSummary = {
  tournamentId: 't-1',
  status: 'PENDING_APPROVAL',
  creatorType: 'PLAYER',
  gameType: 'TER',
  creatorName: 'ana',
  timezone: 'Africa/Douala',
  startsAt: '2026-10-13T17:00:00.000Z',
  endsAt: '2026-10-13T18:00:00.000Z',
  registrationClosesAt: '2026-10-13T17:00:00.000Z',
  entryFee: 1000,
  currency: 'XAF',
  minimumPlayers: 20,
  initialTournamentTokens: 10_000,
  stakePerGame: 500,
  prizeRules: [{ rank: 1, percent: 100 }],
};

const preRegistrations: TournamentRegistration[] = [
  {
    username: 'ben',
    status: 'REGISTERED',
    registeredAt: '2026-10-13T15:00:00.000Z',
    reservation: { amount: 1000, status: 'ACTIVE' },
  },
];

function wrap(ui: ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

function serve(tournament: TournamentSummary) {
  const routes: Record<string, unknown> = {
    'tournaments/t-1': { tournament },
    'tournaments/t-1/registrations': { registrations: preRegistrations },
  };
  get.mockImplementation((path: string) =>
    path in routes ? Promise.resolve(routes[path]) : new Promise(() => {}),
  );
}

beforeEach(() => {
  get.mockReset();
});

describe('proposition ouverte aux préinscriptions (D-108)', () => {
  it('statut « À approuver » et « Préinscriptions ouvertes », préinscriptions listées', async () => {
    serve(proposal);
    wrap(<TournamentDetailView id="t-1" />);
    expect(await screen.findByText('Préinscriptions ouvertes')).toBeInTheDocument();
    expect(screen.getAllByText('À approuver').length).toBeGreaterThan(0);
    expect(screen.getByText('Préinscriptions et réservations')).toBeInTheDocument();
    expect(await screen.findByText('ben')).toBeInTheDocument();
  });

  it('approbation : les préinscriptions sont conservées, sans nouvelle réservation', async () => {
    serve(proposal);
    wrap(<TournamentDetailView id="t-1" />);
    fireEvent.click(await screen.findByRole('button', { name: /Approuver/ }));
    const dialog = await screen.findByRole('dialog');
    expect(
      within(dialog).getByText(/préinscriptions déjà enregistrées sont conservées/),
    ).toBeInTheDocument();
  });

  it('refus : préinscriptions annulées et réservations libérées, préinscrits informés', async () => {
    serve(proposal);
    wrap(<TournamentDetailView id="t-1" />);
    fireEvent.click(await screen.findByRole('button', { name: /Refuser/ }));
    const dialog = await screen.findByRole('dialog');
    expect(
      within(dialog).getByText(/préinscriptions sont annulées et leurs réservations libérées/),
    ).toBeInTheDocument();
  });

  it('tournoi publié : plus de mention de préinscription', async () => {
    serve({ ...proposal, status: 'REGISTRATION_OPEN' });
    wrap(<TournamentDetailView id="t-1" />);
    expect(await screen.findByText('Inscriptions et réservations')).toBeInTheDocument();
    expect(screen.queryByText('Préinscriptions ouvertes')).toBeNull();
  });
});
