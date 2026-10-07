import { randomUUID } from 'node:crypto';

import request from 'supertest';

import type { GameEvent } from '../../../src/domain/game/game-events';
import type { GameId, PlayerId } from '../../../src/domain/game/game-id';
import type { SessionEvent } from '../../../src/domain/sessions/session-events';
import type { SessionId } from '../../../src/domain/sessions/session';
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
 * Sessions multi-parties (D-033, D-034), par l'API HTTP : capacité immuable, sièges fixes
 * et réutilisables, une session active par joueur, joueurs de session ≠ joueurs de partie,
 * Poursuivre/Quitter, J1. Les règles de jeu de test (testRules) servent seulement à JOUER
 * une partie jusqu'au bout pour obtenir un gagnant : R-03/R-08 restent ouvertes en production.
 *
 * Délai de décision : 60 s dans ces tests (aucun départ automatique parasite sous charge),
 * sauf dans les tests qui vérifient précisément l'échéance.
 */
jest.setTimeout(30_000);

let database: TestDatabase;
let ctx: GameApiTestContext;

const setup = async (options: Parameters<typeof createGameApiTestApp>[1] = {}) => {
  await ctx?.stopTimers();
  ctx = createGameApiTestApp(database.sql, {
    rules: testRules,
    random: identityRandom,
    decisionWindowMs: 60_000,
    turnDurationMs: 60_000,
    ...options,
  });
};

beforeAll(async () => {
  database = await createMigratedDatabase();
}, PGLITE_TIMEOUT_MS);
afterAll(() => database.close());
beforeEach(() => setup());
afterEach(async () => {
  await ctx.stopTimers();
  await database.reset();
});

type Player = Awaited<ReturnType<typeof newPlayer>>;

async function newPlayer() {
  const session = await registerAndLogin(ctx.app);
  return { ...session, id: session.userId as PlayerId, api: as(ctx.app, session.accessToken) };
}

async function createSession(owner: Player, maxPlayers = 4) {
  const res = await expectStatus(owner.api.post('/api/sessions', { maxPlayers }), 201);
  return {
    sessionId: res.body.session.sessionId as SessionId,
    gameId: res.body.game.gameId as GameId,
    body: res.body,
  };
}

const view = async (p: Player, sessionId: string) =>
  (await expectStatus(p.api.get(`/api/sessions/${sessionId}`), 200)).body.session;
const seatsOf = async (p: Player, sessionId: string) =>
  ((await view(p, sessionId)).seats as { seat: number; playerId: string | null }[]).map(
    (s) => s.playerId,
  );
const joinSession = (p: Player, sessionId: string) =>
  expectStatus(p.api.post(`/api/sessions/${sessionId}/join`), 200);
const leaveSession = (p: Player, sessionId: string) =>
  p.api.post(`/api/sessions/${sessionId}/leave`);
const decide = (p: Player, sessionId: string, choice: 'continue' | 'leave') =>
  p.api.post(`/api/sessions/${sessionId}/decision`, { choice });
const nextGame = (p: Player, sessionId: string, body: object = {}) =>
  p.api.post(`/api/sessions/${sessionId}/games`, body);
const joinGame = (p: Player, gameId: string) => p.api.post(`/api/games/${gameId}/join`);
const start = (p: Player, gameId: string) => p.api.post(`/api/games/${gameId}/start`);
const act = (p: Player, gameId: string, cardId: string) =>
  p.api.post(`/api/games/${gameId}/actions`, {
    commandId: randomUUID(),
    type: 'PLAY_CARD',
    payload: { cardId },
  });

/** Coups d'une partie à 2 (distribution « identité ») où le 2e joueur prend et garde le contrôle. */
const SECOND_WINS: [0 | 1, string][] = [
  [0, 'COEUR-3'],
  [1, 'COEUR-6'],
  [1, 'PIQUE-3'],
  [0, 'COEUR-9'],
  [1, 'PIQUE-4'],
  [0, 'COEUR-10'],
  [1, 'COEUR-7'],
  [0, 'COEUR-4'],
  // 5e tour AUTOMATIQUE (D-035) : B joue COEUR-8, A joue COEUR-5, B garde le contrôle.
];

/**
 * Partie à 2 (J1 = first) jouée jusqu'au bout avec la distribution « identité » :
 * J1 = COEUR-3,4,5,9,10 ; J2 = COEUR-6,7,8, PIQUE-3,4. J2 prend le contrôle au 1er tour
 * et le garde jusqu'au 5e (joué automatiquement) : il GAGNE.
 */
async function playUntilSecondWins(gameId: string, first: Player, second: Player, started = false) {
  if (!started) {
    await expectStatus(start(first, gameId), 200);
  }
  for (const [who, card] of SECOND_WINS) {
    await expectStatus(act(who === 0 ? first : second, gameId, card), 200);
  }
}

/**
 * Session à 4 places : A, B, C, D aux sièges 0..3 ; partie 1 entre A et B, gagnée par B.
 * À la fin de la partie, la ronde Poursuivre/Quitter est ouverte pour A, B, C et D.
 */
async function sessionWonByB() {
  const [A, B, C, D] = [await newPlayer(), await newPlayer(), await newPlayer(), await newPlayer()];
  const { sessionId, gameId } = await createSession(A, 4);
  for (const p of [B, C, D]) {
    await joinSession(p, sessionId);
  }
  await expectStatus(joinGame(B, gameId), 200);
  await playUntilSecondWins(gameId, A, B);
  return { A, B, C, D, sessionId, game1: gameId };
}

/** Chaque joueur répond ; la ronde se résout quand tous les présents ont répondu. */
async function answer(sessionId: string, choices: [Player, 'continue' | 'leave'][]) {
  for (const [p, choice] of choices) {
    await expectStatus(decide(p, sessionId, choice), 200);
  }
}

const allContinue = (sessionId: string, players: Player[]) =>
  answer(
    sessionId,
    players.map((p) => [p, 'continue'] as [Player, 'continue']),
  );

/** Attend qu'une condition devienne vraie (timers réels du serveur). */
async function eventually<T>(read: () => Promise<T>, ok: (v: T) => boolean, ms = 5_000) {
  const until = Date.now() + ms;
  for (;;) {
    const value = await read();
    if (ok(value) || Date.now() > until) return value;
    await new Promise((r) => setTimeout(r, 50));
  }
}

describe('Session : création, capacité, vue', () => {
  it('POST /api/sessions : OPEN, capacité persistée, créateur au siège 0, 1re partie avec J1 = créateur', async () => {
    const A = await newPlayer();
    const { body, sessionId } = await createSession(A, 3);

    expect(body.session).toMatchObject({
      status: 'open',
      creatorId: A.id,
      maxPlayers: 3,
      seats: [
        { seat: 0, playerId: A.id },
        { seat: 1, playerId: null },
        { seat: 2, playerId: null },
      ],
    });
    expect(body.game).toMatchObject({
      sessionId,
      firstPlayerId: A.id,
      maxPlayers: 3,
      status: 'waiting',
    });
    const { rows } = await database.sql.query<{ max_players: number }>(
      'SELECT max_players FROM sessions WHERE id = $1',
      [sessionId],
    );
    expect(rows[0]?.max_players).toBe(3);
  });

  it.each([2, 3, 4])('maxPlayers = %i accepté', async (n) => {
    const A = await newPlayer();
    expect((await createSession(A, n)).body.session.maxPlayers).toBe(n);
  });

  it.each([1, 5, 0, '4', null])('maxPlayers = %p refusé (400), rien n’est créé', async (n) => {
    const A = await newPlayer();
    const res = await expectStatus(A.api.post('/api/sessions', { maxPlayers: n }), 400);
    expect(res.body.fields).toHaveProperty('maxPlayers');
    const { rows } = await database.sql.query<{ n: number }>(
      'SELECT count(*)::int AS n FROM sessions',
    );
    expect(rows[0]?.n).toBe(0);
  });

  it('maxPlayers est immuable : la base refuse de le modifier', async () => {
    const A = await newPlayer();
    const { sessionId } = await createSession(A, 2);
    await expect(
      database.sql.query('UPDATE sessions SET max_players = 4 WHERE id = $1', [sessionId]),
    ).rejects.toThrow(/immuable/);
  });

  it('POST /api/games (compatibilité) ouvre aussi une session dont c’est la 1re partie', async () => {
    const A = await newPlayer();
    const res = await expectStatus(A.api.post('/api/games', { maxPlayers: 3 }), 201);
    const session = await view(A, res.body.game.sessionId);
    expect(session).toMatchObject({ creatorId: A.id, maxPlayers: 3 });
  });

  it('accès : 401 sans jeton, 400 identifiant invalide, 404 inconnue, 403 non-membre', async () => {
    const A = await newPlayer();
    const outsider = await newPlayer();
    const { sessionId } = await createSession(A);

    await request(ctx.app).get(`/api/sessions/${sessionId}`).expect(401);
    await request(ctx.app).post(`/api/sessions/${sessionId}/join`).expect(401);
    await request(ctx.app).post(`/api/sessions/${sessionId}/decision`).expect(401);
    await expectStatus(A.api.get('/api/sessions/pas-un-uuid'), 400);
    await expectStatus(A.api.get(`/api/sessions/${randomUUID()}`), 404);
    const denied = await expectStatus(outsider.api.get(`/api/sessions/${sessionId}`), 403);
    expect(denied.body.code).toBe('NOT_A_SESSION_MEMBER');
    const badChoice = await expectStatus(
      A.api.post(`/api/sessions/${sessionId}/decision`, { choice: 'peut-être' }),
      400,
    );
    expect(badChoice.body.fields).toHaveProperty('choice');
  });

  it('anti-usurpation : un playerId/creatorId envoyé par le client est ignoré', async () => {
    const [A, B] = [await newPlayer(), await newPlayer()];
    const res = await expectStatus(
      A.api.post('/api/sessions', { maxPlayers: 2, creatorId: B.id, playerId: B.id }),
      201,
    );
    expect(res.body.session.creatorId).toBe(A.id);
    expect(res.body.session.seats[0].playerId).toBe(A.id);
    // B n'est membre de rien : agir « au nom de B » via le corps est impossible.
    const forged = await expectStatus(
      A.api.post(`/api/sessions/${res.body.session.sessionId}/leave`, { playerId: B.id }),
      409,
    );
    expect(forged.body.code).toBe('PLAYER_IN_ACTIVE_GAME'); // c'est bien A qui est traité
  });

  it('idempotence : la même Idempotency-Key renvoie la même session et la même partie', async () => {
    const A = await newPlayer();
    const send = () =>
      request(ctx.app)
        .post('/api/sessions')
        .set('Authorization', `Bearer ${A.accessToken}`)
        .set('Idempotency-Key', 'cle-session-1')
        .send({ maxPlayers: 3 });
    const [first, second] = await Promise.all([send(), send()]);
    const third = await send();

    expect([first.status, second.status, third.status]).toEqual([201, 201, 201]);
    expect(new Set([first, second, third].map((r) => r.body.session.sessionId)).size).toBe(1);
    expect(new Set([first, second, third].map((r) => r.body.game.gameId)).size).toBe(1);
    const { rows } = await database.sql.query<{ n: number }>(
      'SELECT count(*)::int AS n FROM sessions WHERE creator_id = $1',
      [A.id],
    );
    expect(rows[0]?.n).toBe(1);
  });
});

describe('Une seule session active par joueur (D-034)', () => {
  it('présent dans S1 : ni créer, ni rejoindre une autre session', async () => {
    const [A, B, C] = [await newPlayer(), await newPlayer(), await newPlayer()];
    const s1 = await createSession(A);
    const s2 = await createSession(C);
    await joinSession(B, s1.sessionId);

    const create = await expectStatus(B.api.post('/api/sessions', { maxPlayers: 2 }), 409);
    expect(create.body.code).toBe('ALREADY_IN_SESSION');
    const join = await expectStatus(B.api.post(`/api/sessions/${s2.sessionId}/join`), 409);
    expect(join.body.code).toBe('ALREADY_IN_SESSION');

    // Après avoir quitté S1, B peut rejoindre S2 ; l'historique de S1 reste.
    await expectStatus(leaveSession(B, s1.sessionId), 200);
    await joinSession(B, s2.sessionId);
    expect((await view(B, s1.sessionId)).players).toContainEqual(
      expect.objectContaining({ playerId: B.id, active: false }),
    );
    const mine = await expectStatus(B.api.get('/api/sessions/me/active'), 200);
    expect(mine.body.sessions.map((s: { sessionId: string }) => s.sessionId)).toEqual([
      s2.sessionId,
    ]);
  });

  it('la base garantit l’unicité même si l’application est contournée', async () => {
    const [A, C] = [await newPlayer(), await newPlayer()];
    await createSession(A);
    const s2 = await createSession(C);
    await expect(
      database.sql.query(
        `INSERT INTO session_players (session_id, player_id, seat, active, joined_at)
         VALUES ($1, $2, 1, true, now())`,
        [s2.sessionId, A.id],
      ),
    ).rejects.toThrow(/session_players_one_active_session_per_player/);
  });
});

describe('Sièges fixes (D-034)', () => {
  it('attribution, siège vacant, réutilisation du siège vacant, retour d’un joueur, table pleine', async () => {
    const [A, B, C, D, E] = [
      await newPlayer(),
      await newPlayer(),
      await newPlayer(),
      await newPlayer(),
      await newPlayer(),
    ];
    const { sessionId, gameId } = await createSession(A, 4);
    for (const p of [B, C, D]) await joinSession(p, sessionId);
    expect(await seatsOf(A, sessionId)).toEqual([A.id, B.id, C.id, D.id]);

    const full = await expectStatus(E.api.post(`/api/sessions/${sessionId}/join`), 409);
    expect(full.body.code).toBe('SESSION_FULL');

    await expectStatus(leaveSession(C, sessionId), 200);
    expect(await seatsOf(A, sessionId)).toEqual([A.id, B.id, null, D.id]);

    await joinSession(E, sessionId); // E prend le siège 2, pas « la fin »
    expect(await seatsOf(A, sessionId)).toEqual([A.id, B.id, E.id, D.id]);

    await expectStatus(leaveSession(B, sessionId), 200);
    await joinSession(C, sessionId); // C revient : premier siège vacant = 1
    expect(await seatsOf(A, sessionId)).toEqual([A.id, C.id, E.id, D.id]);

    // La partie en attente reçoit le siège de session de chaque joueur qui la rejoint.
    await expectStatus(joinGame(E, gameId), 200);
    const { rows } = await database.sql.query<{ table_position: number }>(
      'SELECT table_position FROM game_players WHERE game_id = $1 AND player_id = $2',
      [gameId, E.id],
    );
    expect(rows[0]?.table_position).toBe(2);
  });

  it.each([2, 3])('capacité %i : jamais plus de joueurs présents que de sièges', async (n) => {
    const players = [await newPlayer(), await newPlayer(), await newPlayer(), await newPlayer()];
    const { sessionId } = await createSession(players[0]!, n);
    for (const p of players.slice(1, n)) await joinSession(p, sessionId);
    const extra = await expectStatus(players[n]!.api.post(`/api/sessions/${sessionId}/join`), 409);
    expect(extra.body.code).toBe('SESSION_FULL');
    expect((await seatsOf(players[0]!, sessionId)).every(Boolean)).toBe(true);
  });
});

describe('Joueurs de session et joueurs de partie', () => {
  it('rejoindre la session ne fait pas entrer dans la partie ; la partie exige la session', async () => {
    const [A, B, C] = [await newPlayer(), await newPlayer(), await newPlayer()];
    const { sessionId, gameId } = await createSession(A);

    const direct = await expectStatus(joinGame(C, gameId), 403);
    expect(direct.body.code).toBe('NOT_A_SESSION_MEMBER');

    await joinSession(B, sessionId);
    const game = await expectStatus(A.api.get(`/api/games/${gameId}`), 200);
    expect(game.body.game.players.map((p: { playerId: string }) => p.playerId)).toEqual([A.id]);
    await expectStatus(joinGame(B, gameId), 200);
  });

  it('arrivée pendant une partie EN COURS : joueur de session seulement, sans carte', async () => {
    const [A, B, C] = [await newPlayer(), await newPlayer(), await newPlayer()];
    const { sessionId, gameId } = await createSession(A, 3);
    await joinSession(B, sessionId);
    await expectStatus(joinGame(B, gameId), 200);
    await expectStatus(start(A, gameId), 200);

    await joinSession(C, sessionId);
    const refused = await expectStatus(joinGame(C, gameId), 409);
    expect(refused.body.code).toBe('GAME_NOT_JOINABLE');
    await expectStatus(C.api.get(`/api/games/${gameId}`), 403); // aucune carte, aucune vue
    const game = await expectStatus(A.api.get(`/api/games/${gameId}`), 200);
    expect(game.body.game.players).toHaveLength(2);
    expect(Object.keys(game.body.game.play.handCounts)).not.toContain(C.id);
    const session = await view(A, sessionId);
    expect(session.seats.map((s: { playerId: string }) => s.playerId)).toEqual([A.id, B.id, C.id]);
    expect(session.currentGame).toMatchObject({
      gameId,
      status: 'in_progress',
      playerIds: [A.id, B.id],
    });
  });

  it('quitter la session : refusé pendant sa partie active ; autorisé à un joueur hors partie', async () => {
    const [A, B, C] = [await newPlayer(), await newPlayer(), await newPlayer()];
    const { sessionId, gameId } = await createSession(A);
    await joinSession(B, sessionId);
    await joinSession(C, sessionId);
    await expectStatus(joinGame(B, gameId), 200);

    const refused = await expectStatus(leaveSession(B, sessionId), 409);
    expect(refused.body.code).toBe('PLAYER_IN_ACTIVE_GAME');
    await expectStatus(leaveSession(C, sessionId), 200);
  });
});

describe('Poursuivre / Quitter entre deux parties (D-034)', () => {
  it('la fin de partie ouvre la ronde (10 s) pour TOUS les présents, joueurs ou non de la partie', async () => {
    await setup({ decisionWindowMs: 10_000 });
    const { A, B, C, D, sessionId, game1 } = await sessionWonByB();
    const session = await view(A, sessionId);
    const finishedAt = new Date(
      (await expectStatus(A.api.get(`/api/games/${game1}`), 200)).body.game.finishedAt,
    );

    expect(session.decision).toMatchObject({ gameId: game1, open: true });
    expect(new Date(session.decision.deadlineAt).getTime() - finishedAt.getTime()).toBe(10_000);
    expect([...session.decision.pendingPlayerIds].sort()).toEqual([A.id, B.id, C.id, D.id].sort());
    const { rows } = await database.sql.query<{ deadline_at: Date }>(
      'SELECT deadline_at FROM session_decision_rounds WHERE game_id = $1 AND resolved_at IS NULL',
      [game1],
    );
    expect(rows[0]?.deadline_at.getTime()).toBe(finishedAt.getTime() + 10_000);
    expect(ctx.sessionTimers.has(sessionId)).toBe(true);
  });

  it('Poursuivre / Quitter persistés ; Quitter libère le siège ; résolue quand tous ont répondu', async () => {
    const { A, B, C, D, sessionId, game1 } = await sessionWonByB();
    await answer(sessionId, [
      [A, 'continue'],
      [C, 'leave'],
    ]);
    let session = await view(A, sessionId);
    expect(session.decision.open).toBe(true);
    expect(await seatsOf(A, sessionId)).toEqual([A.id, B.id, null, D.id]);

    await answer(sessionId, [
      [B, 'continue'],
      [D, 'continue'],
    ]);
    session = await view(A, sessionId);
    expect(session.decision).toMatchObject({ open: false, pendingPlayerIds: [] });
    expect(ctx.sessionTimers.has(sessionId)).toBe(false);
    const { rows } = await database.sql.query<{ player_id: string; choice: string }>(
      'SELECT player_id, choice FROM session_decisions WHERE game_id = $1',
      [game1],
    );
    expect(rows).toHaveLength(4);
    expect(rows.find((r) => r.player_id === C.id)?.choice).toBe('leave');
    expect(rows.find((r) => r.player_id === A.id)?.choice).toBe('continue');
  });

  it('pendant la ronde : partie suivante et nouvelle arrivée refusées (409)', async () => {
    const { A, sessionId } = await sessionWonByB();
    const E = await newPlayer();
    const next = await expectStatus(nextGame(A, sessionId), 409);
    expect(next.body.code).toBe('SESSION_DECISION_IN_PROGRESS');
    const join = await expectStatus(E.api.post(`/api/sessions/${sessionId}/join`), 409);
    expect(join.body.code).toBe('SESSION_DECISION_IN_PROGRESS');
  });

  it('absence de réponse : départ AUTOMATIQUE à l’échéance (serveur), siège libéré', async () => {
    await setup({ decisionWindowMs: 4_000 });
    const { A, B, C, D, sessionId } = await sessionWonByB();
    const events: SessionEvent[] = [];
    ctx.sessionEvents.subscribe(sessionId, (e) => events.push(e));
    await answer(sessionId, [
      [A, 'continue'],
      [B, 'continue'],
    ]);

    const session = await eventually(
      () => view(A, sessionId),
      (s) => s.decision?.open === false,
      10_000,
    );
    expect(await seatsOf(A, sessionId)).toEqual([A.id, B.id, null, null]);
    expect(session.status).toBe('open');
    expect(
      session.decision.decisions.filter((d: { choice: string }) => d.choice === 'auto_leave'),
    ).toHaveLength(2);
    expect(
      events
        .filter((e) => e.type === 'session:auto_leave')
        .map((e) => e.payload.playerId as string)
        .sort(),
    ).toEqual([C.id, D.id].sort());
    expect(ctx.logLines.filter((l) => l.message === 'AUTO_LEAVE')).toHaveLength(2);
    expect(ctx.logLines.some((l) => l.message === 'SESSION_DECISION_TIMEOUT')).toBe(true);
  });

  it('personne ne répond : tout le monde part, la session est CLOSED (aucune réouverture)', async () => {
    await setup({ decisionWindowMs: 500 });
    const { A, sessionId } = await sessionWonByB();
    const late = await newPlayer();
    const session = await eventually(
      () => view(A, sessionId),
      (s) => s.status === 'closed',
    );
    expect(session).toMatchObject({ status: 'closed', closedAt: expect.any(String) });
    const join = await expectStatus(late.api.post(`/api/sessions/${sessionId}/join`), 409);
    expect(join.body.code).toBe('SESSION_CLOSED');
    const res = await nextGame(A, sessionId);
    expect([403, 409]).toContain(res.status);
  });

  it('le joueur arrivé pendant la partie choisit Poursuivre et joue la partie suivante', async () => {
    const [A, B, C] = [await newPlayer(), await newPlayer(), await newPlayer()];
    const { sessionId, gameId } = await createSession(A, 3);
    await joinSession(B, sessionId);
    await expectStatus(joinGame(B, gameId), 200);
    await expectStatus(start(A, gameId), 200);
    await joinSession(C, sessionId); // pendant la partie : spectateur de session, sans carte
    await playUntilSecondWins(gameId, A, B, true); // B gagne

    expect((await view(C, sessionId)).decision.pendingPlayerIds).toContain(C.id);
    await allContinue(sessionId, [A, B, C]);

    const game2 = (await expectStatus(nextGame(C, sessionId), 201)).body.game;
    expect(game2).toMatchObject({ firstPlayerId: B.id, maxPlayers: 3 });
    await expectStatus(joinGame(B, game2.gameId), 200);
    const started = await expectStatus(start(C, game2.gameId), 200);
    expect(started.body.game.play.myHand).toHaveLength(5);
    // Sièges fixes : B = 1, C = 2 ; J1 = B → ordre antihoraire B → C.
    expect(started.body.game.play.dealOrder).toEqual([B.id, C.id]);
  });
});

describe('Plusieurs parties et J1 (D-033, D-034)', () => {
  it('TEST 2 — gagnant B présent : J1 de la partie 2 = B ; sièges inchangés ; historique', async () => {
    const { A, B, C, D, sessionId, game1 } = await sessionWonByB();
    await allContinue(sessionId, [A, B, C, D]);
    const seatsBefore = await seatsOf(A, sessionId);

    const game2 = (await expectStatus(nextGame(A, sessionId), 201)).body.game;
    expect(game2).toMatchObject({
      sessionId,
      firstPlayerId: B.id,
      creatorId: A.id,
      maxPlayers: 4,
    });
    await expectStatus(joinGame(B, game2.gameId), 200);
    const started = await expectStatus(start(A, game2.gameId), 200);
    expect(started.body.game.play.dealOrder).toEqual([B.id, A.id]); // B servi en premier
    expect(started.body.game.play.controllerId).toBe(B.id);
    expect(started.body.game.play.nextPlayerId).toBe(B.id);
    // J1 a changé, les sièges NON (B n'est pas devenu le siège 0).
    expect(await seatsOf(A, sessionId)).toEqual(seatsBefore);
    expect(seatsBefore).toEqual([A.id, B.id, C.id, D.id]);

    const history = await expectStatus(A.api.get(`/api/sessions/${sessionId}/games`), 200);
    expect(history.body.games.map((g: { gameId: string }) => g.gameId)).toEqual([
      game1,
      game2.gameId,
    ]);
    expect(history.body.games[0]).toMatchObject({
      status: 'finished',
      winnerId: B.id,
      firstPlayerId: A.id,
    });
    expect(JSON.stringify(history.body)).not.toMatch(/COEUR|PIQUE|TREFLE|ETOILE/);
  });

  it('TEST 3 — B a quitté : J1 = C (siège suivant celui de B, sens antihoraire)', async () => {
    const { A, B, C, D, sessionId } = await sessionWonByB();
    await answer(sessionId, [[B, 'leave']]);
    await allContinue(sessionId, [A, C, D]);
    const created = await expectStatus(nextGame(A, sessionId), 201);
    expect(created.body.game.firstPlayerId).toBe(C.id);
  });

  it('TEST 4 — B et C absents : J1 = D', async () => {
    const { A, B, C, D, sessionId } = await sessionWonByB();
    await answer(sessionId, [
      [B, 'leave'],
      [C, 'leave'],
    ]);
    await allContinue(sessionId, [A, D]);
    const created = await expectStatus(nextGame(A, sessionId), 201);
    expect(created.body.game.firstPlayerId).toBe(D.id);
  });

  it('TEST 5 — B, C et D absents : J1 = A (tour complet de la table)', async () => {
    const { A, B, C, D, sessionId } = await sessionWonByB();
    await answer(sessionId, [
      [B, 'leave'],
      [C, 'leave'],
      [D, 'leave'],
      [A, 'continue'],
    ]);
    const created = await expectStatus(nextGame(A, sessionId), 201);
    expect(created.body.game.firstPlayerId).toBe(A.id);
  });

  it('TEST 6 — tout le monde quitte : session CLOSED, plus d’arrivée ni de partie', async () => {
    const { A, B, C, D, sessionId } = await sessionWonByB();
    const late = await newPlayer();
    await answer(sessionId, [
      [B, 'leave'],
      [C, 'leave'],
      [D, 'leave'],
      [A, 'leave'],
    ]);

    expect(await view(A, sessionId)).toMatchObject({
      status: 'closed',
      closedAt: expect.any(String),
    });
    const join = await expectStatus(late.api.post(`/api/sessions/${sessionId}/join`), 409);
    expect(join.body.code).toBe('SESSION_CLOSED');
    const res = await nextGame(A, sessionId);
    expect([403, 409]).toContain(res.status);
  });

  it('capacité immuable : la partie suivante garde maxPlayers ; une autre valeur est refusée', async () => {
    const { A, B, C, D, sessionId } = await sessionWonByB();
    await allContinue(sessionId, [A, B, C, D]);
    const refused = await expectStatus(nextGame(A, sessionId, { maxPlayers: 2 }), 409);
    expect(refused.body.code).toBe('SESSION_MAX_PLAYERS_IMMUTABLE');
    const ok = await expectStatus(nextGame(A, sessionId, { maxPlayers: 4 }), 201);
    expect(ok.body.game.maxPlayers).toBe(4);
  });

  it('une seule partie active par session : partie suivante refusée tant que la précédente dure', async () => {
    const [A, B] = [await newPlayer(), await newPlayer()];
    const { sessionId } = await createSession(A);
    await joinSession(B, sessionId);
    const res = await expectStatus(nextGame(B, sessionId), 409);
    expect(res.body.code).toBe('SESSION_GAME_IN_PROGRESS');
  });

  it('J1 absent de la partie : démarrage refusé (409 FIRST_PLAYER_NOT_IN_GAME)', async () => {
    const { A, B, C, D, sessionId } = await sessionWonByB();
    await allContinue(sessionId, [A, B, C, D]);
    const created = await expectStatus(nextGame(A, sessionId), 201); // J1 = B
    await expectStatus(joinGame(C, created.body.game.gameId), 200);
    const res = await expectStatus(start(A, created.body.game.gameId), 409);
    expect(res.body.code).toBe('FIRST_PLAYER_NOT_IN_GAME');
  });

  it('dernière partie terminée sans gagnant : J1 indéterminé → 409, rien n’est créé', async () => {
    const A = await newPlayer();
    const { sessionId, gameId } = await createSession(A, 2);
    await ctx.games.finishGame(gameId); // arrêt administratif, pas de gagnant
    await answer(sessionId, [[A, 'continue']]);
    const res = await expectStatus(nextGame(A, sessionId), 409);
    expect(res.body.code).toBe('FIRST_PLAYER_UNDETERMINED');
  });
});

describe('Événements de session', () => {
  it('versionnés et séquencés, avec sessionId, sans aucune carte', async () => {
    const [A, B] = [await newPlayer(), await newPlayer()];
    const { sessionId, gameId } = await createSession(A, 2);
    const events: SessionEvent[] = [];
    ctx.sessionEvents.subscribe(sessionId, (e) => events.push(e));

    await joinSession(B, sessionId);
    await ctx.games.finishGame(gameId);
    await ctx.sessions.syncSession(sessionId);
    await answer(sessionId, [
      [B, 'leave'],
      [A, 'leave'],
    ]);

    expect(events.map((e) => [e.type, e.version, e.sequence])).toEqual([
      ['session:player_joined', 2, 0],
      ['session:decision_started', 3, 0],
      ['session:decision', 4, 0],
      ['session:player_left', 4, 1],
      ['session:decision', 5, 0],
      ['session:player_left', 5, 1],
      ['session:closed', 5, 2],
    ]);
    expect(events.every((e) => e.sessionId === sessionId)).toBe(true);
    expect(JSON.stringify(events)).not.toMatch(/COEUR|PIQUE|TREFLE|ETOILE/);
  });

  it('game:created porte sessionId et firstPlayerId ; game:player_joined dans la salle de la partie', async () => {
    const { A, B, C, D, sessionId } = await sessionWonByB();
    await allContinue(sessionId, [A, B, C, D]);
    const res = await expectStatus(nextGame(A, sessionId), 201);
    const seen: GameEvent[] = [];
    await ctx.games.subscribe(res.body.game.gameId, A.id, (e) => seen.push(e));
    await expectStatus(joinGame(B, res.body.game.gameId), 200);
    expect(seen[0]).toMatchObject({ type: 'game:player_joined', gameId: res.body.game.gameId });
  });
});

describe('Concurrence (PGlite)', () => {
  it('deux arrivées simultanées pour la DERNIÈRE place : une seule réussit', async () => {
    const [A, B, C] = [await newPlayer(), await newPlayer(), await newPlayer()];
    const { sessionId } = await createSession(A, 2);
    const results = await Promise.all([
      B.api.post(`/api/sessions/${sessionId}/join`),
      C.api.post(`/api/sessions/${sessionId}/join`),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
    expect(results.find((r) => r.status === 409)?.body.code).toBe('SESSION_FULL');
    expect((await seatsOf(A, sessionId)).filter(Boolean)).toHaveLength(2);
  });

  it('deux derniers départs simultanés : session fermée une seule fois', async () => {
    const [A, B] = [await newPlayer(), await newPlayer()];
    const { sessionId, gameId } = await createSession(A, 2);
    await joinSession(B, sessionId);
    await ctx.games.finishGame(gameId);
    const closed: SessionEvent[] = [];
    ctx.sessionEvents.subscribe(sessionId, (e) => e.type === 'session:closed' && closed.push(e));

    await Promise.all([leaveSession(A, sessionId), leaveSession(B, sessionId)]);
    expect(closed).toHaveLength(1);
    expect((await view(A, sessionId)).status).toBe('closed');
  });

  it('Poursuivre et Quitter simultanés de tous les joueurs : une seule résolution', async () => {
    const { A, B, C, D, sessionId } = await sessionWonByB();
    const resolved: SessionEvent[] = [];
    ctx.sessionEvents.subscribe(
      sessionId,
      (e) => e.type === 'session:decision_closed' && resolved.push(e),
    );
    const results = await Promise.all([
      decide(A, sessionId, 'continue'),
      decide(B, sessionId, 'continue'),
      decide(C, sessionId, 'leave'),
      decide(D, sessionId, 'continue'),
    ]);
    expect(results.map((r) => r.status)).toEqual([200, 200, 200, 200]);
    expect(resolved).toHaveLength(1);
    expect(resolved[0]?.payload.continuingPlayerIds).toEqual([A.id, B.id, D.id]);
  });

  it('deux créations simultanées de partie dans la même session : une seule', async () => {
    const { A, B, C, D, sessionId } = await sessionWonByB();
    await allContinue(sessionId, [A, B, C, D]);
    const results = await Promise.all([nextGame(A, sessionId), nextGame(C, sessionId)]);
    expect(results.map((r) => r.status).sort()).toEqual([201, 409]);
    expect(results.find((r) => r.status === 409)?.body.code).toBe('SESSION_GAME_IN_PROGRESS');
  });

  it('double fin de partie : une seule transition, un seul game:finished, une seule ronde', async () => {
    const A = await newPlayer();
    const { gameId, sessionId } = await createSession(A, 2);
    const seen: GameEvent[] = [];
    await ctx.games.subscribe(gameId, A.id, (e) => seen.push(e));
    await Promise.all([ctx.games.finishGame(gameId), ctx.games.finishGame(gameId)]);
    await Promise.all([ctx.sessions.syncSession(sessionId), ctx.sessions.syncSession(sessionId)]);
    expect(seen.filter((e) => e.type === 'game:finished')).toHaveLength(1);
    const { rows } = await database.sql.query<{ n: number }>(
      'SELECT count(*)::int AS n FROM session_decision_rounds WHERE session_id = $1',
      [sessionId],
    );
    expect(rows[0]?.n).toBe(1);
  });
});
