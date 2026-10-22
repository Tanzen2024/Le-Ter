import { randomUUID } from 'node:crypto';

import type { GameId, PlayerId } from '../../../src/domain/game/game-id';
import type { GaramCardId } from '../../../src/domain/garam/garam-cards';
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
import { GARAM_TURN_DURATION_MS } from '../../../src/domain/garam/garam-rules';
import { garamDecksRandom } from '../../fixtures/random';

/**
 * Conformité de GARAM TIA aux règles officielles (D-121, D-122), par HTTP sur PostgreSQL migré :
 * mise, solde, nombre de joueurs, distribution, terre, ordre, signe, contrôle, tirage, fin du
 * terre et temps de tour du Ter (timer de PRODUCTION, D-122) avec action automatique légale.
 * Toutes les règles sont appliquées par le serveur : chaque refus vient de l'API.
 */
jest.setTimeout(120_000);

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

/** 3 joueurs : a dégage ♥9 ; b doit suivre ♥ ; c n'a pas de ♥ (carte libre). */
const THREE: GaramCardId[] = [
  'COEUR-9', 'TREFLE-7', 'PIQUE-10',
  'COEUR-5', 'CARREAU-8', 'TREFLE-10',
  'TREFLE-8', 'PIQUE-9', 'CARREAU-10',
  'TREFLE-4', 'PIQUE-5', 'CARREAU-3', 'COEUR-6',
];
const FOUR: GaramCardId[] = [
  'COEUR-9', 'TREFLE-7', 'PIQUE-10',
  'COEUR-5', 'CARREAU-8', 'TREFLE-10',
  'TREFLE-8', 'PIQUE-9', 'CARREAU-10',
  'CARREAU-9', 'TREFLE-5', 'PIQUE-7',
  'TREFLE-4', 'PIQUE-5', 'CARREAU-3', 'COEUR-6', 'PIQUE-3',
];
/** Exemple du §16 : a garde 14, tire 6 (20), puis 3 → 23 « Impossible ». */
const DRAW: GaramCardId[] = [
  'COEUR-9', 'TREFLE-8', 'PIQUE-6',
  'COEUR-4', 'CARREAU-10', 'TREFLE-6',
  'CARREAU-6', 'TREFLE-3', 'PIQUE-5',
];
/** Terre épuisé avant la fin des tirages. */
const EMPTY_TERRE: GaramCardId[] = [
  'COEUR-3', 'TREFLE-4', 'PIQUE-5',
  'COEUR-4', 'CARREAU-5', 'TREFLE-6',
  'PIQUE-6', 'COEUR-5', 'TREFLE-3',
];
/**
 * Chrono : la plus basse carte de a est ♥8 ; b doit suivre ♥ avec son seul ♥4. Aucune main
 * spéciale (trois ♥ en seraient une, déclarée par le serveur, D-137).
 */
const TIMER: GaramCardId[] = [
  'COEUR-9', 'CARREAU-10', 'COEUR-8',
  'COEUR-4', 'TREFLE-10', 'PIQUE-6',
  'PIQUE-3', 'TREFLE-3', 'CARREAU-4',
];

function app(decks: GaramCardId[][], production = false) {
  ctx = createGameApiTestApp(database.sql, {
    random: garamDecksRandom(...decks),
    // Timer de production (15 s affichées, D-127) seulement pour les tests du chrono.
    ...(production ? {} : { turnDurationMs: 60_000 }),
    decisionWindowMs: 60_000,
    stakePolicies: true,
  });
}

async function newPlayer(balance = 1_000) {
  const session = await registerAndLogin(ctx.app);
  await database.sql.query(
    'INSERT INTO wallets (user_id, balance, created_at, updated_at) VALUES ($1, $2, now(), now())',
    [session.userId, balance],
  );
  return { ...session, id: session.userId as PlayerId, api: as(ctx.app, session.accessToken) };
}
type Player = Awaited<ReturnType<typeof newPlayer>>;

const create = (p: Player, body: object) =>
  p.api.post('/api/sessions', { maxPlayers: 4, gameType: 'GARAM', garamVariant: 15, ...body });
const act = (p: Player, gameId: string, type: string, payload?: object) =>
  p.api.post(`/api/games/${gameId}/actions`, {
    commandId: randomUUID(),
    type,
    ...(payload && { payload }),
  });
const view = async (p: Player, gameId: string) =>
  (await expectStatus(p.api.get(`/api/games/${gameId}`), 200)).body.game;
const play = (p: Player, gameId: string, cardId: string) =>
  expectStatus(act(p, gameId, 'PLAY_CARD', { cardId }), 200);

/** Table de `players.length` joueurs (le premier crée), démarrée. */
async function table(players: Player[], stake = 100) {
  const [creator, ...others] = players;
  const created = await expectStatus(
    create(creator!, { maxPlayers: players.length, stakeAmount: stake }),
    201,
  );
  const gameId = created.body.game.gameId as GameId;
  for (const p of others) await expectStatus(enterGame(p.api, database.sql, gameId), 200);
  await expectStatus(creator!.api.post(`/api/games/${gameId}/start`), 200);
  return gameId;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function until<T>(read: () => Promise<T>, done: (v: T) => boolean, timeoutMs = 10_000) {
  const limit = Date.now() + timeoutMs;
  for (;;) {
    const value = await read();
    if (done(value) || Date.now() > limit) return value;
    await sleep(100);
  }
}

describe('mise et solde (§3, §4)', () => {
  it('mise 0, négative, décimale ou texte : refusée par le serveur ; entière > 0 acceptée', async () => {
    app([]);
    const a = await newPlayer();
    for (const stakeAmount of [0, -100, 1.5, '100']) {
      const res = await create(a, { stakeAmount });
      expect(res.status).toBe(400);
      expect(res.body.fields.stakeAmount).toBeDefined();
    }
    await expectStatus(create(a, { stakeAmount: 100 }), 201);
  });

  it('solde < 2 × mise : refus ; = 2 × mise et > 2 × mise : accepté ; rien n’est débité', async () => {
    app([]);
    const poor = await newPlayer(199);
    expect((await create(poor, { stakeAmount: 100 })).body.code).toBe(
      'INSUFFICIENT_BALANCE_FOR_STAKE',
    );
    const exact = await newPlayer(200);
    const created = await expectStatus(create(exact, { stakeAmount: 100 }), 201);
    const rich = await newPlayer(5_000);
    const gameId = created.body.game.gameId as string;
    await expectStatus(enterGame(rich.api, database.sql, gameId), 200);
    const late = await newPlayer(150);
    expect((await enterGame(late.api, database.sql, gameId)).body.code).toBe(
      'INSUFFICIENT_BALANCE_FOR_STAKE',
    );
    const { rows } = await database.sql.query<{ balance: string }>(
      'SELECT balance FROM wallets WHERE user_id = $1',
      [exact.userId],
    );
    expect(Number(rows[0]!.balance)).toBe(200); // engagement seulement, aucun débit
  });
});

describe('joueurs, distribution et terre (§2, §5, §6)', () => {
  it('1 joueur : impossible de démarrer ; 5e joueur : refusé', async () => {
    app([]);
    const [a, b, c, d, e] = [
      await newPlayer(),
      await newPlayer(),
      await newPlayer(),
      await newPlayer(),
      await newPlayer(),
    ];
    const created = await expectStatus(create(a!, { stakeAmount: 100 }), 201);
    const gameId = created.body.game.gameId as string;
    expect((await a!.api.post(`/api/games/${gameId}/start`)).body.code).toBe('NOT_ENOUGH_PLAYERS');
    for (const p of [b, c, d]) await expectStatus(enterGame(p!.api, database.sql, gameId), 200);
    expect((await enterGame(e!.api, database.sql, gameId)).body.code).toBe('SESSION_FULL');
  });

  it.each([
    [2, THREE.slice(0, 6).concat(THREE.slice(9, 12)), 3],
    [3, THREE, 4],
    [4, FOUR, 5],
  ])('%i joueurs : 3 cartes chacun, terre de %i cartes… sans doublon', async (n, deck, terre) => {
    app([deck as GaramCardId[]]);
    const players: Player[] = [];
    for (let i = 0; i < n; i++) players.push(await newPlayer());
    const gameId = await table(players);
    const views = await Promise.all(players.map((p) => view(p, gameId)));
    expect(views[0].garam.terre).toHaveLength(terre);
    const hands = views.map((v) => v.garam.myHand as string[]);
    expect(hands.every((h) => h.length === 3)).toBe(true);
    const all = [...hands.flat(), ...views[0].garam.terre];
    expect(new Set(all).size).toBe(all.length);
    // Main d'un adversaire jamais transmise : ni valeur ni signe.
    for (const card of hands[1]!) expect(JSON.stringify(views[0])).not.toContain(card);
    expect(views[0].garam.handCounts[players[1]!.id]).toBe(3);
  });
});

describe('premier tour (§9-§13)', () => {
  it('créateur en premier, sens antihoraire, signe obligatoire, carte libre sans le signe, contrôle', async () => {
    app([THREE]);
    const [a, b, c] = [await newPlayer(), await newPlayer(), await newPlayer()];
    const gameId = await table([a, b, c]);
    expect((await view(a, gameId)).activePlayerId).toBe(a.id);
    expect((await act(b, gameId, 'PLAY_CARD', { cardId: 'COEUR-5' })).body.code).toBe(
      'NOT_YOUR_TURN',
    );
    await play(a, gameId, 'COEUR-9');
    expect((await view(a, gameId)).activePlayerId).toBe(b.id); // siège suivant, antihoraire
    // b possède un ♥ : tout autre signe est refusé par le serveur.
    expect((await act(b, gameId, 'PLAY_CARD', { cardId: 'TREFLE-10' })).body.code).toBe(
      'CARD_NOT_PLAYABLE',
    );
    expect((await view(b, gameId)).myActions.playableCardIds).toEqual(['COEUR-5']);
    await play(b, gameId, 'COEUR-5');
    expect((await view(c, gameId)).activePlayerId).toBe(c.id);
    // c n'a aucun ♥ : carte libre (le ♦10 ne bat pas le ♥9).
    expect((await view(c, gameId)).myActions.playableCardIds).toHaveLength(3);
    await play(c, gameId, 'CARREAU-10');
    const after = await view(a, gameId);
    expect(after.garam).toMatchObject({ phase: 'DRAW', controllerId: a.id, leadSuit: 'COEUR' });
  });
});

describe('tirage (§14-§18)', () => {
  it('tête du terre, une carte à la fois, limite 21, carte refusée laissée et reprise', async () => {
    app([DRAW]);
    const [a, b] = [await newPlayer(), await newPlayer()];
    const gameId = await table([a, b]);
    await play(a, gameId, 'COEUR-9');
    // Premier tour en cours : aucun tirage n'est encore possible.
    expect((await act(a, gameId, 'DRAW_CARD')).body.code).toBe('GARAM_ACTION_NOT_ALLOWED');
    await play(b, gameId, 'COEUR-4');
    // a contrôle et garde 14 : la tête ♦6 donne 20 ; le ♣3 suivant ferait 23.
    expect((await view(a, gameId)).garam).toMatchObject({ myTotal: 14, canDraw: true });
    expect((await act(b, gameId, 'DRAW_CARD')).body.code).toBe('NOT_YOUR_TURN');
    await expectStatus(act(a, gameId, 'DRAW_CARD'), 200);
    const afterA = await view(b, gameId);
    expect(afterA.garam).toMatchObject({
      terre: ['TREFLE-3', 'PIQUE-5'], // carte prise retirée, carte refusée restée à la tête
      drawn: { [a.id]: ['CARREAU-6'] },
      lastRefusal: { playerId: a.id, cardId: 'TREFLE-3' },
      drawDone: [a.id],
    });
    expect(afterA.activePlayerId).toBe(b.id);
    // b (16) reprend à la carte refusée : ♣3 → 19, puis ♠5 → 24 « Impossible ».
    await expectStatus(act(b, gameId, 'DRAW_CARD'), 200);
    const done = await view(a, gameId);
    expect(done.status).toBe('finished');
    expect(done.garam.terre).toEqual(['PIQUE-5']);
    expect(done.result).toMatchObject({ winnerId: a.id, scores: { [a.id]: 20, [b.id]: 19 } });
  });

  it('terre épuisé : le joueur ne tire rien, son score est celui de ses cartes', async () => {
    app([EMPTY_TERRE]);
    const [a, b] = [await newPlayer(), await newPlayer()];
    const gameId = await table([a, b]);
    await play(a, gameId, 'COEUR-3');
    await play(b, gameId, 'COEUR-4'); // b contrôle (4 > 3)
    await expectStatus(act(b, gameId, 'DRAW_CARD'), 200); // 11 + 6 = 17, ♥5 → 22 refusé
    await expectStatus(act(a, gameId, 'DRAW_CARD'), 200); // 9 + 5 = 14
    await expectStatus(act(a, gameId, 'DRAW_CARD'), 200); // 14 + 3 = 17, terre vide
    const end = await view(a, gameId);
    expect(end.status).toBe('finished');
    expect(end.garam.terre).toEqual([]);
    expect(end.garamTie).toMatchObject({ kind: 'SCORE', scores: { [a.id]: 17, [b.id]: 17 } });
  });
});

describe('chrono (§19-§22, D-127), timer de production', () => {
  it('15 s fixées par le serveur ; sans action : carte LÉGALE déterministe, puis tirage ≤ 21', async () => {
    app([TIMER], true);
    const [a, b] = [await newPlayer(), await newPlayer()];
    const created = await expectStatus(create(a, { maxPlayers: 2, stakeAmount: 100 }), 201);
    const gameId = created.body.game.gameId as GameId;
    await expectStatus(enterGame(b.api, database.sql, gameId), 200);
    await expectStatus(a.api.post(`/api/games/${gameId}/start`), 200);
    const start = await view(b, gameId);
    expect(Date.parse(start.turnDeadlineAt) - Date.parse(start.turnStartedAt)).toBe(GARAM_TURN_DURATION_MS);
    expect(start.activePlayerId).toBe(a.id); // visible par tous : joueur et échéance

    // a ne joue pas : le serveur joue sa carte LÉGALE la plus basse (D-127) : ♥8.
    const afterA = await until(
      () => view(b, gameId),
      (v) => v.activePlayerId === b.id,
      GARAM_TURN_DURATION_MS + 10_000,
    );
    expect(afterA.garam.firstCards[0].playerId).toBe(a.id);
    expect(afterA.garam.firstCards[0].cardId).toBe('COEUR-8');
    expect(Date.parse(afterA.turnDeadlineAt) - Date.parse(afterA.turnStartedAt)).toBe(GARAM_TURN_DURATION_MS);

    // b ne joue pas : il possède un ♥, le serveur DOIT jouer son ♥4 (jamais ♣10 ou ♠6).
    const afterB = await until(
      () => view(b, gameId),
      (v) => v.garam.firstCards.length === 2,
      GARAM_TURN_DURATION_MS + 10_000,
    );
    expect(afterB.garam.firstCards[1]).toEqual({ playerId: b.id, cardId: 'COEUR-4' });
    expect(afterB.garam.phase).toBe('DRAW');

    // Tirage automatique de a : jamais au-delà de 21.
    const afterDraw = await until(
      () => view(a, gameId),
      (v) => v.status === 'finished' || v.garam.drawDone.includes(a.id),
      GARAM_TURN_DURATION_MS + 10_000,
    );
    expect(afterDraw.garam.myTotal).toBeLessThanOrEqual(21);
  });
});
