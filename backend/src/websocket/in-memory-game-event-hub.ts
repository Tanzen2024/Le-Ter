import type { GameEvent } from '../domain/game/game-events';
import type { GameId, PlayerId } from '../domain/game/game-id';
import type {
  GameEventListener,
  GameEventPublisher,
  GameEventSubscriber,
} from './game-event-publisher';
import { gameRoom } from './game-rooms';

interface Subscription {
  playerId: PlayerId;
  listener: GameEventListener;
}

/**
 * Hub en mémoire qui reproduit le modèle « une salle par partie ».
 * Sert de référence de comportement pour le futur adaptateur temps réel.
 */
export class InMemoryGameEventHub implements GameEventPublisher, GameEventSubscriber {
  private readonly rooms = new Map<string, Set<Subscription>>();

  subscribe(gameId: GameId, playerId: PlayerId, listener: GameEventListener): () => void {
    const room = gameRoom(gameId);
    const members = this.rooms.get(room) ?? new Set<Subscription>();
    const subscription: Subscription = { playerId, listener };
    members.add(subscription);
    this.rooms.set(room, members);

    return () => {
      members.delete(subscription);
      if (members.size === 0) {
        this.rooms.delete(room);
      }
    };
  }

  publishToGame(event: GameEvent): void {
    for (const { listener } of this.membersOf(event.gameId)) {
      listener(event);
    }
  }

  publishToPlayer(playerId: PlayerId, event: GameEvent): void {
    for (const sub of this.membersOf(event.gameId)) {
      if (sub.playerId === playerId) {
        sub.listener(event);
      }
    }
  }

  /** Nombre de salles ouvertes (une par partie ayant au moins un abonné). */
  get roomCount(): number {
    return this.rooms.size;
  }

  private membersOf(gameId: GameId): Subscription[] {
    return [...(this.rooms.get(gameRoom(gameId)) ?? [])];
  }
}
