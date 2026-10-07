import type { PubSubTransport } from '../../src/websocket/pubsub-transport';

/**
 * Courtier Pub/Sub en mémoire qui simule Redis entre plusieurs instances du
 * backend : chaque `connect()` est la connexion d'une instance. Comme Redis,
 * la livraison est asynchrone, ordonnée, et un message publié sans abonné est perdu.
 */
export class InMemoryPubSubBroker {
  private readonly channels = new Map<string, Set<(message: string) => void>>();
  /** Simule une panne de Redis : toute opération échoue. */
  down = false;
  readonly published: { channel: string; message: string }[] = [];

  connect(): PubSubTransport {
    const own = new Map<string, (message: string) => void>();
    return {
      publish: async (channel, message) => {
        this.assertUp();
        this.published.push({ channel, message });
        for (const handler of [...(this.channels.get(channel) ?? [])]) {
          queueMicrotask(() => handler(message));
        }
      },
      subscribe: async (channel, onMessage) => {
        this.assertUp();
        own.set(channel, onMessage);
        const handlers = this.channels.get(channel) ?? new Set();
        handlers.add(onMessage);
        this.channels.set(channel, handlers);
      },
      unsubscribe: async (channel) => {
        this.assertUp();
        const handler = own.get(channel);
        own.delete(channel);
        const handlers = this.channels.get(channel);
        if (handler && handlers) {
          handlers.delete(handler);
          if (handlers.size === 0) {
            this.channels.delete(channel);
          }
        }
      },
    };
  }

  subscriberCount(channel: string): number {
    return this.channels.get(channel)?.size ?? 0;
  }

  /** Remet un message brut sur un canal (message forgé ou corrompu). */
  inject(channel: string, message: string): void {
    for (const handler of this.channels.get(channel) ?? []) {
      handler(message);
    }
  }

  private assertUp(): void {
    if (this.down) {
      throw new Error('Redis indisponible (simulé)');
    }
  }
}

/** Laisse passer les livraisons asynchrones du courtier. */
export const flushPubSub = () => new Promise<void>((resolve) => setImmediate(resolve));
