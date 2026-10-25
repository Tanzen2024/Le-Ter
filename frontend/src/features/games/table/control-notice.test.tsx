/// <reference types="jest" />
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, render, screen } from '@testing-library/react-native';

import { useGameUiStore } from '../../../stores/game-ui-store';
import type { GameView } from '../../../types/game';
import { GARAM_CONTROL_NOTICE_MS } from '../garam/garam-presentation';
import { GameTableScreen } from './GameTableScreen';

/**
 * Fap-Fap : halo et annonce du contrôle EXACTEMENT comme GARAM TIA (D-164) — halo sur la plaque
 * et « … prend le contrôle » pendant `GARAM_CONTROL_NOTICE_MS`, aucun halo de tour autour des
 * cartes. Écran réel, serveur simulé au niveau de l'API (même banc que flee-flow).
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

const hidden = { includeHiddenElements: true };
const wait = (ms: number) =>
  act(async () => {
    await new Promise((resolve) => setTimeout(resolve, ms));
  });

afterEach(async () => {
  await cleanup();
  client.clear();
});

describe('Fap-Fap : contrôle annoncé comme dans GARAM TIA', () => {
  it('« Vous prenez le contrôle » et halo sur la plaque, puis retirés après la même durée', async () => {
    await openTable(inProgress());
    expect(await screen.findByTestId('control-notice')).toHaveTextContent('Vous prenez le contrôle');
    expect(screen.getByTestId('control-glow', hidden)).toBeTruthy();
    await wait(GARAM_CONTROL_NOTICE_MS + 300);
    expect(screen.queryByTestId('control-notice')).toBeNull();
    expect(screen.queryByTestId('control-glow', hidden)).toBeNull();
  });

  it('adversaire au contrôle : son pseudo dans l’annonce', async () => {
    const base = inProgress();
    await openTable({ ...base, play: { ...base.play!, controllerId: OTHER } });
    expect(await screen.findByTestId('control-notice')).toHaveTextContent('Kofi prend le contrôle');
  });

  it('plus de halo de tour autour des cartes (Garam n’en a pas)', async () => {
    await openTable(inProgress());
    await screen.findByTestId('control-notice');
    expect(screen.queryByTestId('turn-glow', hidden)).toBeNull();
  });
});
