import {
  DEFAULT_CHAT_PAGE_SIZE,
  MAX_CHAT_PAGE_SIZE,
  normalizeChatContent,
  type ChatMessageId,
} from '../domain/chat/chat';
import { parseIdempotencyKey } from './game.validators';
import { ValidationError } from './validation-error';

/**
 * Validation des entrées du chat (D-045), en HTTP comme en WebSocket. Aucun champ
 * d'identité n'est lu : `senderId`, `playerId`, `username`… envoyés par le client sont
 * ignorés ; l'expéditeur est toujours le titulaire du JWT.
 */

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export interface ChatMessageInput {
  content: string;
  /** Clé d'envoi (en-tête `Idempotency-Key` en HTTP, `clientMessageId` en WebSocket). */
  clientMessageId: string;
}

export function parseChatMessageInput(body: unknown, clientMessageId: unknown): ChatMessageInput {
  const content = normalizeChatContent(asRecord(body).content);
  if (!content.ok) {
    throw new ValidationError({ content: content.reason });
  }
  return { content: content.content, clientMessageId: parseIdempotencyKey(clientMessageId) };
}

export interface ChatPageInput {
  before?: ChatMessageId;
  after?: ChatMessageId;
  limit: number;
}

/** `?before=<id>` (plus anciens), `?after=<id>` (plus récents), `?limit=1..50`. */
export function parseChatPageQuery(query: unknown): ChatPageInput {
  const source = asRecord(query);
  const fields: Record<string, string> = {};
  const cursor = (name: 'before' | 'after'): ChatMessageId | undefined => {
    const value = source[name];
    if (value === undefined) {
      return undefined;
    }
    if (typeof value !== 'string' || !UUID_PATTERN.test(value)) {
      fields[name] = 'Identifiant de message invalide.';
      return undefined;
    }
    return value as ChatMessageId;
  };
  const before = cursor('before');
  const after = cursor('after');
  if (source.before !== undefined && source.after !== undefined) {
    fields.after = '`before` et `after` ne peuvent pas être utilisés ensemble.';
  }
  let limit = DEFAULT_CHAT_PAGE_SIZE;
  if (source.limit !== undefined) {
    const parsed = typeof source.limit === 'string' ? Number(source.limit) : NaN;
    if (!Number.isInteger(parsed) || parsed < 1 || parsed > MAX_CHAT_PAGE_SIZE) {
      fields.limit = `La taille de page doit être comprise entre 1 et ${MAX_CHAT_PAGE_SIZE}.`;
    } else {
      limit = parsed;
    }
  }
  if (Object.keys(fields).length > 0) {
    throw new ValidationError(fields);
  }
  return { ...(before && { before }), ...(after && { after }), limit };
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {};
}
