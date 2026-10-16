/// <reference types="jest" />
import { act, cleanup, renderHook } from '@testing-library/react-native';
import { AppState, type AppStateStatus } from 'react-native';

import {
  getAppState,
  onAppForeground,
  onAppStateChange,
  resetAppLifecycleForTests,
  useAppForeground,
  useAppState,
} from './app-lifecycle';

/**
 * Cycle de vie centralisé : une seule souscription native, un retour au premier plan = une
 * transition RÉELLE background → active (jamais `inactive` seul), un événement par retour,
 * abonnements nettoyés.
 */

let handlers: ((state: AppStateStatus) => void)[] = [];
const remove = jest.fn();
const emit = (state: AppStateStatus) => act(() => handlers.forEach((h) => h(state)));
let now = 0;

beforeEach(() => {
  handlers = [];
  now = 1_000;
  resetAppLifecycleForTests(() => now);
  remove.mockClear(); // abonnement du test précédent retiré par la remise à zéro
  // jest-expo fournit déjà une fonction simulée : ses appels sont remis à zéro à chaque test.
  const spy = jest.spyOn(AppState, 'addEventListener');
  spy.mockClear();
  spy.mockImplementation((_type, handler) => {
    handlers.push(handler as (state: AppStateStatus) => void);
    return {
      remove: () => {
        remove();
        handlers = handlers.filter((h) => h !== handler);
      },
    } as ReturnType<typeof AppState.addEventListener>;
  });
});
afterEach(async () => {
  await cleanup();
  jest.restoreAllMocks();
  remove.mockClear();
});

describe('retours au premier plan', () => {
  it('background → active : un événement, avec la durée de l’absence', async () => {
    const seen: number[] = [];
    onAppForeground(({ awayMs }) => seen.push(awayMs));
    await emit('background');
    now += 45_000;
    await emit('active');
    expect(seen).toEqual([45_000]);
  });

  it('`inactive` seul (notifications, appel, permission) : aucun retour', async () => {
    const listener = jest.fn();
    onAppForeground(listener);
    await emit('inactive');
    await emit('active');
    expect(listener).not.toHaveBeenCalled();
    // iOS : active → inactive → background → active compte UNE fois.
    await emit('inactive');
    await emit('background');
    await emit('active');
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('événements répétés du système (active, active) : aucun doublon', async () => {
    const listener = jest.fn();
    onAppForeground(listener);
    await emit('background');
    await emit('background');
    await emit('active');
    await emit('active');
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('plusieurs retours successifs : un événement par retour', async () => {
    const listener = jest.fn();
    onAppForeground(listener);
    for (let i = 0; i < 3; i += 1) {
      await emit('background');
      await emit('active');
    }
    expect(listener).toHaveBeenCalledTimes(3);
  });
});

describe('abonnements', () => {
  it('une seule souscription native pour tous les abonnés, retirée avec le dernier', () => {
    const offA = onAppForeground(jest.fn());
    const offB = onAppStateChange(jest.fn());
    const offC = onAppForeground(jest.fn());
    expect(AppState.addEventListener).toHaveBeenCalledTimes(1);
    offA();
    offB();
    expect(remove).not.toHaveBeenCalled();
    offC();
    expect(remove).toHaveBeenCalledTimes(1);
    expect(handlers).toEqual([]);
  });

  it('useAppForeground : dernier callback rendu, sans réabonnement ; retiré au démontage', async () => {
    const first = jest.fn();
    const second = jest.fn();
    const hook = await renderHook(({ cb }: { cb: () => void }) => useAppForeground(cb), {
      initialProps: { cb: first },
    });
    await hook.rerender({ cb: second });
    expect(AppState.addEventListener).toHaveBeenCalledTimes(1);
    await emit('background');
    await emit('active');
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
    await hook.unmount();
    expect(remove).toHaveBeenCalledTimes(1);
  });

  it('useAppState suit l’état courant', async () => {
    const hook = await renderHook(() => useAppState());
    expect(hook.result.current).toBe('active');
    await emit('background');
    expect(hook.result.current).toBe('background');
    expect(getAppState()).toBe('background');
    await emit('active');
    expect(hook.result.current).toBe('active');
  });
});
