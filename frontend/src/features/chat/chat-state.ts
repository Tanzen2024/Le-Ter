import type { ChatMessage, ChatMessageEvent } from '../../types/chat';

/**
 * Logique pure du chat côté client (D-045). Le serveur est la source de vérité : on ne
 * fabrique jamais de message, on ne fait que fusionner ceux qu'il a confirmés.
 */

/** Ordre du serveur : (createdAt, id). */
function compare(a: ChatMessage, b: ChatMessage): number {
  if (a.createdAt !== b.createdAt) return a.createdAt < b.createdAt ? -1 : 1;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/**
 * Fusionne des messages reçus (REST, temps réel, accusé d'envoi) sans doublon : un même
 * `id` n'apparaît qu'une fois, quelle que soit la voie par laquelle il est arrivé.
 */
export function mergeMessages(
  current: readonly ChatMessage[],
  incoming: readonly ChatMessage[],
): ChatMessage[] {
  if (incoming.length === 0) return current as ChatMessage[];
  const byId = new Map(current.map((m) => [m.id, m]));
  let changed = false;
  for (const message of incoming) {
    if (!byId.has(message.id)) {
      byId.set(message.id, message);
      changed = true;
    }
  }
  return changed ? [...byId.values()].sort(compare) : (current as ChatMessage[]);
}

/**
 * Un événement n'est retenu que s'il appartient à la partie affichée, en-tête ET message
 * (défense en profondeur : le serveur n'envoie déjà que les salles abonnées).
 */
export function messageForGame(event: unknown, gameId: string): ChatMessage | undefined {
  if (typeof event !== 'object' || event === null) return undefined;
  const e = event as Partial<ChatMessageEvent>;
  const m = e.message;
  if (e.type !== 'chat:message' || e.gameId !== gameId || !m || m.gameId !== gameId) {
    return undefined;
  }
  const valid =
    typeof m.id === 'string' &&
    typeof m.senderId === 'string' &&
    typeof m.senderDisplayName === 'string' &&
    typeof m.content === 'string' &&
    typeof m.createdAt === 'string';
  return valid ? m : undefined;
}

/** Messages des autres joueurs arrivés après `seenId` (badge « non lus »). */
export function unreadCount(
  messages: readonly ChatMessage[],
  seenId: string | undefined,
  myId: string | undefined,
): number {
  const start = seenId ? messages.findIndex((m) => m.id === seenId) + 1 : 0;
  return messages.slice(start).filter((m) => m.senderId !== myId).length;
}
