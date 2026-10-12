import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { randomUUID } from 'expo-crypto';
import { useCallback, useEffect, useRef, useState } from 'react';

import { ApiError } from '../../lib/api-client';
import type { RealtimeClient } from '../../lib/realtime-client';
import { chatApi } from '../../services/chat-api';
import type { ChatHistory, ChatMessage } from '../../types/chat';
import { withAccessToken } from '../auth/session';
import { isGameId } from '../games/hooks';
import { mergeMessages, messageForGame } from './chat-state';
import { realtime as appRealtime, useRealtimeStatus, useRealtimeWake } from './realtime';

/** Historique du chat d'une partie, mis en cache par `gameId` (aucun chat « courant »). */
export const chatKeys = {
  history: (gameId: string) => ['games', gameId, 'chat'] as const,
};

/** Sans connexion temps réel (coupure, serveur injoignable), l'historique est relu. */
const OFFLINE_REFRESH_MS = 5_000;
const CATCH_UP_PAGE = 50;

/**
 * Dernière page relue et fusionnée avec ce qui est déjà affiché (pages plus anciennes
 * comprises). Si la nouvelle page ne recoupe pas l'ancienne, un trou est possible : on
 * repart de la dernière page plutôt que d'afficher un historique incomplet sans le savoir.
 */
export function mergeLatest(previous: ChatHistory | undefined, latest: ChatHistory): ChatHistory {
  if (!previous || previous.messages.length === 0) return latest;
  const first = latest.messages[0];
  const overlaps = !first || !latest.hasMore || previous.messages.some((m) => m.id === first.id);
  if (!overlaps) return latest;
  return {
    ...latest,
    messages: mergeMessages(previous.messages, latest.messages),
    hasMore: latest.hasMore && previous.hasMore,
  };
}

function addMessages(queryClient: QueryClient, gameId: string, incoming: ChatMessage[]): void {
  queryClient.setQueryData<ChatHistory>(chatKeys.history(gameId), (current) =>
    current ? { ...current, messages: mergeMessages(current.messages, incoming) } : current,
  );
}

/**
 * Chat d'une partie : historique (REST), messages en temps réel (salle de la partie), et
 * rattrapage après chaque (re)connexion. Tout vient du serveur ; aucun message local.
 */
export function useGameChat(gameId: string, client: RealtimeClient = appRealtime) {
  const queryClient = useQueryClient();
  const status = useRealtimeStatus(client);
  const valid = isGameId(gameId);
  useRealtimeWake();

  const history = useQuery({
    queryKey: chatKeys.history(gameId),
    queryFn: async () => {
      const latest = await withAccessToken((t) => chatApi.list(t, gameId));
      return mergeLatest(queryClient.getQueryData(chatKeys.history(gameId)), latest);
    },
    enabled: valid,
    refetchInterval: status === 'connected' ? false : OFFLINE_REFRESH_MS,
  });

  // Rattrapage : messages postérieurs au dernier affiché, page par page, sans doublon.
  const catchUp = useCallback(async () => {
    const current = queryClient.getQueryData<ChatHistory>(chatKeys.history(gameId));
    let after = current?.messages.at(-1)?.id;
    if (!after) {
      await queryClient.invalidateQueries({
        queryKey: chatKeys.history(gameId),
      });
      return;
    }
    try {
      for (let page = 0; page < 20 && after; page += 1) {
        const cursor: string = after;
        const res = await withAccessToken((t) =>
          chatApi.list(t, gameId, { after: cursor, limit: CATCH_UP_PAGE }),
        );
        addMessages(queryClient, gameId, res.messages);
        queryClient.setQueryData<ChatHistory>(chatKeys.history(gameId), (c) =>
          c
            ? {
                ...c,
                canSend: res.canSend,
                restriction: res.restriction ?? null,
              }
            : c,
        );
        after = res.hasMore ? res.messages.at(-1)?.id : undefined;
      }
    } catch {
      await queryClient.invalidateQueries({
        queryKey: chatKeys.history(gameId),
      });
    }
  }, [queryClient, gameId]);

  useEffect(() => {
    if (!valid) return;
    return client.subscribeChat(gameId, {
      onEvent: (event) => {
        const message = messageForGame(event, gameId);
        if (message) addMessages(queryClient, gameId, [message]);
      },
      onSubscribed: () => void catchUp(),
    });
  }, [client, queryClient, gameId, valid, catchUp]);

  const [loadingOlder, setLoadingOlder] = useState(false);
  const loadingOlderRef = useRef(false);
  const loadOlder = useCallback(async () => {
    const current = queryClient.getQueryData<ChatHistory>(chatKeys.history(gameId));
    const oldest = current?.messages[0]?.id;
    if (!current?.hasMore || !oldest || loadingOlderRef.current) return;
    loadingOlderRef.current = true;
    setLoadingOlder(true);
    try {
      const page = await withAccessToken((t) => chatApi.list(t, gameId, { before: oldest }));
      queryClient.setQueryData<ChatHistory>(chatKeys.history(gameId), (c) =>
        c
          ? {
              ...c,
              messages: mergeMessages(c.messages, page.messages),
              hasMore: page.hasMore,
            }
          : c,
      );
    } catch {
      // Réessayé au prochain défilement vers le haut.
    } finally {
      loadingOlderRef.current = false;
      setLoadingOlder(false);
    }
  }, [queryClient, gameId]);

  return { history, status, loadOlder, loadingOlder };
}

/**
 * Envoi d'un message. Une clé par INTENTION : tant que le même texte est renvoyé (échec
 * réseau, double appui), la même clé est réutilisée et le serveur ne crée qu'un message.
 * Le champ n'est vidé qu'après la confirmation du serveur (`onSent`).
 */
export function useSendChatMessage(gameId: string) {
  const queryClient = useQueryClient();
  const intent = useRef<{ content: string; key: string } | null>(null);
  const mutation = useMutation({
    mutationFn: ({ content, key }: { content: string; key: string }) =>
      withAccessToken((t) => chatApi.send(t, gameId, content, key)),
    onSuccess: ({ message }) => {
      intent.current = null;
      addMessages(queryClient, gameId, [message]);
    },
    onError: (err) => {
      if (err instanceof ApiError && err.code === 'CHAT_CLOSED') {
        queryClient.setQueryData<ChatHistory>(chatKeys.history(gameId), (c) =>
          c ? { ...c, canSend: false } : c,
        );
      }
      // Restriction posée par l'administration (D-079) : le serveur refuse chaque envoi.
      if (err instanceof ApiError && err.code === 'CHAT_RESTRICTED') {
        void queryClient.invalidateQueries({
          queryKey: chatKeys.history(gameId),
        });
      }
    },
  });

  const send = (content: string, onSent?: () => void) => {
    if (mutation.isPending) return; // Double appui : aucune seconde requête.
    if (intent.current?.content !== content) {
      intent.current = { content, key: randomUUID() };
    }
    mutation.mutate({ content, key: intent.current.key }, { onSuccess: () => onSent?.() });
  };
  return {
    send,
    isPending: mutation.isPending,
    error: mutation.error,
    reset: mutation.reset,
  };
}
