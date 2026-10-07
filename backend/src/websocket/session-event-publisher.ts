import type { SessionEvent } from '../domain/sessions/session-events';
import type { SessionId } from '../domain/sessions/session';
import type { Logger } from '../utils/logger';
import { sessionEventChannel } from './game-rooms';
import type { PubSubTransport } from './pubsub-transport';

/** Port de diffusion des événements de session (D-033). */
export interface SessionEventPublisher {
  publish(event: SessionEvent): void;
}

export type SessionEventListener = (event: SessionEvent) => void;

/**
 * Diffusion locale (une instance, tests). Les abonnés d'une session ne reçoivent que
 * les événements de CETTE session.
 */
export class InMemorySessionEventHub implements SessionEventPublisher {
  private readonly listeners = new Map<SessionId, Set<SessionEventListener>>();

  subscribe(sessionId: SessionId, listener: SessionEventListener): () => void {
    const set = this.listeners.get(sessionId) ?? new Set();
    set.add(listener);
    this.listeners.set(sessionId, set);
    return () => {
      set.delete(listener);
      if (set.size === 0) {
        this.listeners.delete(sessionId);
      }
    };
  }

  publish(event: SessionEvent): void {
    for (const listener of [...(this.listeners.get(event.sessionId) ?? [])]) {
      listener(event);
    }
  }
}

/**
 * Diffusion inter-instances sur Redis, canal `le-ter:session:{sessionId}:events`, et
 * remise aux abonnés locaux. Comme pour les parties (D-024) : publier ne lève jamais
 * d'erreur, la mutation est déjà enregistrée dans PostgreSQL. L'abonnement des clients
 * viendra avec le transport temps réel (phase D).
 */
export class PubSubSessionEventPublisher implements SessionEventPublisher {
  constructor(
    private readonly transport: PubSubTransport,
    private readonly local: InMemorySessionEventHub,
    private readonly logger: Logger,
  ) {}

  publish(event: SessionEvent): void {
    this.local.publish(event);
    this.transport
      .publish(sessionEventChannel(event.sessionId), JSON.stringify(event))
      .catch((err: unknown) =>
        this.logger.error('session event publish failed', {
          sessionId: event.sessionId,
          type: event.type,
          error: err instanceof Error ? err.message : String(err),
        }),
      );
  }
}
