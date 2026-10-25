/// <reference types="jest" />
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react-native';

import { ApiError } from '../../../lib/api-client';
import { useGameUiStore } from '../../../stores/game-ui-store';
import type { GameView } from '../../../types/game';
import { GameTableScreen } from './GameTableScreen';
import { FAREWELL_MS } from './TurnHud';

/**
 * « Se coucher » et « Main spéciale » de bout en bout sur l'écran de la table : appui, requête
 * envoyée, réponse du serveur (seul juge), état affiché et panneau de fin. Le serveur est
 * simulé au niveau de l'API (`gamesApi`) ; tout le reste est l'écran réel.
 */
const GAME = '11111111-1111-4111-8111-111111111111';
const SESSION = '22222222-2222-4222-8222-222222222222';
const ME = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const OTHER = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const THIRD = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';

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

/** État du serveur après MA fuite dans une partie à 2 : OTHER gagne (D-086). */
function afterMyFlee(): GameView {
  const before = inProgress();
  return {
    ...before,
    version: 6,
    status: 'finished',
    endReason: 'OPPONENT_FLED',
    activePlayerId: undefined,
    turnStartedAt: undefined,
    turnDeadlineAt: undefined,
    players: before.players.map((p) =>
      p.playerId === ME ? { ...p, fledAt: '2026-10-14T10:01:02.000Z' } : p,
    ),
    play: { ...before.play!, nextPlayerId: undefined },
    result: {
      winnerId: OTHER,
      method: 'OPPONENT_FLED',
      victoryType: 'SIMPLE',
      remainingOpponentIds: [],
      fledPlayerIds: [ME],
    },
    mySettlement: { delta: -100, account: 'WALLET' },
    myActions: NO_ACTIONS,
  };
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

/** Laisse passer la main d'au revoir (3 s, temps réel) et les relectures. */
const waitFarewell = () =>
  act(async () => {
    await new Promise((resolve) => setTimeout(resolve, FAREWELL_MS + 300));
  });

beforeEach(() => {
  mockGet.mockReset();
  mockAct.mockReset();
});
afterEach(async () => {
  await cleanup();
  client.clear();
});

describe('« Se coucher » sur la table', () => {
  it('partie à 2 : une seule requête FLEE (sans version), main d’au revoir, puis le panneau du fuyard', async () => {
    await openTable(inProgress());
    mockAct.mockResolvedValue({ game: afterMyFlee() });
    mockGet.mockResolvedValue({ game: afterMyFlee() });

    await act(async () => {
      fireEvent.press(await screen.findByText('Se coucher'));
    });

    expect(mockAct).toHaveBeenCalledTimes(1);
    const [, gameId, command] = mockAct.mock.calls[0]!;
    expect(gameId).toBe(GAME);
    expect(command.action).toEqual({ type: 'FLEE' });
    expect(command).not.toHaveProperty('expectedVersion');
    expect(screen.getByTestId('farewell-hand')).toBeTruthy();
    // Pas de résultat pendant la main d'au revoir.
    expect(screen.queryByTestId('game-over-panel')).toBeNull();

    await waitFarewell();
    expect(screen.queryByTestId('farewell-hand')).toBeNull();
    expect(screen.getAllByTestId('game-over-panel')).toHaveLength(1);
    expect(screen.getByTestId('game-over-title')).toHaveTextContent('Kofi a gagné la partie.');
    expect(screen.getByText('Vous avez fui la partie')).toBeTruthy();
    expect(screen.queryByText('Se coucher')).toBeNull();
  });

  it('double appui : une seule commande envoyée', async () => {
    await openTable(inProgress());
    let answer: (value: { game: GameView }) => void = () => undefined;
    mockAct.mockImplementation(
      () => new Promise<{ game: GameView }>((resolve) => (answer = resolve)),
    );
    const button = await screen.findByText('Se coucher');
    await act(async () => {
      fireEvent.press(button);
      fireEvent.press(button);
    });
    await act(async () => {
      fireEvent.press(screen.getByText('Se coucher'));
    });
    expect(mockAct).toHaveBeenCalledTimes(1);
    mockGet.mockResolvedValue({ game: afterMyFlee() });
    await act(async () => answer({ game: afterMyFlee() }));
  });

  it('refus du serveur : message affiché, partie relue, aucun départ supposé', async () => {
    await openTable(inProgress());
    mockAct.mockRejectedValue(
      new ApiError(422, 'FLEE_NOT_ALLOWED', 'Vous ne pouvez pas fuir maintenant.'),
    );
    const reads = mockGet.mock.calls.length;
    await act(async () => {
      fireEvent.press(await screen.findByText('Se coucher'));
    });
    expect(await screen.findByText('Vous ne pouvez pas fuir maintenant.')).toBeTruthy();
    await waitFor(() => expect(mockGet.mock.calls.length).toBeGreaterThan(reads));
    // Toujours en jeu : ni main d'au revoir ni panneau de fin.
    expect(screen.queryByTestId('farewell-hand')).toBeNull();
    expect(screen.queryByTestId('game-over-panel')).toBeNull();
    expect(screen.getByText('Se coucher')).toBeTruthy();
  });

  it('coupure réseau pendant la demande : message, puis l’état réel relu (fuite appliquée) s’affiche', async () => {
    await openTable(inProgress());
    mockAct.mockRejectedValue(
      new ApiError(0, 'NETWORK_ERROR', 'Impossible de joindre le serveur. Vérifiez votre connexion.'),
    );
    // Le serveur avait appliqué la fuite avant la coupure : la relecture le montre.
    mockGet.mockResolvedValue({ game: afterMyFlee() });
    await act(async () => {
      fireEvent.press(await screen.findByText('Se coucher'));
    });
    await waitFor(() => expect(screen.getByTestId('farewell-hand')).toBeTruthy());
    await waitFarewell();
    expect(screen.getByText('Vous avez fui la partie')).toBeTruthy();
  });

  it('tour d’un autre joueur : ni « Se coucher » ni « Main spéciale »', async () => {
    await openTable(
      inProgress({
        firstPlayerId: OTHER,
        activePlayerId: OTHER,
        play: {
          ...inProgress().play!,
          dealOrder: [OTHER, ME],
          controllerId: OTHER,
          nextPlayerId: OTHER,
          trickOrder: [OTHER, ME],
        },
        myActions: { ...NO_ACTIONS, canFlee: true, canDeclareInstantWin: true },
      }),
    );
    expect(await screen.findByText('Tour de Kofi')).toBeTruthy();
    expect(screen.queryByText('Se coucher')).toBeNull();
    expect(screen.queryByText('Main spéciale')).toBeNull();
  });

  it('partie à 3 : après ma fuite la partie continue sans moi, sans bouton ni plantage', async () => {
    const three = inProgress({
      maxPlayers: 3,
      players: [
        ...inProgress().players,
        { playerId: THIRD, seat: 2, joinedAt: '2026-10-14T10:00:02.000Z', username: 'Awa' },
      ],
      play: {
        ...inProgress().play!,
        dealOrder: [ME, OTHER, THIRD],
        trickOrder: [ME, OTHER, THIRD],
        handCounts: { [ME]: 5, [OTHER]: 5, [THIRD]: 5 },
      },
    });
    await openTable(three);
    const fled: GameView = {
      ...three,
      version: 6,
      players: three.players.map((p) =>
        p.playerId === ME ? { ...p, fledAt: '2026-10-14T10:01:02.000Z' } : p,
      ),
      play: { ...three.play!, trickOrder: [OTHER, THIRD] },
      myActions: NO_ACTIONS,
    };
    mockAct.mockResolvedValue({ game: fled });
    mockGet.mockResolvedValue({ game: fled });
    await act(async () => {
      fireEvent.press(await screen.findByText('Se coucher'));
    });
    await waitFarewell();
    expect(screen.queryByText('Se coucher')).toBeNull();
    expect(screen.queryByText('Main spéciale')).toBeNull();
    expect(screen.queryByTestId('game-over-panel')).toBeNull();
    // Ma plaque annonce la fuite (état officiel), les autres continuent.
    expect(screen.getByLabelText(/Moi.*A fui/)).toBeTruthy();
  });

  it('reconnexion après la fin : panneau direct, sans main d’au revoir, un seul panneau', async () => {
    await openTable(afterMyFlee());
    expect(await screen.findByTestId('game-over-panel')).toBeTruthy();
    expect(screen.queryByTestId('farewell-hand')).toBeNull();
    // Même état relu une seconde fois (signal en double) : rien ne se répète.
    await act(async () => {
      await client.invalidateQueries({ queryKey: ['games', GAME], exact: true });
    });
    expect(screen.getAllByTestId('game-over-panel')).toHaveLength(1);
    expect(screen.getByText('Vous avez fui la partie')).toBeTruthy();
  });
});

describe('« Main spéciale » sur la table', () => {
  const winning = () =>
    inProgress({
      myActions: { ...NO_ACTIONS, canFlee: true, canDeclareInstantWin: true },
      myInstantWin: { rank: 3, combination: 'FIVE_SAME_SUIT' },
    });

  it('main reconnue par le serveur : une seule déclaration, victoire affichée avec la combinaison', async () => {
    await openTable(winning());
    const won: GameView = {
      ...winning(),
      version: 6,
      status: 'finished',
      endReason: 'INSTANT_WIN',
      activePlayerId: undefined,
      turnDeadlineAt: undefined,
      myInstantWin: undefined,
      result: {
        winnerId: ME,
        method: 'INSTANT_WIN',
        instantWinRank: 3,
        instantWinCombination: 'FIVE_SAME_SUIT',
        automatic: false,
        victoryType: 'SIMPLE',
        remainingOpponentIds: [OTHER],
        fledPlayerIds: [],
      },
      myActions: NO_ACTIONS,
    };
    mockAct.mockResolvedValue({ game: won });
    mockGet.mockResolvedValue({ game: won });
    const button = await screen.findByText('Main spéciale');
    await act(async () => {
      fireEvent.press(button);
      fireEvent.press(button);
    });
    expect(mockAct).toHaveBeenCalledTimes(1);
    expect(mockAct.mock.calls[0]![2].action).toEqual({ type: 'DECLARE_WIN' });
    expect(mockAct.mock.calls[0]![2]).not.toHaveProperty('expectedVersion');
    expect(await screen.findByTestId('game-over-panel')).toBeTruthy();
    expect(screen.getByTestId('game-over-title')).toHaveTextContent('Vous avez gagné !');
    expect(screen.getByTestId('game-over-reason')).toHaveTextContent(
      'Victoire par main spéciale : Cinq cartes de la même famille',
    );
    expect(screen.queryByTestId('farewell-hand')).toBeNull();
  });

  it('aucune main reconnue : rien n’est envoyé, un message explique', async () => {
    await openTable(inProgress());
    await act(async () => {
      fireEvent.press(await screen.findByText('Main spéciale'));
    });
    expect(mockAct).not.toHaveBeenCalled();
    expect(screen.getByTestId('special-hand-hint')).toBeTruthy();
  });

  it('déclaration refusée par le serveur (trop tard) : message, partie toujours en cours', async () => {
    await openTable(winning());
    mockAct.mockRejectedValue(
      new ApiError(422, 'WIN_DECLARATION_NOT_ALLOWED', 'La victoire instantanée n’est plus possible.'),
    );
    await act(async () => {
      fireEvent.press(await screen.findByText('Main spéciale'));
    });
    expect(await screen.findByText('La victoire instantanée n’est plus possible.')).toBeTruthy();
    expect(screen.queryByTestId('game-over-panel')).toBeNull();
  });
});
