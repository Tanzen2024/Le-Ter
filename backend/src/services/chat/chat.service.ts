import {
  ChatClosedError,
  ChatMessageKeyReusedError,
  ChatRateLimitedError,
  ChatRestrictedError,
  MAX_CHAT_MESSAGE_LENGTH,
  newChatMessageId,
  type ChatMessage,
  type ChatMessageId,
  type ChatPage,
} from '../../domain/chat/chat';
import { GameAccessDeniedError, GameNotFoundError } from '../../domain/game/game-errors';
import type { GameId, PlayerId } from '../../domain/game/game-id';
import type { ChatAccess, ChatRepository } from '../../repositories/chat.repository';
import { ValidationError } from '../../validators/validation-error';
import type { Logger } from '../../utils/logger';
import type { ChatEventBus, ChatEventListener } from '../../websocket/chat-event-bus';

export interface ChatRateLimit {
  /** Messages acceptés par joueur et par fenêtre. */
  max: number;
  windowMs: number;
}

/** Anti-spam : 10 messages par 10 s et par joueur, toutes parties et transports confondus. */
export const DEFAULT_CHAT_RATE_LIMIT: ChatRateLimit = { max: 10, windowMs: 10_000 };

export interface ChatServiceDependencies {
  repository: ChatRepository;
  bus: ChatEventBus;
  logger: Logger;
  clock?: () => Date;
  rateLimit?: ChatRateLimit;
}

/** Chat vu par un joueur : une page d'historique et l'état d'envoi. */
export interface ChatHistory extends ChatPage {
  /** Faux quand la partie est terminée (D-045) ou le chat du joueur restreint (D-079). */
  canSend: boolean;
  /** Restriction du chat du lecteur (D-079) ; `endsAt` ISO, null : durée indéterminée. */
  restriction: { endsAt: string | null } | null;
  maxMessageLength: number;
}

/**
 * Chat de partie (D-045), indépendant du moteur : il ne passe jamais par GameService, ne
 * verrouille jamais une partie et ne modifie aucun état de jeu. Il ne fait que vérifier
 * qu'un joueur appartient à la partie (`game_players`) avant toute lecture, tout envoi et
 * tout abonnement temps réel.
 *
 * L'expéditeur est TOUJOURS l'appelant authentifié (JWT) ; l'identifiant et la date du
 * message sont produits ici ; le pseudo affiché est lu en base.
 */
export class ChatService {
  private readonly clock: () => Date;
  private readonly rateLimit: ChatRateLimit;
  private readonly windows = new Map<PlayerId, { count: number; resetAt: number }>();

  constructor(private readonly deps: ChatServiceDependencies) {
    this.clock = deps.clock ?? (() => new Date());
    this.rateLimit = deps.rateLimit ?? DEFAULT_CHAT_RATE_LIMIT;
  }

  async listMessages(
    gameId: GameId,
    viewerId: PlayerId,
    query: { before?: ChatMessageId; after?: ChatMessageId; limit: number },
  ): Promise<ChatHistory> {
    const access = await this.requirePlayer(gameId, viewerId);
    const page = await this.deps.repository.listPage(gameId, query);
    if (!page) {
      throw new ValidationError({
        [query.before ? 'before' : 'after']: 'Message de référence inconnu dans cette partie.',
      });
    }
    const restriction = access.chatRestriction;
    return {
      ...page,
      canSend: access.status !== 'finished' && !restriction,
      restriction: restriction ? { endsAt: restriction.endsAt?.toISOString() ?? null } : null,
      maxMessageLength: MAX_CHAT_MESSAGE_LENGTH,
    };
  }

  /**
   * Envoie un message (contenu déjà normalisé par le validateur). Une même clé d'envoi
   * renvoie le message déjà enregistré (`replayed`) sans en créer ni en diffuser un second.
   * Le message n'est diffusé qu'APRÈS son enregistrement, tel qu'il est stocké.
   */
  async sendMessage(
    gameId: GameId,
    senderId: PlayerId,
    input: { content: string; clientMessageId: string },
  ): Promise<{ message: ChatMessage; replayed: boolean }> {
    const access = await this.requirePlayer(gameId, senderId);
    const existing = await this.findReplay(gameId, senderId, input);
    if (existing) {
      return { message: existing, replayed: true };
    }
    if (access.status === 'finished') {
      throw new ChatClosedError(gameId);
    }
    // Restriction vérifiée à CHAQUE envoi, HTTP comme WebSocket, puis dans l'insertion SQL.
    if (access.chatRestriction) {
      throw new ChatRestrictedError(access.chatRestriction.endsAt);
    }
    this.consumeRate(senderId);

    const message = await this.deps.repository.insert({
      id: newChatMessageId(),
      gameId,
      senderId,
      content: input.content,
      clientMessageId: input.clientMessageId,
      createdAt: this.clock(),
    });
    if (!message) {
      // Refus de l'insertion : envoi concurrent de la même clé, ou état changé entre-temps.
      const concurrent = await this.findReplay(gameId, senderId, input);
      if (concurrent) {
        return { message: concurrent, replayed: true };
      }
      const now = await this.requirePlayer(gameId, senderId);
      if (now.status === 'finished') throw new ChatClosedError(gameId);
      if (now.chatRestriction) throw new ChatRestrictedError(now.chatRestriction.endsAt);
      throw new GameAccessDeniedError(gameId, senderId);
    }

    try {
      this.deps.bus.publish({ type: 'chat:message', gameId, message });
    } catch (err) {
      // Le message est enregistré : une panne de diffusion ne fait jamais échouer l'envoi.
      this.deps.logger.error('chat publish failed', {
        gameId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
    return { message, replayed: false };
  }

  /**
   * Abonne une connexion au chat d'une partie, après contrôle d'appartenance. Le
   * listener ne reçoit que les messages de CETTE partie.
   */
  async subscribe(
    gameId: GameId,
    playerId: PlayerId,
    listener: ChatEventListener,
  ): Promise<() => void> {
    await this.requirePlayer(gameId, playerId);
    return this.deps.bus.subscribe(gameId, (event) => {
      if (event.gameId === gameId) {
        listener(event);
      }
    });
  }

  private async requirePlayer(gameId: GameId, playerId: PlayerId): Promise<ChatAccess> {
    const access = await this.deps.repository.findAccess(gameId, playerId, this.clock());
    if (!access) {
      throw new GameNotFoundError(gameId);
    }
    if (!access.isPlayer) {
      throw new GameAccessDeniedError(gameId, playerId);
    }
    return access;
  }

  private async findReplay(
    gameId: GameId,
    senderId: PlayerId,
    input: { content: string; clientMessageId: string },
  ): Promise<ChatMessage | null> {
    const existing = await this.deps.repository.findByClientMessageId(
      gameId,
      senderId,
      input.clientMessageId,
    );
    if (existing && existing.content !== input.content) {
      throw new ChatMessageKeyReusedError();
    }
    return existing;
  }

  private consumeRate(senderId: PlayerId): void {
    const now = this.clock().getTime();
    if (this.windows.size > 10_000) {
      for (const [key, entry] of this.windows) {
        if (entry.resetAt <= now) {
          this.windows.delete(key);
        }
      }
    }
    let entry = this.windows.get(senderId);
    if (!entry || entry.resetAt <= now) {
      entry = { count: 0, resetAt: now + this.rateLimit.windowMs };
      this.windows.set(senderId, entry);
    }
    if (entry.count >= this.rateLimit.max) {
      throw new ChatRateLimitedError(entry.resetAt - now);
    }
    entry.count += 1;
  }
}
