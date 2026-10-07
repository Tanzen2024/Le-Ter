import type { RedisClientType } from 'redis';

/**
 * Transport de messages entre instances du backend. Redis Pub/Sub en
 * production ; un courtier en mémoire dans les tests.
 *
 * Livraison « au plus une fois », sans persistance : un message publié pendant
 * une coupure est perdu. Les clients rattrapent grâce à la `version` de chaque
 * événement (trou détecté → relecture de l'état depuis PostgreSQL).
 */
export interface PubSubTransport {
  publish(channel: string, message: string): Promise<void>;
  subscribe(channel: string, onMessage: (message: string) => void): Promise<void>;
  unsubscribe(channel: string): Promise<void>;
}

export class RedisPubSubTransport implements PubSubTransport {
  constructor(
    private readonly publisher: RedisClientType,
    private readonly subscriber: RedisClientType,
  ) {}

  async publish(channel: string, message: string): Promise<void> {
    await this.publisher.publish(channel, message);
  }

  async subscribe(channel: string, onMessage: (message: string) => void): Promise<void> {
    await this.subscriber.subscribe(channel, (message) => onMessage(message));
  }

  async unsubscribe(channel: string): Promise<void> {
    await this.subscriber.unsubscribe(channel);
  }
}
