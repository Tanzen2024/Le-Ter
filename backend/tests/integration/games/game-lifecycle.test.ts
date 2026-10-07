import { randomUUID } from 'node:crypto';

import request from 'supertest';

import type { GameEvent } from '../../../src/domain/game/game-events';
import type { GameId, PlayerId } from '../../../src/domain/game/game-id';
import { InvalidStatusTransitionError } from '../../../src/domain/game/game-errors';
import { PostgresGameRepository } from '../../../src/repositories/postgres-game.repository';
import { registerAndLogin } from '../../fixtures/auth';
import {
  as,
  createGameApiTestApp,
  enterGame,
  expectStatus,
  type GameApiTestContext,
} from '../../fixtures/game-api';
import {
  createMigratedDatabase,
  PGLITE_TIMEOUT_MS,
  type TestDatabase,
} from '../../fixtures/pglite';
import { identityRandom } from '../../fixtures/random';
import { testRules } from '../../fixtures/rules';

/**
 * Cycle de vie des parties (D-031) : R-18 (une seule partie active), R-23 (capacité 2/3/4,
 * démarrage par le créateur dès 2 joueurs), idempotence de la création, concurrence.
 */
// Suites HTTP complètes (inscription, connexion, PGlite) lancées en parallèle : 5 s ne
// suffisent pas toujours sous charge.
jest.setTimeout(30_000);

let database: TestDatabase;
let ctx: GameApiTestContext;

beforeAll(async () => {
  database = await createMigratedDatabase();
}, PGLITE_TIMEOUT_MS);
afterAll(() => database.close());
beforeEach(() => {
  ctx = createGameApiTestApp(database.sql);
});
afterEach(async () => {
  await ctx.stopTimers();
  await database.reset();
});

type Player = Awaited<ReturnType<typeof newPlayer>>;

async function newPlayer() {
  const session = await registerAndLogin(ctx.app);
  return { ...session, api: as(ctx.app, session.accessToken) };
}

async function createGame(owner: Player, maxPlayers = 2): Promise<GameId> {
  const res = await owner.api.post('/api/games', { maxPlayers }).expect(201);
  return res.body.game.gameId;
}

/** Partie de `maxPlayers` places avec `present` joueurs (le créateur compris). */
async function tableOf(maxPlayers: number, present: number) {
  const players = [await newPlayer()];
  const gameId = await createGame(players[0]!, maxPlayers);
  for (let i = 1; i < present; i++) {
    const p = await newPlayer();
    await expectStatus(enterGame(p.api, database.sql, gameId), 200);
    players.push(p);
  }
  return { creator: players[0]!, players, gameId };
}

const start = (p: Player, gameId: GameId, body: object = {}) =>
  p.api.post(`/api/games/${gameId}/start`, body);

/**
 * Quitte la session de la partie (D-034 : un joueur n'est présent que dans UNE session ;
 * après une partie terminée, quitter vaut le choix « Quitter »).
 */
async function leaveSessionOf(p: Player, gameId: GameId) {
  const { rows } = await database.sql.query<{ session_id: string }>(
    'SELECT session_id FROM games WHERE id = $1',
    [gameId],
  );
  await p.api.post(`/api/sessions/${rows[0]?.session_id}/leave`, {}).expect(200);
}

async function activeRows(userId: string): Promise<number> {
  const { rows } = await database.sql.query<{ n: number }>(
    'SELECT count(*)::int AS n FROM game_players WHERE player_id = $1 AND active',
    [userId],
  );
  return rows[0]?.n ?? 0;
}

describe('R-18 — une seule partie active par joueur', () => {
  it('1. sans partie active : rejoindre est autorisé', async () => {
    const { gameId } = await tableOf(3, 1);
    const bob = await newPlayer();
    await expectStatus(enterGame(bob.api, database.sql, gameId), 200);
  });

  it('2. membre d’une partie en attente : rejoindre ou créer une deuxième partie est refusé', async () => {
    const a = await tableOf(3, 2);
    const b = await tableOf(3, 1);
    const member = a.players[1]!;

    // Entrer dans la partie B passe par sa session : refusé dès la session (D-034).
    const join = await expectStatus(enterGame(member.api, database.sql, b.gameId), 409);
    expect(join.body.code).toBe('ALREADY_IN_SESSION');
    const create = await member.api.post('/api/games', { maxPlayers: 2 }).expect(409);
    expect(create.body.code).toBe('ALREADY_IN_ACTIVE_GAME');
    expect(await activeRows(member.userId)).toBe(1);
  });

  it('3. membre d’une partie en cours : rejoindre une deuxième partie est refusé', async () => {
    const a = await tableOf(2, 2);
    await start(a.creator, a.gameId).expect(200);
    const b = await tableOf(3, 1);

    const res = await expectStatus(enterGame(a.players[1]!.api, database.sql, b.gameId), 409);
    expect(res.body.code).toBe('ALREADY_IN_SESSION');
    expect(await activeRows(a.players[1]!.userId)).toBe(1);
  });

  it('4. partie précédente terminée : rejoindre une nouvelle partie est autorisé, l’historique reste', async () => {
    const a = await tableOf(2, 2);
    await ctx.games.finishGame(a.gameId);
    await leaveSessionOf(a.players[1]!, a.gameId);
    const b = await tableOf(3, 1);

    await expectStatus(enterGame(a.players[1]!.api, database.sql, b.gameId), 200);
    const { rows } = await database.sql.query<{ n: number }>(
      'SELECT count(*)::int AS n FROM game_players WHERE player_id = $1',
      [a.players[1]!.userId],
    );
    expect(rows[0]?.n).toBe(2); // partie terminée conservée + partie active
    expect(await activeRows(a.players[1]!.userId)).toBe(1);
  });

  it('5-8. rejoindre A et B en même temps : une seule adhésion réussit, jamais deux parties actives', async () => {
    const a = await tableOf(4, 1);
    const b = await tableOf(4, 1);
    const carol = await newPlayer();

    const results = await Promise.all([
      enterGame(carol.api, database.sql, a.gameId),
      enterGame(carol.api, database.sql, b.gameId),
    ]);

    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
    expect(await activeRows(carol.userId)).toBe(1);
    const active = await carol.api.get('/api/games/me/active').expect(200);
    expect(active.body.games).toHaveLength(1);
  });

  it('sans la vérification applicative, l’index PostgreSQL seul empêche la double participation', async () => {
    // La pré-vérification est neutralisée : seules les écritures concurrentes s'affrontent.
    ctx = createGameApiTestApp(database.sql, {
      participationPolicy: { canJoin: async () => true },
    });
    const a = await tableOf(4, 1);
    const b = await tableOf(4, 1);
    const carol = await newPlayer();

    const results = await Promise.all([
      enterGame(carol.api, database.sql, a.gameId),
      enterGame(carol.api, database.sql, b.gameId),
    ]);

    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
    // La session (D-034) refuse avant la partie : un joueur, une session, une partie active.
    expect(results.find((r) => r.status === 409)?.body.code).toBe('ALREADY_IN_SESSION');
    expect(await activeRows(carol.userId)).toBe(1);
  });

  it('la base refuse une seconde participation active même si l’application était contournée', async () => {
    const a = await tableOf(2, 1);
    const b = await tableOf(2, 1);
    await expect(
      database.sql.query(
        `INSERT INTO game_players (game_id, player_id, seat, joined_at, active, table_position)
         VALUES ($1, $2, 1, now(), true, 1)`,
        [b.gameId, a.creator.userId],
      ),
    ).rejects.toThrow();
  });

  it('GET /me/active renvoie la seule partie active ; une partie terminée n’y figure plus', async () => {
    const alice = await newPlayer();
    const first = await createGame(alice);
    expect((await alice.api.get('/api/games/me/active')).body.games).toHaveLength(1);
    await ctx.games.finishGame(first);
    expect((await alice.api.get('/api/games/me/active')).body.games).toEqual([]);
    await leaveSessionOf(alice, first);

    const second = await createGame(alice);
    const res = await alice.api.get('/api/games/me/active').expect(200);
    expect(res.body.games.map((g: { gameId: string }) => g.gameId)).toEqual([second]);
  });
});

describe('R-23 — capacité et démarrage', () => {
  it.each([2, 3, 4])('9-11. capacité %i acceptée', async (maxPlayers) => {
    const alice = await newPlayer();
    const res = await alice.api.post('/api/games', { maxPlayers }).expect(201);
    expect(res.body.game).toMatchObject({ maxPlayers, status: 'waiting' });
  });

  it.each([1, 5, 0])('12-13. capacité %i refusée (400)', async (maxPlayers) => {
    const alice = await newPlayer();
    const res = await alice.api.post('/api/games', { maxPlayers }).expect(400);
    expect(res.body.fields).toHaveProperty('maxPlayers');
  });

  it.each([2, 3, 4])('14. un seul joueur (capacité %i) : démarrage refusé', async (maxPlayers) => {
    const { creator, gameId } = await tableOf(maxPlayers, 1);
    const res = await start(creator, gameId).expect(422);
    expect(res.body.code).toBe('NOT_ENOUGH_PLAYERS');
    expect((await creator.api.get(`/api/games/${gameId}`)).body.game.status).toBe('waiting');
  });

  it.each([
    [2, 2],
    [3, 2],
    [4, 2],
    [3, 3],
    [4, 3],
    [4, 4],
  ])('15-20. capacité %i, %i joueurs : démarrage accepté', async (maxPlayers, present) => {
    const { creator, gameId } = await tableOf(maxPlayers, present);
    const res = await start(creator, gameId).expect(200);

    expect(res.body.game).toMatchObject({ status: 'in_progress', version: present + 1 });
    expect(res.body.game.players).toHaveLength(present);
    expect(res.body.game.startedAt).toEqual(expect.any(String));
  });

  it('avec un jeu de règles, la distribution concerne les seuls joueurs présents (2 sur 4)', async () => {
    ctx = createGameApiTestApp(database.sql, { rules: testRules, random: identityRandom });
    const { creator, players, gameId } = await tableOf(4, 2);
    const res = await start(creator, gameId).expect(200);

    expect(res.body.game.play.handCounts).toEqual({
      [players[0]!.userId]: 5,
      [players[1]!.userId]: 5,
    });
    expect(res.body.game.play.myHand).toHaveLength(5);
  });
});

describe('R-23 — autorisation et cycle de vie', () => {
  it('21-23. seul le créateur démarre ; un membre ou un non-membre est refusé (identité du JWT)', async () => {
    const { creator, players, gameId } = await tableOf(3, 2);
    const outsider = await newPlayer();

    const byMember = await start(players[1]!, gameId, { creatorId: creator.userId }).expect(403);
    expect(byMember.body.code).toBe('ONLY_CREATOR_CAN_START');
    const byOutsider = await start(outsider, gameId).expect(403);
    expect(byOutsider.body.code).toBe('NOT_A_MEMBER');
    await request(ctx.app).post(`/api/games/${gameId}/start`).expect(401);

    await start(creator, gameId).expect(200);
  });

  it('24-27. waiting → in_progress, puis plus de démarrage, plus d’adhésion, aucun retour', async () => {
    const { creator, gameId } = await tableOf(4, 2);
    await start(creator, gameId).expect(200);
    const late = await newPlayer();

    const again = await start(creator, gameId).expect(409);
    expect(again.body.code).toBe('GAME_ALREADY_STARTED');
    const join = await expectStatus(enterGame(late.api, database.sql, gameId), 409);
    expect(join.body.code).toBe('GAME_NOT_JOINABLE');

    // Retour en arrière impossible, même en écrivant directement par le dépôt.
    const repository = new PostgresGameRepository(database.sql);
    const game = (await repository.findById(gameId))!;
    await expect(
      repository.save({ ...game, status: 'waiting', version: game.version + 1 }, game.version),
    ).rejects.toThrow(InvalidStatusTransitionError);
    expect((await repository.findById(gameId))?.status).toBe('in_progress');
  });

  it('une partie terminée ne démarre pas (409)', async () => {
    const { creator, gameId } = await tableOf(2, 2);
    await ctx.games.finishGame(gameId);
    const res = await start(creator, gameId).expect(409);
    expect(res.body.code).toBe('GAME_FINISHED');
  });
});

describe('Démarrage concurrent et événement game:started', () => {
  it('28-31. deux démarrages simultanés : une transition, une version, un seul game:started', async () => {
    const { creator, gameId } = await tableOf(3, 2);
    const events: GameEvent[] = [];
    await ctx.games.subscribe(gameId, creator.userId as PlayerId, (e) => events.push(e));

    const results = await Promise.all([start(creator, gameId), start(creator, gameId)]);

    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
    const started = events.filter((e) => e.type === 'game:started');
    expect(started).toHaveLength(1);
    expect(started[0]).toMatchObject({ gameId, version: 3, sequence: 0, actorId: creator.userId });
    expect(started[0]?.payload).toMatchObject({
      dealOrder: [creator.userId, expect.any(String)],
      firstPlayerId: creator.userId,
      controllerId: creator.userId,
    });
    expect((await creator.api.get(`/api/games/${gameId}`)).body.game.version).toBe(3);
  });

  it('un démarrage renvoyé avec le même commandId est idempotent (200, une seule transition)', async () => {
    const { creator, gameId } = await tableOf(2, 2);
    const body = { commandId: randomUUID() };
    const first = await start(creator, gameId, body).expect(200);
    const retry = await start(creator, gameId, body).expect(200);
    expect(retry.body.game.version).toBe(first.body.game.version);
  });

  it('un démarrage refusé ne publie aucun game:started', async () => {
    const { creator, gameId } = await tableOf(4, 1);
    const events: GameEvent[] = [];
    await ctx.games.subscribe(gameId, creator.userId as PlayerId, (e) => events.push(e));
    await start(creator, gameId).expect(422);
    expect(events).toEqual([]);
  });

  it('avec règles : game:started public puis chaque main en privé, dans la même version', async () => {
    ctx = createGameApiTestApp(database.sql, { rules: testRules, random: identityRandom });
    const { creator, players, gameId } = await tableOf(2, 2);
    const seenByGuest: GameEvent[] = [];
    await ctx.games.subscribe(gameId, players[1]!.userId as PlayerId, (e) => seenByGuest.push(e));

    await start(creator, gameId).expect(200);

    expect(seenByGuest.map((e) => [e.type, e.version])).toEqual([
      ['game:started', 3],
      ['game:hand_dealt', 3],
    ]);
    expect(JSON.stringify(seenByGuest)).not.toContain('COEUR-3'); // carte du créateur
  });
});

describe('Idempotence de la création (Idempotency-Key)', () => {
  const create = (p: Player, key: string | undefined, body: object = { maxPlayers: 3 }) => {
    const req = request(ctx.app).post('/api/games').set('Authorization', `Bearer ${p.accessToken}`);
    return (key ? req.set('Idempotency-Key', key) : req).send(body);
  };
  const gamesOf = async (userId: string) =>
    (
      await database.sql.query<{ n: number }>(
        'SELECT count(*)::int AS n FROM games WHERE creator_id = $1',
        [userId],
      )
    ).rows[0]?.n;

  it('A-B. même clé rejouée : la même partie est renvoyée, une seule est créée', async () => {
    const alice = await newPlayer();
    const first = await create(alice, 'cle-ABC-12345').expect(201);
    const replay = await create(alice, 'cle-ABC-12345').expect(201);

    expect(replay.body.game.gameId).toBe(first.body.game.gameId);
    expect(replay.headers['idempotent-replayed']).toBe('true');
    expect(first.headers['idempotent-replayed']).toBeUndefined();
    expect(await gamesOf(alice.userId)).toBe(1);
  });

  it('C. une nouvelle clé crée une nouvelle partie (une fois la précédente terminée : R-18)', async () => {
    const alice = await newPlayer();
    const first = await create(alice, 'cle-ABC-12345').expect(201);
    const blocked = await create(alice, 'cle-XYZ-67890').expect(409);
    expect(blocked.body.code).toBe('ALREADY_IN_ACTIVE_GAME');

    await ctx.games.finishGame(first.body.game.gameId);
    await leaveSessionOf(alice, first.body.game.gameId);
    const second = await create(alice, 'cle-XYZ-67890').expect(201);
    expect(second.body.game.gameId).not.toBe(first.body.game.gameId);
    expect(await gamesOf(alice.userId)).toBe(2);
  });

  it('deux créations simultanées avec la même clé : une seule partie', async () => {
    const alice = await newPlayer();
    const results = await Promise.all([
      create(alice, 'cle-concurrente-1'),
      create(alice, 'cle-concurrente-1'),
      create(alice, 'cle-concurrente-1'),
    ]);

    expect(results.map((r) => r.status)).toEqual([201, 201, 201]);
    expect(new Set(results.map((r) => r.body.game.gameId)).size).toBe(1);
    expect(await gamesOf(alice.userId)).toBe(1);
  });

  it('la même clé pour une création différente est refusée (422)', async () => {
    const alice = await newPlayer();
    await create(alice, 'cle-ABC-12345', { maxPlayers: 3 }).expect(201);
    const res = await create(alice, 'cle-ABC-12345', { maxPlayers: 4 }).expect(422);
    expect(res.body.code).toBe('IDEMPOTENCY_KEY_REUSED');
  });

  it('la clé est propre à chaque créateur', async () => {
    const alice = await newPlayer();
    const bob = await newPlayer();
    const a = await create(alice, 'cle-partagee-1').expect(201);
    const b = await create(bob, 'cle-partagee-1').expect(201);
    expect(a.body.game.gameId).not.toBe(b.body.game.gameId);
  });

  it('sans Idempotency-Key : 400', async () => {
    const alice = await newPlayer();
    const res = await create(alice, undefined).expect(400);
    expect(res.body.fields).toHaveProperty('idempotencyKey');
  });
});
