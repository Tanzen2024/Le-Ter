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

  it('table pleine : un 5e joueur est refusé (SESSION_FULL)', async () => {
    const [A, B, C, D, E] = [
      await newPlayer(),
      await newPlayer(),
      await newPlayer(),
      await newPlayer(),
      await newPlayer(),
    ];
    const table = await createTable(A, 4);
    for (const p of [B, C, D]) {
      await expectStatus(p.api.post(`/api/sessions/${table.sessionId}/join`), 200);
      await expectStatus(p.api.post(`/api/games/${table.gameId}/join`), 200);
    }

    const refused = await E.api.post(`/api/sessions/${table.sessionId}/join`);
    expect(refused.status).toBe(409);
    expect(refused.body.code).toBe('SESSION_FULL');
    expect(await openTables(E)).toEqual([]);
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

/**
 * Scénario observé en jeu : une table Fap-Fap à 4 doit rester trouvable à 2/4 puis 3/4 tant
 * que le créateur n'a pas appuyé sur « Démarrer » ; elle ne quitte la liste que pleine (4/4)
 * ou démarrée. Les appels reproduisent ceux de l'interface : création par « Créer une
 * partie » (nom, mise, détection), puis « Rejoindre » = session, relecture, partie
 * (`use-enter-table.ts`).
 */
describe('Fap-Fap à 4 : visibilité de 1/4 à 4/4 sans « Démarrer »', () => {
  const STAKE = 20;

  // Câblage de production : mise > 0 obligatoire, solde ≥ 2 × mise vérifié à l'arrivée
  // dans la session comme dans la partie (D-073).
  beforeEach(async () => {
    await ctx.stopTimers();
    ctx = createGameApiTestApp(database.sql, {
      rules: testRules,
      random: identityRandom,
      decisionWindowMs: 60_000,
      turnDurationMs: 60_000,
      stakePolicies: true,
    });
  });

  async function newPlayer(balance = 1_000) {
    const session = await registerAndLogin(ctx.app);
    await database.sql.query(
      `INSERT INTO wallets (user_id, balance, created_at, updated_at) VALUES ($1, $2, now(), now())`,
      [session.userId, balance],
    );
    return { ...session, id: session.userId as PlayerId, api: as(ctx.app, session.accessToken) };
  }

  async function createFromPanel(owner: Player) {
    const res = await expectStatus(
      owner.api.post('/api/sessions', {
        maxPlayers: 4,
        name: `Partie de ${await usernameOf(owner)}`,
        stakeAmount: STAKE,
        suspicionDetectionEnabled: false,
      }),
      201,
    );
    return {
      sessionId: res.body.session.sessionId as string,
      gameId: res.body.game.gameId as string,
    };
  }

  async function joinFromPanel(p: Player, sessionId: string) {
    await expectStatus(p.api.post(`/api/sessions/${sessionId}/join`, {}), 200);
    const { session } = (await expectStatus(p.api.get(`/api/sessions/${sessionId}`), 200)).body;
    expect(session.currentGame.status).toBe('waiting');
    await expectStatus(p.api.post(`/api/games/${session.currentGame.gameId}/join`), 200);
  }

  const rowOf = async (viewer: Player, sessionId: string) =>
    (await openTables(viewer)).find((t) => t.sessionId === sessionId);

  /** État réel en base : session ouverte, partie en attente, jamais démarrée. */
  async function expectStillWaiting(table: { sessionId: string; gameId: string }) {
    const { rows } = await database.sql.query<{ session: string; game: string }>(
      `SELECT s.status AS session, g.status AS game
       FROM sessions s JOIN games g ON g.session_id = s.id WHERE g.id = $1`,
      [table.gameId],
    );
    expect(rows).toEqual([{ session: 'open', game: 'waiting' }]);
  }

  it('1/4, 2/4, 3/4 visibles pour un nouveau joueur ; 4/4 retirée ; 5e refusé', async () => {
    const [A, B, C, D, E, F] = [
      await newPlayer(),
      await newPlayer(),
      await newPlayer(),
      await newPlayer(),
      await newPlayer(),
      await newPlayer(),
    ];
    const table = await createFromPanel(A);
    const visible = (count: number) =>
      expect.objectContaining({
        sessionId: table.sessionId,
        gameId: table.gameId,
        name: expect.any(String),
        stakeAmount: STAKE,
        maxPlayers: 4,
        playerCount: count,
        mine: false,
      });

    // 1/4
    expect(await rowOf(B, table.sessionId)).toEqual(visible(1));
    // 2/4 : un nouveau joueur (E, jamais assis) la voit toujours.
    await joinFromPanel(B, table.sessionId);
    await expectStillWaiting(table);
    expect(await rowOf(E, table.sessionId)).toEqual(visible(2));
    expect(await rowOf(C, table.sessionId)).toEqual(visible(2));
    // 3/4 : la rejoindre à 3/4 réussit aussi (D, puis 4/4).
    await joinFromPanel(C, table.sessionId);
    await expectStillWaiting(table);
    expect(await rowOf(E, table.sessionId)).toEqual(visible(3));
    expect(await rowOf(D, table.sessionId)).toEqual(visible(3));
    // 4/4 : retirée parce que pleine, la partie toujours en attente (non démarrée).
    await joinFromPanel(D, table.sessionId);
    await expectStillWaiting(table);
    expect(await rowOf(E, table.sessionId)).toBeUndefined();
    expect(await rowOf(F, table.sessionId)).toBeUndefined();

    const refused = await E.api.post(`/api/sessions/${table.sessionId}/join`, {});
    expect(refused.status).toBe(409);
    expect(refused.body.code).toBe('SESSION_FULL');
  });

  /** Sièges actifs de la session et joueurs de la partie, relus en base. */
  async function seatsAndPlayers(table: { sessionId: string; gameId: string }) {
    const seats = await database.sql.query<{ seat: number }>(
      'SELECT seat FROM session_players WHERE session_id = $1 AND active ORDER BY seat',
      [table.sessionId],
    );
    const players = await database.sql.query<{ n: number }>(
      'SELECT count(*)::int AS n FROM game_players WHERE game_id = $1',
      [table.gameId],
    );
    return { seats: seats.rows.map((r) => r.seat), players: players.rows[0]?.n };
  }

  it.each([2, 3, 4])(
    'table à %i : exactement autant de sièges que de joueurs, jamais plus',
    async (capacity) => {
      const owner = await newPlayer();
      const others = [];
      for (let i = 0; i < capacity; i += 1) others.push(await newPlayer());
      const [viewer, ...joiners] = others;
      const res = await expectStatus(
        owner.api.post('/api/sessions', {
          maxPlayers: capacity,
          name: 'Table',
          stakeAmount: STAKE,
        }),
        201,
      );
      const table = {
        sessionId: res.body.session.sessionId as string,
        gameId: res.body.game.gameId as string,
      };

      for (let count = 1; count <= capacity; count += 1) {
        if (count > 1) await joinFromPanel(joiners[count - 2]!, table.sessionId);
        const { seats, players } = await seatsAndPlayers(table);
        expect(players).toBe(count);
        expect(seats).toEqual(Array.from({ length: count }, (_, i) => i));
        const row = await rowOf(viewer!, table.sessionId);
        if (count < capacity) {
          expect(row).toMatchObject({ playerCount: count, maxPlayers: capacity });
        } else {
          expect(row).toBeUndefined();
        }
      }

      const refused = await viewer!.api.post(`/api/sessions/${table.sessionId}/join`, {});
      expect(refused.status).toBe(409);
      expect(refused.body.code).toBe('SESSION_FULL');
      expect(await seatsAndPlayers(table)).toEqual({
        seats: Array.from({ length: capacity }, (_, i) => i),
        players: capacity,
      });
    },
  );

  it('arrivée = siège ET place dans la partie, en une fois : jamais un siège sans joueur', async () => {
    const [A, B, C, D, E] = [
      await newPlayer(),
      await newPlayer(),
      await newPlayer(),
      await newPlayer(),
      await newPlayer(),
    ];
    const table = await createFromPanel(A);
    // Seul l'appel « session » est fait (le second appel du client échoue ou n'arrive pas).
    for (const [p, count] of [
      [B, 2],
      [C, 3],
      [D, 4],
    ] as const) {
      await expectStatus(p.api.post(`/api/sessions/${table.sessionId}/join`, {}), 200);
      const { seats, players } = await seatsAndPlayers(table);
      expect({ seats: seats.length, players }).toEqual({ seats: count, players: count });
      if (count < 4) {
        expect(await rowOf(E, table.sessionId)).toMatchObject({ playerCount: count });
      }
    }
    expect(await rowOf(E, table.sessionId)).toBeUndefined();
    // Le second appel du client reste sans effet (déjà joueur).
    await expectStatus(D.api.post(`/api/games/${table.gameId}/join`), 200);
    expect((await seatsAndPlayers(table)).players).toBe(4);
  });

  it('arrivée refusée par la partie (solde insuffisant) : aucun siège pris non plus', async () => {
    const [A, E] = [await newPlayer(), await newPlayer()];
    const table = await createFromPanel(A);
    const poor = await newPlayer(2 * STAKE - 1);
    expect((await poor.api.post(`/api/sessions/${table.sessionId}/join`, {})).status).toBe(409);
    expect(await seatsAndPlayers(table)).toEqual({ seats: [0], players: 1 });
    expect(await rowOf(E, table.sessionId)).toMatchObject({ playerCount: 1 });
  });

  it('créateur et joueurs assis la voient « mine » avec le même compte, à 2/4 comme à 3/4', async () => {
    const [A, B, C] = [await newPlayer(), await newPlayer(), await newPlayer()];
    const table = await createFromPanel(A);

    await joinFromPanel(B, table.sessionId);
    for (const p of [A, B]) {
      expect(await rowOf(p, table.sessionId)).toMatchObject({ mine: true, playerCount: 2 });
    }
    await joinFromPanel(C, table.sessionId);
    for (const p of [A, B, C]) {
      expect(await rowOf(p, table.sessionId)).toMatchObject({ mine: true, playerCount: 3 });
    }
  });

  it('arrivée refusée (solde < 2 × mise) : aucun siège pris, la table reste visible à 2/4', async () => {
    const [A, B, E] = [await newPlayer(), await newPlayer(), await newPlayer()];
    const poor = await newPlayer(2 * STAKE - 1);
    const table = await createFromPanel(A);
    await joinFromPanel(B, table.sessionId);

    const refused = await poor.api.post(`/api/sessions/${table.sessionId}/join`, {});
    expect(refused.status).toBeGreaterThanOrEqual(400);
    const { rows } = await database.sql.query<{ n: number }>(
      'SELECT count(*)::int AS n FROM session_players WHERE session_id = $1 AND active',
      [table.sessionId],
    );
    expect(rows[0]?.n).toBe(2);
    expect(await rowOf(E, table.sessionId)).toMatchObject({ playerCount: 2, maxPlayers: 4 });
  });

  it('aucun changement de visibilité tant que « Démarrer » n’est pas appuyé ; démarrée, elle disparaît', async () => {
    const [A, B, C, E] = [await newPlayer(), await newPlayer(), await newPlayer(), await newPlayer()];
    const table = await createFromPanel(A);
    await joinFromPanel(B, table.sessionId);
    await joinFromPanel(C, table.sessionId);

    // Relectures répétées (la liste est relue toutes les 3 s) : rien ne change seul.
    for (let i = 0; i < 5; i += 1) {
      expect(await rowOf(E, table.sessionId)).toMatchObject({ playerCount: 3, maxPlayers: 4 });
    }
    // Le créateur relit sa partie (écran de jeu) : la lecture ne démarre rien.
    const view = (await expectStatus(A.api.get(`/api/games/${table.gameId}`), 200)).body.game;
    expect(view.status).toBe('waiting');
    expect(view).not.toHaveProperty('autoStart');
    await expectStillWaiting(table);
    expect(await rowOf(E, table.sessionId)).toMatchObject({ playerCount: 3 });

    // « Démarrer » : seule cause de sortie d'une table 3/4.
    await expectStatus(A.api.post(`/api/games/${table.gameId}/start`), 200);
    expect(await rowOf(E, table.sessionId)).toBeUndefined();
  });
});
