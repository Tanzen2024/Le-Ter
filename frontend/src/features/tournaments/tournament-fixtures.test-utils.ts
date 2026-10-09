import type { TournamentView } from '../../types/tournament';

/** Vue de tournoi telle que l'API l'envoie (D-054), pour les tests du module. */
export function tournamentView(overrides: Partial<TournamentView> = {}): TournamentView {
  return {
    tournamentId: '33333333-3333-4333-8333-333333333333',
    status: 'REGISTRATION_OPEN',
    creatorType: 'ADMIN',
    timezone: 'Africa/Douala',
    startsAt: '2026-10-12T17:00:00.000Z',
    endsAt: '2026-10-12T19:00:00.000Z',
    registrationClosesAt: '2026-10-12T17:00:00.000Z',
    entryFee: 1000,
    currency: 'XAF',
    minimumPlayers: 20,
    maximumPlayers: 100,
    platformFeePercent: 10,
    initialTournamentTokens: 1000,
    stakePerGame: 100,
    prizeRules: [
      { rank: 1, percent: 50 },
      { rank: 2, percent: 30 },
      { rank: 3, percent: 20 },
    ],
    registeredCount: 12,
    registration: null,
    account: null,
    podium: [],
    canRegister: true,
    canUnregister: false,
    canJoin: false,
    serverNow: '2026-10-12T16:00:00.000Z',
    ...overrides,
  };
}

export const registration = {
  status: 'REGISTERED' as const,
  registeredAt: '2026-10-10T10:00:00.000Z',
  reservation: {
    amount: 1000,
    currency: 'XAF' as const,
    status: 'ACTIVE' as const,
  },
};

export const participant = {
  currentTokens: 1200,
  initialTokens: 1000,
  gamesPlayed: 3,
  gamesWon: 2,
  status: 'ACTIVE' as const,
  prizeAmount: 0,
};
