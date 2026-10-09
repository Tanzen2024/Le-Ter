import { useState } from 'react';

import { ApiError } from '../../lib/api-client';
import { ChatPanel } from './ChatPanel';
import { unreadCount } from './chat-state';
import { useGameChat, useSendChatMessage } from './hooks';

type GameChatState = ReturnType<typeof useGameChat>;

/**
 * Chat d'une partie pour l'écran de jeu : suivi dès l'arrivée sur la table (badge des
 * messages non lus), affiché dans le panneau à la demande.
 */
export function useGameChatWithUnread(gameId: string, myId: string | undefined, open: boolean) {
  const chat = useGameChat(gameId);
  const messages = chat.history.data?.messages;
  const lastId = messages?.at(-1)?.id;
  // Dernier message vu (`''` : aucun ; `null` : historique pas encore reçu). L'historique déjà
  // présent à l'arrivée ne compte pas comme non lu ; panneau ouvert, tout est vu.
  const [seenId, setSeenId] = useState<string | null>(null);
  if (messages && (seenId === null || (open && seenId !== (lastId ?? '')))) {
    setSeenId(lastId ?? '');
  }
  const unread = messages && seenId !== null ? unreadCount(messages, seenId || undefined, myId) : 0;
  return { chat, unread };
}

export function GameChat({
  gameId,
  myId,
  chat,
  top,
  bottom,
  onClose,
}: {
  gameId: string;
  myId: string | undefined;
  chat: GameChatState;
  top: number;
  bottom: number;
  onClose: () => void;
}) {
  const sender = useSendChatMessage(gameId);
  const { history } = chat;
  const data = history.data;
  const errorMessage = (err: unknown) =>
    err instanceof ApiError ? err.message : 'Une erreur est survenue. Réessayez.';
  return (
    <ChatPanel
      top={top}
      bottom={bottom}
      onClose={onClose}
      myId={myId}
      messages={data?.messages ?? []}
      loading={history.isPending}
      loadError={history.error ? errorMessage(history.error) : undefined}
      hasMore={data?.hasMore ?? false}
      loadingOlder={chat.loadingOlder}
      onLoadOlder={() => void chat.loadOlder()}
      canSend={data?.canSend ?? false}
      maxLength={data?.maxMessageLength}
      connection={chat.status}
      sending={sender.isPending}
      sendError={sender.error ? errorMessage(sender.error) : undefined}
      onSend={sender.send}
      onDraftChange={() => {
        if (sender.error) sender.reset();
      }}
    />
  );
}
