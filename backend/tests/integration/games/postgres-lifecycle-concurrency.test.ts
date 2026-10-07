import { randomUUID } from 'node:crypto';

import { Pool } from 'pg';

import { loadMigrations, runMigrations } from '../../../src/database/migrator';
import { createPgSqlClient, type SqlClient } from '../../../src/database/sql-client';
import type { GameEvent } from '../../../src/domain/game/game-events';
import type { GameId, PlayerId } from '../../../src/domain/game/game-id';
import { PostgresGameRepository } from '../../../src/repositories/postgres-game.repository';
import { GameService, type ParticipationPolicy } from '../../../src/services/game/game.service';
import { GameTimerRegistry } from '../../../src/services/game/game-timer-registry';
import { singleActiveGameParticipation } from '../../../src/services/game/participation-policies';
import { silentLogger } from '../../../src/utils/logger';
import { createSessionGameInstance } from '../../fixtures/session-games';
import type { GameEventPublisher } from '../../../src/websocket/game-event-publisher';
import { InMemoryGameEventHub } from '../../../src/websocket/in-memory-game-event-hub';
import { seedUsers, testPlayerId } from '../../fixtures/users';

/**
 * Cycle de vie sur un VRAI PostgreSQL (plusieurs connexions réellement parallèles) et deux
 * « instances » de GameService : chacune a sa propre file par partie, elles ne partagent que
 * la base. Exécutée quand TEST_DATABASE_URL est défini (voir postgres-concurrency.test.ts),
 * dans un schéma temporaire supprimé à la fin.
 */
const url = process.env.TEST_DATABASE_URL;
const describeWithPostgres = url ? describe : describe.skip;
jest.setTimeout(60_000);

describeWithPostgres('Cycle de vie des parties sur PostgreSQL réel (deux instances)', () => {
  const schema = `lifecycle_test_${randomUUID().replace(/-/g, '')}`;
  let pool: Pool;
  let sql: SqlClient;
  let trial = 0;

  beforeAll(async () => {
    const admin = new Pool({ connectionString: url, max: 1 });
    await admin.query(`CREATE SCHEMA ${schema}`);
    await admin.end();
    pool = new Pool({ connectionString: url, max: 16, options: `-c search_path=${schema}` });
    sql = createPgSqlClient(pool);
    await runMigrations(sql, await loadMigrations());
  });

  afterAll(async () => {
    await pool?.query(`DROP SCHEMA ${schema} CASCADE`);
    await pool?.end();
  });

  /** Une instance du backend : sa propre file, ses timers, son bus ; la base est commune. */
  function instance(
    published: GameEvent[],
    policy?: (repository: PostgresGameRepository) => ParticipationPolicy,
  ) {
    const hub = new InMemoryGameEventHub();
    const publisher: GameEventPublisher = {
      publishToGame: (event) => {
        published.push(event);
        hub.publishToGame(event);
      },
      publishToPlayer: (playerId, event) => hub.publishToPlayer(playerId, event),
    };
    // Parcours réel (D-033) : créer ouvre une session, rejoindre passe par la session.
    return createSessionGameInstance(sql, {
      publisher,
      subscriber: hub,
      timers: new GameTimerRegistry(),
      participationPolicy: policy,
    });
  }

  /** Joueurs neufs pour chaque essai (UUID de comptes existants : clés étrangères). */
  async function players(...names: string[]): Promise<PlayerId[]> {
    trial += 1;
    const unique = names.map((n) => `${n}-${trial}`);
    await seedUsers(sql, unique);
    return unique.map(testPlayerId);
  }

  async function activeRows(playerId: PlayerId): Promise<number> {
    const { rows } = await sql.query<{ n: number }>(
      'SELECT count(*)::int AS n FROM game_players WHERE player_id = $1 AND active',
      [playerId],
    );
    return rows[0]?.n ?? 0;
  }

  it('R-18 : 20 essais d’adhésions simultanées à A et B (index seul) — jamais deux réussites', async () => {
    const allowAll = () => ({ canJoin: async () => true });
    const one = instance([], allowAll);
    const two = instance([], allowAll);
    for (let i = 0; i < 20; i++) {
      const [alice, bob, carol] = (await players('alice', 'bob', 'carol')) as [
        PlayerId,
        PlayerId,
        PlayerId,
      ];
      const a = await one.createGame(alice, { maxPlayers: 4 });
      const b = await two.createGame(bob, { maxPlayers: 4 });

      const results = await Promise.allSettled([
        one.joinGame(a.id, carol),
        two.joinGame(b.id, carol),
      ]);

      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
      const failure = results.find((r) => r.status === 'rejected') as PromiseRejectedResult;
      // Entrer dans une partie passe par sa session : la première barrière franchie en
      // concurrence est l'index « une session active par joueur » (D-034), puis celui de
      // R-18 (une partie active). Les deux sont des index uniques PostgreSQL.
      expect(['ParticipationRefusedError', 'PlayerAlreadyInSessionError']).toContain(
        (failure.reason as Error).name,
      );
      expect(await activeRows(carol)).toBe(1);
    }
  });

  it('R-18 avec la politique officielle : même résultat', async () => {
    const one = instance([]);
    const two = instance([]);
    for (let i = 0; i < 10; i++) {
      const [alice, bob, carol] = (await players('alice', 'bob', 'carol')) as [
        PlayerId,
        PlayerId,
        PlayerId,
      ];
      const a = await one.createGame(alice, { maxPlayers: 3 });
      const b = await two.createGame(bob, { maxPlayers: 3 });
      const results = await Promise.allSettled([
        one.joinGame(a.id, carol),
        two.joinGame(b.id, carol),
      ]);
      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
      expect(await activeRows(carol)).toBe(1);
    }
  });

  it('R-23 : 15 essais de double démarrage sur deux instances — une transition, un game:started', async () => {
    const publishedOne: GameEvent[] = [];
    const publishedTwo: GameEvent[] = [];
    const one = instance(publishedOne);
    const two = instance(publishedTwo);
    for (let i = 0; i < 15; i++) {
      const [alice, bob] = (await players('alice', 'bob')) as [PlayerId, PlayerId];
      const game = await one.createGame(alice, { maxPlayers: 4 });
      await two.joinGame(game.id, bob);

      const results = await Promise.allSettled([
        one.startGame(game.id, alice),
        two.startGame(game.id, alice),
      ]);

      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
      const failure = results.find((r) => r.status === 'rejected') as PromiseRejectedResult;
      expect(['GameAlreadyStartedError', 'GameVersionConflictError']).toContain(
        (failure.reason as Error).name,
      );
      const started = [...publishedOne, ...publishedTwo].filter(
        (e) => e.gameId === game.id && e.type === 'game:started',
      );
      expect(started).toHaveLength(1);
      const { rows } = await sql.query<{ status: string; version: number }>(
        'SELECT status, version FROM games WHERE id = $1',
        [game.id],
      );
      expect(rows[0]).toEqual({ status: 'in_progress', version: 3 });
    }
  });

  it('idempotence : 6 créations simultanées avec la même clé sur deux instances → une partie', async () => {
    const one = instance([]);
    const two = instance([]);
    const [alice] = (await players('alice')) as [PlayerId];
    const key = `cle-${randomUUID()}`;

    const results = await Promise.allSettled(
      Array.from({ length: 6 }, (_, i) =>
        (i % 2 ? one : two).createGameIdempotent(alice, { maxPlayers: 3, creationKey: key }),
      ),
    );

    expect(results.every((r) => r.status === 'fulfilled')).toBe(true);
    const ids = new Set(
      results.map((r) => (r as PromiseFulfilledResult<{ game: { id: GameId } }>).value.game.id),
    );
    expect(ids.size).toBe(1);
    const { rows } = await sql.query<{ n: number }>(
      'SELECT count(*)::int AS n FROM games WHERE creator_id = $1',
      [alice],
    );
    expect(rows[0]?.n).toBe(1);
  });

  it('D-032 : le démarrage persiste en une transaction statut, 5 cartes par joueur, J1, contrôle, version', async () => {
    const one = instance([]);
    const [alice, bob, carol] = (await players('alice', 'bob', 'carol')) as [
      PlayerId,
      PlayerId,
      PlayerId,
    ];
    const game = await one.createGame(alice, { maxPlayers: 4 });
    await one.joinGame(game.id, bob);
    await one.joinGame(game.id, carol);
    await one.startGame(game.id, alice);

    const stored = await new PostgresGameRepository(sql).findById(game.id);
    expect(stored).toMatchObject({ status: 'in_progress', version: 4 });
    const play = stored!.play!;
    expect(play.dealOrder).toEqual([alice, bob, carol]);
    expect(play.control).toEqual({ playerId: alice });
    expect(play.nextPlayerId).toBe(alice);
    expect(Object.values(play.hands).map((h) => h.length)).toEqual([5, 5, 5]);
    expect(new Set([...Object.values(play.hands).flat(), ...play.stock]).size).toBe(31);
  });

  it('D-032 : une panne pendant l’écriture du démarrage annule tout (rollback), rien n’est publié', async () => {
    const published: GameEvent[] = [];
    const [alice, bob] = (await players('alice', 'bob')) as [PlayerId, PlayerId];
    const healthy = instance([]);
    const game = await healthy.createGame(alice, { maxPlayers: 3 });
    await healthy.joinGame(game.id, bob);

    // Client SQL qui échoue sur l'écriture des sièges, APRÈS l'UPDATE de la ligne `games`.
    let armed = true;
    const failing: SqlClient = {
      query: (text, params) => sql.query(text, params),
      transaction: (work) =>
        sql.transaction((tx) =>
          work({
            query: (text, params) => {
              if (armed && /INSERT INTO game_players/.test(text)) {
                armed = false;
                return Promise.reject(new Error('panne simulée pendant le démarrage'));
              }
              return tx.query(text, params);
            },
          }),
        ),
    };
    const broken = new GameService({
      repository: new PostgresGameRepository(failing),
      publisher: { publishToGame: (e) => published.push(e), publishToPlayer: () => undefined },
      subscriber: new InMemoryGameEventHub(),
      timers: new GameTimerRegistry(),
      participationPolicy: singleActiveGameParticipation(new PostgresGameRepository(sql)),
      logger: silentLogger,
    });

    await expect(broken.startGame(game.id, alice)).rejects.toThrow('panne simulée');

    const stored = await new PostgresGameRepository(sql).findById(game.id);
    expect(stored).toMatchObject({ status: 'waiting', version: 2 });
    expect(stored!.play).toBeUndefined(); // ni mains partielles, ni in_progress
    expect(published).toEqual([]);
    // La partie reste démarrable normalement.
    await healthy.startGame(game.id, alice);
  });

  it('D-032 : double démarrage sur deux instances — une seule distribution conservée', async () => {
    const one = instance([]);
    const two = instance([]);
    for (let i = 0; i < 5; i++) {
      const [alice, bob] = (await players('alice', 'bob')) as [PlayerId, PlayerId];
      const game = await one.createGame(alice, { maxPlayers: 2 });
      await two.joinGame(game.id, bob);

      const results = await Promise.allSettled([
        one.startGame(game.id, alice),
        two.startGame(game.id, alice),
      ]);
      const winner = results.find((r) => r.status === 'fulfilled') as PromiseFulfilledResult<{
        play?: { hands: Record<string, string[]> };
      }>;
      const stored = await new PostgresGameRepository(sql).findById(game.id);
      // Les mains en base sont exactement celles de la transition qui a réussi.
      expect(stored!.play!.hands).toEqual(winner.value.play!.hands);
    }
  });

  it('une partie terminée libère ses joueurs (active = false), l’historique reste', async () => {
    const one = instance([]);
    const [alice, bob] = (await players('alice', 'bob')) as [PlayerId, PlayerId];
    const first = await one.createGame(alice, { maxPlayers: 2 });
    await one.joinGame(first.id, bob);
    await one.startGame(first.id, alice);
    await one.finishGame(first.id);
    // Partie terminée : chacun quitte la session (« Quitter », D-034) avant d'en ouvrir une autre.
    await one.sessions.leaveSession(first.sessionId!, alice);
    await one.sessions.leaveSession(first.sessionId!, bob);

    const second = await one.createGame(bob, { maxPlayers: 2 });
    await one.joinGame(second.id, alice);
    expect(await activeRows(alice)).toBe(1);
    const { rows } = await sql.query<{ n: number }>(
      'SELECT count(*)::int AS n FROM game_players WHERE player_id = $1',
      [alice],
    );
    expect(rows[0]?.n).toBe(2);
  });
});
