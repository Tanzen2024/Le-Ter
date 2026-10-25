/// <reference types="jest" />
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react-native';
import { router } from 'expo-router';

import { ApiError } from '../../../lib/api-client';
import { useGameUiStore } from '../../../stores/game-ui-store';
import type { GameView } from '../../../types/game';
import { gameKeys } from '../hooks';
import { GameTableScreen } from './GameTableScreen';

/**
 * Reconnexion sur l'écran réel de la table (D-152) : la table reste montée et visible sous
 * l'indicateur flottant, devient inerte tant que l'état est périmé, puis l'indicateur
 * disparaît dès que le serveur répond. Le serveur est simulé au niveau de l'API (`gamesApi`).
 */
const GAME = '11111111-1111-4111-8111-111111111111';
const SESSION = '22222222-2222-4222-8222-222222222222';
const ME = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const OTHER = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

const mockGet = jest.fn();
const mockAct = jest.fn();
jest.mock('expo-router', () => ({
  router: { dismissTo: jest.fn(), replace: jest.fn(), push: jest.fn() },
  useLocalSearchParams: () => ({ gameId: '11111111-1111-4111-8111-111111111111' }),
  useIsFocused: () => true,
}));
jest.mock('../../auth/session', () => ({
  withAccessToken: (call: (token: string) => unknown) => call('jeton'),
  refreshSession: jest.fn(),
}));
jest.mock('../../chat/realtime', () => ({
  realtime: {
    subscribeGame: () => () => undefined,
    subscribeChat: () => () => undefined,
    onStatus: () => () => undefined,
    getStatus: () => 'connected',
    wake: () => undefined,
    onNotification: () => () => undefined,
  },
  useRealtimeStatus: () => 'connected',
  useRealtimeWake: () => undefined,
}));
jest.mock('../../../services/games-api', () => ({
  gamesApi: {
    get: (...args: unknown[]) => mockGet(...args),
    act: (...args: unknown[]) => mockAct(...args),
  },
}));
// Session, chat, portefeuille, géolocalisation : jamais résolus (hors sujet ici).
const never = () => new Promise(() => undefined);
jest.mock('../../../services/sessions-api', () => ({
  sessionsApi: { get: jest.fn(never), leave: jest.fn(), decide: jest.fn() },
}));
jest.mock('../../../services/chat-api', () => ({ chatApi: { list: jest.fn(never), send: jest.fn() } }));
jest.mock('../../../services/wallet-api', () => ({ walletApi: { get: jest.fn(never) } }));
jest.mock('../../../services/geolocation-api', () => ({
  geolocationApi: { status: jest.fn(never) },
}));
jest.mock('../../../services/audio-service', () => ({
  playSound: jest.fn(),
  setMusicScene: jest.fn(),
  isMusicAvailable: jest.fn(() => false),
}));

const NO_ACTIONS = {
  canPlayCard: false,
  playableCardIds: [],
  canFlee: false,
  canDeclareInstantWin: false,
};

/**
 * Tour 1 d'une partie à 2 : c'est MON tour (J1), je n'ai joué aucune carte. « Main spéciale »
 * et « Se coucher » ne s'affichent que pendant le tour du joueur.
 */
function inProgress(overrides: Partial<GameView> = {}): GameView {
  return {
    gameId: GAME,
    sessionId: SESSION,
    firstPlayerId: ME,
    version: 5,
    status: 'in_progress',
    creatorId: OTHER,
    maxPlayers: 2,
    players: [
      { playerId: ME, seat: 0, joinedAt: '2026-10-14T10:00:00.000Z', username: 'Moi' },
      { playerId: OTHER, seat: 1, joinedAt: '2026-10-14T10:00:01.000Z', username: 'Kofi' },
    ],
    play: {
      trickNumber: 1,
      dealOrder: [ME, OTHER],
      dealSequence: [],
      controllerId: ME,
      nextPlayerId: ME,
      trickOrder: [ME, OTHER],
      currentTrick: [],
      completedTricks: [],
      myHand: ['COEUR-3', 'PIQUE-8', 'ETOILE-5', 'TREFLE-10', 'COEUR-9'],
      handCounts: { [ME]: 5, [OTHER]: 5 },
      stockCount: 0,
    },
    activePlayerId: ME,
    turnStartedAt: '2026-10-14T10:01:00.000Z',
    turnDeadlineAt: '2026-10-14T10:01:13.000Z',
    serverNow: '2026-10-14T10:01:01.000Z',
    myActions: { ...NO_ACTIONS, canFlee: true },
    viewerId: ME,
    createdAt: '2026-10-14T10:00:00.000Z',
    ...overrides,
  } as GameView;
}

let client: QueryClient;

async function openTable(initial: GameView) {
  mockGet.mockResolvedValue({ game: initial });
  useGameUiStore.getState().markDealAnimated(GAME);
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  await render(
    <QueryClientProvider client={client}>
      <GameTableScreen />
    </QueryClientProvider>,
  );
}

const indicator = () => screen.queryByTestId('connection-indicator');

beforeEach(() => {
  mockGet.mockReset();
  mockAct.mockReset();
});
afterEach(async () => {
  await cleanup();
  client.clear();
});

describe('reconnexion au-dessus de la partie en cours', () => {
  it('table conservée et inerte, indicateur sans détail technique, puis retrait au retour du réseau', async () => {
    await openTable(inProgress());
    expect(await screen.findByText('Se coucher')).toBeTruthy();
    expect(screen.getByTestId('game-screen').props.pointerEvents).toBe('auto');

    // Réseau coupé : la relecture échoue (délai dépassé).
    mockGet.mockRejectedValue(
      new ApiError(0, 'TIMEOUT', 'GET http://100.72.158.120:3000/api/games {"cause":"x"}'),
    );
    await act(async () => {
      void client.refetchQueries({ queryKey: gameKeys.detail(GAME) });
    });
    expect(await screen.findByText('Reconnexion en cours…', {}, { timeout: 10_000 })).toBeTruthy();
    expect(screen.queryByText(/TIMEOUT|https?:|\/api\/|[{}]/)).toBeNull();
    // Même écran, toujours monté : la table et ses commandes restent visibles, mais inertes.
    expect(screen.getByText('Se coucher')).toBeTruthy();
    expect(screen.getByTestId('game-screen').props.pointerEvents).toBe('none');

    // Réseau revenu : l'état réel est relu, l'indicateur s'efface.
    mockGet.mockResolvedValue({ game: inProgress({ version: 6 }) });
    await act(async () => {
      void client.refetchQueries({ queryKey: gameKeys.detail(GAME) });
    });
    await waitFor(() => expect(indicator()).toBeNull(), { timeout: 10_000 });
    expect(screen.getByText('Se coucher')).toBeTruthy();
    expect(screen.getByTestId('game-screen').props.pointerEvents).toBe('auto');
    expect(router.replace).not.toHaveBeenCalled();
    expect(router.push).not.toHaveBeenCalled();
    expect(router.dismissTo).not.toHaveBeenCalled();
  }, 120_000);
});
