import type { GameId, PlayerId } from '../../../src/domain/game/game-id';
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

/**
 * Timers PERSISTANTS (D-034) : arrêter le backend puis le redémarrer sur la même base.
 * À l'échéance d'un tour, le serveur joue la carte de D-036 (ici J1 ouvre le tour avec
 * COEUR-3,4,5,9,10 : plus petite carte de la main, COEUR-3).
 * L'« instance » 1 démarre une partie (timer de tour) ou en termine une (timer de
 * décision), puis s'arrête (ses timers en mémoire disparaissent). L'instance 2 n'a que
 * PostgreSQL : DeadlineSupervisor.recover() doit reconstruire les timers, ou traiter
 * immédiatement, et une seule fois, les échéances déjà dépassées.
 */
jest.setTimeout(45_000);

let database: TestDatabase;
const instances: GameApiTestContext[] = [];

beforeAll(async () => {
  database = await createMigratedDatabase();
}, PGLITE_TIMEOUT_MS);
afterAll(() => database.close());
afterEach(async () => {
  const stopped = instances.splice(0);
  await Promise.all(stopped.map((i) => i.stopTimers()));
  await Promise.all(stopped.map((i) => i.games.idle()));
  await database.reset();
});

function instance(options: Parameters<typeof createGameApiTestApp>[1] = {}) {
  const ctx = createGameApiTestApp(database.sql, { random: identityRandom, ...options });
  instances.push(ctx);
  return ctx;
}

async function newPlayer(ctx: GameApiTestContext) {
  const s = await registerAndLogin(ctx.app);
  return { id: s.userId as PlayerId, api: as(ctx.app, s.accessToken) };
}

/** Session à 2, partie démarrée par A (J1). */
async function startedGame(ctx: GameApiTestContext) {
  const [A, B] = [await newPlayer(ctx), await newPlayer(ctx)];
  const created = await expectStatus(A.api.post('/api/sessions', { maxPlayers: 2 }), 201);
  const sessionId = created.body.session.sessionId as SessionId;
  const gameId = created.body.game.gameId as GameId;
  await expectStatus(B.api.post(`/api/sessions/${sessionId}/join`), 200);
  await expectStatus(B.api.post(`/api/games/${gameId}/join`), 200);
  await expectStatus(A.api.post(`/api/games/${gameId}/start`), 200);
  return { A, B, sessionId, gameId };
}

async function gameRow(gameId: string) {
  const { rows } = await database.sql.query<{
    version: number;
    turn_deadline_at: Date | null;
    turn_started_at: Date | null;
    turn_timed_out_at: Date | null;
    active_player_id: string | null;
    trick: { playerId: string; cardId: string }[];
  }>(
    `SELECT version, turn_deadline_at, turn_started_at, turn_timed_out_at, active_player_id,
       state -> 'play' -> 'currentTrick' AS trick
     FROM games WHERE id = $1`,
    [gameId],
  );
  return rows[0]!;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe('Timer de tour : redémarrage (turn_deadline_at)', () => {
  it('l’échéance, son début et le joueur attendu sont en base dès le démarrage', async () => {
    const one = instance();
    const { A, gameId } = await startedGame(one);
    const row = await gameRow(gameId);
    expect(row.active_player_id).toBe(A.id);
    expect(row.turn_deadline_at!.getTime() - row.turn_started_at!.getTime()).toBe(13_000);
    expect(row.turn_timed_out_at).toBeNull();
  });

  it('arrêt avant l’échéance → timer reconstruit, TURN_TIMEOUT et coup automatique à l’heure prévue', async () => {
    const one = instance({ turnDurationMs: 4_000 });
    const { A, B, gameId } = await startedGame(one);
    const started = await gameRow(gameId);
    await one.stopTimers(); // arrêt du processus

    const two = instance({ turnDurationMs: 4_000 });
    const report = await two.supervisor.recover();
    expect(report).toMatchObject({ turnTimersScheduled: 1, turnTimeoutsProcessed: 0 });
    expect(two.timers.has(gameId)).toBe(true);
    expect((await gameRow(gameId)).turn_timed_out_at).toBeNull();

    await sleep(4_800);
    await two.games.idle();
    const row = await gameRow(gameId);
    // Coup automatique joué (D-036), puis tour de B avec sa propre échéance.
    expect(row.trick).toEqual([{ playerId: A.id, cardId: 'COEUR-3' }]);
    expect(row.active_player_id).toBe(B.id);
    expect(row.turn_timed_out_at).toBeNull();
    expect(row.version).toBe(started.version + 2);
    const timeout = two.logLines.find((l) => l.message === 'TURN_TIMEOUT')!;
    expect(new Date(timeout.timeout as string).getTime()).toBeGreaterThanOrEqual(
      started.turn_deadline_at!.getTime(),
    );
    // Vue de A : sa main privée ne contient plus la carte jouée automatiquement.
    const view = await expectStatus(A.api.get(`/api/games/${gameId}`), 200);
    expect(view.body.game.play.myHand).toEqual(['COEUR-4', 'COEUR-5', 'COEUR-9', 'COEUR-10']);
  });

  it('échéance dépassée pendant l’arrêt → traitée tout de suite, une seule fois (deux reprises)', async () => {
    const one = instance({ turnDurationMs: 3_000 });
    const { A, gameId } = await startedGame(one);
    const started = await gameRow(gameId);
    await one.stopTimers();
    await sleep(3_200);

    const two = instance();
    const three = instance();
    const [r2, r3] = await Promise.all([two.supervisor.recover(), three.supervisor.recover()]);
    await Promise.all([two.games.idle(), three.games.idle()]);
    // Les deux reprises voient l'échéance dépassée (ou, si l'autre a déjà joué, la nouvelle
    // échéance du tour de B) ; un seul effet : une expiration et UNE carte automatique.
    expect(r2.turnTimeoutsProcessed + r3.turnTimeoutsProcessed).toBeGreaterThanOrEqual(1);
    const row = await gameRow(gameId);
    expect(row.trick).toEqual([{ playerId: A.id, cardId: 'COEUR-3' }]);
    expect(row.version).toBe(started.version + 2);
    const before = (
      await database.sql.query<{ version: number }>('SELECT version FROM games WHERE id = $1', [
        gameId,
      ])
    ).rows[0]!.version;
    await two.supervisor.sweep();
    expect((await gameRow(gameId)).version).toBe(before); // balayage : rien de plus
    const logs = [...two.logLines, ...three.logLines];
    expect(logs.filter((l) => l.message === 'TURN_TIMEOUT')).toHaveLength(1);
    expect(logs.filter((l) => l.message === 'AUTO_CARD_PLAY')).toHaveLength(1);
  });
});

describe('Timer de décision : redémarrage (session_decision_rounds.deadline_at)', () => {
  it('arrêt pendant la ronde → timer reconstruit ; à l’échéance, départ automatique', async () => {
    const one = instance({ decisionWindowMs: 4_000 });
    const { A, sessionId, gameId } = await startedGame(one);
    await one.games.finishGame(gameId);
    await one.sessions.syncSession(sessionId);
    await expectStatus(
      A.api.post(`/api/sessions/${sessionId}/decision`, { choice: 'continue' }),
      200,
    );
    await one.stopTimers();

    const two = instance({ decisionWindowMs: 4_000 });
    const report = await two.supervisor.recover();
    expect(report).toMatchObject({ decisionTimersScheduled: 1, decisionsProcessed: 0 });
    expect(two.sessionTimers.has(sessionId)).toBe(true);

    await sleep(4_800);
    const { rows } = await database.sql.query<{ player_id: string; choice: string }>(
      'SELECT player_id, choice FROM session_decisions WHERE game_id = $1 ORDER BY choice',
      [gameId],
    );
    expect(rows.map((r) => r.choice).sort()).toEqual(['auto_leave', 'continue']);
    const round = await database.sql.query<{ resolved_at: Date | null }>(
      'SELECT resolved_at FROM session_decision_rounds WHERE game_id = $1',
      [gameId],
    );
    expect(round.rows[0]?.resolved_at).not.toBeNull();
  });

  it('échéance dépassée pendant l’arrêt → AUTO_LEAVE immédiat au redémarrage ; session fermée si vide', async () => {
    const one = instance({ decisionWindowMs: 2_000 });
    const { sessionId, gameId } = await startedGame(one);
    await one.games.finishGame(gameId);
    await one.sessions.syncSession(sessionId);
    await one.stopTimers();
    await sleep(2_200);

    const two = instance({ decisionWindowMs: 2_000 });
    const report = await two.supervisor.recover();
    expect(report.decisionsProcessed).toBe(1);
    const { rows } = await database.sql.query<{ status: string }>(
      'SELECT status FROM sessions WHERE id = $1',
      [sessionId],
    );
    expect(rows[0]?.status).toBe('closed');
    // Rejouer la reprise : aucun effet supplémentaire.
    const again = await two.supervisor.recover();
    expect(again).toMatchObject({ decisionsProcessed: 0, decisionTimersScheduled: 0 });
  });

  it('partie terminée sans que la ronde ait été ouverte (arrêt brutal) → ouverte à la reprise', async () => {
    const one = instance({ decisionWindowMs: 60_000 });
    const { sessionId, gameId } = await startedGame(one);
    // Fin de partie enregistrée, mais le processus « meurt » avant d'ouvrir la ronde : on
    // simule en annulant la ronde ouverte par l'écouteur de fin de partie.
    await one.games.finishGame(gameId);
    await one.sessions.idle();
    await database.sql.query('DELETE FROM session_decision_rounds WHERE game_id = $1', [gameId]);
    await one.stopTimers();

    const two = instance({ decisionWindowMs: 60_000 });
    const report = await two.supervisor.recover();
    expect(report.decisionsProcessed).toBe(1);
    const round = await database.sql.query<{ deadline_at: Date }>(
      'SELECT deadline_at FROM session_decision_rounds WHERE game_id = $1 AND resolved_at IS NULL',
      [gameId],
    );
    const finished = await database.sql.query<{ finished_at: Date }>(
      'SELECT finished_at FROM games WHERE id = $1',
      [gameId],
    );
    // Même échéance quel que soit le processus qui ouvre la ronde : fin + fenêtre.
    expect(round.rows[0]?.deadline_at.getTime()).toBe(
      finished.rows[0]!.finished_at.getTime() + 60_000,
    );
    expect(two.sessionTimers.has(sessionId)).toBe(true);
  });
});
