/// <reference types="jest" />
import { act, renderHook } from '@testing-library/react-native';

import { usePullToRefresh } from './use-pull-to-refresh';

/**
 * « Tirer pour actualiser » : l'indicateur ne suit que le geste du joueur, jamais les
 * relectures automatiques (arrivée sur l'écran, premier plan), qui faisaient bouger la liste.
 */
describe('usePullToRefresh', () => {
  it("n'affiche rien tant que le joueur n'a pas tiré la liste", async () => {
    const { result } = await renderHook(() => usePullToRefresh(() => new Promise(() => undefined)));
    expect(result.current.refreshing).toBe(false);
  });

  it('affiche l’indicateur pendant la relecture demandée, puis le retire', async () => {
    let finish!: () => void;
    const refetch = jest.fn(() => new Promise<void>((resolve) => (finish = resolve)));
    const { result } = await renderHook(() => usePullToRefresh(refetch));

    await act(() => result.current.onRefresh());
    expect(refetch).toHaveBeenCalledTimes(1);
    expect(result.current.refreshing).toBe(true);

    await act(async () => finish());
    expect(result.current.refreshing).toBe(false);
  });

  it('retire l’indicateur même si la relecture échoue', async () => {
    const { result } = await renderHook(() =>
      usePullToRefresh(() => Promise.reject(new Error('réseau'))),
    );
    await act(async () => result.current.onRefresh());
    expect(result.current.refreshing).toBe(false);
  });
});
