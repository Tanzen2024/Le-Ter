import { randomUUID } from 'node:crypto';

import { Pool } from 'pg';
import { createClient, type RedisClientType } from 'redis';

import { loadMigrations, runMigrations } from '../../../src/database/migrator';
import { createPgSqlClient, type SqlClient } from '../../../src/database/sql-client';
import type { CardId } from '../../../src/domain/cards/card';
import type { GameEvent } from '../../../src/domain/game/game-events';
import type { GameId, PlayerId } from '../../../src/domain/game/game-id';
import type { SessionId } from '../../../src/domain/sessions/session';
import { silentLogger } from '../../../src/utils/logger';
import { gameEventChannel } from '../../../src/websocket/game-rooms';
import { PubSubGameEventBus } from '../../../src/websocket/pubsub-game-event-bus';
import { RedisPubSubTransport } from '../../../src/websocket/pubsub-transport';
import { registerAndLogin } from '../../fixtures/auth';
import {
  as,
  createGameApiTestApp,
  expectStatus,
  type GameApiTestContext,
} from '../../fixtures/game-api';
import { deckForHands, decksRandom } from '../../fixtures/random';

/**
 * C.6 — validation fonctionnelle de bout en bout sur l'infrastructure RÉELLE : HTTP
 * (Supertest sur l'application complète) → SessionService / GameService → PostgreSQL
 * (Docker) et Redis Pub/Sub (Docker). Les mains sont celles du cahier de validation C.6,
 * distribuées par la VRAIE distribution (3 puis 2, sens antihoraire depuis J1).
 *
 * Exécuté quand TEST_DATABASE_URL et TEST_REDIS_URL sont définis (schéma temporaire).
 */
const databaseUrl = process.env.TEST_DATABASE_URL;
const redisUrl = process.env.TEST_REDIS_URL;
const describeWithInfra = databaseUrl && redisUrl ? describe : describe.skip;
jest.setTimeout(180_000);

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function until<T>(read: () => Promise<T>, done: (value: T) => boolean, timeoutMs = 20_000) {
  const limit = Date.now() + timeoutMs;
  for (;;) {
    const value = await read();
    if (done(value) || Date.now() > limit) {
      return value;
    }
    await sleep(100);
  }
}

/** Mains sans aucune combinaison de victoire instantanée. */
const PLAIN_A: CardId[] = ['COEUR-10', 'PIQUE-5', 'TREFLE-10', 'ETOILE-8', 'TREFLE-8'];
const PLAIN_B: CardId[] = ['PIQUE-7', 'PIQUE-9', 'COEUR-4', 'TREFLE-6', 'COEUR-8'];
const PLAIN_C: CardId[] = ['ETOILE-10', 'COEUR-9', 'PIQUE-8', 'ETOILE-6', 'TREFLE-7'];
const PLAIN_D: CardId[] = ['ETOILE-9', 'COEUR-7', 'PIQUE-6', 'TREFLE-9', 'ETOILE-5'];

interface Player {
  id: PlayerId;
  api: ReturnType<typeof as>;
}

describeWithInfra('C.6 — validation fonctionnelle (HTTP + PostgreSQL + Redis réels)', () => {
  const schema = `c6_test_${randomUUID().replace(/-/g, '')}`;
  let pool: Pool;
  let sql: SqlClient;
  let ctx: GameApiTestContext | undefined;
  let clients: RedisClientType[] = [];

  async function redisClient(): Promise<RedisClientType> {
    const client: RedisClientType = createClient({ url: redisUrl });
    client.on('error', () => undefined);
    await client.connect();
    clients.push(client);
    return client;
  }

  /** Application complète sur PG + Redis réels, avec les paquets imposés (un par donne). */
  async function setup(
    decks: CardId[][],
    timers: { turnDurationMs?: number; decisionWindowMs?: number } = {},
  ): Promise<GameApiTestContext> {
    const bus = new PubSubGameEventBus(
      new RedisPubSubTransport(await redisClient(), await redisClient()),
      silentLogger,
    );
    ctx = createGameApiTestApp(sql, { bus, random: decksRandom(...decks), ...timers });
    return ctx;
  }

  async function newPlayer(app: GameApiTestContext['app']): Promise<Player> {
    const s = await registerAndLogin(app);
    return { id: s.userId as PlayerId, api: as(app, s.accessToken) };
  }

  /** Session de `creator` (siège 0, J1) que les autres rejoignent, puis sa 1re partie. */
  async function table(app: GameApiTestContext['app'], count: number, maxPlayers = count) {
    const players: Player[] = [];
    for (let i = 0; i < count; i++) {
      players.push(await newPlayer(app));
    }
    const [creator, ...others] = players as [Player, ...Player[]];
    const created = await expectStatus(creator.api.post('/api/sessions', { maxPlayers }), 201);
    const sessionId = created.body.session.sessionId as SessionId;
    const gameId = created.body.game.gameId as GameId;
    for (const p of others) {
      await expectStatus(p.api.post(`/api/sessions/${sessionId}/join`), 200);
      await expectStatus(p.api.post(`/api/games/${gameId}/join`), 200);
    }
    return { players, sessionId, gameId };
  }

  const act = (p: Player, gameId: GameId, type: string, payload?: object) =>
    p.api.post(`/api/games/${gameId}/actions`, {
      commandId: randomUUID(),
      type,
      ...(payload && { payload }),
    });
  const view = async (p: Player, gameId: GameId) =>
    (await expectStatus(p.api.get(`/api/games/${gameId}`), 200)).body.game;
  const sessionView = async (p: Player, sessionId: SessionId) =>
    (await expectStatus(p.api.get(`/api/sessions/${sessionId}`), 200)).body.session;
  const stateRow = async (gameId: GameId) =>
    (
      await sql.query<{
        state: {
          play: {
            hands: Record<string, CardId[]>;
            completedTricks: { plays: { playerId: string; cardId: CardId }[] }[];
          };
        };
        version: number;
        status: string;
      }>('SELECT state, version, status FROM games WHERE id = $1', [gameId])
    ).rows[0]!;

  beforeAll(async () => {
    const admin = new Pool({ connectionString: databaseUrl, max: 1 });
    await admin.query(`CREATE SCHEMA ${schema}`);
    await admin.end();
    pool = new Pool({ connectionString: databaseUrl, max: 8, options: `-c search_path=${schema}` });
    sql = createPgSqlClient(pool);
    await runMigrations(sql, await loadMigrations());
  });

  afterEach(async () => {
    await ctx?.stopTimers();
    await ctx?.games.idle();
    ctx = undefined;
    await Promise.allSettled(clients.map((c) => c.close()));
    clients = [];
  });

  afterAll(async () => {
    await pool?.query(`DROP SCHEMA ${schema} CASCADE`);
    await pool?.end();
  });

  // -------------------------------------------------------------------------------------
  // §8 et §14 — famille, actions manuelles et timeout de 15 s (production)
  // -------------------------------------------------------------------------------------

  it('CAS 1 — contrôle 5♠, main 7♠ 9♠ 4♥ 6♣ : 4♥ refusé à la main, 7♠ joué au timeout (15 s)', async () => {
    const A_HAND: CardId[] = ['COEUR-10', 'PIQUE-5', 'TREFLE-10', 'ETOILE-9', 'TREFLE-8'];
    const { app } = await setup([deckForHands([A_HAND, PLAIN_B])]);
    const {
      players: [A, B],
      gameId,
    } = await table(app, 2);
    const wire: { kind: string; event: GameEvent }[] = [];
    const tap = await redisClient();
    await tap.subscribe(gameEventChannel(gameId), (raw) => wire.push(JSON.parse(raw)));

    await expectStatus(A!.api.post(`/api/games/${gameId}/start`), 200);

    // Tour 1 : A ouvre 10♥ ; B possède des ♥ → seules 4♥ et 8♥ sont légales.
    await expectStatus(act(A!, gameId, 'PLAY_CARD', { cardId: 'COEUR-10' }), 200);
    expect((await view(B!, gameId)).myActions.playableCardIds).toEqual(['COEUR-4', 'COEUR-8']);
    const refused = await expectStatus(act(B!, gameId, 'PLAY_CARD', { cardId: 'PIQUE-9' }), 422);
    expect(refused.body.code).toBe('CARD_NOT_PLAYABLE');
    await expectStatus(act(B!, gameId, 'PLAY_CARD', { cardId: 'COEUR-8' }), 200);

    // Tour 2 : A (contrôle conservé, 10♥ > 8♥) ouvre 5♠. Main de B : 7♠ 9♠ 4♥ 6♣.
    const afterLead = await expectStatus(act(A!, gameId, 'PLAY_CARD', { cardId: 'PIQUE-5' }), 200);
    expect(afterLead.body.game.play.completedTricks[0].controllerId).toBe(A!.id);
    const bView = await view(B!, gameId);
    expect(bView.play.myHand).toEqual(['PIQUE-7', 'PIQUE-9', 'COEUR-4', 'TREFLE-6']);
    expect(bView.myActions.playableCardIds).toEqual(['PIQUE-7', 'PIQUE-9']);
    const manual = await expectStatus(act(B!, gameId, 'PLAY_CARD', { cardId: 'COEUR-4' }), 422);
    expect(manual.body.code).toBe('CARD_NOT_PLAYABLE');

    // B ne joue pas : 15 s plus tard, le serveur joue 7♠ (plus petite ♠), B prend le contrôle.
    const deadline = Date.parse(bView.turnDeadlineAt as string);
    expect(deadline - Date.parse(bView.turnStartedAt as string)).toBe(15_000);
    await sleep(Math.max(0, deadline - Date.now()));
    const after = await until(
      () => view(A!, gameId),
      (g) => g.play.completedTricks.length === 2,
    );
    await ctx!.games.idle();
    expect(after.play.completedTricks[1]).toEqual({
      number: 2,
      plays: [
        { playerId: A!.id, cardId: 'PIQUE-5' },
        { playerId: B!.id, cardId: 'PIQUE-7' },
      ],
      controllerId: B!.id,
    });
    expect(after.play.controllerId).toBe(B!.id);
    expect(after.activePlayerId).toBe(B!.id); // le nouveau contrôleur ouvre le tour 3

    // PostgreSQL : source de vérité.
    const row = await stateRow(gameId);
    expect(row.state.play.hands[B!.id]).toEqual(['PIQUE-9', 'COEUR-4', 'TREFLE-6']);
    // Redis : un TURN_TIMEOUT puis un coup automatique, publics, sans aucune main.
    await until(
      async () => wire,
      (w) => w.some((m) => m.event.type === 'game:auto_card_played'),
    );
    expect(wire.filter((m) => m.event.type === 'game:turn_timeout')).toHaveLength(1);
    expect(
      wire.filter((m) => m.event.type === 'game:auto_card_played').map((m) => m.event.payload),
    ).toEqual([{ playerId: B!.id, trickNumber: 2 }]);
  });

  it('CAS 2 — contrôle 5♠, main 8♥ 3♣ 6⭐ 9♥ 7♣ (aucune ♠) : toute carte légale, 3♣ au timeout', async () => {
    const A_HAND: CardId[] = ['PIQUE-5', 'TREFLE-10', 'TREFLE-9', 'ETOILE-10', 'COEUR-10'];
    const B_HAND: CardId[] = ['COEUR-8', 'TREFLE-3', 'ETOILE-6', 'COEUR-9', 'TREFLE-7'];
    const { app } = await setup([deckForHands([A_HAND, B_HAND])]);
    const {
      players: [A, B],
      gameId,
    } = await table(app, 2);
    await expectStatus(A!.api.post(`/api/games/${gameId}/start`), 200);
    await expectStatus(act(A!, gameId, 'PLAY_CARD', { cardId: 'PIQUE-5' }), 200);

    const bView = await view(B!, gameId);
    expect(bView.play.myHand).toEqual(B_HAND);
    // Aucune ♠ : toutes les cartes sont légales pour un coup manuel.
    expect(bView.myActions.playableCardIds).toEqual(B_HAND);

    const deadline = Date.parse(bView.turnDeadlineAt as string);
    await sleep(Math.max(0, deadline - Date.now()));
    const after = await until(
      () => view(A!, gameId),
      (g) => g.play.completedTricks.length === 1,
    );
    await ctx!.games.idle();
    expect(after.play.completedTricks[0].plays).toEqual([
      { playerId: A!.id, cardId: 'PIQUE-5' },
      { playerId: B!.id, cardId: 'TREFLE-3' },
    ]);
    // Autre famille : le contrôle reste à A, qui ouvre le tour 2.
    expect(after.play.completedTricks[0].controllerId).toBe(A!.id);
    expect(after.activePlayerId).toBe(A!.id);
    expect((await stateRow(gameId)).state.play.hands[B!.id]).toEqual([
      'COEUR-8',
      'ETOILE-6',
      'COEUR-9',
      'TREFLE-7',
    ]);
  });

  // -------------------------------------------------------------------------------------
  // §11-§13 et §16 — victoire instantanée, égalité, reprise, Poursuivre/Quitter
  // -------------------------------------------------------------------------------------

  it('J1 rang 2, J2 rang 5 : J1 gagne automatiquement (simple) ; sans réponse, tous quittent', async () => {
    const J1: CardId[] = ['COEUR-3', 'PIQUE-4', 'TREFLE-5', 'ETOILE-4', 'COEUR-5']; // somme 21
    const J2: CardId[] = ['COEUR-8', 'PIQUE-8', 'TREFLE-8', 'COEUR-10', 'ETOILE-10']; // 3 + 2
    const { app } = await setup([deckForHands([J1, J2])], { decisionWindowMs: 1_500 });
    const {
      players: [A, B],
      sessionId,
      gameId,
    } = await table(app, 2);

    const started = await expectStatus(A!.api.post(`/api/games/${gameId}/start`), 200);
    expect(started.body.game.status).toBe('finished');
    expect(started.body.game.endReason).toBe('INSTANT_WIN');
    expect(started.body.game.result).toMatchObject({
      winnerId: A!.id,
      method: 'INSTANT_WIN',
      instantWinRank: 2,
      instantWinCombination: 'SUM_AT_MOST_21',
      automatic: true,
      victoryType: 'SIMPLE',
    });
    expect((await view(B!, gameId)).result.winnerId).toBe(A!.id);

    // Fin de partie → ronde Poursuivre/Quitter pour les deux joueurs.
    const round = await until(
      () => sessionView(A!, sessionId),
      (s) => Boolean(s.decision?.open),
    );
    expect(round.decision.gameId).toBe(gameId);
    expect([...round.decision.pendingPlayerIds].sort()).toEqual([A!.id, B!.id].sort());

    // Personne ne répond : départ automatique de tous, session fermée.
    const closed = await until(
      async () =>
        (
          await sql.query<{ status: string }>('SELECT status FROM sessions WHERE id = $1', [
            sessionId,
          ])
        ).rows[0]!,
      (s) => s.status === 'closed',
    );
    expect(closed.status).toBe('closed');
    const after = await sessionView(A!, sessionId);
    expect(after.seats.every((s: { playerId: string | null }) => s.playerId === null)).toBe(true);
    expect(after.decision.decisions.map((d: { choice: string }) => d.choice)).toEqual([
      'auto_leave',
      'auto_leave',
    ]);
  });

  it('J1 rang 3 = J2 rang 3 (deux fois) : reprises immédiates, même J1, mêmes sièges, nouvelles donnes', async () => {
    const tie1: [CardId[], CardId[]] = [
      ['TREFLE-4', 'TREFLE-6', 'TREFLE-8', 'TREFLE-9', 'TREFLE-10'],
      ['ETOILE-5', 'ETOILE-6', 'ETOILE-8', 'ETOILE-9', 'ETOILE-10'],
    ];
    const tie2: [CardId[], CardId[]] = [
      ['COEUR-4', 'COEUR-6', 'COEUR-8', 'COEUR-9', 'COEUR-10'],
      ['TREFLE-5', 'TREFLE-6', 'TREFLE-7', 'TREFLE-9', 'TREFLE-10'],
    ];
    const { app } = await setup([
      deckForHands(tie1),
      deckForHands(tie2),
      deckForHands([PLAIN_A, PLAIN_B]),
    ]);
    const {
      players: [A, B],
      sessionId,
      gameId,
    } = await table(app, 2);

    const started = await expectStatus(A!.api.post(`/api/games/${gameId}/start`), 200);
    expect(started.body.game.endReason).toBe('INSTANT_WIN_TIE');
    expect(started.body.game.instantWinTie).toEqual({ rank: 3, playerIds: [A!.id, B!.id] });
    expect(started.body.game.result).toBeUndefined(); // aucun gagnant

    const session = await until(
      () => sessionView(B!, sessionId),
      (s) => s.currentGame?.status === 'in_progress',
    );
    expect(session.decision).toBeNull(); // jamais de Poursuivre/Quitter
    expect(session.seats).toEqual([
      { seat: 0, playerId: A!.id },
      { seat: 1, playerId: B!.id },
    ]);
    type Summary = {
      gameId: GameId;
      replayOfGameId?: string;
      endReason?: string;
      firstPlayerId: string;
    };
    const games: Summary[] = (
      await expectStatus(A!.api.get(`/api/sessions/${sessionId}/games`), 200)
    ).body.games;
    expect(games).toHaveLength(3);
    // Chaîne des reprises : partie annulée → sa reprise → la reprise de la reprise.
    const history: Summary[] = [games.find((g) => g.gameId === gameId)!];
    for (let i = 0; i < 2; i++) {
      history.push(games.find((g) => g.replayOfGameId === history[i]!.gameId)!);
    }
    expect(history.map((g) => g.endReason)).toEqual([
      'INSTANT_WIN_TIE',
      'INSTANT_WIN_TIE',
      undefined,
    ]);
    expect(history[1]!.replayOfGameId).toBe(history[0]!.gameId);
    expect(history[2]!.replayOfGameId).toBe(history[1]!.gameId);
    expect(history.every((g) => g.firstPlayerId === A!.id)).toBe(true);

    // Nouvelles donnes à chaque reprise (31 cartes remélangées) ; mains privées.
    const replayId = session.currentGame.gameId as GameId;
    const third = await view(B!, replayId);
    expect(third.play.dealOrder).toEqual([A!.id, B!.id]);
    expect(third.activePlayerId).toBe(A!.id);
    expect(third.play.myHand).toEqual(PLAIN_B);
    expect((await view(B!, history[1]!.gameId)).play.myHand).toEqual(tie2[1]);
    expect((await view(B!, gameId)).play.myHand).toEqual(tie1[1]);
    expect(
      third.players.map((p: { playerId: string; tablePosition: number }) => [
        p.playerId,
        p.tablePosition,
      ]),
    ).toEqual([
      [A!.id, 0],
      [B!.id, 1],
    ]);
  });

  it('main gagnante unique : bouton du seul détenteur, victoire SIMPLE ; J1 suivant = gagnant', async () => {
    const B_FOUR_NINES: CardId[] = ['COEUR-9', 'PIQUE-9', 'TREFLE-9', 'ETOILE-9', 'ETOILE-10'];
    const { app } = await setup(
      [deckForHands([PLAIN_A, B_FOUR_NINES]), deckForHands([PLAIN_B, PLAIN_C])],
      { decisionWindowMs: 8_000 },
    );
    const {
      players: [A, B],
      sessionId,
      gameId,
    } = await table(app, 2);
    await expectStatus(A!.api.post(`/api/games/${gameId}/start`), 200);

    const viewB = await view(B!, gameId);
    expect(viewB.myActions.canDeclareInstantWin).toBe(true);
    expect(viewB.myInstantWin).toEqual({ rank: 4, combination: 'FOUR_OF_A_VALUE' });
    const viewA = await view(A!, gameId);
    expect(viewA.myActions.canDeclareInstantWin).toBe(false);
    expect(viewA.myInstantWin).toBeUndefined();
    // Rien de la main de B (ni ses cartes, ni sa combinaison) dans la vue de A.
    const rawA = JSON.stringify(viewA);
    expect(rawA).not.toContain('FOUR_OF_A_VALUE');
    for (const card of B_FOUR_NINES) {
      expect(rawA).not.toContain(card);
    }
    // A n'a pas de main gagnante : refus.
    expect((await expectStatus(act(A!, gameId, 'DECLARE_WIN'), 422)).body.code).toBe(
      'NOT_A_WINNING_HAND',
    );

    // B déclare (ce n'est pas son tour : la fenêtre est « avant sa première carte »).
    const declared = await expectStatus(act(B!, gameId, 'DECLARE_WIN'), 200);
    expect(declared.body.game.status).toBe('finished');
    expect(declared.body.game.result).toMatchObject({
      winnerId: B!.id,
      method: 'INSTANT_WIN',
      instantWinRank: 4,
      automatic: false,
      victoryType: 'SIMPLE',
    });

    // Poursuivre pour les deux ; partie suivante : J1 = B (gagnant), sièges inchangés.
    await until(
      () => sessionView(A!, sessionId),
      (s) => Boolean(s.decision?.open),
    );
    await expectStatus(
      A!.api.post(`/api/sessions/${sessionId}/decision`, { choice: 'continue' }),
      200,
    );
    await expectStatus(
      B!.api.post(`/api/sessions/${sessionId}/decision`, { choice: 'continue' }),
      200,
    );
    const next = await expectStatus(A!.api.post(`/api/sessions/${sessionId}/games`), 201);
    const nextId = next.body.game.gameId as GameId;
    expect(next.body.game.firstPlayerId).toBe(B!.id);
    await expectStatus(B!.api.post(`/api/games/${nextId}/join`), 200);
    const started = await expectStatus(A!.api.post(`/api/games/${nextId}/start`), 200);
    expect(started.body.game.play.dealOrder).toEqual([B!.id, A!.id]);
    expect(started.body.game.activePlayerId).toBe(B!.id);
    expect(started.body.game.play.controllerId).toBe(B!.id);
    expect(started.body.game.play.myHand).toEqual(PLAIN_C);
    expect((await sessionView(A!, sessionId)).seats).toEqual([
      { seat: 0, playerId: A!.id },
      { seat: 1, playerId: B!.id },
    ]);
  });

  it('main gagnante unique : le détenteur joue sa première carte → le bouton disparaît, droit perdu', async () => {
    const A_FOUR_NINES: CardId[] = ['COEUR-9', 'PIQUE-9', 'TREFLE-9', 'ETOILE-9', 'ETOILE-10'];
    const { app } = await setup([deckForHands([A_FOUR_NINES, PLAIN_A])]);
    const {
      players: [A],
      gameId,
    } = await table(app, 2);
    await expectStatus(A!.api.post(`/api/games/${gameId}/start`), 200);
    expect((await view(A!, gameId)).myActions.canDeclareInstantWin).toBe(true);

    await expectStatus(act(A!, gameId, 'PLAY_CARD', { cardId: 'COEUR-9' }), 200);
    const after = await view(A!, gameId);
    expect(after.myActions.canDeclareInstantWin).toBe(false);
    expect(after.status).toBe('in_progress');
    const refused = await expectStatus(act(A!, gameId, 'DECLARE_WIN'), 422);
    expect(refused.body.code).toBe('WIN_DECLARATION_NOT_ALLOWED');
  });

  // -------------------------------------------------------------------------------------
  // §3, §7, §10, §15, §18 — Fuir, partie entière sans action, 5e tour, confidentialité
  // -------------------------------------------------------------------------------------

  it('4 places, 3 joueurs : J1 fuit, arrivée en cours de partie, tours 1-4 par timeout, 5e tour automatique', async () => {
    const { app } = await setup(
      [
        deckForHands([PLAIN_A, PLAIN_B, PLAIN_C]),
        deckForHands([PLAIN_B, PLAIN_C, PLAIN_D, PLAIN_A]),
      ],
      { turnDurationMs: 1_200, decisionWindowMs: 8_000 },
    );
    const {
      players: [A, B, C],
      sessionId,
      gameId,
    } = await table(app, 3, 4);
    const wire: { kind: string; playerId?: string; event: GameEvent }[] = [];
    const tap = await redisClient();
    await tap.subscribe(gameEventChannel(gameId), (raw) => wire.push(JSON.parse(raw)));
    const eventsB: GameEvent[] = [];
    await ctx!.games.subscribe(gameId, B!.id, (e) => eventsB.push(e));

    const started = await expectStatus(A!.api.post(`/api/games/${gameId}/start`), 200);
    expect(started.body.game.play.dealOrder).toEqual([A!.id, B!.id, C!.id]);
    expect(started.body.game.play.stockCount).toBe(31 - 15); // inaccessible, jamais exposé
    expect(started.body.game.play.stock).toBeUndefined();

    // J1 (contrôleur) fuit avant sa première carte : B (suivant antihoraire) mène le tour 1.
    const fled = await expectStatus(act(A!, gameId, 'FLEE'), 200);
    expect(fled.body.game.play.controllerId).toBe(B!.id);
    expect(fled.body.game.activePlayerId).toBe(B!.id);
    expect(fled.body.game.play.trickOrder).toEqual([B!.id, C!.id]);
    expect((await expectStatus(act(C!, gameId, 'FLEE'), 422)).body.code).toBe('FLEE_NOT_ALLOWED');
    expect(
      (await expectStatus(act(A!, gameId, 'PLAY_CARD', { cardId: 'COEUR-10' }), 422)).body.code,
    ).toBe('PLAYER_HAS_FLED');

    // D rejoint la SESSION pendant la partie : siège libre, mais aucune carte de cette partie.
    const D = await newPlayer(app);
    const joined = await expectStatus(D.api.post(`/api/sessions/${sessionId}/join`), 200);
    expect(joined.body.session.seats[3]).toEqual({ seat: 3, playerId: D.id });
    expect((await expectStatus(D.api.get(`/api/games/${gameId}`), 403)).body.code).toBe(
      'NOT_A_MEMBER',
    );
    // A, fuyard, reste à son siège de session.
    expect(joined.body.session.seats[0]).toEqual({ seat: 0, playerId: A!.id });

    // Aucune action : tours 1 à 4 par timeout (D-036), 5e tour automatique, fin.
    const finished = await until(
      () => view(B!, gameId),
      (g) => g.status === 'finished',
    );
    await ctx!.games.idle();
    const tricks = finished.play.completedTricks.map(
      (t: { plays: { playerId: string; cardId: string }[]; controllerId: string }) => ({
        plays: t.plays.map((p) => [p.playerId === B!.id ? 'B' : 'C', p.cardId]),
        controller: t.controllerId === B!.id ? 'B' : 'C',
      }),
    );
    expect(tricks).toEqual([
      {
        plays: [
          ['B', 'COEUR-4'],
          ['C', 'COEUR-9'],
        ],
        controller: 'C',
      },
      {
        plays: [
          ['C', 'ETOILE-6'],
          ['B', 'TREFLE-6'],
        ],
        controller: 'C',
      },
      {
        plays: [
          ['C', 'TREFLE-7'],
          ['B', 'PIQUE-7'],
        ],
        controller: 'C',
      },
      {
        plays: [
          ['C', 'PIQUE-8'],
          ['B', 'PIQUE-9'],
        ],
        controller: 'B',
      },
      {
        plays: [
          ['B', 'COEUR-8'],
          ['C', 'ETOILE-10'],
        ],
        controller: 'B',
      },
    ]);
    expect(finished.endReason).toBe('CONTROL_AFTER_LAST_TRICK');
    expect(finished.result).toMatchObject({
      winnerId: B!.id,
      method: 'CONTROL_AFTER_LAST_TRICK',
      fledPlayerIds: [A!.id],
      remainingOpponentIds: [C!.id],
    });
    expect(finished.result.victoryType).toBeUndefined(); // Kora non définie (R-02)
    expect(finished.result.revealedHands).toBeUndefined();

    // Cartes du fuyard jamais jouées, jamais révélées.
    expect((await stateRow(gameId)).state.play.hands[A!.id]).toEqual(PLAIN_A);
    const rawB = JSON.stringify(finished);
    for (const card of PLAIN_A) {
      expect(rawB).not.toContain(card);
    }
    // Les 5e tour : coups automatiques sans TURN_TIMEOUT (8 timeouts pour les tours 1-4).
    expect(wire.filter((m) => m.event.type === 'game:turn_timeout')).toHaveLength(8);
    expect(wire.filter((m) => m.event.type === 'game:last_trick_automatic')).toHaveLength(1);
    // Confidentialité : les mains ne circulent qu'en messages privés, chacun à son seul
    // destinataire ; B n'a reçu que la sienne.
    const dealt = wire.filter((m) => m.event.type === 'game:hand_dealt');
    expect(dealt).toHaveLength(3);
    expect(dealt.every((m) => m.kind === 'player' && m.playerId === m.event.payload.playerId)).toBe(
      true,
    );
    expect(eventsB.filter((e) => e.type === 'game:hand_dealt').map((e) => e.payload.cards)).toEqual(
      [PLAIN_B],
    );
    for (const m of wire.filter((x) => x.kind === 'game')) {
      expect(JSON.stringify(m.event.payload)).not.toMatch(/"(cards|hands|myHand|stock)"/);
    }

    // Ronde Poursuivre/Quitter : les 4 présents (fuyard et arrivant compris) poursuivent.
    const round = await until(
      () => sessionView(A!, sessionId),
      (s) => Boolean(s.decision?.open),
    );
    expect([...round.decision.pendingPlayerIds].sort()).toEqual([A!.id, B!.id, C!.id, D.id].sort());
    for (const p of [A!, B!, C!, D]) {
      await expectStatus(
        p.api.post(`/api/sessions/${sessionId}/decision`, { choice: 'continue' }),
        200,
      );
    }

    // Partie suivante : J1 = B (gagnant) ; ordre antihoraire des sièges fixes B → C → D → A.
    const next = await expectStatus(A!.api.post(`/api/sessions/${sessionId}/games`), 201);
    const nextId = next.body.game.gameId as GameId;
    for (const p of [B!, C!, D]) {
      await expectStatus(p.api.post(`/api/games/${nextId}/join`), 200);
    }
    const second = await expectStatus(A!.api.post(`/api/games/${nextId}/start`), 200);
    expect(second.body.game.firstPlayerId).toBe(B!.id);
    expect(second.body.game.play.dealOrder).toEqual([B!.id, C!.id, D.id, A!.id]);
    expect(second.body.game.play.dealSequence).toEqual([
      ...[B!, C!, D, A!].map((p) => ({ pass: 1, playerId: p.id, count: 3 })),
      ...[B!, C!, D, A!].map((p) => ({ pass: 2, playerId: p.id, count: 2 })),
    ]);
    expect(second.body.game.play.myHand).toEqual(PLAIN_A); // le fuyard rejoue normalement
    expect(second.body.game.play.stockCount).toBe(31 - 20);
  });
});
