import request from 'supertest';

import {
  GameAlreadyStartedError,
  GameFullError,
  GameStartForbiddenError,
} from '../../../src/domain/game/game-errors';
import type { GameId, PlayerId } from '../../../src/domain/game/game-id';
import { toPlayerView } from '../../../src/domain/game/game-view';
import {
  TOURNAMENT_TABLE_AUTO_START_MS,
  type Tournament,
} from '../../../src/domain/tournaments/tournament';
import type { UserId } from '../../../src/domain/users/user';
import { DeadlineSupervisor } from '../../../src/services/timers/deadline-supervisor';
import { createLogger } from '../../../src/utils/logger';
import { registerAndLogin } from '../../fixtures/auth';
import {
  createMigratedDatabase,
  PGLITE_TIMEOUT_MS,
  type TestDatabase,
} from '../../fixtures/pglite';
import {
  createTournamentTestStack,
  fillWith,
  fund,
  HOUR,
  MINUTE,
  seedAdmin,
  seedPlayers,
  TestClock,
  tournamentInput,
  type TournamentTestStack,
} from '../../fixtures/tournaments';

/**
 * Tables de tournoi (D-065) : tables de 4 créées et attribuées par le serveur, la plus
 * remplie d'abord ; dès le 2e joueur, le premier joueur affecté (créateur de la partie) a
 * 10 s pour démarrer, puis le SERVEUR démarre la partie. Échéance persistée
 * (`games.start_deadline_at`), jamais repoussée par les arrivées suivantes, reprise après
 * un redémarrage ; une seule transition waiting → in_progress, même en concurrence.
 * Toutes les échéances sont mesurées sur l'horloge de test (parties comprises).
 */
jest.setTimeout(60_000);

const SECOND = 1000;
const logger = createLogger({}, () => undefined);

let database: TestDatabase;
let stack: TournamentTestStack;
let players: UserId[];
let tournament: Tournament;

beforeAll(async () => {
  database = await createMigratedDatabase();
}, PGLITE_TIMEOUT_MS);
afterAll(() => database.close());
beforeEach(async () => {
  stack = createTournamentTestStack(database.sql, new TestClock(), { gameClock: true });
  players = await seedPlayers(database.sql, ['ana', 'ben', 'cid', 'dan', 'eve', 'fil'], 5000);
  const admin = await seedAdmin(database.sql);
  const t = await stack.tournaments.createAsAdmin(admin, tournamentInput(stack.clock, HOUR));
  for (const p of players) await stack.tournaments.register(t.id, p);
  await fillWith(stack, database.sql, t.id);
  stack.clock.set(t.startsAt);
  tournament = await stack.tournaments.advance(t.id);
  expect(tournament.status).toBe('IN_PROGRESS');
});
afterEach(async () => {
  await stack.stop();
  await database.reset();
});

const [ANA, BEN, CID, DAN, EVE, FIL] = [0, 1, 2, 3, 4, 5];
const pid = (i: number) => players[i]! as string as PlayerId;
const join = (i: number) => stack.tournaments.join(tournament.id, players[i]!);
const game = async (id: GameId) => (await stack.games.findGame(id))!;
const storedDeadline = async (id: GameId) =>
  (
    await database.sql.query<{ start_deadline_at: Date | null }>(
      'SELECT start_deadline_at FROM games WHERE id = $1',
      [id],
    )
  ).rows[0]?.start_deadline_at ?? null;

describe('affectation automatique', () => {
  it('un joueur seul : table de 4 créée par le serveur, en attente, sans compte à rebours', async () => {
    const seat = await join(ANA);
    const g = await game(seat.gameId);
    expect(g).toMatchObject({ status: 'waiting', maxPlayers: 4, creatorId: pid(ANA) });
    expect(g.autoStartDelayMs).toBe(TOURNAMENT_TABLE_AUTO_START_MS);
    expect(g.startDeadlineAt).toBeUndefined();
    expect(toPlayerView(g, pid(ANA))).toMatchObject({ autoStart: true });
    expect(toPlayerView(g, pid(ANA)).startDeadlineAt).toBeUndefined();

    // Même longtemps après : aucun démarrage tant qu'il est seul.
    stack.clock.advance(5 * MINUTE);
    expect((await stack.games.handleStartDeadline(seat.gameId)).status).toBe('waiting');
  });

  it('rejoindre deux fois (nouvelle tentative réseau) : même place, aucune double affectation', async () => {
    const first = await join(ANA);
    const again = await join(ANA);
    expect(again).toEqual(first);
    expect((await game(first.gameId)).players).toHaveLength(1);
  });

  it('table complète à 4 : le 5e joueur ouvre une nouvelle table, la partie pleine refuse un 5e', async () => {
    const a = await join(ANA);
    for (const i of [BEN, CID, DAN]) expect((await join(i)).sessionId).toBe(a.sessionId);
    expect((await game(a.gameId)).players).toHaveLength(4);

    const e = await join(EVE);
    expect(e.sessionId).not.toBe(a.sessionId);
    expect(await game(e.gameId)).toMatchObject({ creatorId: pid(EVE), status: 'waiting' });
    await expect(stack.games.joinGame(a.gameId, pid(EVE))).rejects.toBeInstanceOf(GameFullError);
  });

  it('priorité à la table la plus remplie (puis la plus ancienne)', async () => {
    const a = await join(ANA);
    for (const i of [BEN, CID, DAN]) await join(i);
    const b = await join(EVE); // A pleine : nouvelle table B (1 joueur)
    await stack.sessions.leaveSession(a.sessionId, pid(DAN)); // A : 3 joueurs, B : 1
    expect((await join(FIL)).sessionId).toBe(a.sessionId);
    expect((await game(b.gameId)).players).toHaveLength(1);
  });

  it('table démarrée : aucune nouvelle affectation, le joueur suivant ouvre une autre table', async () => {
    const a = await join(ANA);
    await join(BEN);
    await stack.games.startGame(a.gameId, pid(ANA));
    const c = await join(CID);
    expect(c.sessionId).not.toBe(a.sessionId);
    expect((await game(a.gameId)).players.map((p) => p.playerId)).toEqual([pid(ANA), pid(BEN)]);
  });
});

describe('délai de démarrage de 10 s', () => {
  it('arrivée du 2e joueur : échéance persistée à +10 s, visible de tous ; démarrage réservé au premier joueur', async () => {
    expect(TOURNAMENT_TABLE_AUTO_START_MS).toBe(10_000); // D-092 (15 s auparavant)
    const a = await join(ANA);
    const joinedAt = stack.clock.now().getTime();
    await join(BEN);
    const g = await game(a.gameId);
    expect(g.startDeadlineAt?.getTime()).toBe(joinedAt + TOURNAMENT_TABLE_AUTO_START_MS);
    expect((await storedDeadline(a.gameId))?.getTime()).toBe(
      joinedAt + TOURNAMENT_TABLE_AUTO_START_MS,
    );
    expect(toPlayerView(g, pid(BEN)).startDeadlineAt).toEqual(g.startDeadlineAt);
    await expect(stack.games.startGame(a.gameId, pid(BEN))).rejects.toBeInstanceOf(
      GameStartForbiddenError,
    );
  });

  it('3e et 4e arrivées : le délai n’est jamais réinitialisé', async () => {
    const a = await join(ANA);
    await join(BEN);
    const deadline = (await game(a.gameId)).startDeadlineAt!;
    stack.clock.advance(5 * SECOND);
    await join(CID);
    stack.clock.advance(5 * SECOND);
    await join(DAN);
    expect((await game(a.gameId)).startDeadlineAt).toEqual(deadline);
  });

  it('démarrage manuel immédiat par le premier joueur : échéance retirée, le timer n’a plus d’effet', async () => {
    const a = await join(ANA);
    await join(BEN);
    stack.clock.advance(3 * SECOND);
    const started = await stack.games.startGame(a.gameId, pid(ANA));
    expect(started.status).toBe('in_progress');
    expect(started.startDeadlineAt).toBeUndefined();
    expect(await storedDeadline(a.gameId)).toBeNull();

    stack.clock.advance(30 * SECOND);
    const after = await stack.games.handleStartDeadline(a.gameId);
    expect(after.version).toBe(started.version);
  });

  it('démarrage automatique à l’échéance exacte, pas avant (2 et 3 joueurs)', async () => {
    const a = await join(ANA);
    await join(BEN);
    await join(CID);
    stack.clock.advance(TOURNAMENT_TABLE_AUTO_START_MS - 1);
    expect((await stack.games.handleStartDeadline(a.gameId)).status).toBe('waiting');
    stack.clock.advance(1);
    const started = await stack.games.handleStartDeadline(a.gameId);
    expect(started.status).toBe('in_progress');
    expect(started.players).toHaveLength(3);
    expect(started.play?.dealOrder).toHaveLength(3);
  });

  it('démarrage manuel et automatique simultanés : une seule transition réussit', async () => {
    const a = await join(ANA);
    await join(BEN);
    stack.clock.advance(TOURNAMENT_TABLE_AUTO_START_MS);
    const before = (await game(a.gameId)).version;
    const outcomes = await Promise.allSettled([
      stack.games.startGame(a.gameId, pid(ANA)),
      stack.games.handleStartDeadline(a.gameId),
      stack.games.handleStartDeadline(a.gameId),
    ]);
    for (const o of outcomes) {
      if (o.status === 'rejected') expect(o.reason).toBeInstanceOf(GameAlreadyStartedError);
    }
    const g = await game(a.gameId);
    expect(g.status).toBe('in_progress');
    expect(g.version).toBe(before + 1);
  });

  it('premier joueur déconnecté : le serveur démarre quand même (aucun client requis)', async () => {
    const a = await join(ANA);
    await join(BEN);
    // Aucune action d'ana, aucun client abonné : seule la reprise du serveur agit.
    stack.clock.advance(TOURNAMENT_TABLE_AUTO_START_MS);
    const supervisor = new DeadlineSupervisor({
      games: stack.games,
      sessions: stack.sessions,
      logger,
      clock: stack.clock.now,
    });
    await supervisor.sweep();
    expect((await game(a.gameId)).status).toBe('in_progress');
  });

  it('redémarrage du backend : échéance reconstruite depuis PostgreSQL (future → timer, passée → démarrage)', async () => {
    const a = await join(ANA);
    await join(BEN);
    await stack.stop(); // « arrêt » : plus aucun timer en mémoire

    const restarted = createTournamentTestStack(database.sql, stack.clock, { gameClock: true });
    try {
      const supervisor = new DeadlineSupervisor({
        games: restarted.games,
        sessions: restarted.sessions,
        logger,
        clock: stack.clock.now,
      });
      // Avant l'échéance (relatif au délai réel) : le timer est réarmé.
      stack.clock.advance(TOURNAMENT_TABLE_AUTO_START_MS - 5 * SECOND);
      const early = await supervisor.recover();
      expect(early.startTimersScheduled).toBe(1);
      expect((await game(a.gameId)).status).toBe('waiting');

      // Échéance dépassée : le serveur démarre la partie.
      stack.clock.advance(10 * SECOND);
      const due = await supervisor.recover();
      expect(due.startDeadlinesProcessed).toBe(1);
      expect((await game(a.gameId)).status).toBe('in_progress');
    } finally {
      await restarted.stop();
    }
  });

  it('départ du premier joueur : à 2, plus de compte à rebours ; à 3, le droit passe au suivant sans réinitialiser le délai', async () => {
    const a = await join(ANA);
    await join(BEN);
    await stack.sessions.leaveSession(a.sessionId, pid(ANA));
    const alone = await game(a.gameId);
    expect(alone.players).toHaveLength(1);
    expect(alone.startDeadlineAt).toBeUndefined();
    expect(await storedDeadline(a.gameId)).toBeNull();

    // Nouveau 2e joueur : nouvelle échéance ; puis un 3e ; le premier affecté (ben) part.
    await join(CID);
    const deadline = (await game(a.gameId)).startDeadlineAt!;
    expect(deadline.getTime()).toBe(stack.clock.now().getTime() + TOURNAMENT_TABLE_AUTO_START_MS);
    await join(DAN);
    await stack.sessions.leaveSession(a.sessionId, pid(BEN));
    const g = await game(a.gameId);
    expect(g.startDeadlineAt).toEqual(deadline);
    expect(g.creatorId).toBe(pid(CID));
    expect((await stack.games.startGame(a.gameId, pid(CID))).status).toBe('in_progress');
  });
});

describe('parties privées inchangées', () => {
  it('aucun délai ni démarrage automatique hors tournoi', async () => {
    const [x, y] = await seedPlayers(database.sql, ['xav', 'yan'], 0);
    const { game: created } = await stack.sessions.createSession(x as string as PlayerId, {
      maxPlayers: 2,
    });
    await stack.sessions.joinSession(created.sessionId!, y as string as PlayerId);
    const joined = await stack.games.joinGame(created.id, y as string as PlayerId);
    expect(joined.autoStartDelayMs).toBeUndefined();
    expect(joined.startDeadlineAt).toBeUndefined();
    expect(toPlayerView(joined, y as string as PlayerId).autoStart).toBeUndefined();
    stack.clock.advance(HOUR);
    expect((await stack.games.handleStartDeadline(created.id)).status).toBe('waiting');
  });
});

describe('liste des tournois (GET /api/tournaments)', () => {
  it('publiés à venir et en cours, début le plus proche d’abord ; brouillons exclus ; mon inscription', async () => {
    const session = await registerAndLogin(stack.app);
    const me = session.userId as UserId;
    await fund(database.sql, me, 5000);
    const admin = await seedAdmin(database.sql, 'admin2');
    // Deux tournois à venir (créés dans le désordre), après celui en cours.
    const later = await stack.tournaments.createAsAdmin(
      admin,
      tournamentInput(stack.clock, 8 * HOUR),
    );
    const sooner = await stack.tournaments.createAsAdmin(
      admin,
      tournamentInput(stack.clock, 4 * HOUR),
    );
    await stack.tournaments.register(sooner.id, me);
    // Brouillon d'un joueur : jamais listé.
    await stack.tournaments.createAsPlayer(me, tournamentInput(stack.clock, 12 * HOUR));

    const res = await request(stack.app)
      .get('/api/tournaments')
      .set('Authorization', `Bearer ${session.accessToken}`)
      .expect(200);
    const list = res.body.tournaments as {
      tournamentId: string;
      status: string;
      registration: unknown;
      registeredCount: number;
    }[];
    expect(list.map((t) => t.tournamentId)).toEqual([tournament.id, sooner.id, later.id]);
    expect(list.map((t) => t.status)).toEqual([
      'IN_PROGRESS',
      'REGISTRATION_OPEN',
      'REGISTRATION_OPEN',
    ]);
    expect(list[1]).toMatchObject({ registration: { status: 'REGISTERED' }, registeredCount: 1 });
    expect(list[2]).toMatchObject({ registration: null, registeredCount: 0 });
    expect(res.body.history).toEqual([]);
    expect(typeof res.body.serverNow).toBe('string');
  });
});
