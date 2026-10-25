/// <reference types="jest" />
import { act, cleanup, renderHook } from '@testing-library/react-native';
import { AppState, type AppStateStatus } from 'react-native';

import { ApiError } from '../../lib/api-client';
import {
  FAILURES_BEFORE_RETRY_PROMPT,
  gameScreenContent,
  isConnectivityError,
  useGameReconnection,
} from './use-game-reconnection';

let appStateHandlers: ((state: AppStateStatus) => void)[] = [];
const emit = (state: AppStateStatus) => appStateHandlers.forEach((h) => h(state));

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
});
afterEach(async () => {
  await cleanup();
  jest.restoreAllMocks();
});

const NETWORK = new ApiError(0, 'NETWORK_ERROR', 'hors ligne');
type QueryLike = Parameters<typeof useGameReconnection>[0];

/** État de requête simulé (sous-ensemble lu par le hook). */
function query(overrides: Partial<Parameters<typeof useGameReconnection>[0]> = {}) {
  return {
    data: { version: 7 } as unknown,
    error: null,
    isFetching: false,
    dataUpdatedAt: 1_000,
    errorUpdatedAt: 0,
    refetch: jest.fn().mockResolvedValue(undefined),
    ...overrides,
  } as Parameters<typeof useGameReconnection>[0];
}

describe('isConnectivityError', () => {
  it('réseau coupé ou serveur indisponible ; jamais un refus métier', () => {
    expect(isConnectivityError(NETWORK)).toBe(true);
    expect(isConnectivityError(new ApiError(503, 'UNAVAILABLE', 'x'))).toBe(true);
    expect(isConnectivityError(new ApiError(403, 'NOT_A_MEMBER', 'x'))).toBe(false);
    expect(isConnectivityError(new Error('x'))).toBe(false);
  });
});

describe('useGameReconnection', () => {
  it('état à jour : aucun panneau', async () => {
    const { result } = await renderHook(() => useGameReconnection(query()));
    expect(result.current.state).toBeNull();
  });

  it('retour au premier plan : relecture immédiate, panneau jusqu’à la réponse suivante', async () => {
    const q = query();
    const hook = await renderHook((props: QueryLike) => useGameReconnection(props), {
      initialProps: q,
    });
    await act(async () => {
      emit('background');
      emit('active');
    });
    expect(q.refetch).toHaveBeenCalledTimes(1);
    expect(hook.result.current.state).toBe('restoring');

    // Réponse du serveur reçue APRÈS le retour : état plus récent affiché, panneau retiré.
    await hook.rerender({ ...q, dataUpdatedAt: Date.now() + 1 });
    expect(hook.result.current.state).toBeNull();
  });

  it('`inactive` (notification, appel) n’est pas une absence', async () => {
    const q = query();
    const hook = await renderHook(() => useGameReconnection(q));
    await act(async () => {
      emit('inactive');
      emit('active');
    });
    expect(q.refetch).not.toHaveBeenCalled();
    expect(hook.result.current.state).toBeNull();
  });

  it('réseau coupé avec la table affichée : « Reconnexion », puis échec et Réessayer', async () => {
    let q = query();
    const hook = await renderHook((props: QueryLike) => useGameReconnection(props), {
      initialProps: q,
    });
    for (let i = 1; i <= FAILURES_BEFORE_RETRY_PROMPT; i += 1) {
      q = { ...q, error: NETWORK, errorUpdatedAt: 1_000 + i };
      await hook.rerender(q);
      if (i < FAILURES_BEFORE_RETRY_PROMPT) expect(hook.result.current.state).toBe('restoring');
    }
    expect(hook.result.current.state).toBe('failed');

    // Réessayer : relecture ; pendant la requête, de nouveau « Reconnexion ».
    await act(async () => hook.result.current.retry());
    expect(q.refetch).toHaveBeenCalled();
    await hook.rerender({ ...q, isFetching: true });
    expect(hook.result.current.state).toBe('restoring');

    // Réseau revenu : réponse réussie, plus aucun panneau, compteur remis à zéro.
    await hook.rerender({ ...q, error: null, isFetching: false, dataUpdatedAt: 5_000 });
    expect(hook.result.current.state).toBeNull();
  });

  it('refus métier (403) : pas de panneau de reconnexion', async () => {
    const q = query({ error: new ApiError(403, 'NOT_A_MEMBER', 'x'), errorUpdatedAt: 2_000 });
    const { result } = await renderHook(() => useGameReconnection(q));
    expect(result.current.state).toBeNull();
  });

  it('arrivée par la reprise automatique : panneau jusqu’au premier état reçu', async () => {
    const pending = query({ data: undefined, dataUpdatedAt: 0, isFetching: true });
    const hook = await renderHook(
      (props: QueryLike) => useGameReconnection(props, { resume: true }),
      {
        initialProps: pending,
      },
    );
    expect(hook.result.current.state).toBe('restoring');
    await hook.rerender({ ...pending, data: { version: 9 }, dataUpdatedAt: 3_000 });
    expect(hook.result.current.state).toBeNull();
  });

  it('écouteur AppState retiré au démontage', async () => {
    const hook = await renderHook(() => useGameReconnection(query()));
    expect(appStateHandlers).toHaveLength(1);
    await hook.unmount();
    expect(appStateHandlers).toHaveLength(0);
  });
});

describe('gameScreenContent', () => {
  it('table gardée si des données existent, même après une relecture en échec', () => {
    expect(gameScreenContent({ hasData: true, error: NETWORK, reconnecting: true })).toBe('table');
  });
  it('sans données : réseau → Réessayer ; refus → message ; reprise → Reconnexion', () => {
    expect(gameScreenContent({ hasData: false, error: NETWORK, reconnecting: false })).toBe(
      'retry',
    );
    expect(
      gameScreenContent({
        hasData: false,
        error: new ApiError(403, 'NOT_A_MEMBER', 'x'),
        reconnecting: false,
      }),
    ).toBe('message');
    expect(gameScreenContent({ hasData: false, error: null, reconnecting: true })).toBe(
      'restoring',
    );
    expect(gameScreenContent({ hasData: false, error: null, reconnecting: false })).toBe('loading');
  });
});
