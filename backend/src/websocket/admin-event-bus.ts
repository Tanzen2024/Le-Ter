import type { Logger } from '../utils/logger';
import type { PubSubTransport } from './pubsub-transport';

/**
 * Signal de l'administration (D-116) : « un point d'attention a changé ». Il ne transporte que
 * sa source, jamais de donnée : l'administration relit ses compteurs par l'API HTTP
 * (`GET /api/admin/attention`), seule source (PostgreSQL). Un signal perdu (Redis indisponible,
 * navigateur déconnecté) ne fait rien perdre : les compteurs sont relus à la reconnexion et
 * périodiquement.
 */
export type AdminAttentionSource = 'DETECTION_ALERT' | 'TOURNAMENT_APPROVAL' | 'COMPLAINT';

export interface AdminEvent {
  type: 'attention';
  source: AdminAttentionSource;
}

export type AdminEventListener = (event: AdminEvent) => void;

export interface AdminEventPublisher {
  /** Ne lève jamais : un signal est facultatif (D-024). */
  publish(event: AdminEvent): void;
}

export interface AdminEventSubscriber {
  /**
   * Abonne un flux d'administration. Aucun contrôle d'accès ici : seule la route
   * `/api/admin/events`, derrière la garde de l'administration, s'abonne.
   */
  subscribe(listener: AdminEventListener): () => void;
}

export type AdminEventBus = AdminEventPublisher & AdminEventSubscriber;

/** Canal inter-instances (Redis Pub/Sub) des signaux de l'administration. */
export const ADMIN_EVENT_CHANNEL = 'le-ter:admin:events';

const SOURCES: ReadonlySet<string> = new Set<AdminAttentionSource>([
  'DETECTION_ALERT',
  'TOURNAMENT_APPROVAL',
  'COMPLAINT',
]);

function isAdminEvent(value: unknown): value is AdminEvent {
  const event = value as Partial<AdminEvent> | null;
  return (
    event?.type === 'attention' && typeof event.source === 'string' && SOURCES.has(event.source)
  );
}

/** Abonnés en mémoire (une instance, tests). Un abonné en échec n'empêche pas les autres. */
export class InMemoryAdminEventHub implements AdminEventBus {
  private readonly listeners = new Set<AdminEventListener>();

  subscribe(listener: AdminEventListener): () => void {
    const entry: AdminEventListener = (event) => listener(event);
    this.listeners.add(entry);
    return () => {
      this.listeners.delete(entry);
    };
  }

  publish(event: AdminEvent): void {
    for (const listener of [...this.listeners]) {
      try {
        listener(event);
      } catch {
        // Flux fermé entre-temps : rien à faire, les compteurs restent dans PostgreSQL.
      }
    }
  }

  get subscriberCount(): number {
    return this.listeners.size;
  }
}

/**
 * Signaux entre plusieurs instances, sur le transport Redis Pub/Sub existant (D-024). Une
 * instance ne s'abonne au canal que tant qu'un flux d'administration y est ouvert.
 * Publication en échec : remise aux seuls abonnés locaux (jamais d'erreur pour l'appelant).
 */
export class PubSubAdminEventBus implements AdminEventBus {
  private readonly local = new InMemoryAdminEventHub();

  constructor(
    private readonly transport: PubSubTransport,
    private readonly logger: Logger,
  ) {}

  subscribe(listener: AdminEventListener): () => void {
    const unsubscribeLocal = this.local.subscribe(listener);
    if (this.local.subscriberCount === 1) {
      this.transport
        .subscribe(ADMIN_EVENT_CHANNEL, (raw) => this.receive(raw))
        .catch((err: unknown) => this.logFailure('admin channel subscribe failed', err));
    }
    let active = true;
    return () => {
      if (!active) return;
      active = false;
      unsubscribeLocal();
      if (this.local.subscriberCount > 0) return;
      this.transport
        .unsubscribe(ADMIN_EVENT_CHANNEL)
        .catch((err: unknown) => this.logFailure('admin channel unsubscribe failed', err));
    };
  }

  publish(event: AdminEvent): void {
    this.transport.publish(ADMIN_EVENT_CHANNEL, JSON.stringify(event)).catch((err: unknown) => {
      this.logFailure('admin event publish failed, local delivery only', err);
      this.local.publish(event);
    });
  }

  private receive(raw: string): void {
    let event: unknown;
    try {
      event = JSON.parse(raw);
    } catch (err) {
      this.logFailure('invalid admin event ignored', err);
      return;
    }
    if (!isAdminEvent(event)) {
      this.logger.warn('unknown admin event ignored');
      return;
    }
    this.local.publish({ type: 'attention', source: event.source });
  }

  private logFailure(message: string, err: unknown): void {
    this.logger.error(message, { error: err instanceof Error ? err.message : String(err) });
  }
}

/** Publie sans jamais lever (signal facultatif : la donnée est déjà dans PostgreSQL). */
export function announceToAdmin(
  publisher: AdminEventPublisher | undefined,
  source: AdminAttentionSource,
  logger: Logger,
): void {
  if (!publisher) return;
  try {
    publisher.publish({ type: 'attention', source });
  } catch (err) {
    logger.warn('admin realtime signal failed', {
      source,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}
