import { randomUUID } from 'node:crypto';

import type { GameId, PlayerId } from '../../../src/domain/game/game-id';
import type { GaramCardId } from '../../../src/domain/garam/garam-cards';
import {
  GARAM_AUTO_DRAW_AFTER_FIRST_ROUND_MS,
  GARAM_AUTO_DRAW_FIRST_MS,
  GARAM_AUTO_DRAW_STEP_MS,
  GARAM_PASS_NOTICE_MS,
} from '../../../src/domain/garam/garam-rules';
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
 * Tirage automatique de GARAM TIA (D-136), par HTTP sur PostgreSQL migré, timers réels : le
 * serveur tire pour le joueur attendu (le tirage est obligatoire, §3.8), une carte par échéance,
 * par la même opération que `DRAW_CARD` ; aucune action du joueur n'est nécessaire.
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

/**
 * a dégage ♥9 et garde 14 ; b suit ♥4 et garde 16 ; terre CA6, T3, P5.
 * a : 14 + 6 = 20, puis 3 → 23 « Impossible ». b : 16 + 3 = 19, puis 5 → 24 « Impossible ».
 */
const DECK: GaramCardId[] = [
  'COEUR-9', 'TREFLE-8', 'PIQUE-6',
  'COEUR-4', 'CARREAU-10', 'TREFLE-6',
  'CARREAU-6', 'TREFLE-3', 'PIQUE-5',
];

function app(garamAutoDrawMs?: { first: number; step: number; afterFirstRound?: number }) {
  ctx = createGameApiTestApp(database.sql, {
    random: garamDecksRandom(DECK),
    turnDurationMs: 60_000,
    decisionWindowMs: 60_000,
    // Délais de PRODUCTION par défaut : c'est le tempo réel qui est vérifié.
    garamAutoDrawMs: garamAutoDrawMs ?? {
      first: GARAM_AUTO_DRAW_FIRST_MS,
      step: GARAM_AUTO_DRAW_STEP_MS,
      afterFirstRound: GARAM_AUTO_DRAW_AFTER_FIRST_ROUND_MS,
    },
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

/** Table de 2 joueurs démarrée, premier tour joué : a a le contrôle, tirage ouvert. */
async function drawPhase() {
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
  await expectStatus(a.api.post(`/api/games/${gameId}/start`), 200);
  await expectStatus(act(a, gameId, 'PLAY_CARD', { cardId: 'COEUR-9' }), 200);
  const opened = await expectStatus(act(b, gameId, 'PLAY_CARD', { cardId: 'COEUR-4' }), 200);
  return { a, b, gameId, opened: opened.body.game, openedAt: Date.now() };
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
const drawnCount = (v: { garam: { drawn: Record<string, string[]> } }) =>
  Object.values(v.garam.drawn).flat().length;

describe('tirage automatique (D-136)', () => {
  it('contrôle obtenu : court délai, puis cartes tirées par le serveur jusqu’à la fin, sans action', async () => {
    app();
    const { a, b, gameId, opened, openedAt } = await drawPhase();
    expect(opened.garam).toMatchObject({ phase: 'DRAW', controllerId: a.id, nextPlayerId: a.id });
    // Échéance = délai du tirage automatique, pas les 15 s d'une décision.
    expect(Date.parse(opened.turnDeadlineAt) - Date.parse(opened.turnStartedAt)).toBe(
      GARAM_AUTO_DRAW_AFTER_FIRST_ROUND_MS,
    );
    // Rien n'est tiré avant le délai : le joueur voit d'abord qu'il a le contrôle.
    expect(drawnCount(await view(a, gameId))).toBe(0);

    const first = await until(() => view(b, gameId), (v) => drawnCount(v) >= 1);
    expect(Date.now() - openedAt).toBeGreaterThanOrEqual(GARAM_AUTO_DRAW_AFTER_FIRST_ROUND_MS - 50);
    expect(first.garam.drawn[a.id]).toEqual(['CARREAU-6']);

    // Puis « Impossible » pour a (3 → 23), tour de b : T3 (19), puis « Impossible » (5 → 24).
    const done = await until(() => view(b, gameId), (v) => v.status === 'finished');
    expect(done.status).toBe('finished');
    expect(done.garam.drawn).toEqual({ [a.id]: ['CARREAU-6'], [b.id]: ['TREFLE-3'] });
    // La carte refusée reste au terre (même règle qu'avant) : jamais tirée.
    expect(done.garam.terre).toEqual(['PIQUE-5']);
  });

  it('contrôleur sans carte prenable : « Je passe » annoncé, puis main au suivant au tempo réel (D-140)', async () => {
    // a dégage ♥9 et garde ♣10 + ♦10 = 20 ; tête ♠3 → 23 : a ne peut rien tirer.
    const deck: GaramCardId[] = [
      'COEUR-9', 'TREFLE-10', 'CARREAU-10',
      'COEUR-4', 'CARREAU-5', 'TREFLE-6',
      'PIQUE-3', 'TREFLE-3', 'PIQUE-5',
    ];
    ctx = createGameApiTestApp(database.sql, {
      random: garamDecksRandom(deck),
      turnDurationMs: 60_000,
      decisionWindowMs: 60_000,
      // Tempo de PRODUCTION du « Je passe » : c'est le rythme réel qui est vérifié.
      garamAutoDrawMs: {
        first: GARAM_AUTO_DRAW_FIRST_MS,
        step: GARAM_AUTO_DRAW_STEP_MS,
        afterFirstRound: GARAM_AUTO_DRAW_AFTER_FIRST_ROUND_MS,
        pass: GARAM_AUTO_DRAW_AFTER_FIRST_ROUND_MS + GARAM_PASS_NOTICE_MS,
      },
      stakePolicies: true,
    });
    const { a, b, gameId, opened, openedAt } = await drawPhase();
    // Tour du contrôleur ouvert, annoncé à toute la table ; aucune carte prise, b attend.
    expect(opened.garam).toMatchObject({ nextPlayerId: a.id, passingPlayerId: a.id, canDraw: false });
    expect(Date.parse(opened.turnDeadlineAt) - Date.parse(opened.turnStartedAt)).toBe(
      GARAM_AUTO_DRAW_AFTER_FIRST_ROUND_MS + GARAM_PASS_NOTICE_MS,
    );
    expect((await view(b, gameId)).garam).toMatchObject({ passingPlayerId: a.id, drawDone: [] });

    const passed = await until(() => view(b, gameId), (v) => v.garam.drawDone.includes(a.id));
    expect(Date.now() - openedAt).toBeGreaterThanOrEqual(
      GARAM_AUTO_DRAW_AFTER_FIRST_ROUND_MS + GARAM_PASS_NOTICE_MS - 50,
    );
    expect(passed.garam.passingPlayerId).toBeUndefined();
    expect(passed.garam.lastRefusal).toEqual({ playerId: a.id, cardId: 'PIQUE-3', passed: true });
    expect(passed.garam.drawn[a.id]).toEqual([]);
  }, 30_000);

  it('le joueur qui n’a pas la main ne provoque aucun tirage ; consulter la partie ne tire rien', async () => {
    app({ first: 60_000, step: 60_000 });
    const { a, b, gameId } = await drawPhase();
    expect((await act(b, gameId, 'DRAW_CARD')).body.code).toBe('NOT_YOUR_TURN');
    // Reconnexion / écran rouvert : lire la partie ne déclenche aucun tirage.
    const before = await view(a, gameId);
    await view(a, gameId);
    await view(b, gameId);
    const after = await view(a, gameId);
    expect(after.version).toBe(before.version);
    expect(drawnCount(after)).toBe(0);
  });

  it('échéance traitée deux fois en même temps (deux timers, deux instances) : UNE seule carte', async () => {
    // Le timer est arrêté : l'échéance est déclenchée à la main, plusieurs fois, en parallèle.
    app({ first: 200, step: 60_000 });
    const { a, b, gameId } = await drawPhase();
    await ctx.stopTimers();
    await sleep(300);
    await Promise.all([
      ctx.games.handleTurnTimeout(gameId),
      ctx.games.handleTurnTimeout(gameId),
      ctx.games.retryAutomaticPlay(gameId),
    ]);
    await ctx.games.idle();
    const once = await view(b, gameId);
    expect(once.garam.drawn[a.id]).toEqual(['CARREAU-6']);

    // Même événement reçu encore (reprise, doublon) : aucune carte de plus pour a. (a est
    // « Impossible » après CA6 : le tour de b, ouvert par le serveur, peut seul tirer ensuite.)
    await ctx.games.handleTurnTimeout(gameId);
    await ctx.games.retryAutomaticPlay(gameId);
    await ctx.games.idle();
    const again = await view(b, gameId);
    expect(again.garam.drawn[a.id]).toEqual(['CARREAU-6']);
    // Jamais une carte tirée deux fois ni venue d'ailleurs : tirées + terre = terre d'origine.
    const cards = [...Object.values(again.garam.drawn as Record<string, string[]>).flat(), ...again.garam.terre];
    expect([...cards].sort()).toEqual(['CARREAU-6', 'PIQUE-5', 'TREFLE-3']);
  });
});
