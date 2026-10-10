/// <reference types="jest" />
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { router } from 'expo-router';

import { ApiError } from '../../../lib/api-client';
import { sessionsApi } from '../../../services/sessions-api';
import { useAuthStore } from '../../../stores/auth-store';
import type { GameView } from '../../../types/game';
import type { useStartGame } from '../hooks';
import { TournamentTableWaiting } from './TournamentTableWaiting';

jest.mock('../../../services/sessions-api', () => ({
  sessionsApi: { leave: jest.fn() },
}));
jest.mock('expo-router', () => ({
  router: { dismissTo: jest.fn(), replace: jest.fn(), push: jest.fn() },
}));

const sessions = sessionsApi as jest.Mocked<typeof sessionsApi>;
const dismissTo = router.dismissTo as jest.Mock;

const ME = 'p-me';
const OTHER = 'p-other';
const NOW = '2026-10-09T10:00:00.000Z';

function waitingGame(overrides: Partial<GameView> = {}): GameView {
  return {
    gameId: 'g-1',
    sessionId: 'session-1',
    version: 2,
    status: 'waiting',
    creatorId: OTHER,
    viewerId: ME,
    maxPlayers: 4,
    autoStart: true,
    serverNow: NOW,
    players: [
      { playerId: OTHER, seat: 0, joinedAt: NOW, username: 'Kofi' },
      { playerId: ME, seat: 1, joinedAt: NOW, username: 'Roly_237' },
    ],
    startDeadlineAt: '2026-10-09T10:00:15.000Z',
    ...overrides,
  } as GameView;
}

const start = { start: jest.fn(), isPending: false, error: null } as unknown as ReturnType<
  typeof useStartGame
>;

const clients: QueryClient[] = [];
async function renderWaiting(game: GameView) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  clients.push(queryClient);
  await render(
    <QueryClientProvider client={queryClient}>
      <TournamentTableWaiting game={game} receivedAt={Date.parse(NOW)} start={start} />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  jest.clearAllMocks();
  useAuthStore.getState().signIn('jeton');
});
afterEach(async () => {
  await cleanup();
  clients.splice(0).forEach((client) => client.clear());
});

describe('table de tournoi en attente : « Annuler la recherche »', () => {
  it('visible seul comme à 2 joueurs, à côté du compte à rebours', async () => {
    await renderWaiting(waitingGame());
    expect(screen.getByText('Partie prête à démarrer.')).toBeTruthy();
    expect(screen.getByText('Annuler la recherche')).toBeTruthy();
    await cleanup();
    await renderWaiting(
      waitingGame({ players: [waitingGame().players[1]!], startDeadlineAt: undefined }),
    );
    expect(screen.getByText('En attente d’un autre joueur…')).toBeTruthy();
    expect(screen.getByText('Annuler la recherche')).toBeTruthy();
  });

  it('quitte la table par le départ de session existant, puis revient à la liste', async () => {
    sessions.leave.mockResolvedValue({ session: null } as never);
    await renderWaiting(waitingGame());
    await fireEvent.press(screen.getByText('Annuler la recherche'));
    await waitFor(() =>
      expect(dismissTo).toHaveBeenCalledWith({
        pathname: '/tournament',
        params: { searchCancelled: '1' },
      }),
    );
    expect(sessions.leave).toHaveBeenCalledTimes(1);
    expect(sessions.leave).toHaveBeenCalledWith('jeton', 'session-1');
  });

  it('erreur réseau : message, la table reste affichée et l’on peut réessayer', async () => {
    sessions.leave.mockRejectedValueOnce(new Error('réseau'));
    sessions.leave.mockResolvedValueOnce({ session: null } as never);
    await renderWaiting(waitingGame());
    await fireEvent.press(screen.getByText('Annuler la recherche'));
    expect(
      await screen.findByText(
        'L’annulation n’a pas abouti. Vérifiez votre connexion et réessayez.',
      ),
    ).toBeTruthy();
    expect(dismissTo).not.toHaveBeenCalled();
    await fireEvent.press(screen.getByText('Annuler la recherche'));
    await waitFor(() => expect(dismissTo).toHaveBeenCalledTimes(1));
    expect(sessions.leave).toHaveBeenCalledTimes(2);
  });

  it('partie démarrée entre-temps : départ refusé, aucun retour à la liste ni message d’échec', async () => {
    sessions.leave.mockRejectedValue(
      new ApiError(409, 'PLAYER_IN_ACTIVE_GAME', 'Vous participez à une partie.'),
    );
    await renderWaiting(waitingGame());
    await fireEvent.press(screen.getByText('Annuler la recherche'));
    await waitFor(() => expect(sessions.leave).toHaveBeenCalledTimes(1));
    expect(dismissTo).not.toHaveBeenCalled();
    expect(screen.queryByRole('alert')).toBeNull();
  });
});
