import { createClient, type RedisClientType } from 'redis';

/**
 * - `disconnected` : Redis non configuré (REDIS_URL vide) ;
 * - `connected` : les connexions de commande et d'abonnement sont prêtes ;
 * - `unavailable` : Redis configuré mais injoignable (reconnexion en cours).
 */
export type RedisStatus = 'disconnected' | 'connected' | 'unavailable';

export interface RedisConnections {
  /** Commandes et PUBLISH. */
  client: RedisClientType;
  /** Connexion dédiée aux abonnements (une connexion abonnée n'accepte plus d'autres commandes). */
  subscriber: RedisClientType;
}

let connections: RedisConnections | undefined;

/**
 * Ouvre les connexions Redis. Redis n'est jamais la source de vérité (D-024) :
 * une panne n'affecte que la diffusion inter-instances, jamais PostgreSQL.
 *
 * `disableOfflineQueue` : pendant une coupure, une commande échoue tout de suite
 * au lieu de s'accumuler en mémoire et d'être rejouée en retard.
 */
export async function connectRedis(
  url: string,
  onError: (err: Error) => void,
): Promise<RedisConnections> {
  if (connections) {
    throw new Error('Redis déjà connecté');
  }
  const client: RedisClientType = createClient({ url, disableOfflineQueue: true });
  const subscriber: RedisClientType = client.duplicate();
  // Sans écouteur 'error', une coupure Redis arrêterait le processus.
  client.on('error', onError);
  subscriber.on('error', onError);
  try {
    await Promise.all([client.connect(), subscriber.connect()]);
  } catch (err) {
    client.destroy();
    subscriber.destroy();
    throw err;
  }
  connections = { client, subscriber };
  return connections;
}

export async function disconnectRedis(): Promise<void> {
  const current = connections;
  connections = undefined;
  if (current) {
    await Promise.allSettled([current.client.close(), current.subscriber.close()]);
  }
}

export function getRedisStatus(): RedisStatus {
  if (!connections) {
    return 'disconnected';
  }
  return connections.client.isReady && connections.subscriber.isReady ? 'connected' : 'unavailable';
}
