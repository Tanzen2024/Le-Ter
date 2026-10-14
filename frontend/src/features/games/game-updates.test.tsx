/// <reference types="jest" />
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, renderHook } from '@testing-library/react-native';
import type { ReactNode } from 'react';

import type { GameSubscriptionHandlers } from '../../lib/realtime-client';
import type { GameView } from '../../types/game';
import { useGameUpdates } from './game-updates';
import { gameKeys } from './hooks';

jest.mock('../chat/realtime', () => ({ realtime: { subscribeGame: jest.fn(() => () => undefined) } }));

const GAME = '11111111-1111-4111-8111-111111111111';
const OTHER = '22222222-2222-4222-8222-222222222222';

function setup(version = 5) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  queryClient.setQueryData(gameKeys.detail(GAME), { gameId: GAME, version } as GameView);
  const invalidate = jest.spyOn(queryClient, 'invalidateQueries').mockResolvedValue(undefined);
  const handlers = new Map<string, GameSubscriptionHandlers>();
  const unsubscribe = jest.fn();
  const client = {
    subscribeGame: jest.fn((gameId: string, h: GameSubscriptionHandlers) => {
      handlers.set(gameId, h);
      return unsubscribe;
    }),
  };
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  return { queryClient, invalidate, handlers, unsubscribe, client, wrapper };
}

afterEach(cleanup);

describe('useGameUpdates : carte acceptée par le serveur → état relu aussitôt (D-101)', () => {
  it('nouvelle version : relecture immédiate de CETTE partie, sans attendre les 3 s', async () => {
    const { invalidate, handlers, client, wrapper } = setup(5);
    await renderHook(() => useGameUpdates(GAME, client), { wrapper });
    handlers.get(GAME)!.onChanged(6);
    expect(invalidate).toHaveBeenCalledTimes(1);
    expect(invalidate).toHaveBeenCalledWith({ queryKey: gameKeys.detail(GAME), exact: true });
  });

  it('version déjà affichée (ma propre carte, signal reçu deux fois) : aucune relecture', async () => {
    const { invalidate, handlers, client, wrapper, queryClient } = setup(5);
    await renderHook(() => useGameUpdates(GAME, client), { wrapper });
    handlers.get(GAME)!.onChanged(5);
    handlers.get(GAME)!.onChanged(4);
    expect(invalidate).not.toHaveBeenCalled();
    // Première relecture faite, le même signal rejoué ne relit plus.
    handlers.get(GAME)!.onChanged(6);
    queryClient.setQueryData(gameKeys.detail(GAME), { gameId: GAME, version: 6 } as GameView);
    handlers.get(GAME)!.onChanged(6);
    expect(invalidate).toHaveBeenCalledTimes(1);
  });

  it('(ré)abonnement confirmé, reconnexion comprise : rattrapage par relecture', async () => {
    const { invalidate, handlers, client, wrapper } = setup();
    await renderHook(() => useGameUpdates(GAME, client), { wrapper });
    handlers.get(GAME)!.onSubscribed?.();
    expect(invalidate).toHaveBeenCalledTimes(1);
  });

  it('une partie = un abonnement ; changement de partie et démontage : désabonnement', async () => {
    const { client, unsubscribe, wrapper } = setup();
    const view = await renderHook(({ id }: { id: string }) => useGameUpdates(id, client), {
      wrapper,
      initialProps: { id: GAME },
    });
    expect(client.subscribeGame).toHaveBeenCalledWith(GAME, expect.any(Object));
    await view.rerender({ id: OTHER });
    expect(unsubscribe).toHaveBeenCalledTimes(1);
    expect(client.subscribeGame).toHaveBeenLastCalledWith(OTHER, expect.any(Object));
    await view.unmount();
    expect(unsubscribe).toHaveBeenCalledTimes(2);
  });

  it('identifiant invalide : aucun abonnement', async () => {
    const { client, wrapper } = setup();
    await renderHook(() => useGameUpdates('', client), { wrapper });
    expect(client.subscribeGame).not.toHaveBeenCalled();
  });
});
