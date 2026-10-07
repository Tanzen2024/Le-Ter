import type { GameEvent } from '../domain/game/game-events';
import type { GameId, PlayerId } from '../domain/game/game-id';
import type { Logger } from '../utils/logger';
import type {
  GameEventListener,
  GameEventPublisher,
  GameEventSubscriber,
} from './game-event-publisher';
import { gameEventChannel } from './game-rooms';
import { InMemoryGameEventHub } from './in-memory-game-event-hub';
import type { PubSubTransport } from './pubsub-transport';

/** Message échangé entre instances sur le canal d'une partie. */
type BusMessage =
  { kind: 'game'; event: GameEvent } | { kind: 'player'; playerId: PlayerId; event: GameEvent };

/**
 * Diffusion des événements de partie entre plusieurs instances du backend (D-024).
 *
 * - Publier envoie l'événement sur le canal de SA partie (`gameEventChannel`).
 * - Chaque instance ne s'abonne qu'aux canaux des parties suivies par au moins
 *   une de ses connexions, et se désabonne quand la dernière part.
 * - À la réception, l'événement est remis aux abonnés locaux par un
 *   InMemoryGameEventHub : mêmes salles, mêmes règles de diffusion privée.
 *   L'instance qui publie reçoit aussi son propre message : un seul chemin de livraison.
 *
 * - Un abonnement au canal qui échoue (Redis coupé) est retenté avec un délai
 *   croissant tant qu'un abonné local suit la partie : sans cela, le client Redis ne
 *   le rejouerait pas à la reconnexion et l'instance ne recevrait plus rien de la partie.
 *
 * Panne de Redis : publier ne lève jamais d'erreur (l'état est déjà enregistré
 * dans PostgreSQL). L'événement est alors remis aux seuls abonnés locaux et les
 * autres instances le perdent ; leurs clients détectent le trou de version et
 * relisent l'état. Une remise en double est sans effet (version déjà vue).
 */
export interface PubSubGameEventBusOptions {
  /** Premier délai avant de retenter un abonnement échoué ; doublé à chaque échec. */
  resubscribeDelayMs?: number;
}

const DEFAULT_RESUBSCRIBE_DELAY_MS = 1_000;
const MAX_RESUBSCRIBE_DELAY_MS = 30_000;

export class PubSubGameEventBus implements GameEventPublisher, GameEventSubscriber {
  private readonly local = new InMemoryGameEventHub();
  /** Nombre d'abonnements locaux par partie : décide de l'abonnement au canal. */
  private readonly localSubscriptions = new Map<GameId, number>();
  /** Nouvel essai d'abonnement programmé, par partie. */
  private readonly retries = new Map<GameId, NodeJS.Timeout>();
  private readonly resubscribeDelayMs: number;

  constructor(
    private readonly transport: PubSubTransport,
    private readonly logger: Logger,
    options: PubSubGameEventBusOptions = {},
  ) {
    this.resubscribeDelayMs = options.resubscribeDelayMs ?? DEFAULT_RESUBSCRIBE_DELAY_MS;
  }

  subscribe(gameId: GameId, playerId: PlayerId, listener: GameEventListener): () => void {
    const unsubscribeLocal = this.local.subscribe(gameId, playerId, listener);
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
        .unsubscribe(gameEventChannel(gameId))
        .catch((err: unknown) => this.logFailure('event channel unsubscribe failed', gameId, err));
    };
  }

  publishToGame(event: GameEvent): void {
    this.send({ kind: 'game', event });
  }

  publishToPlayer(playerId: PlayerId, event: GameEvent): void {
    this.send({ kind: 'player', playerId, event });
  }

  /** Canaux de partie auxquels cette instance est abonnée. */
  get channelCount(): number {
    return this.localSubscriptions.size;
  }

  private subscribeChannel(gameId: GameId, nextDelayMs: number): void {
    this.transport
      .subscribe(gameEventChannel(gameId), (raw) => this.receive(gameId, raw))
      .catch((err: unknown) => {
        this.logFailure('event channel subscribe failed', gameId, err);
        if (!this.localSubscriptions.has(gameId) || this.retries.has(gameId)) {
          return;
        }
        const retry = setTimeout(() => {
          this.retries.delete(gameId);
          if (this.localSubscriptions.has(gameId)) {
            this.subscribeChannel(gameId, Math.min(nextDelayMs * 2, MAX_RESUBSCRIBE_DELAY_MS));
          }
        }, nextDelayMs);
        retry.unref(); // N'empêche pas l'arrêt du processus.
        this.retries.set(gameId, retry);
      });
  }

  private send(message: BusMessage): void {
    const { gameId } = message.event;
    this.transport
      .publish(gameEventChannel(gameId), JSON.stringify(message))
      .catch((err: unknown) => {
        this.logFailure('event publish failed, local delivery only', gameId, err);
        this.deliver(message);
      });
  }

  private receive(channelGameId: GameId, raw: string): void {
    let message: BusMessage;
    try {
      message = JSON.parse(raw) as BusMessage;
    } catch (err) {
      this.logFailure('invalid event message ignored', channelGameId, err);
      return;
    }
    // Un message n'est jamais remis hors de la partie de son canal.
    if (message.event?.gameId !== channelGameId) {
      this.logger.warn('event for another game ignored', { gameId: channelGameId });
      return;
    }
    this.deliver(message);
  }

  private deliver(message: BusMessage): void {
    try {
      if (message.kind === 'player') {
        this.local.publishToPlayer(message.playerId, message.event);
      } else {
        this.local.publishToGame(message.event);
      }
    } catch (err) {
      // Un abonné défaillant ne doit pas interrompre la réception des autres messages.
      this.logFailure('event listener failed', message.event.gameId, err);
    }
  }

  private logFailure(message: string, gameId: GameId, err: unknown): void {
    this.logger.error(message, { gameId, error: err instanceof Error ? err.message : String(err) });
  }
}
