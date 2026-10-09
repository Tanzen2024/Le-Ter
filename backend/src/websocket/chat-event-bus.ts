import type { ChatMessage, ChatMessageEvent } from '../domain/chat/chat';
import type { GameId } from '../domain/game/game-id';
import type { Logger } from '../utils/logger';
import { gameChatChannel, gameChatRoom } from './game-rooms';
import type { PubSubTransport } from './pubsub-transport';

export type ChatEventListener = (event: ChatMessageEvent) => void;

/** Port de diffusion du chat (D-045) : salle `game:{gameId}:chat`, une par partie. */
export interface ChatEventPublisher {
  publish(event: ChatMessageEvent): void;
}

export interface ChatEventSubscriber {
  /**
   * Abonne une connexion au chat d'UNE partie. N'effectue AUCUN contrôle d'accès : il doit
   * passer par ChatService.subscribe, qui vérifie que le joueur est dans la partie.
   */
  subscribe(gameId: GameId, listener: ChatEventListener): () => void;
}

export type ChatEventBus = ChatEventPublisher & ChatEventSubscriber;

/** Salles en mémoire (une instance, tests) : un abonné ne reçoit que SA partie. */
export class InMemoryChatEventHub implements ChatEventBus {
  private readonly rooms = new Map<string, Set<ChatEventListener>>();

  subscribe(gameId: GameId, listener: ChatEventListener): () => void {
    const room = gameChatRoom(gameId);
    const members = this.rooms.get(room) ?? new Set<ChatEventListener>();
    // Un abonné = une entrée : la même fonction abonnée deux fois reste deux abonnements.
    const entry: ChatEventListener = (event) => listener(event);
    members.add(entry);
    this.rooms.set(room, members);
    return () => {
      members.delete(entry);
      if (members.size === 0) {
        this.rooms.delete(room);
      }
    };
  }

  publish(event: ChatMessageEvent): void {
    for (const listener of [...(this.rooms.get(gameChatRoom(event.gameId)) ?? [])]) {
      listener(event);
    }
  }

  /** Abonnés locaux du chat d'une partie. */
  subscriberCount(gameId: GameId): number {
    return this.rooms.get(gameChatRoom(gameId))?.size ?? 0;
  }
}

const DEFAULT_RESUBSCRIBE_DELAY_MS = 1_000;
const MAX_RESUBSCRIBE_DELAY_MS = 30_000;

/**
 * Chat entre plusieurs instances du backend, sur le même transport Redis Pub/Sub que les
 * événements de partie (PubSubGameEventBus, D-024), canal `le-ter:game:{gameId}:chat`.
 *
 * - Une instance ne s'abonne au canal d'une partie que tant qu'une de ses connexions suit
 *   ce chat ; elle se désabonne avec la dernière.
 * - Le message est déjà enregistré dans PostgreSQL avant d'être publié : une panne de Redis
 *   ne fait jamais échouer un envoi. Le message est alors remis aux seuls abonnés locaux ; les
 *   clients des autres instances le récupèrent par l'historique (rattrapage `after`).
 * - Un message reçu sur le canal d'une partie mais portant un autre `gameId` est ignoré.
 */
export class PubSubChatEventBus implements ChatEventBus {
  private readonly local = new InMemoryChatEventHub();
  private readonly localSubscriptions = new Map<GameId, number>();
  private readonly retries = new Map<GameId, NodeJS.Timeout>();

  constructor(
    private readonly transport: PubSubTransport,
    private readonly logger: Logger,
    private readonly resubscribeDelayMs = DEFAULT_RESUBSCRIBE_DELAY_MS,
  ) {}

  subscribe(gameId: GameId, listener: ChatEventListener): () => void {
    const unsubscribeLocal = this.local.subscribe(gameId, listener);
    const count = (this.localSubscriptions.get(gameId) ?? 0) + 1;
    this.localSubscriptions.set(gameId, count);
    if (count === 1) {
      this.subscribeChannel(gameId, this.resubscribeDelayMs);
    }
    let active = true;
    return () => {
      if (!active) {
        return;
      }
      active = false;
      unsubscribeLocal();
      const remaining = (this.localSubscriptions.get(gameId) ?? 1) - 1;
      if (remaining > 0) {
        this.localSubscriptions.set(gameId, remaining);
        return;
      }
      this.localSubscriptions.delete(gameId);
      clearTimeout(this.retries.get(gameId));
      this.retries.delete(gameId);
      this.transport
        .unsubscribe(gameChatChannel(gameId))
        .catch((err: unknown) => this.logFailure('chat channel unsubscribe failed', gameId, err));
    };
  }

  publish(event: ChatMessageEvent): void {
    this.transport
      .publish(gameChatChannel(event.gameId), JSON.stringify(event))
      .catch((err: unknown) => {
        this.logFailure('chat publish failed, local delivery only', event.gameId, err);
        this.deliver(event);
      });
  }

  private subscribeChannel(gameId: GameId, nextDelayMs: number): void {
    this.transport
      .subscribe(gameChatChannel(gameId), (raw) => this.receive(gameId, raw))
      .catch((err: unknown) => {
        this.logFailure('chat channel subscribe failed', gameId, err);
        if (!this.localSubscriptions.has(gameId) || this.retries.has(gameId)) {
          return;
        }
        const retry = setTimeout(() => {
          this.retries.delete(gameId);
          if (this.localSubscriptions.has(gameId)) {
            this.subscribeChannel(gameId, Math.min(nextDelayMs * 2, MAX_RESUBSCRIBE_DELAY_MS));
          }
        }, nextDelayMs);
        retry.unref();
        this.retries.set(gameId, retry);
      });
  }

  private receive(channelGameId: GameId, raw: string): void {
    let event: ChatMessageEvent;
    try {
      const parsed = JSON.parse(raw) as ChatMessageEvent & {
        message: ChatMessage & { createdAt: string };
      };
      event = {
        ...parsed,
        message: { ...parsed.message, createdAt: new Date(parsed.message.createdAt) },
      };
    } catch (err) {
      this.logFailure('invalid chat message ignored', channelGameId, err);
      return;
    }
    if (
      event.type !== 'chat:message' ||
      event.gameId !== channelGameId ||
      event.message?.gameId !== channelGameId
    ) {
      this.logger.warn('chat event for another game ignored', { gameId: channelGameId });
      return;
    }
    this.deliver(event);
  }

  private deliver(event: ChatMessageEvent): void {
    try {
      this.local.publish(event);
    } catch (err) {
      this.logFailure('chat listener failed', event.gameId, err);
    }
  }

  private logFailure(message: string, gameId: GameId, err: unknown): void {
    this.logger.error(message, { gameId, error: err instanceof Error ? err.message : String(err) });
  }
}
