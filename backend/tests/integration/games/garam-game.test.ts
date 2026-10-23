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
import { garamDecksRandom } from '../../fixtures/random';
import { garamRevealPresentationMs } from '../../../src/domain/garam/garam-rules';

/**
 * GARAM TIA (D-119) de bout en bout : HTTP → SessionService / GameService → PostgreSQL migré.
 * Identification du jeu, manche réellement jouée, refus côté serveur, règlement (barème de
 * commission de l'administration, pris aussi sur le Koraté, D-130), rotation du dégageur,
 * manche nulle avec proposition de doubler la mise et retrait faute de solde (§3.16).
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

/** Manche « moins de 15 » : a garde 20 et gagne, b finit à 12. */
const BELOW_FIFTEEN: GaramCardId[] = [
  'COEUR-9', 'TREFLE-10', 'PIQUE-10', // dégageur
  'COEUR-3', 'CARREAU-4', 'TREFLE-5',
  'PIQUE-3', 'CARREAU-11', 'TREFLE-7', // terre
];
/** Manche nulle au plus grand total : 18 partout, aucun tirage possible. */
const SCORE_TIE: GaramCardId[] = [
  'COEUR-5', 'TREFLE-8', 'PIQUE-10',
  'COEUR-4', 'CARREAU-8', 'TREFLE-10',
  'PIQUE-9', 'COEUR-10', 'TREFLE-9',
];
/** Manche ordinaire, sans condition spéciale. */
const PLAIN: GaramCardId[] = [
  'COEUR-9', 'TREFLE-7', 'PIQUE-10',
  'COEUR-5', 'CARREAU-8', 'TREFLE-10',
  'TREFLE-4', 'PIQUE-5', 'CARREAU-3',
];

function app(...decks: GaramCardId[][]) {
  ctx = createGameApiTestApp(database.sql, {
    random: garamDecksRandom(...decks),
    turnDurationMs: 60_000,
    decisionWindowMs: 60_000,
    stakePolicies: true,
    autoNextGame: true,
  });
}

async function newPlayer(balance: number) {
  const session = await registerAndLogin(ctx.app);
  await database.sql.query(
    'INSERT INTO wallets (user_id, balance, created_at, updated_at) VALUES ($1, $2, now(), now())',
    [session.userId, balance],
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

/**
 * Chaque joueur qui a la main sans carte prenable annonce « Je passe » (D-145). Échéance de
 * 1 ms dans ces tests ; elle est appliquée ici (sans attendre le minuteur), joueur après
 * joueur, jusqu'à un tour où l'on peut tirer ou la fin de la manche.
 */
async function controllerPasses(gameId: string) {
  for (let i = 0; i < 4; i++) {
    await new Promise((r) => setTimeout(r, 5)); // échéance de 1 ms dépassée
    await ctx.games.handleTurnTimeout(gameId as GameId);
    await ctx.games.idle();
    const game = await ctx.games.findGame(gameId as GameId);
    if (game?.status !== 'in_progress' || !game.garam?.passing) return;
  }
}

async function balance(p: Player) {
  const { rows } = await database.sql.query<{ balance: string }>(
    'SELECT balance FROM wallets WHERE user_id = $1',
    [p.userId],
  );
  return Number(rows[0]!.balance);
}

async function garamTable(a: Player, b: Player, stake = 100) {
  const created = await expectStatus(
    a.api.post('/api/sessions', { maxPlayers: 2, stakeAmount: stake, gameType: 'GARAM', garamVariant: 15 }),
    201,
  );
  const gameId = created.body.game.gameId as GameId;
  await expectStatus(enterGame(b.api, database.sql, gameId), 200);
  await expectStatus(a.api.post(`/api/games/${gameId}/start`), 200);
  return { gameId, sessionId: created.body.session.sessionId as string };
}

async function lastGameOf(sessionId: string) {
  await ctx.sessions.idle();
  const { rows } = await database.sql.query<{ id: string }>(
    'SELECT id FROM games WHERE session_id = $1 ORDER BY created_at DESC, id DESC LIMIT 1',
    [sessionId],
  );
  return (await ctx.games.findGame(rows[0]!.id as GameId))!;
}

describe('identification du jeu (D-119)', () => {
  it('une table GARAM est typée et n’apparaît que dans la liste GARAM', async () => {
    app();
    const a = await newPlayer(1_000);
    const c = await newPlayer(1_000);
    const created = await expectStatus(
      a.api.post('/api/sessions', { maxPlayers: 3, stakeAmount: 100, gameType: 'GARAM', garamVariant: 15 }),
      201,
    );
    expect(created.body.session.gameType).toBe('GARAM');
    expect(created.body.game.gameType).toBe('GARAM');
    const ter = await expectStatus(
      c.api.post('/api/sessions', { maxPlayers: 2, stakeAmount: 100 }),
      201,
    );
    expect(ter.body.session.gameType).toBeUndefined();
    expect(ter.body.game.gameType).toBeUndefined();

    const b = await newPlayer(1_000);
    const terList = (await expectStatus(b.api.get('/api/sessions/open'), 200)).body.tables;
    const garamList = (await expectStatus(b.api.get('/api/sessions/open?gameType=GARAM'), 200))
      .body.tables;
    expect(terList.map((t: { sessionId: string }) => t.sessionId)).toEqual([
      ter.body.session.sessionId,
    ]);
    expect(garamList.map((t: { sessionId: string }) => t.sessionId)).toEqual([
      created.body.session.sessionId,
    ]);
    expect(garamList[0].gameType).toBe('GARAM');
    await expectStatus(b.api.get('/api/sessions/open?gameType=AUTRE'), 400);
    const { rows } = await database.sql.query<{ game_type: string }>(
      'SELECT game_type FROM games WHERE id = $1',
      [created.body.game.gameId],
    );
    expect(rows[0]!.game_type).toBe('GARAM');
  });
});

describe('manche jouée par HTTP', () => {
  it('distribution, refus côté serveur, résultat et règlement « moins de 15 »', async () => {
    app(BELOW_FIFTEEN);
    const a = await newPlayer(1_000);
    const b = await newPlayer(1_000);
    const { gameId } = await garamTable(a, b);

    const mine = await view(b, gameId);
    expect(mine.garam.myHand).toEqual(['COEUR-3', 'CARREAU-4', 'TREFLE-5']);
    expect(mine.garam.terre).toEqual(['PIQUE-3', 'CARREAU-11', 'TREFLE-7']);
    expect(JSON.stringify(mine)).not.toContain('TREFLE-10'); // main de a
    expect(mine.myActions.canPlayCard).toBe(false);

    // Hors tour, carte non possédée, tirage au premier tour : refusés par le serveur.
    expect((await act(b, gameId, 'PLAY_CARD', { cardId: 'COEUR-3' })).body.code).toBe(
      'NOT_YOUR_TURN',
    );
    expect((await act(a, gameId, 'PLAY_CARD', { cardId: 'COEUR-3' })).body.code).toBe(
      'CARD_NOT_IN_HAND',
    );
    expect((await act(a, gameId, 'DRAW_CARD')).body.code).toBe('GARAM_ACTION_NOT_ALLOWED');

    await expectStatus(act(a, gameId, 'PLAY_CARD', { cardId: 'COEUR-9' }), 200);
    // Même signe obligatoire : b a un cœur, il ne peut pas jouer le trèfle.
    expect((await act(b, gameId, 'PLAY_CARD', { cardId: 'TREFLE-5' })).body.code).toBe(
      'CARD_NOT_PLAYABLE',
    );
    await expectStatus(act(b, gameId, 'PLAY_CARD', { cardId: 'COEUR-3' }), 200);
    // a contrôle mais 20 + 3 > 21 : il annonce « Je passe » (D-145), puis b tire.
    await controllerPasses(gameId);
    const drawing = await view(b, gameId);
    expect(drawing.garam).toMatchObject({
      phase: 'DRAW',
      controllerId: a.id,
      canDraw: true,
      lastRefusal: { playerId: a.id, cardId: 'PIQUE-3', passed: true },
    });
    expect(drawing.garam.passingPlayerId).toBeUndefined();
    await expectStatus(act(b, gameId, 'DRAW_CARD'), 200);

    const done = await view(a, gameId);
    expect(done.status).toBe('finished');
    expect(done.result).toMatchObject({
      winnerId: a.id,
      method: 'GARAM_BEST_SCORE',
      belowThresholdIds: [b.id],
      penaltyThreshold: 15,
    });
    // Barème initial : mise 100 → 1 %. b perd 100 + 100 (Koraté) ; commission 1 % des 200.
    expect(await balance(a)).toBe(1_198);
    expect(await balance(b)).toBe(800);
    const settled = await database.sql.query<Record<string, unknown>>(
      'SELECT * FROM game_settlements WHERE game_id = $1',
      [gameId],
    );
    expect(settled.rows[0]).toMatchObject({ status: 'SETTLED', penalty_amount: 100 });
    // Commission prélevée sur toute la perte de b (pénalité comprise, D-130), dans la caisse
    // unique, source GARAM TIA (D-120) ; une seule écriture pour la manche.
    const caisse = await database.sql.query<{ kind: string; amount: number; source: string }>(
      'SELECT kind, amount, source FROM platform_ledger WHERE game_id = $1',
      [gameId],
    );
    expect(caisse.rows.map((r) => ({ ...r, amount: Number(r.amount) }))).toEqual([
      { kind: 'GAME_COMMISSION', amount: 2, source: 'GARAM_TIA' },
    ]);
    expect(done.mySettlement).toEqual({ delta: 198, account: 'WALLET' });
  });
});

describe('manches successives (§3.15-3.17)', () => {
  it('Continuer : le dégagement tourne ; égalité : même dégageur, mise doublée à l’unanimité', async () => {
    app(BELOW_FIFTEEN, SCORE_TIE, PLAIN);
    const a = await newPlayer(1_000);
    const b = await newPlayer(1_000);
    const { gameId, sessionId } = await garamTable(a, b);
    await expectStatus(act(a, gameId, 'PLAY_CARD', { cardId: 'COEUR-9' }), 200);
    await expectStatus(act(b, gameId, 'PLAY_CARD', { cardId: 'COEUR-3' }), 200);
    await controllerPasses(gameId);
    await expectStatus(act(b, gameId, 'DRAW_CARD'), 200);

    for (const p of [a, b]) {
      await expectStatus(p.api.post(`/api/sessions/${sessionId}/decision`, { choice: 'continue' }), 200);
    }
    const second = await lastGameOf(sessionId);
    expect(second.id).not.toBe(gameId);
    expect(second.gameType).toBe('GARAM');
    expect(second.firstPlayerId).toBe(b.id); // rotation antihoraire du dégagement
    expect(second.garam?.dealerId).toBe(b.id);

    // Égalité 18 / 18 : manche nulle, rejouée sans Continuer/Sortir.
    await expectStatus(act(b, second.id, 'PLAY_CARD', { cardId: 'COEUR-5' }), 200);
    await expectStatus(act(a, second.id, 'PLAY_CARD', { cardId: 'COEUR-4' }), 200);
    await controllerPasses(second.id);
    const replay = await lastGameOf(sessionId);
    expect(replay.replayOfGameId).toBe(second.id);
    expect(replay.status).toBe('waiting');
    expect((await view(a, replay.id)).garamStakeVote).toMatchObject({
      previousStake: 100,
      proposedStake: 200,
      canVote: true,
    });
    expect((await b.api.post(`/api/games/${replay.id}/start`)).body.code).toBe(
      'STAKE_VOTE_IN_PROGRESS',
    );
    await expectStatus(act(a, replay.id, 'STAKE_VOTE', { accept: true }), 200);
    await expectStatus(act(b, replay.id, 'STAKE_VOTE', { accept: true }), 200);
    const third = (await ctx.games.findGame(replay.id))!;
    expect(third.status).toBe('in_progress');
    expect(third.stakeAmount).toBe(200);
    expect(third.firstPlayerId).toBe(b.id); // même dégageur après la manche nulle
  });

  it('un seul « non » : la mise est conservée', async () => {
    app(SCORE_TIE, PLAIN);
    const a = await newPlayer(1_000);
    const b = await newPlayer(1_000);
    const { gameId, sessionId } = await garamTable(a, b);
    await expectStatus(act(a, gameId, 'PLAY_CARD', { cardId: 'COEUR-5' }), 200);
    await expectStatus(act(b, gameId, 'PLAY_CARD', { cardId: 'COEUR-4' }), 200);
    await controllerPasses(gameId);
    const replay = await lastGameOf(sessionId);
    await expectStatus(act(a, replay.id, 'STAKE_VOTE', { accept: true }), 200);
    await expectStatus(act(b, replay.id, 'STAKE_VOTE', { accept: false }), 200);
    const started = (await ctx.games.findGame(replay.id))!;
    expect(started.status).toBe('in_progress');
    expect(started.stakeAmount).toBe(100);
  });

  /** Manche nulle jouée par a puis b (18 / 18) ; renvoie la manche rejouée, en attente du vote. */
  async function tie(a: Player, b: Player, gameId: string, sessionId: string) {
    await expectStatus(act(a, gameId, 'PLAY_CARD', { cardId: 'COEUR-5' }), 200);
    await expectStatus(act(b, gameId, 'PLAY_CARD', { cardId: 'COEUR-4' }), 200);
    await controllerPasses(gameId);
    const replay = await lastGameOf(sessionId);
    expect(replay.replayOfGameId).toBe(gameId);
    return replay;
  }

  it('mise doublée : commission du barème sur le NOUVEAU montant (D-138)', async () => {
    app(SCORE_TIE, PLAIN);
    const a = await newPlayer(1_000);
    const b = await newPlayer(1_000);
    const { gameId, sessionId } = await garamTable(a, b);
    const replay = await tie(a, b, gameId, sessionId);
    await expectStatus(act(a, replay.id, 'STAKE_VOTE', { accept: true }), 200);
    await expectStatus(act(b, replay.id, 'STAKE_VOTE', { accept: true }), 200);
    const { rows } = await database.sql.query<{ stake: string; commission_bps: number }>(
      'SELECT stake, commission_bps FROM game_settlements WHERE game_id = $1',
      [replay.id],
    );
    // Engagement de la manche sur 200 (et non 100) : la commission s'y applique.
    expect(Number(rows[0]!.stake)).toBe(200);
  });

  it('égalité sur une mise déjà doublée, un « non » : retour à la mise de CRÉATION (D-138)', async () => {
    app(SCORE_TIE, SCORE_TIE, PLAIN);
    const a = await newPlayer(1_000);
    const b = await newPlayer(1_000);
    const { gameId, sessionId } = await garamTable(a, b);
    const first = await tie(a, b, gameId, sessionId);
    await expectStatus(act(a, first.id, 'STAKE_VOTE', { accept: true }), 200);
    await expectStatus(act(b, first.id, 'STAKE_VOTE', { accept: true }), 200);
    expect((await ctx.games.findGame(first.id))!.stakeAmount).toBe(200);

    // Nouvelle égalité à 200 : proposition 200 → 400, mise de création 100.
    const second = await tie(a, b, first.id, sessionId);
    expect(second.garamStakeVote).toMatchObject({
      previousStake: 200,
      proposedStake: 400,
      baseStake: 100,
    });
    await expectStatus(act(a, second.id, 'STAKE_VOTE', { accept: true }), 200);
    await expectStatus(act(b, second.id, 'STAKE_VOTE', { accept: false }), 200);
    const restarted = (await ctx.games.findGame(second.id))!;
    expect(restarted.status).toBe('in_progress');
    expect(restarted.stakeAmount).toBe(100); // jamais 200
    expect(restarted.firstPlayerId).toBe(a.id); // même joueur qui débute après l'égalité
  });

  it('un joueur sans réponse à l’échéance : nouvelle manche à la mise de création (D-138)', async () => {
    app(SCORE_TIE, SCORE_TIE, PLAIN);
    const a = await newPlayer(1_000);
    const b = await newPlayer(1_000);
    const { gameId, sessionId } = await garamTable(a, b);
    const first = await tie(a, b, gameId, sessionId);
    await expectStatus(act(a, first.id, 'STAKE_VOTE', { accept: true }), 200);
    await expectStatus(act(b, first.id, 'STAKE_VOTE', { accept: true }), 200);
    const second = await tie(a, b, first.id, sessionId);
    // a accepte, b ne répond pas.
    await expectStatus(act(a, second.id, 'STAKE_VOTE', { accept: true }), 200);
    expect((await ctx.games.findGame(second.id))!.status).toBe('waiting');
    // Échéance passée (sans attendre le minuteur réel) : celle que le serveur déclencherait.
    await database.sql.query(
      `UPDATE games SET start_deadline_at = now() - interval '1 second' WHERE id = $1`,
      [second.id],
    );
    const restarted = await ctx.games.handleStartDeadline(second.id as GameId);
    expect(restarted.status).toBe('in_progress');
    expect(restarted.stakeAmount).toBe(100);
    expect(restarted.firstPlayerId).toBe(a.id);
    // Une réponse arrivée après la clôture n'y change rien.
    expect((await act(b, second.id, 'STAKE_VOTE', { accept: true })).status).not.toBe(200);
  });

  it('mise doublée non couverte : le joueur est retiré de la table (§3.16)', async () => {
    app(SCORE_TIE, PLAIN);
    const a = await newPlayer(1_000);
    const b = await newPlayer(300); // couvre 2 × 100, pas 2 × 200
    const { gameId, sessionId } = await garamTable(a, b);
    await expectStatus(act(a, gameId, 'PLAY_CARD', { cardId: 'COEUR-5' }), 200);
    await expectStatus(act(b, gameId, 'PLAY_CARD', { cardId: 'COEUR-4' }), 200);
    await controllerPasses(gameId);
    const replay = await lastGameOf(sessionId);
    await expectStatus(act(a, replay.id, 'STAKE_VOTE', { accept: true }), 200);
    await expectStatus(act(b, replay.id, 'STAKE_VOTE', { accept: true }), 200);
    await ctx.sessions.idle();
    const waiting = (await ctx.games.findGame(replay.id))!;
    expect(waiting.status).toBe('waiting');
    expect(waiting.stakeAmount).toBe(200);
    expect(waiting.players.map((p) => p.playerId)).toEqual([a.id]);
    const { rows } = await database.sql.query<{ active: boolean }>(
      'SELECT active FROM session_players WHERE session_id = $1 AND player_id = $2',
      [sessionId, b.id],
    );
    expect(rows[0]!.active).toBe(false);
    expect(await balance(b)).toBe(300); // manche nulle : aucun débit
  });
});

describe('actions propres à un jeu (D-126)', () => {
  it('Fap-Fap : fuir est refusé dans une manche GARAM ; « Main spéciale » sans main : refusée', async () => {
    app(PLAIN);
    const a = await newPlayer(1_000);
    const b = await newPlayer(1_000);
    const { gameId } = await garamTable(a, b);
    const before = await view(a, gameId);
    const flee = await act(a, gameId, 'FLEE');
    expect([flee.status, flee.body.code]).toEqual([422, 'ACTION_NOT_AVAILABLE_FOR_GAME']);
    // DECLARE_WIN existe en GARAM (D-129) : refusé ici faute de main spéciale.
    const declare = await act(a, gameId, 'DECLARE_WIN');
    expect([declare.status, declare.body.code]).toEqual([422, 'NOT_A_WINNING_HAND']);
    // Aucun changement : la manche est intacte et se joue normalement.
    expect((await view(a, gameId)).version).toBe(before.version);
    await expectStatus(act(a, gameId, 'PLAY_CARD', { cardId: 'COEUR-9' }), 200);
  });

  it('main spéciale GARAM (D-137) : déclarée par le serveur, jamais par un bouton', async () => {
    // a : trois 7 ; b : rien de spécial. Délai allongé : l'état d'attente est lu avant la
    // déclaration, même sur une machine chargée (le tempo réel est vérifié dans
    // garam-auto-declare.test.ts).
    ctx = createGameApiTestApp(database.sql, {
      random: garamDecksRandom(['COEUR-7', 'TREFLE-7', 'PIQUE-7', 'COEUR-5', 'CARREAU-8', 'TREFLE-10', 'TREFLE-4', 'PIQUE-5', 'CARREAU-3']),
      turnDurationMs: 60_000,
      decisionWindowMs: 60_000,
      stakePolicies: true,
      autoNextGame: true,
      garamAutoDeclareMs: 3_000,
    });
    const a = await newPlayer(1_000);
    const b = await newPlayer(1_000);
    const { gameId } = await garamTable(a, b);
    const mine = await view(a, gameId);
    expect(mine.status).toBe('in_progress');
    expect(mine.myActions.canDeclareInstantWin).toBe(false);
    expect(mine.garam.mySpecial).toBe('THREE_SEVENS');
    expect(mine.garam.specialPending).toBe(true);
    const theirs = await view(b, gameId);
    expect(theirs.myActions.canDeclareInstantWin).toBe(false);
    expect(JSON.stringify(theirs)).not.toContain('THREE_SEVENS');
    // b n'a pas de main spéciale.
    expect((await act(b, gameId, 'DECLARE_WIN')).body.code).toBe('NOT_A_WINNING_HAND');
    // Aucune action : le serveur déclare à l'échéance courte (GARAM_AUTO_DECLARE_MS).
    let done = await view(b, gameId);
    for (let i = 0; i < 200 && done.status !== 'finished'; i++) {
      await new Promise((r) => setTimeout(r, 50));
      done = await view(b, gameId);
    }
    expect(done.status).toBe('finished');
    expect(done.result).toMatchObject({
      winnerId: a.id,
      method: 'GARAM_AUTOMATIC_WIN',
      garamCondition: 'THREE_SEVENS',
      automatic: true,
    });
  });

  it('GARAM : tirer ou voter la mise est refusé dans une partie de Fap-Fap', async () => {
    app();
    const a = await newPlayer(1_000);
    const b = await newPlayer(1_000);
    const created = await expectStatus(
      a.api.post('/api/sessions', { maxPlayers: 2, stakeAmount: 100 }),
      201,
    );
    const gameId = created.body.game.gameId as GameId;
    await expectStatus(enterGame(b.api, database.sql, gameId), 200);
    await expectStatus(a.api.post(`/api/games/${gameId}/start`), 200);
    const before = await view(a, gameId);
    for (const [type, payload] of [
      ['DRAW_CARD', undefined],
      ['STAKE_VOTE', { accept: true }],
    ] as const) {
      const res = await act(a, gameId, type, payload);
      expect(res.status).toBe(422);
      expect(res.body.code).toBe('ACTION_NOT_AVAILABLE_FOR_GAME');
    }
    expect((await view(a, gameId)).version).toBe(before.version);
  });
});

describe('variantes GARAM 15 / 16 / 17 / 18 (D-127)', () => {
  const createGaram = (p: Player, extra: object) =>
    p.api.post('/api/sessions', { maxPlayers: 2, stakeAmount: 100, gameType: 'GARAM', ...extra });

  it.each([15, 16, 17, 18])('GARAM %i : enregistrée, visible et recopiée sur la manche', async (v) => {
    app();
    const a = await newPlayer(1_000);
    const created = await expectStatus(createGaram(a, { garamVariant: v }), 201);
    expect(created.body.session).toMatchObject({ gameType: 'GARAM', garamVariant: v });
    expect(created.body.game).toMatchObject({ gameType: 'GARAM', garamVariant: v });
    const b = await newPlayer(1_000);
    const list = (await expectStatus(b.api.get('/api/sessions/open?gameType=GARAM'), 200)).body
      .tables;
    expect(list[0]).toMatchObject({ gameType: 'GARAM', garamVariant: v });
    const { rows } = await database.sql.query<{ s: number; g: number }>(
      `SELECT s.garam_variant AS s, g.garam_variant AS g
       FROM sessions s JOIN games g ON g.session_id = s.id WHERE g.id = $1`,
      [created.body.game.gameId],
    );
    expect(rows[0]).toEqual({ s: v, g: v });
  });

  it('variante absente ou invalide : création refusée, aucune valeur par défaut', async () => {
    app();
    const a = await newPlayer(1_000);
    for (const extra of [{}, { garamVariant: null }, { garamVariant: 14 }, { garamVariant: 19 }, { garamVariant: '15' }, { garamVariant: 15.5 }]) {
      const res = await createGaram(a, extra);
      expect(res.status).toBe(400);
      expect(res.body.fields).toHaveProperty('garamVariant');
    }
    // Une variante n'existe pas pour Fap-Fap.
    const ter = await a.api.post('/api/sessions', { maxPlayers: 2, stakeAmount: 100, garamVariant: 15 });
    expect(ter.status).toBe(400);
    expect(ter.body.fields).toHaveProperty('garamVariant');
    const { rows } = await database.sql.query('SELECT 1 FROM sessions');
    expect(rows).toHaveLength(0);
  });

  it('base : une session GARAM sans variante est impossible ; variante immuable', async () => {
    app();
    const a = await newPlayer(1_000);
    await expect(
      database.sql.query(
        `INSERT INTO sessions (id, version, status, creator_id, max_players, created_at,
           updated_at, game_type)
         VALUES ($1, 1, 'open', $2, 2, now(), now(), 'GARAM')`,
        [randomUUID(), a.id],
      ),
    ).rejects.toThrow();
    const created = await expectStatus(createGaram(a, { garamVariant: 17 }), 201);
    await expect(
      database.sql.query('UPDATE sessions SET garam_variant = 18 WHERE id = $1', [
        created.body.session.sessionId,
      ]),
    ).rejects.toThrow(/immuable/);
    await expect(
      database.sql.query('UPDATE games SET garam_variant = 18 WHERE id = $1', [
        created.body.game.gameId,
      ]),
    ).rejects.toThrow(/immuable/);
  });

  it('GARAM 18 : un perdant à 17 paie la pénalité (mise initiale) au gagnant', async () => {
    // a garde ♣10 + ♠10 = 20 ; b joue ♥3 et garde ♣9 + ♦8 = 17 ; terre d'As : aucun tirage.
    app([
      'COEUR-9', 'TREFLE-10', 'PIQUE-10',
      'COEUR-3', 'TREFLE-9', 'CARREAU-8',
      'CARREAU-11', 'TREFLE-11', 'COEUR-11',
    ]);
    const a = await newPlayer(1_000);
    const b = await newPlayer(1_000);
    const created = await expectStatus(createGaram(a, { garamVariant: 18 }), 201);
    const gameId = created.body.game.gameId as GameId;
    await expectStatus(enterGame(b.api, database.sql, gameId), 200);
    await expectStatus(a.api.post(`/api/games/${gameId}/start`), 200);
    await expectStatus(act(a, gameId, 'PLAY_CARD', { cardId: 'COEUR-9' }), 200);
    await expectStatus(act(b, gameId, 'PLAY_CARD', { cardId: 'COEUR-3' }), 200);
    await controllerPasses(gameId);
    const done = await view(a, gameId);
    expect(done.result).toMatchObject({
      winnerId: a.id,
      scores: { [a.id]: 20, [b.id]: 17 },
      belowThresholdIds: [b.id],
      penaltyThreshold: 18,
    });
    // Mise 100 : b perd 100 + 100 ; commission 1 % des 200 (pénalité comprise, D-130).
    expect(await balance(a)).toBe(1_198);
    expect(await balance(b)).toBe(800);
  });
});

describe('erreur cross-game dédiée (D-126)', () => {
  it('avant le démarrage : FLEE dans une manche GARAM n’est jamais un faux GAME_NOT_IN_PROGRESS', async () => {
    app();
    const a = await newPlayer(1_000);
    const created = await expectStatus(
      a.api.post('/api/sessions', { maxPlayers: 2, stakeAmount: 100, gameType: 'GARAM', garamVariant: 16 }),
      201,
    );
    const res = await act(a, created.body.game.gameId as string, 'FLEE');
    expect([res.status, res.body.code]).toEqual([422, 'ACTION_NOT_AVAILABLE_FOR_GAME']);
  });
});

describe('présentation de fin de manche (D-128)', () => {
  it('la ronde Continuer/Sortir commence APRÈS la révélation des mains (comme le 5e tour du Ter)', async () => {
    ctx = createGameApiTestApp(database.sql, {
      random: garamDecksRandom(BELOW_FIFTEEN),
      turnDurationMs: 60_000,
      decisionWindowMs: 60_000,
      stakePolicies: true,
      autoNextGame: true,
      garamRevealPresentationMs, // rythme réel des écrans
    });
    const a = await newPlayer(1_000);
    const b = await newPlayer(1_000);
    const { gameId, sessionId } = await garamTable(a, b);
    await expectStatus(act(a, gameId, 'PLAY_CARD', { cardId: 'COEUR-9' }), 200);
    await expectStatus(act(b, gameId, 'PLAY_CARD', { cardId: 'COEUR-3' }), 200);
    await controllerPasses(gameId);
    await expectStatus(act(b, gameId, 'DRAW_CARD'), 200);
    const done = await view(a, gameId);
    expect(done.status).toBe('finished');
    await ctx.sessions.idle();
    const session = (await expectStatus(a.api.get(`/api/sessions/${sessionId}`), 200)).body
      .session;
    const deadline = Date.parse(session.decision.deadlineAt);
    expect(deadline - Date.parse(done.finishedAt)).toBe(garamRevealPresentationMs(2) + 60_000);
    // 2 joueurs : 2 600 + 2 × 900 + 900 + 2 000 ms.
    expect(garamRevealPresentationMs(2)).toBe(8_000);
    expect(garamRevealPresentationMs(4)).toBe(9_800);
  });
});

describe('mains spéciales et Koraté par HTTP (D-130)', () => {
  it('égalité de priorité (trois 5 / trois 9) : manche nulle, puis proposition de doubler la mise', async () => {
    app(
      ['COEUR-5', 'TREFLE-5', 'PIQUE-5', 'COEUR-9', 'TREFLE-9', 'PIQUE-9', 'PIQUE-10', 'COEUR-11', 'TREFLE-11'],
    );
    const a = await newPlayer(1_000);
    const b = await newPlayer(1_000);
    const { gameId, sessionId } = await garamTable(a, b);
    const tied = await view(a, gameId);
    expect(tied.endReason).toBe('GARAM_TIE');
    expect(tied.garamTie).toMatchObject({ kind: 'SPECIAL', condition: 'THREE_OF_A_KIND' });
    // Même mécanisme que l'égalité de total : la manche rejouée attend le vote.
    const replay = await lastGameOf(sessionId);
    expect(replay.replayOfGameId).toBe(gameId);
    expect(replay.garamStakeVote).toMatchObject({ previousStake: 100, proposedStake: 200 });
  });

  it('Koraté, mise 250 : b paie 250 + 250 ; une commission du barème sur les 500 ; a reçoit le reste', async () => {
    app(BELOW_FIFTEEN); // a garde 20 et gagne, b finit à 12 (< 15)
    const a = await newPlayer(1_000);
    const b = await newPlayer(1_000);
    const { gameId } = await garamTable(a, b, 250);
    await expectStatus(act(a, gameId, 'PLAY_CARD', { cardId: 'COEUR-9' }), 200);
    await expectStatus(act(b, gameId, 'PLAY_CARD', { cardId: 'COEUR-3' }), 200);
    await controllerPasses(gameId);
    await expectStatus(act(b, gameId, 'DRAW_CARD'), 200);
    const done = await view(a, gameId);
    expect(done.result).toMatchObject({ winnerId: a.id, belowThresholdIds: [b.id], penaltyThreshold: 15 });
    const settlement = (
      await database.sql.query<Record<string, unknown>>(
        'SELECT * FROM game_settlements WHERE game_id = $1',
        [gameId],
      )
    ).rows[0]!;
    const commission = Number(settlement.commission_amount);
    // Barème global de la plateforme (aucun taux propre à GARAM) appliqué à toute la perte de b.
    expect(commission).toBe(Math.floor((500 * Number(settlement.applied_commission_bps)) / 10_000));
    expect(Number(settlement.gross_amount)).toBe(250);
    expect(Number(settlement.net_gain) + commission).toBe(500);
    expect(Number(settlement.penalty_amount)).toBe(250);
    expect(await balance(b)).toBe(1_000 - 500);
    expect(await balance(a)).toBe(1_000 + 500 - commission);
    // Une seule écriture de commission, source GARAM TIA, dans la caisse unique.
    const ledger = await database.sql.query<{ kind: string; amount: string; source: string }>(
      'SELECT kind, amount, source FROM platform_ledger WHERE game_id = $1',
      [gameId],
    );
    expect(ledger.rows.map((r) => ({ ...r, amount: Number(r.amount) }))).toEqual(
      commission > 0 ? [{ kind: 'GAME_COMMISSION', amount: commission, source: 'GARAM_TIA' }] : [],
    );
  });
});
