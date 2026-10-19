import { createLogger } from '../../../src/utils/logger';
import {
  ADMIN_EVENT_CHANNEL,
  announceToAdmin,
  InMemoryAdminEventHub,
  PubSubAdminEventBus,
  type AdminEvent,
} from '../../../src/websocket/admin-event-bus';
import { InMemoryPubSubBroker } from '../../fixtures/in-memory-pubsub';

/** Signaux de l'administration (D-116) : entre instances, sans donnée, jamais d'erreur. */
const logger = createLogger({}, () => undefined);
const signal: AdminEvent = { type: 'attention', source: 'TOURNAMENT_APPROVAL' };
const flush = () => new Promise((r) => setTimeout(r, 0));

describe('InMemoryAdminEventHub', () => {
  it('tous les abonnés reçoivent ; un abonné en échec n’empêche pas les autres', () => {
    const hub = new InMemoryAdminEventHub();
    const got: AdminEvent[] = [];
    hub.subscribe(() => {
      throw new Error('flux fermé');
    });
    const stop = hub.subscribe((e) => got.push(e));
    hub.publish(signal);
    stop();
    hub.publish(signal);
    expect(got).toEqual([signal]);
    expect(hub.subscriberCount).toBe(1);
  });
});

describe('PubSubAdminEventBus', () => {
  it('publié sur une instance, reçu sur l’autre ; canal quitté au dernier désabonnement', async () => {
    const broker = new InMemoryPubSubBroker();
    const a = new PubSubAdminEventBus(broker.connect(), logger);
    const b = new PubSubAdminEventBus(broker.connect(), logger);
    const got: AdminEvent[] = [];
    const stop1 = b.subscribe((e) => got.push(e));
    const stop2 = b.subscribe((e) => got.push(e));
    await flush();
    a.publish(signal);
    await flush();
    expect(got).toEqual([signal, signal]);
    expect(broker.published).toEqual([
      { channel: ADMIN_EVENT_CHANNEL, message: JSON.stringify(signal) },
    ]);
    stop1();
    stop1(); // idempotent
    stop2();
    await flush();
    a.publish(signal);
    await flush();
    expect(got).toHaveLength(2);
  });

  it('message inconnu ou mal formé ignoré ; seule la source est relayée', async () => {
    const broker = new InMemoryPubSubBroker();
    const bus = new PubSubAdminEventBus(broker.connect(), logger);
    const raw = broker.connect();
    const got: AdminEvent[] = [];
    bus.subscribe((e) => got.push(e));
    await flush();
    await raw.publish(ADMIN_EVENT_CHANNEL, 'pas du json');
    await raw.publish(ADMIN_EVENT_CHANNEL, JSON.stringify({ type: 'attention', source: 'X' }));
    await raw.publish(
      ADMIN_EVENT_CHANNEL,
      JSON.stringify({ type: 'attention', source: 'DETECTION_ALERT', extra: 'secret' }),
    );
    await flush();
    expect(got).toEqual([{ type: 'attention', source: 'DETECTION_ALERT' }]);
  });

  it('Redis indisponible : remise locale, aucune erreur pour l’appelant', async () => {
    const broker = new InMemoryPubSubBroker();
    const bus = new PubSubAdminEventBus(broker.connect(), logger);
    const got: AdminEvent[] = [];
    broker.down = true;
    bus.subscribe((e) => got.push(e));
    expect(() => bus.publish(signal)).not.toThrow();
    await flush();
    expect(got).toEqual([signal]);
  });
});

describe('announceToAdmin', () => {
  it('sans publieur : rien ; publieur en échec : avalé', () => {
    expect(() => announceToAdmin(undefined, 'DETECTION_ALERT', logger)).not.toThrow();
    expect(() =>
      announceToAdmin(
        {
          publish: () => {
            throw new Error('boom');
          },
        },
        'DETECTION_ALERT',
        logger,
      ),
    ).not.toThrow();
  });
});
