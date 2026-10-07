import { randomUUID } from 'node:crypto';

import { Pool } from 'pg';

import { loadMigrations, runMigrations } from '../../../src/database/migrator';
import { createPgSqlClient, type SqlClient } from '../../../src/database/sql-client';
import type { GameEvent } from '../../../src/domain/game/game-events';
import type { GameId, PlayerId } from '../../../src/domain/game/game-id';
import type { SessionEvent } from '../../../src/domain/sessions/session-events';
import type { SessionId } from '../../../src/domain/sessions/session';
import { GameTimerRegistry } from '../../../src/services/game/game-timer-registry';
import { InMemoryGameEventHub } from '../../../src/websocket/in-memory-game-event-hub';
import type { RandomSource } from '../../../src/domain/cards/random-source';
import type { CardId } from '../../../src/domain/cards/card';
import { deckForHands, decksRandom, identityRandom } from '../../fixtures/random';
import { testRules } from '../../fixtures/rules';
import { createSessionGameInstance } from '../../fixtures/session-games';
import { seedUsers, testPlayerId } from '../../fixtures/users';

/**
 * Sessions et timers (D-033, D-034) sur un VRAI PostgreSQL : connexions réellement
 * parallèles, deux « instances » (files, timers, hubs distincts) qui ne partagent que la
 * base. Exécutée quand TEST_DATABASE_URL est défini, dans un schéma temporaire supprimé
 * à la fin.
 */
const url = process.env.TEST_DATABASE_URL;
const describeWithPostgres = url ? describe : describe.skip;
jest.setTimeout(90_000);

describeWithPostgres('Sessions et timers sur PostgreSQL réel (concurrence)', () => {
  const schema = `session_test_${randomUUID().replace(/-/g, '')}`;
  let pool: Pool;
  let sql: SqlClient;
  let trial = 0;
  const running: { stop(): void; idle(): Promise<void> }[] = [];

  beforeAll(async () => {
    const admin = new Pool({ connectionString: url, max: 1 });
    await admin.query(`CREATE SCHEMA ${schema}`);
    await admin.end();
    pool = new Pool({ connectionString: url, max: 16, options: `-c search_path=${schema}` });
    sql = createPgSqlClient(pool);
    await runMigrations(sql, await loadMigrations());
  });

  // Arrêt des instances, puis attente des commandes déjà lancées en arrière-plan (fin de
  // partie → ronde, timers) : aucune transaction ne doit survivre au test.
  afterEach(async () => {
    const stopped = running.splice(0);
    stopped.forEach((i) => i.stop());
    await Promise.all(stopped.map((i) => i.idle()));
  });

  afterAll(async () => {
    await pool?.query(`DROP SCHEMA ${schema} CASCADE`);
    await pool?.end();
  });

  function instance(
    gameEvents: GameEvent[] = [],
    options: {
      turnDurationMs?: number;
      decisionWindowMs?: number;
      clock?: () => Date;
      random?: RandomSource;
    } = {},
  ) {
    const hub = new InMemoryGameEventHub();
    const inst = createSessionGameInstance(sql, {
      publisher: {
        publishToGame: (e) => {
          gameEvents.push(e);
          hub.publishToGame(e);
        },
        publishToPlayer: (p, e) => hub.publishToPlayer(p, e),
      },
      subscriber: hub,
      timers: new GameTimerRegistry(),
      rules: testRules,
      random: options.random ?? identityRandom,
      turnDurationMs: options.turnDurationMs ?? 60_000,
      decisionWindowMs: options.decisionWindowMs ?? 60_000,
      ...(options.clock && { clock: options.clock }),
    });
    running.push(inst);
    return inst;
  }

  async function players(...names: string[]): Promise<PlayerId[]> {
    trial += 1;
    const unique = names.map((n) => `${n}-s${trial}`);
    await seedUsers(sql, unique);
    return unique.map(testPlayerId);
  }

  async function sessionState(sessionId: SessionId) {
    const { rows } = await sql.query<{ status: string; n: number }>(
      `SELECT s.status, (SELECT count(*)::int FROM session_players p
         WHERE p.session_id = s.id AND p.active) AS n
       FROM sessions s WHERE s.id = $1`,
      [sessionId],
    );
    return rows[0]!;
  }

  /** Session à 2 (a, b), partie démarrée (J1 = a), timer de tour armé. */
  async function startedPair(inst: ReturnType<typeof instance>) {
    const [a, b] = (await players('a', 'b')) as [PlayerId, PlayerId];
    const { session, game } = await inst.sessions.createSession(a, { maxPlayers: 2 });
    await inst.joinGame(game.id, b);
    const started = await inst.startGame(game.id, a);
    return { a, b, sessionId: session.id, game: started };
  }

  // --- Sièges, capacité, une session par joueur ----------------------------------------

  it('8 arrivées simultanées (deux instances) pour 3 places : 3 réussissent, sièges distincts', async () => {
    const one = instance();
    const two = instance();
    const [creator, ...others] = await players('c', 'p1', 'p2', 'p3', 'p4', 'p5', 'p6', 'p7', 'p8');
    const { session } = await one.sessions.createSession(creator!, { maxPlayers: 4 });

    const results = await Promise.allSettled(
      others.map((p, i) => (i % 2 ? one : two).sessions.joinSession(session.id, p)),
    );

    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(3);
    for (const r of results.filter((x) => x.status === 'rejected') as PromiseRejectedResult[]) {
      expect((r.reason as Error).name).toBe('SessionFullError');
    }
    const { rows } = await sql.query<{ seat: number }>(
      'SELECT seat FROM session_players WHERE session_id = $1 AND active ORDER BY seat',
      [session.id],
    );
    expect(rows.map((r) => r.seat)).toEqual([0, 1, 2, 3]);
  });

  it('10 essais : deux arrivées pour la DERNIÈRE place → une seule', async () => {
    for (let i = 0; i < 10; i++) {
      const one = instance();
      const two = instance();
      const [a, b, c] = await players('a', 'b', 'c');
      const { session } = await one.sessions.createSession(a!, { maxPlayers: 2 });
      const results = await Promise.allSettled([
        one.sessions.joinSession(session.id, b!),
        two.sessions.joinSession(session.id, c!),
      ]);
      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
      expect((await sessionState(session.id)).n).toBe(2);
    }
  });

  it('10 essais : un joueur rejoint deux sessions en même temps → une seule session active', async () => {
    for (let i = 0; i < 10; i++) {
      const one = instance();
      const two = instance();
      const [a, b, carol] = await players('a', 'b', 'carol');
      const s1 = await one.sessions.createSession(a!, { maxPlayers: 4 });
      const s2 = await two.sessions.createSession(b!, { maxPlayers: 4 });

      const results = await Promise.allSettled([
        one.sessions.joinSession(s1.session.id, carol!),
        two.sessions.joinSession(s2.session.id, carol!),
      ]);

      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
      const failure = results.find((r) => r.status === 'rejected') as PromiseRejectedResult;
      expect((failure.reason as Error).name).toBe('PlayerAlreadyInSessionError');
      const { rows } = await sql.query<{ n: number }>(
        'SELECT count(*)::int AS n FROM session_players WHERE player_id = $1 AND active',
        [carol],
      );
      expect(rows[0]?.n).toBe(1);
    }
  });

  // --- Départs, fermeture --------------------------------------------------------------

  it('10 essais : les deux derniers partent en même temps → fermée une seule fois', async () => {
    for (let i = 0; i < 10; i++) {
      const closed: SessionEvent[] = [];
      const one = instance();
      const two = instance();
      const [a, b] = await players('a', 'b');
      const { session, game } = await one.sessions.createSession(a!, { maxPlayers: 2 });
      await one.sessions.joinSession(session.id, b!);
      await one.finishGame(game.id);
      for (const inst of [one, two]) {
        inst.sessionEvents.subscribe(
          session.id,
          (e) => e.type === 'session:closed' && closed.push(e),
        );
      }

      await Promise.all([
        one.sessions.leaveSession(session.id, a!),
        two.sessions.leaveSession(session.id, b!),
      ]);

      expect(closed).toHaveLength(1);
      expect(await sessionState(session.id)).toEqual({ status: 'closed', n: 0 });
    }
  });

  it('10 essais : départ du dernier joueur contre arrivée → jamais « fermée avec des joueurs »', async () => {
    for (let i = 0; i < 10; i++) {
      const one = instance();
      const two = instance();
      const [a, b] = await players('a', 'b');
      const { session, game } = await one.sessions.createSession(a!, { maxPlayers: 2 });
      await one.finishGame(game.id);
      await one.sessions.decide(session.id, a!, 'continue'); // ronde résolue

      const results = await Promise.allSettled([
        one.sessions.leaveSession(session.id, a!),
        two.sessions.joinSession(session.id, b!),
      ]);
      const state = await sessionState(session.id);
      // Soit l'arrivée passe avant (session ouverte avec B), soit après (fermée, B refusé).
      expect(state.status === 'open' ? state.n > 0 : state.n === 0).toBe(true);
      if (state.status === 'closed') {
        expect(results[1]?.status).toBe('rejected');
      }
    }
  });

  // --- Parties successives ---------------------------------------------------------------

  it('10 essais : deux créations simultanées de partie dans une session → une seule, même J1', async () => {
    for (let i = 0; i < 10; i++) {
      const one = instance();
      const two = instance();
      const [a, b, c] = await players('a', 'b', 'c');
      const { session, game } = await one.sessions.createSession(a!, { maxPlayers: 3 });
      await one.sessions.joinSession(session.id, b!);
      await one.sessions.joinSession(session.id, c!);
      // Gagnant enregistré avant la fin (R-03/R-08 : pas de partie gagnée en production).
      await one.finishGame(game.id);
      await sql.query(
        "UPDATE games SET winner_id = $2, end_reason = 'CONTROL_AFTER_LAST_TRICK' WHERE id = $1",
        [game.id, b],
      );
      for (const p of [a, b, c]) await one.sessions.decide(session.id, p!, 'continue');

      const results = await Promise.allSettled([
        one.sessions.createNextGame(session.id, a!, {}),
        two.sessions.createNextGame(session.id, c!, {}),
      ]);

      const ok = results.filter((r) => r.status === 'fulfilled') as PromiseFulfilledResult<{
        game: { firstPlayerId: PlayerId; maxPlayers: number };
      }>[];
      expect(ok).toHaveLength(1);
      expect(ok[0]!.value.game).toMatchObject({ firstPlayerId: b, maxPlayers: 3 });
      const failure = results.find((r) => r.status === 'rejected') as PromiseRejectedResult;
      expect(['SessionGameInProgressError', 'ParticipationRefusedError']).toContain(
        (failure.reason as Error).name,
      );
      const { rows } = await sql.query<{ n: number }>(
        `SELECT count(*)::int AS n FROM games WHERE session_id = $1 AND status <> 'finished'`,
        [session.id],
      );
      expect(rows[0]?.n).toBe(1);
    }
  });

  it('10 essais : démarrages simultanés (deux instances) → une seule distribution', async () => {
    for (let i = 0; i < 10; i++) {
      const events: GameEvent[] = [];
      const one = instance(events);
      const two = instance(events);
      const [a, b] = (await players('a', 'b')) as [PlayerId, PlayerId];
      const { game } = await one.sessions.createSession(a, { maxPlayers: 2 });
      await one.joinGame(game.id, b);

      const results = await Promise.allSettled([
        one.startGame(game.id, a),
        two.startGame(game.id, a),
      ]);
      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
      expect(events.filter((e) => e.gameId === game.id && e.type === 'game:started')).toHaveLength(
        1,
      );
    }
  });

  it('10 essais : rejoindre la partie contre quitter la session → jamais parti ET dans la partie', async () => {
    for (let i = 0; i < 10; i++) {
      const one = instance();
      const two = instance();
      const [a, b] = await players('a', 'b');
      const { session, game } = await one.sessions.createSession(a!, { maxPlayers: 3 });
      await one.sessions.joinSession(session.id, b!);

      await Promise.allSettled([
        one.games.joinGame(game.id, b!),
        two.sessions.leaveSession(session.id, b!),
      ]);

      const { rows } = await sql.query<{ active: boolean; in_game: boolean }>(
        `SELECT sp.active,
           EXISTS (SELECT 1 FROM game_players gp WHERE gp.game_id = $2 AND gp.player_id = $3)
             AS in_game
         FROM session_players sp WHERE sp.session_id = $1 AND sp.player_id = $3`,
        [session.id, game.id, b],
      );
      const state = rows[0]!;
      expect(!state.active && state.in_game).toBe(false);
    }
  });

  it('double fin de partie sur deux instances : une transition, un game:finished, une ronde', async () => {
    const events: GameEvent[] = [];
    const one = instance(events);
    const two = instance(events);
    const [a] = await players('a');
    const { session, game } = await one.sessions.createSession(a!, { maxPlayers: 2 });

    await Promise.allSettled([one.finishGame(game.id), two.finishGame(game.id)]);
    await Promise.all([one.sessions.syncSession(session.id), two.sessions.syncSession(session.id)]);

    expect(events.filter((e) => e.gameId === game.id && e.type === 'game:finished')).toHaveLength(
      1,
    );
    const { rows } = await sql.query<{ status: string; version: number }>(
      'SELECT status, version FROM games WHERE id = $1',
      [game.id],
    );
    expect(rows[0]).toEqual({ status: 'finished', version: 2 });
    const rounds = await sql.query<{ n: number }>(
      'SELECT count(*)::int AS n FROM session_decision_rounds WHERE game_id = $1',
      [game.id],
    );
    expect(rounds.rows[0]?.n).toBe(1);
  });

  // --- Poursuivre / Quitter --------------------------------------------------------------

  it('10 essais : Poursuivre/Quitter simultanés sur deux instances → une seule résolution, cohérente', async () => {
    for (let i = 0; i < 10; i++) {
      const resolved: SessionEvent[] = [];
      const one = instance();
      const two = instance();
      const [a, b, c] = (await players('a', 'b', 'c')) as [PlayerId, PlayerId, PlayerId];
      const { session, game } = await one.sessions.createSession(a, { maxPlayers: 3 });
      await one.sessions.joinSession(session.id, b);
      await one.sessions.joinSession(session.id, c);
      await one.finishGame(game.id);
      await one.sessions.syncSession(session.id);
      for (const inst of [one, two]) {
        inst.sessionEvents.subscribe(
          session.id,
          (e) => e.type === 'session:decision_closed' && resolved.push(e),
        );
      }

      await Promise.all([
        one.sessions.decide(session.id, a, 'continue'),
        two.sessions.decide(session.id, b, 'leave'),
        (i % 2 ? one : two).sessions.decide(session.id, c, 'continue'),
      ]);

      expect(resolved).toHaveLength(1);
      expect(resolved[0]?.payload.continuingPlayerIds).toEqual([a, c]);
      const { rows } = await sql.query<{ player_id: string; seat: number }>(
        'SELECT player_id, seat FROM session_players WHERE session_id = $1 AND active ORDER BY seat',
        [session.id],
      );
      expect(rows).toEqual([
        { player_id: a, seat: 0 },
        { player_id: c, seat: 2 }, // le siège 1 de B est vacant, C n'a pas bougé
      ]);
    }
  });

  it('échéance de décision traitée par deux instances à la fois → un seul départ automatique', async () => {
    const events: SessionEvent[] = [];
    // La ronde est préparée à l'heure réelle ; deux instances « 2 minutes plus tard »
    // (horloge injectée) traitent son échéance en même temps.
    const setup = instance([], { decisionWindowMs: 10_000 });
    const later = () => new Date(Date.now() + 120_000);
    const one = instance([], { decisionWindowMs: 10_000, clock: later });
    const two = instance([], { decisionWindowMs: 10_000, clock: later });
    const [a, b] = (await players('a', 'b')) as [PlayerId, PlayerId];
    const { session, game } = await setup.sessions.createSession(a, { maxPlayers: 2 });
    await setup.sessions.joinSession(session.id, b);
    await setup.finishGame(game.id);
    await setup.sessions.decide(session.id, a, 'continue');
    setup.stop();
    await setup.idle();
    for (const inst of [one, two]) {
      inst.sessionEvents.subscribe(session.id, (e) => events.push(e));
    }

    await Promise.all([
      one.sessions.syncSession(session.id),
      two.sessions.syncSession(session.id),
      two.supervisor.sweep(),
    ]);
    expect(events.filter((e) => e.type === 'session:auto_leave')).toHaveLength(1);
    expect(events.filter((e) => e.type === 'session:decision_closed')).toHaveLength(1);
    expect(await sessionState(session.id)).toEqual({ status: 'open', n: 1 });
  });

  // --- Timer de tour ----------------------------------------------------------------------

  it('10 essais : TURN_TIMEOUT déclenché par deux instances → une expiration, UNE carte automatique', async () => {
    for (let i = 0; i < 10; i++) {
      const events: GameEvent[] = [];
      const setup = instance(events);
      const { a, game } = await startedPair(setup);
      setup.stop(); // seul le test déclenche les expirations
      // Deux instances « après l'échéance » (horloge injectée, aucune attente réelle).
      const after = () => new Date(game.turnDeadlineAt!.getTime() + 1);
      const one = instance(events, { clock: after });
      const two = instance(events, { clock: after });

      await Promise.all([
        one.games.handleTurnTimeout(game.id),
        two.games.handleTurnTimeout(game.id),
        two.supervisor.sweep(),
      ]);
      await Promise.all([one.idle(), two.idle()]);
      const ofGame = (type: string) =>
        events.filter((e) => e.gameId === game.id && e.type === type);
      expect(ofGame('game:turn_timeout')).toHaveLength(1);
      expect(ofGame('game:auto_card_played')).toHaveLength(1);
      expect(ofGame('game:card_played')).toHaveLength(1);
      // J1 ouvre le tour avec COEUR-3,4,5,9,10 : plus petite carte de la main (D-036).
      const { rows } = await sql.query<{
        version: number;
        timed_out: boolean;
        trick: unknown[];
        hand: string[];
      }>(
        `SELECT version, turn_timed_out_at IS NOT NULL AS timed_out,
           state -> 'play' -> 'currentTrick' AS trick,
           state -> 'play' -> 'hands' -> $2::text AS hand
         FROM games WHERE id = $1`,
        [game.id, a],
      );
      expect(rows[0]).toEqual({
        version: game.version + 2,
        timed_out: false,
        trick: [{ playerId: a, cardId: 'COEUR-3' }],
        hand: ['COEUR-4', 'COEUR-5', 'COEUR-9', 'COEUR-10'],
      });
    }
  });

  it('10 essais : coup du joueur contre TURN_TIMEOUT à l’échéance → exactement un des deux', async () => {
    for (let i = 0; i < 10; i++) {
      const events: GameEvent[] = [];
      const setup = instance(events);
      const { a, game } = await startedPair(setup);
      setup.stop();
      const deadline = game.turnDeadlineAt!.getTime();
      // Le joueur joue 1 ms AVANT l'échéance ; le timer d'une autre instance la constate
      // 1 ms APRÈS. Les deux écritures se disputent la même version.
      const player = instance(events, { clock: () => new Date(deadline - 1) });
      const timer = instance(events, { clock: () => new Date(deadline + 1) });

      const [played, timedOut] = await Promise.allSettled([
        player.games.playCard(game.id, a, 'COEUR-3'),
        timer.games.handleTurnTimeout(game.id),
      ]);

      const { rows } = await sql.query<{ timed_out: boolean; trick: unknown[] }>(
        `SELECT turn_timed_out_at IS NOT NULL AS timed_out,
           state -> 'play' -> 'currentTrick' AS trick FROM games WHERE id = $1`,
        [game.id],
      );
      const state = rows[0]!;
      await Promise.all([player.idle(), timer.idle()]);
      const autoPlays = events.filter(
        (e) => e.gameId === game.id && e.type === 'game:auto_card_played',
      );
      // Toujours UNE seule carte jouée : soit celle du joueur (le timeout est alors sans
      // effet), soit celle du coup automatique (le coup du joueur est alors refusé).
      expect(state.trick).toHaveLength(1);
      expect(state.timed_out).toBe(false);
      if (played.status === 'fulfilled') {
        expect(autoPlays).toHaveLength(0);
        expect(
          events.filter((e) => e.gameId === game.id && e.type === 'game:turn_timeout'),
        ).toHaveLength(0);
      } else {
        expect(timedOut.status).toBe('fulfilled');
        expect(autoPlays).toHaveLength(1);
      }
    }
  });

  it('redémarrage : timers de tour et de décision reconstruits depuis PostgreSQL', async () => {
    // Instance 1 : une partie en cours (tour) et une session en ronde de décision, avec des
    // échéances de 60 s. Aucune dépendance au temps réel : l'instance 2 redémarre
    // « maintenant » (échéances futures → timers réarmés), l'instance 3 « 2 minutes plus
    // tard » (horloge injectée) et traite les échéances par son balayage.
    const one = instance([], { turnDurationMs: 60_000, decisionWindowMs: 60_000 });
    const [c] = (await players('c')) as [PlayerId];
    const s = await one.sessions.createSession(c, { maxPlayers: 2 });
    await one.finishGame(s.game.id);
    await one.sessions.syncSession(s.session.id);
    const running = await startedPair(one);
    one.stop(); // arrêt du serveur, avant les deux échéances
    await one.idle();

    // Instance 2 : uniquement la base ; timers reconstruits.
    const two = instance([], { turnDurationMs: 60_000, decisionWindowMs: 60_000 });
    const report = await two.supervisor.recover();
    expect(report.turnTimersScheduled).toBeGreaterThanOrEqual(1);
    expect(report.decisionTimersScheduled).toBeGreaterThanOrEqual(1);
    expect(two.timers.has(running.game.id)).toBe(true);
    expect(two.sessionTimers.has(s.session.id)).toBe(true);
    two.stop();

    // Instance 3, après les échéances : son balayage les traite.
    const later = () => new Date(Date.now() + 120_000);
    const three = instance([], { decisionWindowMs: 60_000, clock: later });
    await three.supervisor.sweep();
    await three.idle();
    // Échéance traitée : TURN_TIMEOUT puis coup automatique (D-036), J1 ouvre avec COEUR-3.
    const game = await sql.query<{ trick: unknown[] }>(
      `SELECT state -> 'play' -> 'currentTrick' AS trick FROM games WHERE id = $1`,
      [running.game.id],
    );
    expect(game.rows[0]?.trick).toEqual([{ playerId: running.a, cardId: 'COEUR-3' }]);
    expect(await sessionState(s.session.id)).toEqual({ status: 'closed', n: 0 });
  });

  it('redémarrage après les échéances : traitées immédiatement et une seule fois', async () => {
    // Les échéances (10 s) sont posées par l'instance 1, qui s'arrête bien avant. Les
    // instances 2 et 3 redémarrent « 2 minutes plus tard » (horloge injectée) : aucune
    // dépendance au temps réel, donc aucune course avec la charge de la machine.
    const one = instance([], { turnDurationMs: 10_000, decisionWindowMs: 10_000 });
    const [c, d] = (await players('c', 'd')) as [PlayerId, PlayerId];
    const s = await one.sessions.createSession(c, { maxPlayers: 2 });
    await one.sessions.joinSession(s.session.id, d);
    await one.finishGame(s.game.id);
    await one.sessions.syncSession(s.session.id);
    await one.sessions.decide(s.session.id, c, 'continue');
    const running = await startedPair(one);
    one.stop();
    await one.idle();
    const { rows: before } = await sql.query<{ timed_out: boolean }>(
      'SELECT turn_timed_out_at IS NOT NULL AS timed_out FROM games WHERE id = $1',
      [running.game.id],
    );
    expect(before[0]?.timed_out).toBe(false);

    const later = () => new Date(Date.now() + 120_000);
    const events: GameEvent[] = [];
    const two = instance(events, { clock: later, decisionWindowMs: 10_000 });
    const three = instance(events, { clock: later, decisionWindowMs: 10_000 });
    await Promise.all([two.supervisor.recover(), three.supervisor.recover()]);

    await Promise.all([two.idle(), three.idle()]);
    expect(
      events.filter((e) => e.gameId === running.game.id && e.type === 'game:turn_timeout'),
    ).toHaveLength(1);
    expect(
      events.filter((e) => e.gameId === running.game.id && e.type === 'game:auto_card_played'),
    ).toHaveLength(1);
    const { rows: after } = await sql.query<{ version: number }>(
      'SELECT version FROM games WHERE id = $1',
      [running.game.id],
    );
    expect(after[0]?.version).toBe(running.game.version + 2);
    const { rows } = await sql.query<{ player_id: string; choice: string }>(
      'SELECT player_id, choice FROM session_decisions WHERE game_id = $1 ORDER BY player_id',
      [s.game.id as GameId],
    );
    expect(rows).toEqual(
      expect.arrayContaining([
        { player_id: c, choice: 'continue' },
        { player_id: d, choice: 'auto_leave' },
      ]),
    );
    expect(await sessionState(s.session.id)).toEqual({ status: 'open', n: 1 });
  });

  // --- Socle de vérité (D-035) ------------------------------------------------------------

  const TIE = deckForHands([
    ['COEUR-9', 'PIQUE-9', 'TREFLE-9', 'COEUR-10', 'TREFLE-10'],
    ['COEUR-8', 'PIQUE-8', 'TREFLE-8', 'COEUR-6', 'PIQUE-6'],
  ] as CardId[][]);

  it('10 essais : égalité de priorité traitée par deux instances → UNE seule reprise', async () => {
    for (let i = 0; i < 10; i++) {
      // L'instance de démarrage tire une égalité ; la reprise est faite par one et two.
      const starter = instance([], { random: decksRandom(TIE) });
      const one = instance();
      const two = instance();
      const [a, b] = (await players('a', 'b')) as [PlayerId, PlayerId];
      const { session, game } = await starter.sessions.createSession(a, { maxPlayers: 2 });
      await starter.joinGame(game.id, b);
      starter.stop(); // aucune reprise par l'instance qui a démarré
      await starter.games.startGame(game.id, a);
      starter.stop();
      await starter.idle();
      await sql.query(
        'DELETE FROM game_players WHERE game_id IN (SELECT id FROM games WHERE replay_of_game_id = $1)',
        [game.id],
      );
      await sql.query('DELETE FROM games WHERE replay_of_game_id = $1', [game.id]);

      await Promise.all([
        one.sessions.syncSession(session.id),
        two.sessions.syncSession(session.id),
      ]);
      const { rows } = await sql.query<{ n: number; first: string }>(
        `SELECT count(*)::int AS n, min(first_player_id::text) AS first
         FROM games WHERE replay_of_game_id = $1`,
        [game.id],
      );
      expect(rows[0]).toEqual({ n: 1, first: a });
    }
  });

  it('10 essais : deux joueurs fuient en même temps sur deux instances → un seul fuyard', async () => {
    for (let i = 0; i < 10; i++) {
      const one = instance();
      const two = instance();
      const [a, b, c] = (await players('a', 'b', 'c')) as [PlayerId, PlayerId, PlayerId];
      const { game } = await one.sessions.createSession(a, { maxPlayers: 3 });
      await one.joinGame(game.id, b);
      await one.joinGame(game.id, c);
      await one.startGame(game.id, a);

      const results = await Promise.allSettled([
        one.games.flee(game.id, b),
        two.games.flee(game.id, c),
      ]);
      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
      const { rows } = await sql.query<{ n: number }>(
        'SELECT count(*)::int AS n FROM game_players WHERE game_id = $1 AND fled_at IS NOT NULL',
        [game.id],
      );
      expect(rows[0]?.n).toBe(1);
    }
  });

  it('10 essais : double déclaration de victoire instantanée → une seule victoire', async () => {
    for (let i = 0; i < 10; i++) {
      const events: GameEvent[] = [];
      // Distribution « identité » : a = 5 cœurs (rang 3), seule main gagnante.
      const one = instance(events);
      const two = instance(events);
      const [a, b] = (await players('a', 'b')) as [PlayerId, PlayerId];
      const { game } = await one.sessions.createSession(a, { maxPlayers: 2 });
      await one.joinGame(game.id, b);
      await one.startGame(game.id, a);

      const results = await Promise.allSettled([
        one.games.declareWin(game.id, a),
        two.games.declareWin(game.id, a),
      ]);
      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
      expect(events.filter((e) => e.gameId === game.id && e.type === 'game:finished')).toHaveLength(
        1,
      );
      const { rows } = await sql.query<{ end_reason: string; winner_id: string }>(
        'SELECT end_reason, winner_id FROM games WHERE id = $1',
        [game.id],
      );
      expect(rows[0]).toEqual({ end_reason: 'INSTANT_WIN', winner_id: a });
    }
  });
});
