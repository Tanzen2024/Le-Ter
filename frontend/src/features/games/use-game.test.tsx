/// <reference types="jest" />
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react-native';
import type { ReactNode } from 'react';

import type { GameView } from '../../types/game';
import { gameKeys, useGame } from './hooks';

const GAME = '11111111-1111-4111-8111-111111111111';

let pendingGet: ((game: GameView) => void) | undefined;
jest.mock('../auth/session', () => ({
  withAccessToken: (call: (token: string) => unknown) => call('jeton'),
}));
jest.mock('../../services/games-api', () => ({
  gamesApi: {
    get: jest.fn(
      () =>
        new Promise<{ game: GameView }>((resolve) => {
          pendingGet = (game) => resolve({ game });
        }),
    ),
  },
}));

const view = (version: number, activePlayerId: string) =>
  ({ gameId: GAME, version, activePlayerId, serverNow: '2026-10-14T19:00:00.000Z' }) as GameView;

afterEach(cleanup);

describe('useGame : relecture concurrente d’une carte acceptée', () => {
  it('carte acceptée PENDANT une relecture : l’état d’avant n’écrase pas le nouveau tour', async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    queryClient.setQueryData(gameKeys.detail(GAME), view(6, 'moi'));
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );
    const { result, unmount } = await renderHook(() => useGame(GAME), { wrapper });
    // Relecture partie AVANT la carte (le serveur répond encore v6)…
    await waitFor(() => expect(pendingGet).toBeDefined());
    // …pendant ce temps, la réponse de MA carte est enregistrée : v7, tour de l'adversaire.
    await act(async () => {
      queryClient.setQueryData(gameKeys.detail(GAME), view(7, 'adversaire'));
    });
    await act(async () => {
      pendingGet!(view(6, 'moi'));
    });
    await waitFor(() => expect(result.current.isFetching).toBe(false));
    expect(result.current.data).toMatchObject({ version: 7, activePlayerId: 'adversaire' });
    // Relecture périodique arrêtée : aucun minuteur ne survit au test.
    await unmount();
    queryClient.clear();
  });
});
