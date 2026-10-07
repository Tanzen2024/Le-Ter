import { randomUUID } from 'node:crypto';

import type { GameEvent } from '../../../src/domain/game/game-events';
import type { PlayerId } from '../../../src/domain/game/game-id';
import { silentLogger } from '../../../src/utils/logger';
import { PubSubGameEventBus } from '../../../src/websocket/pubsub-game-event-bus';
import { registerAndLogin } from '../../fixtures/auth';
import { as, createGameApiTestApp, enterGame, expectStatus } from '../../fixtures/game-api';
import { flushPubSub, InMemoryPubSubBroker } from '../../fixtures/in-memory-pubsub';
import {
  createMigratedDatabase,
  PGLITE_TIMEOUT_MS,
  type TestDatabase,
} from '../../fixtures/pglite';
import { identityRandom } from '../../fixtures/random';
import { testRules } from '../../fixtures/rules';

/**
 * Chaîne complète sur deux instances du backend qui ne partagent que PostgreSQL et le
 * bus (Redis simulé) : HTTP (instance 1) → requireAuth → GameService → PostgreSQL →
 * Pub/Sub → abonné connecté à l'instance 2.
 */
// Suites HTTP complètes (inscription, connexion, PGlite) lancées en parallèle : 5 s ne
// suffisent pas toujours sous charge.
jest.setTimeout(30_000);

let database: TestDatabase;

beforeAll(async () => {
  database = await createMigratedDatabase();
}, PGLITE_TIMEOUT_MS);
afterAll(() => database.close());
afterEach(() => database.reset());

function twoInstances() {
  const broker = new InMemoryPubSubBroker();
  const options = { rules: testRules, random: identityRandom };
  const instance = () =>
    createGameApiTestApp(database.sql, {
      ...options,
      bus: new PubSubGameEventBus(broker.connect(), silentLogger),
    });
  return { broker, one: instance(), two: instance() };
}

describe('API des parties sur deux instances', () => {
  it('une action reçue par l’instance 1 est diffusée à un joueur suivi par l’instance 2', async () => {
    const { broker, one, two } = twoInstances();
    const alice = await registerAndLogin(one.app);
    const bob = await registerAndLogin(one.app);
    // Session en base : le jeton émis par l'instance 1 est valable sur l'instance 2.
    const aliceOn1 = as(one.app, alice.accessToken);
    const bobOn2 = as(two.app, bob.accessToken);

    const created = await aliceOn1.post('/api/games', { maxPlayers: 2 }).expect(201);
    const { gameId } = created.body.game;
    await expectStatus(enterGame(bobOn2, database.sql, gameId), 200);
    await one.games.startGame(gameId, alice.userId as PlayerId);

    const seenByBob: GameEvent[] = [];
    await two.games.subscribe(gameId, bob.userId as PlayerId, (e) => seenByBob.push(e));
    await flushPubSub();

    await aliceOn1
      .post(`/api/games/${gameId}/actions`, {
        commandId: randomUUID(),
        type: 'PLAY_CARD',
        payload: { cardId: 'COEUR-3' },
      })
      .expect(200);
    await flushPubSub();

    expect(seenByBob.map((e) => [e.type, e.version, e.sequence])).toEqual([
      ['game:card_played', 4, 0],
      ['game:turn_changed', 4, 1],
    ]);
    // L'état relu par l'instance 2 vient de PostgreSQL, identique.
    const bobView = await bobOn2.get(`/api/games/${gameId}`).expect(200);
    expect(bobView.body.game.version).toBe(4);
    expect(bobView.body.game.play.nextPlayerId).toBe(bob.userId);
    expect(broker.published.every((m) => m.channel === `le-ter:game:${gameId}:events`)).toBe(true);
  });

  it('démarrage simultané reçu par deux instances : une seule transition, un seul game:started', async () => {
    const { broker, one, two } = twoInstances();
    const alice = await registerAndLogin(one.app);
    const bob = await registerAndLogin(one.app);
    const created = await as(one.app, alice.accessToken)
      .post('/api/games', { maxPlayers: 4 })
      .expect(201);
    const { gameId } = created.body.game;
    await expectStatus(enterGame(as(two.app, bob.accessToken), database.sql, gameId), 200);

    const results = await Promise.all([
      as(one.app, alice.accessToken).post(`/api/games/${gameId}/start`),
      as(two.app, alice.accessToken).post(`/api/games/${gameId}/start`),
    ]);
    await flushPubSub();

    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
    expect(['GAME_ALREADY_STARTED', 'VERSION_CONFLICT']).toContain(
      results.find((r) => r.status === 409)?.body.code,
    );
    const started = broker.published
      .map((m) => JSON.parse(m.message) as { event: GameEvent })
      .filter((m) => m.event.type === 'game:started');
    expect(started).toHaveLength(1);
    expect(started[0]?.event).toMatchObject({ gameId, version: 3, sequence: 0 });

    // Les deux instances relisent le même état depuis PostgreSQL.
    for (const app of [one.app, two.app]) {
      const view = await as(app, bob.accessToken).get(`/api/games/${gameId}`).expect(200);
      expect(view.body.game).toMatchObject({ status: 'in_progress', version: 3 });
    }
  });

  it('R-18 sur deux instances : adhésions simultanées à A et B, une seule réussit', async () => {
    const { one, two } = twoInstances();
    const alice = await registerAndLogin(one.app);
    const bob = await registerAndLogin(two.app);
    const carol = await registerAndLogin(one.app);
    const gameA = (await as(one.app, alice.accessToken).post('/api/games', { maxPlayers: 3 })).body
      .game.gameId;
    const gameB = (await as(two.app, bob.accessToken).post('/api/games', { maxPlayers: 3 })).body
      .game.gameId;

    const results = await Promise.all([
      enterGame(as(one.app, carol.accessToken), database.sql, gameA),
      enterGame(as(two.app, carol.accessToken), database.sql, gameB),
    ]);

    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
    const active = await as(two.app, carol.accessToken).get('/api/games/me/active').expect(200);
    expect(active.body.games).toHaveLength(1);
  });

  it('Redis en panne au démarrage : la transition est enregistrée, la réponse est un succès', async () => {
    const { broker, one, two } = twoInstances();
    const alice = await registerAndLogin(one.app);
    const bob = await registerAndLogin(one.app);
    const created = await as(one.app, alice.accessToken)
      .post('/api/games', { maxPlayers: 2 })
      .expect(201);
    const { gameId } = created.body.game;
    await expectStatus(enterGame(as(one.app, bob.accessToken), database.sql, gameId), 200);
    const localEvents: GameEvent[] = [];
    await one.games.subscribe(gameId, alice.userId as PlayerId, (e) => localEvents.push(e));
    await flushPubSub();

    broker.down = true;
    const published = broker.published.length;
    await as(one.app, alice.accessToken).post(`/api/games/${gameId}/start`).expect(200);
    await flushPubSub();

    // PostgreSQL fait foi : l'autre instance relit la partie démarrée.
    const view = await as(two.app, bob.accessToken).get(`/api/games/${gameId}`).expect(200);
    expect(view.body.game.status).toBe('in_progress');
    // Rien n'est parti sur Redis ; les abonnés locaux reçoivent quand même l'événement.
    expect(broker.published).toHaveLength(published);
    expect(localEvents.map((e) => e.type)).toEqual(['game:started', 'game:hand_dealt']);
  });

  it('Redis en panne : l’action est enregistrée et la réponse HTTP reste un succès', async () => {
    const { broker, one, two } = twoInstances();
    const alice = await registerAndLogin(one.app);
    const created = await as(one.app, alice.accessToken)
      .post('/api/games', { maxPlayers: 3 })
      .expect(201);

    broker.down = true;
    const bob = await registerAndLogin(two.app);
    await expectStatus(
      enterGame(as(two.app, bob.accessToken), database.sql, created.body.game.gameId),
      200,
    );

    const view = await as(one.app, alice.accessToken)
      .get(`/api/games/${created.body.game.gameId}`)
      .expect(200);
    expect(view.body.game.players).toHaveLength(2);
  });
});
