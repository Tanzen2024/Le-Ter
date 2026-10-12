/// <reference types="jest" />
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, renderHook } from '@testing-library/react-native';
import { router } from 'expo-router';
import type { ReactNode } from 'react';
import { AppState, type AppStateStatus } from 'react-native';

import { ApiError } from '../../lib/api-client';
import { gamesApi } from '../../services/games-api';
import { sessionsApi } from '../../services/sessions-api';
import type { GameView } from '../../types/game';
import type { SessionView } from '../../types/session';
import { gameKeys } from './hooks';
import {
  gameToReturnTo,
  restoreActiveGame,
  useActiveGameRestorer,
  useReturnToActiveGame,
} from './use-return-to-active-game';

jest.mock('../../services/games-api', () => ({ gamesApi: { listActive: jest.fn() } }));
jest.mock('../../services/sessions-api', () => ({ sessionsApi: { listMine: jest.fn() } }));
jest.mock('../auth/session', () => ({
  withAccessToken: (call: (token: string) => unknown) => call('token'),
}));
// L'écran prend le focus dès le rendu.
jest.mock('expo-router', () => {
  const { useEffect } = jest.requireActual<typeof import('react')>('react');
  return {
    router: { push: jest.fn() },
    useFocusEffect: (effect: () => void | (() => void)) => useEffect(effect, [effect]),
  };
});

const listActive = gamesApi.listActive as jest.Mock;
const listMine = sessionsApi.listMine as jest.Mock;
const push = router.push as jest.Mock;

const game = (gameId: string, status: GameView['status']) => ({ gameId, status }) as GameView;
const NOW = '2026-10-11T19:00:00.000Z';
const session = (decision: Partial<NonNullable<SessionView['decision']>> | null) =>
  ({
    sessionId: 's-1',
    status: 'open',
    serverNow: NOW,
    decision: decision && {
      gameId: 'g-ended',
      open: true,
      deadlineAt: '2026-10-11T19:00:15.000Z',
      decisions: [],
      pendingPlayerIds: ['me'],
      ...decision,
    },
  }) as SessionView;

/** Événements AppState simulés : le module natif n'émet rien en test. */
let appStateHandlers: ((state: AppStateStatus) => void)[] = [];
function emitAppState(state: AppStateStatus) {
  for (const handler of [...appStateHandlers]) handler(state);
}

function setup() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  return { client, wrapper };
}

const flush = () => act(async () => {});

beforeEach(() => {
  appStateHandlers = [];
  jest.spyOn(AppState, 'addEventListener').mockImplementation((_type, handler) => {
    appStateHandlers.push(handler as (state: AppStateStatus) => void);
    return {
      remove: () => {
        appStateHandlers = appStateHandlers.filter((h) => h !== handler);
      },
    } as ReturnType<typeof AppState.addEventListener>;
  });
  listMine.mockResolvedValue({ sessions: [] });
});

afterEach(async () => {
  await cleanup();
  jest.restoreAllMocks();
  jest.clearAllMocks();
});

describe('gameToReturnTo', () => {
  it('la partie en cours d’abord, sinon celle en attente, sinon aucune', () => {
    expect(gameToReturnTo([game('w', 'waiting'), game('p', 'in_progress')])?.gameId).toBe('p');
    expect(gameToReturnTo([game('w', 'waiting')])?.gameId).toBe('w');
    expect(gameToReturnTo([])).toBeUndefined();
  });
});

describe('useReturnToActiveGame (accueil)', () => {
  it('partie laissée en cours : retour automatique dans son aire de jeu, en reprise', async () => {
    listActive.mockResolvedValue({ games: [game('g-1', 'in_progress')] });
    const { wrapper } = setup();
    await renderHook(() => useReturnToActiveGame(true), { wrapper });
    await flush();

    expect(push).toHaveBeenCalledWith('/game/g-1?reprise=1');
  });

  it('aucune partie active ni ronde ouverte : le joueur reste sur l’écran', async () => {
    listActive.mockResolvedValue({ games: [] });
    const { wrapper } = setup();
    await renderHook(() => useReturnToActiveGame(true), { wrapper });
    await flush();

    expect(listActive).toHaveBeenCalledTimes(1);
    expect(listMine).toHaveBeenCalledTimes(1);
    expect(push).not.toHaveBeenCalled();
  });

  it('partie terminée pendant l’absence, ronde encore ouverte : écran de fin de cette partie', async () => {
    listActive.mockResolvedValue({ games: [] });
    listMine.mockResolvedValue({ sessions: [session({})] });
    const { wrapper } = setup();
    await renderHook(() => useReturnToActiveGame(true), { wrapper });
    await flush();

    expect(push).toHaveBeenCalledWith('/game/g-ended?reprise=1');
  });

  it('ronde échue sur l’horloge du serveur : aucune redirection (départ automatique)', async () => {
    listActive.mockResolvedValue({ games: [] });
    listMine.mockResolvedValue({
      sessions: [session({ deadlineAt: '2026-10-11T18:59:59.000Z' })],
    });
    const { wrapper } = setup();
    await renderHook(() => useReturnToActiveGame(true), { wrapper });
    await flush();

    expect(push).not.toHaveBeenCalled();
  });

  it('relit le serveur, jamais un cache périmé (départ déjà enregistré)', async () => {
    listActive.mockResolvedValue({ games: [] });
    const { client, wrapper } = setup();
    // Cache d'avant « Quitter » : la partie y figure encore.
    client.setQueryData(gameKeys.active, [game('g-old', 'waiting')]);
    await renderHook(() => useReturnToActiveGame(true), { wrapper });
    await flush();

    expect(listActive).toHaveBeenCalledTimes(1);
    expect(push).not.toHaveBeenCalled();
  });

  it('non connecté : aucune lecture, aucune redirection', async () => {
    const { wrapper } = setup();
    await renderHook(() => useReturnToActiveGame(false), { wrapper });
    await flush();

    expect(listActive).not.toHaveBeenCalled();
    expect(push).not.toHaveBeenCalled();
  });

  it('erreur réseau : le joueur reste sur l’écran, sans plantage', async () => {
    listActive.mockRejectedValue(new Error('réseau'));
    const { wrapper } = setup();
    await renderHook(() => useReturnToActiveGame(true), { wrapper });
    await flush();

    expect(push).not.toHaveBeenCalled();
  });

  it('écran quitté avant la réponse : aucune redirection tardive', async () => {
    let resolve: (value: { games: GameView[] }) => void = () => undefined;
    listActive.mockReturnValue(new Promise((r) => (resolve = r)));
    const { wrapper } = setup();
    const hook = await renderHook(() => useReturnToActiveGame(true), { wrapper });
    await hook.unmount();
    resolve({ games: [game('g-1', 'in_progress')] });
    await flush();

    expect(push).not.toHaveBeenCalled();
  });
});

describe('restoreActiveGame : une vérification, une navigation', () => {
  it('appels simultanés (lancement + accueil + retour) : un seul appel serveur, une seule navigation', async () => {
    let resolve: (value: { games: GameView[] }) => void = () => undefined;
    listActive.mockReturnValue(new Promise((r) => (resolve = r)));
    const { client } = setup();
    const calls = [restoreActiveGame(client), restoreActiveGame(client), restoreActiveGame(client)];
    resolve({ games: [game('g-1', 'in_progress')] });
    await act(async () => {
      await Promise.all(calls);
    });

    expect(listActive).toHaveBeenCalledTimes(1);
    expect(push).toHaveBeenCalledTimes(1);
  });
});

describe('useActiveGameRestorer (toute l’application)', () => {
  it('lancement connecté : « Reconnexion » pendant la recherche, puis ouverture de la partie', async () => {
    let resolve: (value: { games: GameView[] }) => void = () => undefined;
    listActive.mockReturnValue(new Promise((r) => (resolve = r)));
    const { wrapper } = setup();
    const hook = await renderHook(() => useActiveGameRestorer(true, '/'), { wrapper });
    expect(hook.result.current.phase).toBe('restoring');

    resolve({ games: [game('g-1', 'in_progress')] });
    await flush();
    expect(push).toHaveBeenCalledWith('/game/g-1?reprise=1');
    expect(hook.result.current.phase).toBe('idle');
  });

  it('aucune partie : panneau retiré, accueil habituel', async () => {
    listActive.mockResolvedValue({ games: [] });
    const { wrapper } = setup();
    const hook = await renderHook(() => useActiveGameRestorer(true, '/'), { wrapper });
    await flush();

    expect(hook.result.current.phase).toBe('idle');
    expect(push).not.toHaveBeenCalled();
  });

  it('serveur injoignable : échec explicite, Réessayer relance la recherche', async () => {
    listActive.mockRejectedValueOnce(new ApiError(0, 'NETWORK_ERROR', 'hors ligne'));
    const { wrapper } = setup();
    const hook = await renderHook(() => useActiveGameRestorer(true, '/'), { wrapper });
    await flush();
    expect(hook.result.current.phase).toBe('failed');
    expect(push).not.toHaveBeenCalled();

    listActive.mockResolvedValue({ games: [game('g-1', 'in_progress')] });
    await act(async () => hook.result.current.retry());
    await flush();
    expect(push).toHaveBeenCalledWith('/game/g-1?reprise=1');
    expect(hook.result.current.phase).toBe('idle');
  });

  it('retour au premier plan : nouvelle recherche ; `inactive` seul n’en déclenche pas', async () => {
    listActive.mockResolvedValue({ games: [] });
    const { wrapper } = setup();
    await renderHook(() => useActiveGameRestorer(true, '/tournament'), { wrapper });
    await flush();
    expect(listActive).toHaveBeenCalledTimes(1);

    await act(async () => {
      emitAppState('inactive');
      emitAppState('active');
    });
    await flush();
    expect(listActive).toHaveBeenCalledTimes(1);

    listActive.mockResolvedValue({ games: [game('g-1', 'in_progress')] });
    await act(async () => {
      emitAppState('background');
      emitAppState('active');
    });
    await flush();
    expect(listActive).toHaveBeenCalledTimes(2);
    expect(push).toHaveBeenCalledWith('/game/g-1?reprise=1');
  });

  it('sur l’écran d’une partie ou déconnecté : aucune recherche (l’écran relit sa partie)', async () => {
    const { wrapper } = setup();
    await renderHook(() => useActiveGameRestorer(true, '/game/g-1'), { wrapper });
    await renderHook(() => useActiveGameRestorer(false, '/'), { wrapper });
    await flush();

    expect(listActive).not.toHaveBeenCalled();
  });

  it('écouteurs retirés au démontage', async () => {
    listActive.mockResolvedValue({ games: [] });
    const { wrapper } = setup();
    const hook = await renderHook(() => useActiveGameRestorer(true, '/'), { wrapper });
    await flush();
    expect(appStateHandlers).toHaveLength(1);
    await hook.unmount();
    expect(appStateHandlers).toHaveLength(0);
  });
});
