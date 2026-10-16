import type { UserId } from '../../../src/domain/users/user';
import { createLogger } from '../../../src/utils/logger';
import type { PubSubTransport } from '../../../src/websocket/pubsub-transport';
import {
  InMemoryUserEventHub,
  PubSubUserEventBus,
  userEventChannel,
  type UserEvent,
} from '../../../src/websocket/user-event-bus';

/** Signaux personnels (D-106) : chacun ne reçoit que les siens ; une panne ne casse rien. */
const ANA = 'a0000000-0000-4000-8000-000000000001' as UserId;
const BEN = 'b0000000-0000-4000-8000-000000000002' as UserId;
const signal = (userId: UserId): UserEvent => ({
  type: 'notification',
  userId,
  notificationType: 'TOURNAMENT_RESULTS_AVAILABLE',
  tournamentId: 't1',
});
const logger = createLogger({}, () => undefined);

/** Transport en mémoire (comme Redis Pub/Sub) ; `failPublish` simule une panne. */
function fakeTransport(failPublish = false): PubSubTransport & { channels: Set<string> } {
  const handlers = new Map<string, (m: string) => void>();
  return {
    channels: new Set(),
    async publish(channel, message) {
      if (failPublish) throw new Error('Redis indisponible');
      handlers.get(channel)?.(message);
    },
    async subscribe(channel, onMessage) {
      handlers.set(channel, onMessage);
      this.channels.add(channel);
    },
    async unsubscribe(channel) {
      handlers.delete(channel);
      this.channels.delete(channel);
    },
  };
}

it('en mémoire : seul le destinataire reçoit, désabonnement effectif', () => {
  const hub = new InMemoryUserEventHub();
  const got: UserEvent[] = [];
  const stop = hub.subscribe(ANA, (e) => got.push(e));
  hub.publish(signal(BEN));
  hub.publish(signal(ANA));
  expect(got).toEqual([signal(ANA)]);
  stop();
  hub.publish(signal(ANA));
  expect(got).toHaveLength(1);
  expect(hub.subscriberCount(ANA)).toBe(0);
});

it('Pub/Sub : canal par joueur, signal d’un autre joueur ignoré, désabonnement du canal', async () => {
  const transport = fakeTransport();
  const bus = new PubSubUserEventBus(transport, logger);
  const got: UserEvent[] = [];
  const stop = bus.subscribe(ANA, (e) => got.push(e));
  await Promise.resolve();
  expect(transport.channels.has(userEventChannel(ANA))).toBe(true);
  bus.publish(signal(ANA));
  await transport.publish(userEventChannel(ANA), JSON.stringify(signal(BEN)));
  await new Promise((r) => setImmediate(r));
  expect(got).toEqual([signal(ANA)]);
  stop();
  await new Promise((r) => setImmediate(r));
  expect(transport.channels.size).toBe(0);
});

it('Pub/Sub en panne : aucune erreur pour l’appelant, remise locale', async () => {
  const bus = new PubSubUserEventBus(fakeTransport(true), logger);
  const got: UserEvent[] = [];
  bus.subscribe(ANA, (e) => got.push(e));
  expect(() => bus.publish(signal(ANA))).not.toThrow();
  await new Promise((r) => setImmediate(r));
  expect(got).toEqual([signal(ANA)]);
});
