/// <reference types="jest" />
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react-native';
import type { ReactNode } from 'react';

import type { ChatSubscriptionHandlers, RealtimeClient } from '../../lib/realtime-client';
import { chatApi } from '../../services/chat-api';
import { useAuthStore } from '../../stores/auth-store';
import type { ChatHistory, ChatMessage } from '../../types/chat';
import { useGameChat, useSendChatMessage } from './hooks';

jest.mock('../../services/chat-api', () => ({
  chatApi: { list: jest.fn(), send: jest.fn() },
}));
jest.mock('expo-crypto', () => ({
  randomUUID: () => jest.requireActual('crypto').randomUUID(),
}));

const list = chatApi.list as jest.MockedFunction<typeof chatApi.list>;
const send = chatApi.send as jest.MockedFunction<typeof chatApi.send>;

const GAME = '11111111-1111-4111-8111-111111111111';
const OTHER = '22222222-2222-4222-8222-222222222222';

const message = (id: string, second: number, gameId = GAME): ChatMessage => ({
  id,
  gameId,
  senderId: 'p1',
  senderDisplayName: 'Roly',
  content: `message ${id}`,
  createdAt: `2026-10-08T10:00:${String(second).padStart(2, '0')}.000Z`,
});

const page = (messages: ChatMessage[], extra: Partial<ChatHistory> = {}): ChatHistory => ({
  messages,
  hasMore: false,
  canSend: true,
  maxMessageLength: 500,
  ...extra,
});

/** Faux client temps réel : le test déclenche les confirmations et les événements. */
function fakeRealtime() {
  const handlers = new Map<string, ChatSubscriptionHandlers>();
  const client = {
    getStatus: () => 'connected' as const,
    onStatus: () => () => undefined,
    wake: () => undefined,
    subscribeChat: jest.fn((gameId: string, h: ChatSubscriptionHandlers) => {
      handlers.set(gameId, h);
      return () => handlers.delete(gameId);
    }),
  };
  return { client: client as unknown as RealtimeClient, handlers };
}

function wrapper() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: Infinity },
      mutations: { retry: false, gcTime: Infinity },
    },
  });
  const Wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  return Wrapper;
}

beforeEach(() => {
  jest.clearAllMocks();
  useAuthStore.getState().signIn('jeton');
});

describe('useGameChat', () => {
  it('charge l’historique, puis ajoute les messages temps réel sans doublon', async () => {
    list.mockResolvedValueOnce(page([message('a', 1)]));
    const { client, handlers } = fakeRealtime();
    const { result } = await renderHook(() => useGameChat(GAME, client), {
      wrapper: wrapper(),
    });
    await waitFor(() => expect(result.current.history.data?.messages).toHaveLength(1));
    expect(list).toHaveBeenCalledWith('jeton', GAME);
    expect(client.subscribeChat).toHaveBeenCalledWith(GAME, expect.any(Object));

    const live = {
      type: 'chat:message',
      gameId: GAME,
      message: message('b', 2),
    };
    await act(async () => {
      handlers.get(GAME)!.onEvent(live);
      handlers.get(GAME)!.onEvent(live); // reçu deux fois (ex. reconnexion)
    });
    await waitFor(() =>
      expect(result.current.history.data?.messages.map((m) => m.id)).toEqual(['a', 'b']),
    );
  });

  it('ignore un événement appartenant à une autre partie', async () => {
    list.mockResolvedValueOnce(page([]));
    const { client, handlers } = fakeRealtime();
    const { result } = await renderHook(() => useGameChat(GAME, client), {
      wrapper: wrapper(),
    });
    await waitFor(() => expect(result.current.history.data).toBeDefined());
    await act(async () => {
      handlers.get(GAME)!.onEvent({
        type: 'chat:message',
        gameId: OTHER,
        message: message('x', 1, OTHER),
      });
    });
    expect(result.current.history.data?.messages).toEqual([]);
  });

  it('après reconnexion : rattrape les messages manqués avec `after`, sans doublon', async () => {
    list.mockResolvedValueOnce(page([message('a', 1)]));
    const { client, handlers } = fakeRealtime();
    const { result } = await renderHook(() => useGameChat(GAME, client), {
      wrapper: wrapper(),
    });
    await waitFor(() => expect(result.current.history.data?.messages).toHaveLength(1));

    list.mockResolvedValueOnce(page([message('a', 1), message('b', 2), message('c', 3)]));
    await act(async () => {
      handlers.get(GAME)!.onSubscribed?.();
    });
    await waitFor(() =>
      expect(result.current.history.data?.messages.map((m) => m.id)).toEqual(['a', 'b', 'c']),
    );
    expect(list).toHaveBeenLastCalledWith('jeton', GAME, {
      after: 'a',
      limit: 50,
    });
  });

  it('charge les messages plus anciens', async () => {
    list.mockResolvedValueOnce(page([message('c', 3)], { hasMore: true }));
    const { client } = fakeRealtime();
    const { result } = await renderHook(() => useGameChat(GAME, client), {
      wrapper: wrapper(),
    });
    await waitFor(() => expect(result.current.history.data).toBeDefined());
    list.mockResolvedValueOnce(page([message('a', 1), message('b', 2)]));
    await act(() => result.current.loadOlder());
    expect(list).toHaveBeenLastCalledWith('jeton', GAME, { before: 'c' });
    expect(result.current.history.data?.messages.map((m) => m.id)).toEqual(['a', 'b', 'c']);
    expect(result.current.history.data?.hasMore).toBe(false);
  });
});

describe('useSendChatMessage', () => {
  it('même texte renvoyé après un échec : même clé d’envoi (aucun doublon côté serveur)', async () => {
    const { result } = await renderHook(() => useSendChatMessage(GAME), {
      wrapper: wrapper(),
    });
    send.mockRejectedValueOnce(new Error('réseau'));
    const onFailed = jest.fn();
    await act(async () => result.current.send('salut', onFailed));
    await waitFor(() => expect(result.current.error).toBeTruthy());
    expect(onFailed).toHaveBeenCalledTimes(1);

    send.mockResolvedValueOnce({ message: message('a', 1) });
    await act(async () => result.current.send('salut', onFailed));
    await waitFor(() => expect(result.current.isPending).toBe(false));
    expect(onFailed).toHaveBeenCalledTimes(1);

    const [first, second] = send.mock.calls;
    expect(first?.[3]).toBe(second?.[3]);
    expect(first?.[2]).toBe('salut');
  });

  it('double appui pendant l’envoi : une seule requête', async () => {
    let resolve: (v: { message: ChatMessage }) => void = () => undefined;
    send.mockImplementationOnce(() => new Promise((r) => (resolve = r)));
    const { result } = await renderHook(() => useSendChatMessage(GAME), {
      wrapper: wrapper(),
    });
    await act(async () => result.current.send('vite'));
    await waitFor(() => expect(result.current.isPending).toBe(true));
    await act(async () => result.current.send('vite'));
    expect(send).toHaveBeenCalledTimes(1);
    await act(async () => resolve({ message: message('a', 1) }));
  });
});
