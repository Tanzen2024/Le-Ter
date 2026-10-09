import request from 'supertest';

import type { PlayerId } from '../../../src/domain/game/game-id';
import { registerAndLogin } from '../../fixtures/auth';
import {
  as,
  createGameApiTestApp,
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
 * GET /api/sessions/open : tables que l'on peut rejoindre depuis « Rechercher une partie ».
 * Lecture seule : session ouverte, partie EN ATTENTE, siège libre, hors les tables où le
 * joueur est déjà présent. Aucune règle de session n'est modifiée (R-19, D-034, D-037).
 */
jest.setTimeout(30_000);

let database: TestDatabase;
let ctx: GameApiTestContext;

beforeAll(async () => {
  database = await createMigratedDatabase();
}, PGLITE_TIMEOUT_MS);
afterAll(() => database.close());
beforeEach(() => {
  ctx = createGameApiTestApp(database.sql, {
    rules: testRules,
    random: identityRandom,
    decisionWindowMs: 60_000,
    turnDurationMs: 60_000,
  });
});
afterEach(async () => {
  await ctx.stopTimers();
  await database.reset();
});

async function newPlayer() {
  const session = await registerAndLogin(ctx.app);
  return { ...session, id: session.userId as PlayerId, api: as(ctx.app, session.accessToken) };
}
type Player = Awaited<ReturnType<typeof newPlayer>>;

async function createTable(owner: Player, maxPlayers = 4) {
  const res = await expectStatus(owner.api.post('/api/sessions', { maxPlayers }), 201);
  return {
    sessionId: res.body.session.sessionId as string,
    gameId: res.body.game.gameId as string,
  };
}

const openTables = async (p: Player) =>
  (await expectStatus(p.api.get('/api/sessions/open'), 200)).body.tables as {
    sessionId: string;
    gameId: string;
    creatorName: string;
    maxPlayers: number;
    playerCount: number;
    mine: boolean;
    suspicionDetectionEnabled: boolean;
  }[];

/** Tables des AUTRES joueurs (la sienne est marquée `mine`). */
const othersTables = async (p: Player) => (await openTables(p)).filter((t) => !t.mine);

const usernameOf = async (p: Player) =>
  (await expectStatus(p.api.get('/api/auth/me'), 200)).body.user.username as string;

describe('GET /api/sessions/open', () => {
  it('liste les tables en attente avec une place libre ; la mienne marquée « mine »', async () => {
    const [A, B] = [await newPlayer(), await newPlayer()];
    const table = await createTable(A, 3);

    expect(await openTables(A)).toEqual([
      expect.objectContaining({ sessionId: table.sessionId, mine: true }),
    ]);
    expect(await openTables(B)).toEqual([
      expect.objectContaining({
        sessionId: table.sessionId,
        gameId: table.gameId,
        creatorName: await usernameOf(A),
        maxPlayers: 3,
        playerCount: 1,
        mine: false,
      }),
    ]);
  });

  it('rejoindre (session puis partie) met à jour le nombre de joueurs ; table pleine retirée', async () => {
    const [A, B, C] = [await newPlayer(), await newPlayer(), await newPlayer()];
    const table = await createTable(A, 2);

    await expectStatus(B.api.post(`/api/sessions/${table.sessionId}/join`), 200);
    await expectStatus(B.api.post(`/api/games/${table.gameId}/join`), 200);

    expect(await othersTables(B)).toEqual([]);
    expect(await openTables(C)).toEqual([]);
  });

  it('une partie démarrée ou une table quittée disparaît de la liste', async () => {
    const [A, B, C] = [await newPlayer(), await newPlayer(), await newPlayer()];
    const started = await createTable(A, 4);
    await expectStatus(B.api.post(`/api/sessions/${started.sessionId}/join`), 200);
    await expectStatus(B.api.post(`/api/games/${started.gameId}/join`), 200);
    await expectStatus(A.api.post(`/api/games/${started.gameId}/start`), 200);

    const D = await newPlayer();
    const left = await createTable(D, 4);
    expect((await openTables(C)).map((t) => t.sessionId)).toEqual([left.sessionId]);

    await expectStatus(D.api.post(`/api/sessions/${left.sessionId}/leave`), 200);
    expect(await openTables(C)).toEqual([]);
  });

  it('401 sans jeton', async () => {
    const res = await request(ctx.app).get('/api/sessions/open');
    expect(res.status).toBe(401);
  });
});

describe('Partie privée : nom, mise, mot de passe (D-039)', () => {
  const createPrivate = async (owner: Player, body: object) =>
    (await expectStatus(owner.api.post('/api/sessions', body), 201)).body;

  it('« Partie de Roly » | 20 | 1/4 | 🔒 : création, liste, vue sans hash', async () => {
    const [A, B] = [await newPlayer(), await newPlayer()];
    const body = await createPrivate(A, {
      maxPlayers: 4,
      name: '  Partie de Roly ',
      stakeAmount: 20,
      password: 'secret-123',
    });

    expect(body.session).toEqual(
      expect.objectContaining({ name: 'Partie de Roly', hasPassword: true }),
    );
    expect(body.session).not.toHaveProperty('passwordHash');
    expect(body.game.stakeAmount).toBe(20);
    expect(await openTables(B)).toEqual([
      expect.objectContaining({
        name: 'Partie de Roly',
        stakeAmount: 20,
        hasPassword: true,
        playerCount: 1,
        maxPlayers: 4,
      }),
    ]);
    const { rows } = await database.sql.query<{ password_hash: string }>(
      'SELECT password_hash FROM sessions WHERE id = $1',
      [body.session.sessionId],
    );
    expect(rows[0]?.password_hash).toMatch(/^\$2[aby]\$/);
    expect(rows[0]?.password_hash).not.toContain('secret-123');
  });

  it('rejoindre une partie protégée : sans ou avec un mauvais mot de passe → 403 ; le bon → 200', async () => {
    const [A, B] = [await newPlayer(), await newPlayer()];
    const { session } = await createPrivate(A, { maxPlayers: 2, password: 'secret-123' });
    const join = (password?: string) =>
      B.api.post(`/api/sessions/${session.sessionId}/join`, password ? { password } : {});

    const missing = await join();
    expect(missing.status).toBe(403);
    expect(missing.body.code).toBe('TABLE_PASSWORD_INVALID');
    expect((await join('mauvais')).status).toBe(403);
    await expectStatus(join('secret-123'), 200);
  });

  it('partie sans mot de passe : arrivée libre, hasPassword false', async () => {
    const [A, B] = [await newPlayer(), await newPlayer()];
    const { session } = await createPrivate(A, { maxPlayers: 2, name: 'Ouverte' });
    expect(session.hasPassword).toBe(false);
    await expectStatus(B.api.post(`/api/sessions/${session.sessionId}/join`), 200);
  });

  it('validation : nom trop long ou vide, mot de passe trop court, mise négative → 400', async () => {
    const A = await newPlayer();
    for (const body of [
      { maxPlayers: 2, name: 'x'.repeat(41) },
      { maxPlayers: 2, name: '   ' },
      { maxPlayers: 2, password: 'abc' },
      { maxPlayers: 2, stakeAmount: -5 },
    ]) {
      const res = await A.api.post('/api/sessions', body);
      expect(res.status).toBe(400);
    }
  });
});

describe('Détection anti-collusion : réglage de la partie (D-043)', () => {
  it('désactivée par défaut ; activée à la demande ; renvoyée par la vue et la liste', async () => {
    const [A, B, C] = [await newPlayer(), await newPlayer(), await newPlayer()];
    const plain = (await expectStatus(A.api.post('/api/sessions', { maxPlayers: 2 }), 201)).body;
    const guarded = (
      await expectStatus(
        B.api.post('/api/sessions', { maxPlayers: 2, suspicionDetectionEnabled: true }),
        201,
      )
    ).body;

    expect(plain.session.suspicionDetectionEnabled).toBe(false);
    expect(guarded.session.suspicionDetectionEnabled).toBe(true);
    const listed = await openTables(C);
    expect(listed.find((t) => t.sessionId === plain.session.sessionId)).toMatchObject({
      suspicionDetectionEnabled: false,
    });
    expect(listed.find((t) => t.sessionId === guarded.session.sessionId)).toMatchObject({
      suspicionDetectionEnabled: true,
    });
  });

  it('valeur non booléenne refusée (400)', async () => {
    const A = await newPlayer();
    for (const value of ['true', 1, 'oui']) {
      const res = await A.api.post('/api/sessions', {
        maxPlayers: 2,
        suspicionDetectionEnabled: value,
      });
      expect(res.status).toBe(400);
    }
  });

  it('immuable après la création : la base refuse toute modification', async () => {
    const A = await newPlayer();
    const { session } = (
      await expectStatus(
        A.api.post('/api/sessions', { maxPlayers: 2, suspicionDetectionEnabled: true }),
        201,
      )
    ).body;
    await expect(
      database.sql.query('UPDATE sessions SET suspicion_detection_enabled = false WHERE id = $1', [
        session.sessionId,
      ]),
    ).rejects.toThrow();
  });
});
