import { GameVersionConflictError } from '../../../src/domain/game/game-errors';
import type { GameEvent } from '../../../src/domain/game/game-events';
import { GameTimerRegistry } from '../../../src/services/game/game-timer-registry';
import { silentLogger } from '../../../src/utils/logger';
import { PubSubGameEventBus } from '../../../src/websocket/pubsub-game-event-bus';
import { allowAllParticipation } from '../../fixtures/game-service.fixture';
import { createSessionGameInstance } from '../../fixtures/session-games';
import { flushPubSub, InMemoryPubSubBroker } from '../../fixtures/in-memory-pubsub';
import {
  createMigratedDatabase,
  PGLITE_TIMEOUT_MS,
  type TestDatabase,
} from '../../fixtures/pglite';
import { seedUsers, testPlayerId } from '../../fixtures/users';

/**
 * Architecture cible : plusieurs instances du backend, PostgreSQL comme source
 * de vérité commune, Redis Pub/Sub pour la diffusion. Chaque instance a ses
 * propres files, timers et abonnés ; elles ne partagent que la base et le bus.
 */
let database: TestDatabase;
let broker: InMemoryPubSubBroker;
const timers: GameTimerRegistry[] = [];

function startInstance() {
  const bus = new PubSubGameEventBus(broker.connect(), silentLogger);
  const registry = new GameTimerRegistry();
  timers.push(registry);
  // Parcours réel (D-033) : créer ouvre une session, rejoindre passe par la session.
  return createSessionGameInstance(database.sql, {
    publisher: bus,
    subscriber: bus,
    timers: registry,
    participationPolicy: () => allowAllParticipation,
  });
}

beforeAll(async () => {
  database = await createMigratedDatabase();
}, PGLITE_TIMEOUT_MS);
afterAll(async () => {
  await database.close();
});
beforeEach(async () => {
  broker = new InMemoryPubSubBroker();
  // Les joueurs sont des comptes existants (clés étrangères vers users, migration 0003).
  await seedUsers(database.sql, ['alice', 'bob', 'carol', 'dave']);
});
afterEach(async () => {
  timers.splice(0).forEach((t) => t.cancelAll());
  await database.reset();
});

const alice = testPlayerId('alice');
const bob = testPlayerId('bob');
const carol = testPlayerId('carol');
const dave = testPlayerId('dave');

describe('Plusieurs instances (PostgreSQL + Pub/Sub)', () => {
  it("une commande traitée par l'instance 1 est diffusée aux joueurs connectés à l'instance 2", async () => {
    const instance1 = startInstance();
    const instance2 = startInstance();
    const game = await instance1.createGame(alice, { maxPlayers: 3 });

    const inbox: GameEvent[] = [];
    await instance2.subscribe(game.id, alice, (e) => inbox.push(e));
    await flushPubSub();

    await instance1.joinGame(game.id, bob);
    await flushPubSub();

    expect(inbox).toEqual([
      expect.objectContaining({ gameId: game.id, version: 2, type: 'game:player_joined' }),
    ]);
    // L'instance 2 lit le même état, sans cache à synchroniser.
    expect((await instance2.getGameForPlayer(game.id, alice)).version).toBe(2);
  });

  it('des commandes concurrentes sur deux instances ne perdent aucune écriture', async () => {
    const instance1 = startInstance();
    const instance2 = startInstance();
    const game = await instance1.createGame(alice, { maxPlayers: 4 });

    const results = await Promise.allSettled([
      instance1.joinGame(game.id, bob),
      instance2.joinGame(game.id, carol),
      instance1.joinGame(game.id, dave),
    ]);

    const failures = results.filter((r): r is PromiseRejectedResult => r.status === 'rejected');
    failures.forEach((f) => expect(f.reason).toBeInstanceOf(GameVersionConflictError));

    const stored = await instance2.getGameForPlayer(game.id, alice);
    const succeeded = results.length - failures.length;
    expect(stored.players).toHaveLength(1 + succeeded);
    expect(stored.version).toBe(1 + succeeded);
    expect(new Set(stored.players.map((p) => p.seat)).size).toBe(stored.players.length);
  });

  it("Redis en panne : la commande est enregistrée dans PostgreSQL et l'état reste cohérent", async () => {
    const instance1 = startInstance();
    const instance2 = startInstance();
    const game = await instance1.createGame(alice, { maxPlayers: 2 });

    broker.down = true;
    await instance1.joinGame(game.id, bob);
    broker.down = false;

    const view = await instance2.getGameForPlayer(game.id, bob);
    expect(view.version).toBe(2);
    expect(view.players.map((p) => p.playerId)).toEqual([alice, bob]);
  });

  it("une partie modifiée sur une instance n'affecte pas une autre partie", async () => {
    const instance1 = startInstance();
    const instance2 = startInstance();
    const gameA = await instance1.createGame(alice, { maxPlayers: 2 });
    const gameB = await instance2.createGame(carol, { maxPlayers: 2 });
    const inboxB: GameEvent[] = [];
    await instance2.subscribe(gameB.id, carol, (e) => inboxB.push(e));
    await flushPubSub();

    await instance1.joinGame(gameA.id, bob);
    await flushPubSub();

    expect(inboxB).toEqual([]);
    expect((await instance2.getGameForPlayer(gameB.id, carol)).version).toBe(1);
  });
});
