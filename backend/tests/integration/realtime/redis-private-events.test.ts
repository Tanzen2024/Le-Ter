import { randomUUID } from 'node:crypto';

import { Pool } from 'pg';
import { createClient, type RedisClientType } from 'redis';

import { loadMigrations, runMigrations } from '../../../src/database/migrator';
import { createPgSqlClient, type SqlClient } from '../../../src/database/sql-client';
import type { CardId } from '../../../src/domain/cards/card';
import { GameAccessDeniedError } from '../../../src/domain/game/game-errors';
import type { GameEvent } from '../../../src/domain/game/game-events';
import type { GameId, PlayerId } from '../../../src/domain/game/game-id';
import { GameTimerRegistry } from '../../../src/services/game/game-timer-registry';
import { silentLogger } from '../../../src/utils/logger';
import { gameEventChannel } from '../../../src/websocket/game-rooms';
import { PubSubGameEventBus } from '../../../src/websocket/pubsub-game-event-bus';
import { RedisPubSubTransport } from '../../../src/websocket/pubsub-transport';
import { createSessionGameInstance } from '../../fixtures/session-games';
import { seedUsers, testPlayerId } from '../../fixtures/users';

/**
 * CONFIDENTIALITÉ DES MAINS sur l'infrastructure RÉELLE (PostgreSQL + Redis, Docker).
 *
 * Les joueurs ne s'abonnent jamais à Redis : Redis relie les instances du backend (D-024) ;
 * chaque instance remet les événements à SES joueurs connectés par GameService.subscribe,
 * qui filtre les événements privés par destinataire. Le test reproduit donc le chemin réel :
 * J1 est connecté à l'instance A, J2 à l'instance B, la partie est démarrée par l'instance
 * C ; tout transite par Redis. On inspecte le CONTENU reçu par chaque joueur, comparé aux
 * mains réellement distribuées (lues dans PostgreSQL, source de vérité), ainsi que les
 * messages qui circulent réellement sur Redis.
 *
 * Exécuté quand TEST_DATABASE_URL et TEST_REDIS_URL sont définis (schéma PostgreSQL
 * temporaire, supprimé à la fin).
 */
const databaseUrl = process.env.TEST_DATABASE_URL;
const redisUrl = process.env.TEST_REDIS_URL;
const describeWithInfra = databaseUrl && redisUrl ? describe : describe.skip;
jest.setTimeout(60_000);

const CARD_PATTERN = /(COEUR|PIQUE|TREFLE|ETOILE)-\d+/g;
const cardsIn = (value: unknown): string[] => JSON.stringify(value).match(CARD_PATTERN) ?? [];

/** Attend une condition observable (abonnements Redis, événements reçus), sans délai fixe. */
async function until(condition: () => boolean | Promise<boolean>, label: string): Promise<void> {
  const deadline = Date.now() + 10_000;
  while (!(await condition())) {
    if (Date.now() > deadline) {
      throw new Error(`condition non atteinte : ${label}`);
    }
    await new Promise((r) => setImmediate(r));
  }
}

describeWithInfra('Confidentialité de game:hand_dealt — Redis réel, trois instances', () => {
  const schema = `privacy_test_${randomUUID().replace(/-/g, '')}`;
  let pool: Pool;
  let sql: SqlClient;
  const clients: RedisClientType[] = [];
  const stops: (() => void)[] = [];

  beforeAll(async () => {
    const admin = new Pool({ connectionString: databaseUrl, max: 1 });
    await admin.query(`CREATE SCHEMA ${schema}`);
    await admin.end();
    pool = new Pool({
      connectionString: databaseUrl,
      max: 12,
      options: `-c search_path=${schema}`,
    });
    sql = createPgSqlClient(pool);
    await runMigrations(sql, await loadMigrations());
  });

  afterAll(async () => {
    stops.forEach((stop) => stop());
    await Promise.allSettled(clients.map((c) => c.close()));
    await pool?.query(`DROP SCHEMA ${schema} CASCADE`);
    await pool?.end();
  });

  async function redisClient(): Promise<RedisClientType> {
    const client: RedisClientType = createClient({ url: redisUrl });
    client.on('error', () => undefined);
    await client.connect();
    clients.push(client);
    return client;
  }

  /** Une instance du backend : ses propres connexions Redis, son bus, son GameService. */
  async function backendInstance() {
    const bus = new PubSubGameEventBus(
      new RedisPubSubTransport(await redisClient(), await redisClient()),
      silentLogger,
    );
    const timers = new GameTimerRegistry();
    const instance = createSessionGameInstance(sql, {
      publisher: bus,
      subscriber: bus,
      timers,
      turnDurationMs: 60_000,
      decisionWindowMs: 60_000,
    });
    stops.push(() => instance.stop());
    return instance;
  }

  /** Mains RÉELLEMENT distribuées, lues dans PostgreSQL (source de vérité). */
  async function dealtHands(gameId: GameId): Promise<Record<string, CardId[]>> {
    const { rows } = await sql.query<{ hands: Record<string, CardId[]> }>(
      `SELECT state -> 'play' -> 'hands' AS hands FROM games WHERE id = $1`,
      [gameId],
    );
    return rows[0]!.hands;
  }

  it('J1 et J2 reçoivent chacun leur main, jamais celle de l’autre ; game:started sans carte', async () => {
    const instanceA = await backendInstance(); // connexion de J1
    const instanceB = await backendInstance(); // connexion de J2
    const instanceC = await backendInstance(); // traite les commandes (création, démarrage)
    const [j1, j2, j3] = ['j1', 'j2', 'j3'].map((n) => `${n}-${randomUUID().slice(0, 8)}`);
    await seedUsers(sql, [j1!, j2!, j3!]);
    const J1 = testPlayerId(j1!) as PlayerId;
    const J2 = testPlayerId(j2!) as PlayerId;
    const J3 = testPlayerId(j3!) as PlayerId;

    const { game } = await instanceC.sessions.createSession(J1, { maxPlayers: 3 });
    await instanceC.joinGame(game.id, J2);
    // J3 reste hors de la table : rejoindre la session pendant que la partie attend ferait de
    // lui un joueur de cette partie (D-033), il pourrait alors légitimement s'y abonner.

    // Abonnements des joueurs, chacun sur SON instance (seul chemin d'abonnement autorisé).
    const receivedByJ1: GameEvent[] = [];
    const receivedByJ2: GameEvent[] = [];
    await instanceA.games.subscribe(game.id, J1, (e) => receivedByJ1.push(e));
    await instanceB.games.subscribe(game.id, J2, (e) => receivedByJ2.push(e));
    // J3 n'est pas joueur de la partie : il ne peut pas s'y abonner.
    await expect(instanceA.games.subscribe(game.id, J3, () => undefined)).rejects.toThrow(
      GameAccessDeniedError,
    );

    // Observateur du fil Redis réel de la partie.
    const wire: { kind: string; playerId?: string; event: GameEvent }[] = [];
    const tap = await redisClient();
    await tap.subscribe(gameEventChannel(game.id), (raw) => wire.push(JSON.parse(raw)));
    const channel = gameEventChannel(game.id);
    const probe = await redisClient();
    await until(async () => {
      const counts = (await probe.pubSubNumSub(channel)) as Record<string, number>;
      return (counts[channel] ?? 0) >= 3; // instances A et B + l'observateur
    }, 'abonnements Redis actifs');

    await instanceC.startGame(game.id, J1);
    const hands = await dealtHands(game.id);
    const handJ1 = hands[J1]!;
    const handJ2 = hands[J2]!;
    expect(handJ1).toHaveLength(5);
    expect(handJ2).toHaveLength(5);

    const dealtTo = (events: GameEvent[]) => events.filter((e) => e.type === 'game:hand_dealt');
    await until(
      () => dealtTo(receivedByJ1).length >= 1 && dealtTo(receivedByJ2).length >= 1,
      'mains reçues par J1 et J2',
    );
    await until(() => wire.some((m) => m.event.type === 'game:started'), 'fil Redis');

    // --- TEST C : chacun reçoit UNIQUEMENT sa main, avec son contenu réel ----------------
    expect(dealtTo(receivedByJ1)).toHaveLength(1);
    expect(dealtTo(receivedByJ2)).toHaveLength(1);
    const [dealtJ1] = dealtTo(receivedByJ1) as [GameEvent];
    expect(dealtJ1.gameId).toBe(game.id);
    expect(dealtJ1.payload).toEqual({
      playerId: J1,
      cards: handJ1,
      batches: [handJ1.slice(0, 3), handJ1.slice(3)],
    });
    const [dealtJ2] = dealtTo(receivedByJ2) as [GameEvent];
    expect(dealtJ2.gameId).toBe(game.id);
    expect(dealtJ2.payload).toEqual({
      playerId: J2,
      cards: handJ2,
      batches: [handJ2.slice(0, 3), handJ2.slice(3)],
    });

    // --- TEST D / E : absence de fuite dans TOUT ce que chaque joueur a reçu -------------
    const streamJ1 = JSON.stringify(receivedByJ1);
    const streamJ2 = JSON.stringify(receivedByJ2);
    for (const card of handJ1) {
      expect(streamJ1).toContain(`"${card}"`);
      expect(streamJ2).not.toContain(`"${card}"`);
    }
    for (const card of handJ2) {
      expect(streamJ2).toContain(`"${card}"`);
      expect(streamJ1).not.toContain(`"${card}"`);
    }
    // Les seules cartes que chacun a reçues sont les siennes.
    expect(new Set(cardsIn(receivedByJ1))).toEqual(new Set(handJ1));
    expect(new Set(cardsIn(receivedByJ2))).toEqual(new Set(handJ2));
    // Aucun événement ne nomme l'autre joueur comme destinataire d'une main.
    expect(dealtTo(receivedByJ1).every((e) => e.payload.playerId === J1)).toBe(true);
    expect(dealtTo(receivedByJ2).every((e) => e.payload.playerId === J2)).toBe(true);

    // --- TEST F : l'événement public game:started ne contient aucune carte privée ---------
    for (const stream of [receivedByJ1, receivedByJ2]) {
      const started = stream.find((e) => e.type === 'game:started');
      expect(started).toBeDefined();
      expect(started!.payload).toMatchObject({ firstPlayerId: J1, controllerId: J1 });
      expect(cardsIn(started)).toEqual([]);
      for (const card of [...handJ1, ...handJ2]) {
        expect(JSON.stringify(started)).not.toContain(card);
      }
    }

    // --- Fil Redis réel : ce qui circule entre les instances -----------------------------
    const publicMessages = wire.filter((m) => m.kind === 'game');
    const privateMessages = wire.filter((m) => m.kind === 'player');
    expect(publicMessages.every((m) => cardsIn(m).length === 0)).toBe(true);
    expect(privateMessages.map((m) => m.playerId).sort()).toEqual([J1, J2].sort());
    for (const message of privateMessages) {
      // Un message privé ne transporte que la main de SON destinataire.
      const own = message.playerId === J1 ? handJ1 : handJ2;
      expect(message.event.payload.playerId).toBe(message.playerId);
      expect(new Set(cardsIn(message))).toEqual(new Set(own));
    }
  });
});
