import { apiRequest } from '../lib/api-client';
import type { ChatHistory, ChatMessage } from '../types/chat';

/** Endpoints du chat d'une partie (D-045). L'expéditeur est toujours celui du jeton. */
export const chatApi = {
  /** Dernière page ; `before` : page plus ancienne ; `after` : messages manqués. */
  list: (
    accessToken: string,
    gameId: string,
    page: { before?: string; after?: string; limit?: number } = {},
  ) => {
    const query = new URLSearchParams();
    if (page.before) query.set('before', page.before);
    if (page.after) query.set('after', page.after);
    if (page.limit) query.set('limit', String(page.limit));
    const suffix = query.size > 0 ? `?${query.toString()}` : '';
    return apiRequest<ChatHistory>(`/api/games/${gameId}/chat/messages${suffix}`, { accessToken });
  },

  /** Une clé par intention d'envoi : un renvoi (double appui, coupure) ne duplique rien. */
  send: (accessToken: string, gameId: string, content: string, idempotencyKey: string) =>
    apiRequest<{ message: ChatMessage }>(`/api/games/${gameId}/chat/messages`, {
      method: 'POST',
      body: { content },
      accessToken,
      headers: { 'Idempotency-Key': idempotencyKey },
    }),
};
