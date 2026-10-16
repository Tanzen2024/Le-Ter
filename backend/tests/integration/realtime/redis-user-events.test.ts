import { randomUUID } from 'node:crypto';

import { createClient, type RedisClientType } from 'redis';

import type { UserId } from '../../../src/domain/users/user';
import { createLogger } from '../../../src/utils/logger';
import { RedisPubSubTransport } from '../../../src/websocket/pubsub-transport';
import { PubSubUserEventBus, type UserEvent } from '../../../src/websocket/user-event-bus';

/**
 * Signaux personnels de fin de tournoi (D-106) entre DEUX instances du backend sur un VRAI
 * Redis : l'instance qui publie le classement n'est pas celle où le joueur est connecté.
 * Pub/Sub seulement (aucune clé écrite). Exécuté quand TEST_REDIS_URL est défini.
 */
const redisUrl = process.env.TEST_REDIS_URL;
const describeWithRedis = redisUrl ? describe : describe.skip;
jest.setTimeout(30_000);

describeWithRedis('signaux personnels sur Redis réel (deux instances)', () => {
  const clients: RedisClientType[] = [];
  const logger = createLogger({}, () => undefined);

  async function connection(): Promise<RedisClientType> {
    const client: RedisClientType = createClient({ url: redisUrl });
    client.on('error', () => undefined);
    await client.connect();
    clients.push(client);
    return client;
  }
  const instance = async () =>
    new PubSubUserEventBus(new RedisPubSubTransport(await connection(), await connection()), logger);

  afterAll(async () => {
    await Promise.all(clients.map((c) => c.quit().catch(() => undefined)));
  });

  const until = async (check: () => boolean) => {
    for (let i = 0; i < 100 && !check(); i += 1) await new Promise((r) => setTimeout(r, 30));
  };

  it('publié sur A, reçu sur B par le seul destinataire ; plus rien après désabonnement', async () => {
    const [a, b] = [await instance(), await instance()];
    const ana = randomUUID() as UserId;
    const ben = randomUUID() as UserId;
    const anaGot: UserEvent[] = [];
    const benGot: UserEvent[] = [];
    const stopAna = b.subscribe(ana, (e) => anaGot.push(e));
    b.subscribe(ben, (e) => benGot.push(e));
    await new Promise((r) => setTimeout(r, 300)); // abonnement Redis effectif
    const signal: UserEvent = {
      type: 'notification',
      userId: ana,
      notificationType: 'TOURNAMENT_RESULTS_AVAILABLE',
      tournamentId: randomUUID(),
    };
    a.publish(signal);
    await until(() => anaGot.length > 0);
    expect(anaGot).toEqual([signal]);
    expect(benGot).toEqual([]);

    stopAna();
    await new Promise((r) => setTimeout(r, 300));
    a.publish(signal);
    await new Promise((r) => setTimeout(r, 300));
    expect(anaGot).toHaveLength(1);
  });
});
