import { randomUUID } from 'node:crypto';

import { Pool } from 'pg';
import { createClient, type RedisClientType } from 'redis';

import { loadMigrations, runMigrations } from '../../../src/database/migrator';
import { createPgSqlClient, type SqlClient } from '../../../src/database/sql-client';
import type { CardId } from '../../../src/domain/cards/card';
import type { GameEvent } from '../../../src/domain/game/game-events';
import type { GameId, PlayerId } from '../../../src/domain/game/game-id';
import { TURN_DURATION_MS } from '../../../src/domain/rules/rule-set';
import type { SessionId } from '../../../src/domain/sessions/session';
import { silentLogger } from '../../../src/utils/logger';
import { gameEventChannel } from '../../../src/websocket/game-rooms';
import { PubSubGameEventBus } from '../../../src/websocket/pubsub-game-event-bus';
import { RedisPubSubTransport } from '../../../src/websocket/pubsub-transport';
import { registerAndLogin } from '../../fixtures/auth';
import {
  as,
  createGameApiTestApp,
  expectStatus,
  type GameApiTestContext,
} from '../../fixtures/game-api';
import { deckForHands, decksRandom } from '../../fixtures/random';

/**
 * D-036 sur l'infrastructure RÉELLE (HTTP + PostgreSQL + Redis, Docker), timer de
 * PRODUCTION (15 s) :
 *
 *   A (J1) : 5♠ 10♣ 8♥ 9⭐ 10♥
 *   B      : 7♠ 9♠ 4♥ 6♣ 8♠
 *
 * Tour 1 joué À LA MAIN (A 5♠, B 9♠ : B prend le contrôle). Tour 2 : B OUVRE le tour et ne
 * joue pas → plus petite carte de sa main (4♥). Puis A, joueur suivant, ne joue pas → il
 * possède des ♥ → plus petite ♥ (8♥), pas le 9⭐ ni le 10♣.
 *
 * Exécuté quand TEST_DATABASE_URL et TEST_REDIS_URL sont définis (schéma temporaire).
 */
const databaseUrl = process.env.TEST_DATABASE_URL;
const redisUrl = process.env.TEST_REDIS_URL;
const describeWithInfra = databaseUrl && redisUrl ? describe : describe.skip;
jest.setTimeout(120_000);

const H_A: CardId[] = ['PIQUE-5', 'TREFLE-10', 'COEUR-8', 'ETOILE-9', 'COEUR-10'];
const H_B: CardId[] = ['PIQUE-7', 'PIQUE-9', 'COEUR-4', 'TREFLE-6', 'PIQUE-8'];

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function until<T>(read: () => Promise<T>, done: (value: T) => boolean, timeoutMs = 10_000) {
  const limit = Date.now() + timeoutMs;
  for (;;) {
    const value = await read();
    if (done(value) || Date.now() > limit) {
      return value;
    }
    await sleep(100);
  }
}

describeWithInfra(
  'D-036 — timeout réel : ouvreur du tour 2 puis joueur suivant (PG + Redis)',
  () => {
    const schema = `d036_test_${randomUUID().replace(/-/g, '')}`;
    let pool: Pool;
    let sql: SqlClient;
    let ctx: GameApiTestContext;
    const clients: RedisClientType[] = [];

    async function redisClient(): Promise<RedisClientType> {
      const client: RedisClientType = createClient({ url: redisUrl });
      client.on('error', () => undefined);
      await client.connect();
      clients.push(client);
      return client;
    }

    beforeAll(async () => {
      const admin = new Pool({ connectionString: databaseUrl, max: 1 });
      await admin.query(`CREATE SCHEMA ${schema}`);
      await admin.end();
      pool = new Pool({
        connectionString: databaseUrl,
        max: 8,
        options: `-c search_path=${schema}`,
      });
      sql = createPgSqlClient(pool);
      await runMigrations(sql, await loadMigrations());
    });

    afterAll(async () => {
      await ctx?.stopTimers();
      await ctx?.games.idle();
      await Promise.allSettled(clients.map((c) => c.close()));
      await pool?.query(`DROP SCHEMA ${schema} CASCADE`);
      await pool?.end();
    });

    it('jeu manuel au tour 1, puis timeouts réels : 4♥ (ouvreur), 8♥ (famille d’ouverture)', async () => {
      const bus = new PubSubGameEventBus(
        new RedisPubSubTransport(await redisClient(), await redisClient()),
        silentLogger,
      );
      ctx = createGameApiTestApp(sql, { bus, random: decksRandom(deckForHands([H_A, H_B])) });
      const newPlayer = async () => {
        const s = await registerAndLogin(ctx.app);
        return { id: s.userId as PlayerId, api: as(ctx.app, s.accessToken) };
      };
      const [A, B] = [await newPlayer(), await newPlayer()];

      const created = await expectStatus(A.api.post('/api/sessions', { maxPlayers: 2 }), 201);
      const sessionId = created.body.session.sessionId as SessionId;
      const gameId = created.body.game.gameId as GameId;
      await expectStatus(B.api.post(`/api/sessions/${sessionId}/join`), 200);
      await expectStatus(B.api.post(`/api/games/${gameId}/join`), 200);

      // Observateur du fil Redis réel de la partie.
      const wire: { event: GameEvent }[] = [];
      const tap = await redisClient();
      await tap.subscribe(gameEventChannel(gameId), (raw) => wire.push(JSON.parse(raw)));
      const eventsA: GameEvent[] = [];
      await ctx.games.subscribe(gameId, A.id, (e) => eventsA.push(e));

      await expectStatus(A.api.post(`/api/games/${gameId}/start`), 200);

      // --- Tour 1 : jeu MANUEL, chaque joueur choisit sa carte (glisser-déposer → HTTP) ---
      await expectStatus(
        A.api.post(`/api/games/${gameId}/actions`, {
          commandId: randomUUID(),
          type: 'PLAY_CARD',
          payload: { cardId: 'PIQUE-5' },
        }),
        200,
      );
      const afterManual = await expectStatus(
        B.api.post(`/api/games/${gameId}/actions`, {
          commandId: randomUUID(),
          type: 'PLAY_CARD',
          payload: { cardId: 'PIQUE-9' },
        }),
        200,
      );
      const manualVersion = afterManual.body.game.version as number;
      expect(afterManual.body.game.activePlayerId).toBe(B.id); // B ouvre le tour 2
      expect(ctx.logLines.filter((l) => l.message === 'AUTO_CARD_PLAY')).toEqual([]);

      // --- Tour 2 : B OUVRE et ne joue pas → timeout réel → plus petite carte : 4♥ ---------
      const deadlineB = Date.parse(afterManual.body.game.turnDeadlineAt as string);
      expect(deadlineB - Date.parse(afterManual.body.game.turnStartedAt as string)).toBe(TURN_DURATION_MS);
      await sleep(Math.max(0, deadlineB - Date.now()));
      const viewA = await until(
        () => expectStatus(A.api.get(`/api/games/${gameId}`), 200),
        (res) => res.body.game.activePlayerId === A.id,
      );
      expect(viewA.body.game.play.currentTrick).toEqual([{ playerId: B.id, cardId: 'COEUR-4' }]);
      expect(viewA.body.game.version).toBe(manualVersion + 2);

      // PostgreSQL (source de vérité).
      const stateRow = async () =>
        (
          await sql.query<{
            state: { play: { currentTrick: unknown[]; hands: Record<string, CardId[]> } };
            version: number;
          }>('SELECT state, version FROM games WHERE id = $1', [gameId])
        ).rows[0]!;
      let row = await stateRow();
      expect(row.state.play.currentTrick).toEqual([{ playerId: B.id, cardId: 'COEUR-4' }]);
      expect(row.state.play.hands[B.id]).toEqual(['PIQUE-7', 'TREFLE-6', 'PIQUE-8']);

      // --- A, joueur suivant, ne joue pas → timeout réel → famille ♥ : 8♥ ------------------
      const deadlineA = Date.parse(viewA.body.game.turnDeadlineAt as string);
      await sleep(Math.max(0, deadlineA - Date.now()));
      const viewAfter = await until(
        () => expectStatus(A.api.get(`/api/games/${gameId}`), 200),
        (res) => res.body.game.play.completedTricks.length === 2,
      );
      await ctx.games.idle();
      expect(viewAfter.body.game.play.completedTricks[1].plays).toEqual([
        { playerId: B.id, cardId: 'COEUR-4' },
        { playerId: A.id, cardId: 'COEUR-8' },
      ]);
      // Vue « frontend » de A : sa main privée à jour.
      expect(viewAfter.body.game.play.myHand).toEqual(['TREFLE-10', 'ETOILE-9', 'COEUR-10']);
      row = await stateRow();
      expect(row.version).toBe(manualVersion + 4);
      expect(row.state.play.hands[A.id]).toEqual(['TREFLE-10', 'ETOILE-9', 'COEUR-10']);

      // Redis : les événements publics des deux coups automatiques ont circulé.
      await until(
        async () => wire,
        (w) => w.filter((m) => m.event.type === 'game:auto_card_played').length >= 2,
      );
      const autoOnWire = wire
        .filter((m) => m.event.type === 'game:auto_card_played')
        .map((m) => m.event.payload);
      expect(autoOnWire).toEqual([
        { playerId: B.id, trickNumber: 2 },
        { playerId: A.id, trickNumber: 2 },
      ]);
      const playedOnWire = wire
        .filter((m) => m.event.type === 'game:card_played')
        .map((m) => m.event.payload.cardId);
      expect(playedOnWire).toEqual(['PIQUE-5', 'PIQUE-9', 'COEUR-4', 'COEUR-8']);
      expect(eventsA.filter((e) => e.type === 'game:auto_card_played')).toHaveLength(2);
      // Seuls les deux coups de timeout sont automatiques ; les deux coups manuels sont des PLAY_CARD.
      expect(ctx.logLines.filter((l) => l.message === 'AUTO_CARD_PLAY')).toHaveLength(2);
    });
  },
);
