import type { UserId } from '../domain/users/user';
import type { Logger } from '../utils/logger';
import type { PubSubTransport } from './pubsub-transport';

/**
 * Signal personnel (D-106) : « une notification t'attend ». Il ne transporte que le type et le
 * tournoi concerné, jamais le contenu : le client relit ses notifications et le classement par
 * l'API HTTP, seules sources (PostgreSQL). Un signal perdu (Redis indisponible, client
 * déconnecté) ne fait rien perdre : tout est relu à la prochaine ouverture.
 */
export interface UserEvent {
  type: 'notification';
  userId: UserId;
  notificationType: string;
  tournamentId?: string;
}

export type UserEventListener = (event: UserEvent) => void;

export interface UserEventPublisher {
  publish(event: UserEvent): void;
}

export interface UserEventSubscriber {
  /**
   * Abonne une connexion aux signaux d'UN joueur. Aucun contrôle d'accès ici : la passerelle
   * n'abonne une connexion qu'à l'identité de SON jeton.
   */
  subscribe(userId: UserId, listener: UserEventListener): () => void;
}

export type UserEventBus = UserEventPublisher & UserEventSubscriber;

/** Salle `user:{userId}` (convention des salles, voir game-rooms.ts). */
export function userRoom(userId: UserId): string {
  return `user:${userId}`;
}

/** Canal inter-instances (Redis Pub/Sub) des signaux d'un joueur. */
export function userEventChannel(userId: UserId): string {
  return `le-ter:user:${userId}:events`;
}

/** Salles en mémoire (une instance, tests) : un abonné ne reçoit que SES signaux. */
export class InMemoryUserEventHub implements UserEventBus {
  private readonly rooms = new Map<string, Set<UserEventListener>>();

  subscribe(userId: UserId, listener: UserEventListener): () => void {
    const room = userRoom(userId);
    const members = this.rooms.get(room) ?? new Set<UserEventListener>();
    const entry: UserEventListener = (event) => listener(event);
    members.add(entry);
    this.rooms.set(room, members);
    return () => {
      members.delete(entry);
      if (members.size === 0) this.rooms.delete(room);
    };
  }

  publish(event: UserEvent): void {
    for (const listener of [...(this.rooms.get(userRoom(event.userId)) ?? [])]) {
      listener(event);
    }
  }

  subscriberCount(userId: UserId): number {
    return this.rooms.get(userRoom(userId))?.size ?? 0;
  }
}

/**
 * Signaux entre plusieurs instances, sur le transport Redis Pub/Sub existant (D-024). Une
 * instance ne s'abonne au canal d'un joueur que tant qu'une de ses connexions est la sienne.
 * Publication en échec : remise aux seuls abonnés locaux (jamais d'erreur pour l'appelant).
 */
export class PubSubUserEventBus implements UserEventBus {
  private readonly local = new InMemoryUserEventHub();
  private readonly localSubscriptions = new Map<UserId, number>();

  constructor(
    private readonly transport: PubSubTransport,
    private readonly logger: Logger,
  ) {}

  subscribe(userId: UserId, listener: UserEventListener): () => void {
    const unsubscribeLocal = this.local.subscribe(userId, listener);
    const count = (this.localSubscriptions.get(userId) ?? 0) + 1;
    this.localSubscriptions.set(userId, count);
    if (count === 1) {
      this.transport
        .subscribe(userEventChannel(userId), (raw) => this.receive(userId, raw))
        .catch((err: unknown) => this.logFailure('user channel subscribe failed', err));
    }
    let active = true;
    return () => {
      if (!active) return;
      active = false;
      unsubscribeLocal();
      const remaining = (this.localSubscriptions.get(userId) ?? 1) - 1;
      if (remaining > 0) {
        this.localSubscriptions.set(userId, remaining);
        return;
      }
      this.localSubscriptions.delete(userId);
      this.transport
        .unsubscribe(userEventChannel(userId))
        .catch((err: unknown) => this.logFailure('user channel unsubscribe failed', err));
    };
  }

  publish(event: UserEvent): void {
    this.transport
      .publish(userEventChannel(event.userId), JSON.stringify(event))
      .catch((err: unknown) => {
        this.logFailure('user event publish failed, local delivery only', err);
        this.local.publish(event);
      });
  }

  private receive(channelUserId: UserId, raw: string): void {
    let event: UserEvent;
    try {
      event = JSON.parse(raw) as UserEvent;
    } catch (err) {
      this.logFailure('invalid user event ignored', err);
      return;
    }
    // Un signal reçu sur le canal d'un joueur mais destiné à un autre est ignoré.
    if (event?.type !== 'notification' || event.userId !== channelUserId) {
      this.logger.warn('user event for another player ignored');
      return;
    }
    try {
      this.local.publish(event);
    } catch (err) {
      this.logFailure('user event listener failed', err);
    }
  }

  private logFailure(message: string, err: unknown): void {
    // Jamais l'identifiant du joueur en clair dans un message d'erreur d'infrastructure.
    this.logger.error(message, { error: err instanceof Error ? err.message : String(err) });
  }
}
