import { randomUUID } from 'node:crypto';

import type { GameId, PlayerId } from '../../../src/domain/game/game-id';
import type { GaramCardId } from '../../../src/domain/garam/garam-cards';
import { GARAM_AUTO_DECLARE_MS } from '../../../src/domain/garam/garam-rules';
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
import { garamDecksRandom } from '../../fixtures/random';

/**
 * Main spéciale de GARAM TIA déclarée AUTOMATIQUEMENT par le serveur (D-137), par HTTP sur
 * PostgreSQL migré, timers réels : une main spéciale unique n'est plus un bouton ; à la fin de
 * la distribution, une échéance persistée courte (GARAM_AUTO_DECLARE_MS) déclenche la
 * déclaration par la MÊME opération que l'ancienne commande DECLARE_WIN.
 */
jest.setTimeout(60_000);

let database: TestDatabase;
let ctx: GameApiTestContext;

beforeAll(async () => {
  database = await createMigratedDatabase();
}, PGLITE_TIMEOUT_MS);
afterAll(() => database.close());
afterEach(async () => {
  await ctx.stopTimers();
  await ctx.games.idle();
  await database.reset();
});

/** a (dégageur) : trois 7 ; b : rien de spécial ; terre T4, P5, CA3. */
const SEVENS: GaramCardId[] = [
  'COEUR-7', 'TREFLE-7', 'PIQUE-7',
  'COEUR-5', 'CARREAU-8', 'TREFLE-10',
  'TREFLE-4', 'PIQUE-5', 'CARREAU-3',
];
/** b (non-dégageur) : somme 10 (3 + 3 + 4) ; a : rien de spécial. */
const SUM_TEN_B: GaramCardId[] = [
  'CARREAU-4', 'COEUR-8', 'TREFLE-10',
  'COEUR-3', 'TREFLE-3', 'PIQUE-4',
  'PIQUE-5', 'COEUR-6', 'TREFLE-5',
];

function app(deck: GaramCardId[], garamAutoDeclareMs?: number) {
  ctx = createGameApiTestApp(database.sql, {
    random: garamDecksRandom(deck),
    turnDurationMs: 60_000,
    decisionWindowMs: 60_000,
    // Délai de PRODUCTION par défaut : c'est le tempo réel qui est vérifié.
    ...(garamAutoDeclareMs !== undefined && { garamAutoDeclareMs }),
    stakePolicies: true,
  });
}

async function newPlayer() {
  const session = await registerAndLogin(ctx.app);
  await database.sql.query(
    'INSERT INTO wallets (user_id, balance, created_at, updated_at) VALUES ($1, 1000, now(), now())',
    [session.userId],
  );
  return { ...session, id: session.userId as PlayerId, api: as(ctx.app, session.accessToken) };
}
type Player = Awaited<ReturnType<typeof newPlayer>>;

const act = (p: Player, gameId: string, type: string, payload?: object) =>
  p.api.post(`/api/games/${gameId}/actions`, {
    commandId: randomUUID(),
    type,
    ...(payload && { payload }),
  });
const view = async (p: Player, gameId: string) =>
  (await expectStatus(p.api.get(`/api/games/${gameId}`), 200)).body.game;

async function startedTable() {
  const [a, b] = [await newPlayer(), await newPlayer()];
  const created = await expectStatus(
    a.api.post('/api/sessions', {
      maxPlayers: 2,
      gameType: 'GARAM',
      garamVariant: 15,
      stakeAmount: 100,
    }),
    201,
  );
  const gameId = created.body.game.gameId as GameId;
  await expectStatus(enterGame(b.api, database.sql, gameId), 200);
  const started = await expectStatus(a.api.post(`/api/games/${gameId}/start`), 200);
  return { a, b, gameId, started: started.body.game, startedAt: Date.now() };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function until<T>(read: () => Promise<T>, done: (v: T) => boolean, timeoutMs = 10_000) {
  const limit = Date.now() + timeoutMs;
  for (;;) {
    const value = await read();
    if (done(value) || Date.now() > limit) return value;
    await sleep(50);
  }
}

async function settlementsOf(gameId: string) {
  const { rows } = await database.sql.query<{ count: string }>(
    'SELECT count(*) AS count FROM game_settlements WHERE game_id = $1',
    [gameId],
  );
  return Number(rows[0]!.count);
}
async function balanceOf(p: Player) {
  const { rows } = await database.sql.query<{ balance: string }>(
    'SELECT balance FROM wallets WHERE user_id = $1',
    [p.userId],
  );
  return Number(rows[0]!.balance);
}

describe('main spéciale automatique (D-137)', () => {
  it('G1 : annonce publique, aucun bouton ni carte jouable, puis victoire déclarée par le serveur après le court délai', async () => {
    app(SEVENS);
    const { a, b, gameId, started } = await startedTable();
    expect(started.status).toBe('in_progress');
    // Échéance = délai de la déclaration automatique, pas les 15 s d'une décision.
    expect(Date.parse(started.turnDeadlineAt) - Date.parse(started.turnStartedAt)).toBe(
      GARAM_AUTO_DECLARE_MS,
    );
    // Réponse du démarrage (lue atomiquement, avant toute échéance) : annonce, aucun bouton.
    expect(started.garam.specialPending).toBe(true);
    expect(started.myActions.canDeclareInstantWin).toBe(false);
    expect(started.myActions.canPlayCard).toBe(false);

    const done = await until(
      () => view(b, gameId),
      (v) => v.status === 'finished',
    );
    expect(done.result).toMatchObject({
      winnerId: a.id,
      method: 'GARAM_AUTOMATIC_WIN',
      garamCondition: 'THREE_SEVENS',
      automatic: true,
    });
    // G8 : aucun premier tour, aucun tirage automatique : le terre est intact.
    expect(done.garam.firstCards).toEqual([]);
    expect(Object.values(done.garam.drawn).flat()).toEqual([]);
    expect(done.garam.terre).toEqual(['TREFLE-4', 'PIQUE-5', 'CARREAU-3']);
    expect(done.garam.specialPending).toBeUndefined();
    await ctx.games.idle();
    expect(await settlementsOf(gameId)).toBe(1);
  });

  it('main d’un NON-dégageur : déclarée pour lui (le dégageur ne peut pas jouer avant)', async () => {
    app(SUM_TEN_B, 2_000);
    const { a, b, gameId } = await startedTable();
    expect((await act(a, gameId, 'PLAY_CARD', { cardId: 'CARREAU-4' })).status).toBe(422);
    const done = await until(
      () => view(a, gameId),
      (v) => v.status === 'finished',
    );
    expect(done.result).toMatchObject({ winnerId: b.id, garamCondition: 'SUM_TEN', automatic: true });
  });

  it('pendant l’attente (délai allongé) : annonce pour tous, aucun bouton, aucune carte jouable', async () => {
    app(SEVENS, 30_000);
    const { a, b, gameId } = await startedTable();
    for (const p of [a, b]) {
      const v = await view(p, gameId);
      expect(v.garam.specialPending).toBe(true);
      expect(v.myActions.canDeclareInstantWin).toBe(false); // plus de bouton « Main spéciale »
      expect(v.myActions.canPlayCard).toBe(false);
    }
    expect(JSON.stringify(await view(b, gameId))).not.toContain('THREE_SEVENS');
    // Personne ne peut jouer avant la déclaration (le détenteur ne « joue » pas sa chance).
    const early = await act(a, gameId, 'PLAY_CARD', { cardId: 'COEUR-7' });
    expect(early.status).toBe(422);
    expect((await view(a, gameId)).garam.firstCards).toEqual([]);
  });

  it('G6 : un joueur sans main spéciale ne peut pas la déclarer', async () => {
    app(SEVENS, 30_000);
    const { b, gameId } = await startedTable();
    const declare = await act(b, gameId, 'DECLARE_WIN');
    expect([declare.status, declare.body.code]).toEqual([422, 'NOT_A_WINNING_HAND']);
    expect((await view(b, gameId)).status).toBe('in_progress');
  });

  it('G4/G5 : échéance traitée deux fois + déclaration concurrente : UNE seule victoire, un seul règlement', async () => {
    app(SEVENS, 300);
    const { a, b, gameId } = await startedTable();
    await sleep(400);
    await Promise.all([
      ctx.games.handleTurnTimeout(gameId).catch(() => undefined),
      ctx.games.handleTurnTimeout(gameId).catch(() => undefined),
      act(a, gameId, 'DECLARE_WIN'),
    ]);
    await ctx.games.idle();
    const done = await view(a, gameId);
    expect(done.status).toBe('finished');
    expect(done.result.winnerId).toBe(a.id);
    // Rejouer l'échéance ensuite : sans effet.
    await ctx.games.handleTurnTimeout(gameId);
    expect((await view(a, gameId)).version).toBe(done.version);
    expect(await settlementsOf(gameId)).toBe(1);
    // Gain et perte une seule fois.
    expect((await balanceOf(a)) + (await balanceOf(b))).toBeLessThanOrEqual(2_000);
    expect(await balanceOf(b)).toBe(900);
  });

  it('G7 : redémarrage / reconnexion : l’échéance persistée est reprise, une seule fois', async () => {
    app(SEVENS, 300);
    const { a, gameId } = await startedTable();
    // Serveur arrêté avant l'échéance : aucun timer ne reste.
    ctx.supervisor.stop();
    ctx.timers.cancelAll();
    await sleep(500);
    const waiting = await view(a, gameId);
    expect(waiting.status).toBe('in_progress');
    expect(waiting.garam.specialPending).toBe(true);
    // Reprise (redémarrage) : l'échéance PERSISTÉE dépassée est traitée.
    await ctx.supervisor.recover();
    const done = await until(
      () => view(a, gameId),
      (v) => v.status === 'finished',
    );
    expect(done.result).toMatchObject({ winnerId: a.id, automatic: true });
    // Une seconde reprise (reconnexion, nouvelle instance) ne rejoue rien.
    await ctx.supervisor.recover();
    await ctx.games.idle();
    expect((await view(a, gameId)).version).toBe(done.version);
    expect(await settlementsOf(gameId)).toBe(1);
  });
});
