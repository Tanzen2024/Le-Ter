/// <reference types="jest" />
import { act, renderHook } from '@testing-library/react-native';

import { useServerCountdown } from './use-server-countdown';

/**
 * Compte à rebours vers une échéance FIXÉE PAR LE SERVEUR (tour, Poursuivre/Quitter, départ
 * d'une table de tournoi : 10 s depuis D-092). Le téléphone n'affiche que le temps restant ;
 * il ne déclenche jamais lui-même la fin du délai.
 */
const T0 = Date.parse('2026-10-09T10:00:00.000Z');
const iso = (ms: number) => new Date(ms).toISOString();
const DEADLINE = iso(T0 + 10_000);

type Props = { deadlineAt?: string; serverNow?: string; receivedAt: number };

beforeEach(() => {
  jest.useFakeTimers();
  jest.setSystemTime(T0);
});
afterEach(() => {
  jest.restoreAllMocks();
  jest.useRealTimers();
});

function renderCountdown(initial: Props) {
  return renderHook(
    ({ deadlineAt, serverNow, receivedAt }: Props) =>
      useServerCountdown(deadlineAt, serverNow, receivedAt),
    { initialProps: initial },
  );
}

describe('compte à rebours serveur — délai de 10 s (D-092)', () => {
  it('affiche 10 s au début, décompte, puis reste à 0 sans jamais devenir négatif', async () => {
    const { result } = await renderCountdown({ deadlineAt: DEADLINE, serverNow: iso(T0), receivedAt: T0 });
    expect(result.current).toBe(10);
    await act(() => jest.advanceTimersByTime(1_000));
    expect(result.current).toBe(9);
    await act(() => jest.advanceTimersByTime(8_500));
    expect(result.current).toBe(1);
    await act(() => jest.advanceTimersByTime(500));
    expect(result.current).toBe(0);
    await act(() => jest.advanceTimersByTime(5_000));
    expect(result.current).toBe(0);
  });

  it('reconnexion : reprend le temps restant du serveur, sans repartir à 10 s', async () => {
    // Horloge du téléphone en avance de 5 s ; la vue relue après reconnexion arrive à T0 + 4 s.
    const skew = 5_000;
    jest.setSystemTime(T0 + 4_000 + skew);
    const { result } = await renderCountdown({
      deadlineAt: DEADLINE,
      serverNow: iso(T0 + 4_000),
      receivedAt: T0 + 4_000 + skew,
    });
    expect(result.current).toBe(6);
  });

  it('nouveau tour : suit la nouvelle échéance ; minuteur arrêté sans échéance et au démontage', async () => {
    // Intervalles du compte à rebours encore actifs (les autres minuteurs sont ignorés).
    const active = new Set<unknown>();
    const realSet = globalThis.setInterval;
    const realClear = globalThis.clearInterval;
    jest.spyOn(globalThis, 'setInterval').mockImplementation(((fn: () => void, ms?: number) => {
      const id = realSet(fn, ms);
      if (ms === 250) active.add(id);
      return id;
    }) as typeof setInterval);
    jest.spyOn(globalThis, 'clearInterval').mockImplementation(((id?: unknown) => {
      active.delete(id);
      realClear(id as Parameters<typeof clearInterval>[0]);
    }) as typeof clearInterval);

    const { result, rerender, unmount } = await renderCountdown({
      deadlineAt: DEADLINE,
      serverNow: iso(T0),
      receivedAt: T0,
    });
    await act(() => jest.advanceTimersByTime(5_000));
    expect(result.current).toBe(5);
    await rerender({ deadlineAt: iso(T0 + 15_000), serverNow: iso(T0 + 5_000), receivedAt: T0 + 5_000 });
    expect(result.current).toBe(10);
    // Un seul intervalle par échéance, retiré avec elle : pas d'accumulation de minuteurs.
    expect(active.size).toBe(1);
    await rerender({ deadlineAt: undefined, serverNow: iso(T0 + 5_000), receivedAt: T0 + 5_000 });
    expect(result.current).toBeNull();
    expect(active.size).toBe(0);
    await rerender({ deadlineAt: iso(T0 + 15_000), serverNow: iso(T0 + 5_000), receivedAt: T0 + 5_000 });
    expect(active.size).toBe(1);
    await unmount();
    expect(active.size).toBe(0);
  });
});
