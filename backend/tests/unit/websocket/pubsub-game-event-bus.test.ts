import type { GameEvent } from '../../../src/domain/game/game-events';
import { toPlayerId, type GameId } from '../../../src/domain/game/game-id';
import { createLogger, silentLogger } from '../../../src/utils/logger';
import { gameEventChannel } from '../../../src/websocket/game-rooms';
import { PubSubGameEventBus } from '../../../src/websocket/pubsub-game-event-bus';
import { flushPubSub, InMemoryPubSubBroker } from '../../fixtures/in-memory-pubsub';

const A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' as GameId;
const B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' as GameId;
const alice = toPlayerId('alice');
const bob = toPlayerId('bob');

function event(gameId: GameId, version = 2): GameEvent {
  return {
    eventId: `evt-${gameId}-${version}`,
    gameId,
    version,
    type: 'game:player_joined',
    occurredAt: '2026-10-07T10:00:00.000Z',
    payload: {},
  };
}

/** Deux instances du backend reliées par le même « Redis ». */
function twoInstances() {
  const broker = new InMemoryPubSubBroker();
  return {
    broker,
    instance1: new PubSubGameEventBus(broker.connect(), silentLogger),
    instance2: new PubSubGameEventBus(broker.connect(), silentLogger),
  };
}

describe('PubSubGameEventBus', () => {
  it("diffuse un événement publié sur une instance aux abonnés d'une autre", async () => {
    const { instance1, instance2 } = twoInstances();
    const onInstance1 = jest.fn();
    const onInstance2 = jest.fn();
    instance1.subscribe(A, alice, onInstance1);
    instance2.subscribe(A, bob, onInstance2);
    await flushPubSub();

    instance1.publishToGame(event(A));
    await flushPubSub();

    expect(onInstance1).toHaveBeenCalledWith(event(A));
    expect(onInstance2).toHaveBeenCalledWith(event(A));
  });

  it("n'envoie un événement privé qu'à son destinataire, sur toutes les instances", async () => {
    const { instance1, instance2 } = twoInstances();
    const aliceOn2 = jest.fn();
    const bobOn2 = jest.fn();
    instance2.subscribe(A, alice, aliceOn2);
    instance2.subscribe(A, bob, bobOn2);
    await flushPubSub();

    instance1.publishToPlayer(alice, event(A));
    await flushPubSub();

    expect(aliceOn2).toHaveBeenCalledTimes(1);
    expect(bobOn2).not.toHaveBeenCalled();
  });

  it("isole les parties : un événement de A n'atteint pas B", async () => {
    const { broker, instance1, instance2 } = twoInstances();
    const inB = jest.fn();
    instance2.subscribe(B, alice, inB);
    await flushPubSub();

    instance1.publishToGame(event(A));
    await flushPubSub();

    expect(inB).not.toHaveBeenCalled();
    expect(broker.published.map((m) => m.channel)).toEqual([gameEventChannel(A)]);
  });

  it('ne remet jamais un message dont le gameId diffère de celui du canal', async () => {
    const { broker, instance2 } = twoInstances();
    const inA = jest.fn();
    instance2.subscribe(A, alice, inA);
    await flushPubSub();

    broker.inject(gameEventChannel(A), JSON.stringify({ kind: 'game', event: event(B) }));
    broker.inject(gameEventChannel(A), 'pas du JSON');

    expect(inA).not.toHaveBeenCalled();
  });

  it("ne s'abonne au canal d'une partie que tant qu'un abonné local la suit", async () => {
    const { broker, instance1 } = twoInstances();
    const off1 = instance1.subscribe(A, alice, jest.fn());
    const off2 = instance1.subscribe(A, bob, jest.fn());
    await flushPubSub();
    expect(broker.subscriberCount(gameEventChannel(A))).toBe(1);

    off1();
    off1(); // Se désabonner deux fois est sans effet.
    await flushPubSub();
    expect(broker.subscriberCount(gameEventChannel(A))).toBe(1);

    off2();
    await flushPubSub();
    expect(broker.subscriberCount(gameEventChannel(A))).toBe(0);
    expect(instance1.channelCount).toBe(0);
  });

  it('Redis en panne : publier ne lève pas, les abonnés locaux reçoivent quand même', async () => {
    const broker = new InMemoryPubSubBroker();
    const logLines: Record<string, unknown>[] = [];
    const logger = createLogger({}, (line) => logLines.push(JSON.parse(line)));
    const bus = new PubSubGameEventBus(broker.connect(), logger);
    const local = jest.fn();
    bus.subscribe(A, alice, local);
    await flushPubSub();

    broker.down = true;
    expect(() => bus.publishToGame(event(A))).not.toThrow();
    await flushPubSub();

    expect(local).toHaveBeenCalledWith(event(A));
    expect(logLines).toContainEqual(
      expect.objectContaining({
        level: 'error',
        gameId: A,
        message: expect.stringContaining('publish'),
      }),
    );
  });

  it("un abonné qui lève une erreur n'interrompt pas la réception", async () => {
    const { instance1, instance2 } = twoInstances();
    const received = jest.fn();
    instance2.subscribe(A, alice, () => {
      throw new Error('écran démonté');
    });
    instance2.subscribe(B, bob, received);
    await flushPubSub();

    instance1.publishToGame(event(A));
    instance1.publishToGame(event(B));
    await flushPubSub();

    expect(received).toHaveBeenCalledWith(event(B));
  });
});
