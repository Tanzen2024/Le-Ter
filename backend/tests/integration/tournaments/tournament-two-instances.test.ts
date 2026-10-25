import { GameVersionConflictError } from '../../../src/domain/game/game-errors';
import type { GameId, PlayerId } from '../../../src/domain/game/game-id';
import { type Tournament, TournamentBusyError } from '../../../src/domain/tournaments/tournament';
import type { UserId } from '../../../src/domain/users/user';
import {
  createMigratedDatabase,
  PGLITE_TIMEOUT_MS,
  type TestDatabase,
} from '../../fixtures/pglite';
import {
  createTournamentTestStack,
  fillWith,
  HOUR,
  seedAdmin,
  seedPlayers,
  TestClock,
  tournamentInput,
  type TournamentTestStack,
} from '../../fixtures/tournaments';

/**
 * Deux instances du backend sur la même base (régression trouvée sur PostgreSQL réel) : la
 * place de session est sérialisée par le verrou de la session, mais l'entrée dans la partie
 * ne l'est que par instance ; entre instances, la version optimiste fait perdre une écriture.
 * Le perdant relit la table et réessaie ; à bout d'essais, TOURNAMENT_BUSY, et sa place de
 * session est libérée (jamais assis sans jouer). Sans TEST_DATABASE_URL : PGlite.
 */
jest.setTimeout(120_000);

let database: TestDatabase;
let a: TournamentTestStack;
let b: TournamentTestStack;
let players: UserId[];
let tournament: Tournament;

beforeAll(async () => {
  database = await createMigratedDatabase();
}, PGLITE_TIMEOUT_MS);
afterAll(() => database.close());
beforeEach(async () => {
  const clock = new TestClock();
  a = createTournamentTestStack(database.sql, clock, { gameClock: true });
  b = createTournamentTestStack(database.sql, clock, { gameClock: true });
  players = await seedPlayers(
    database.sql,
    ['ana', 'ben', 'cid', 'dan', 'eve', 'fil', 'gus', 'hal'],
    5000,
  );
  const admin = await seedAdmin(database.sql);
  const t = await a.tournaments.createAsAdmin(admin, tournamentInput(clock, HOUR));
  for (const p of players) await a.tournaments.register(t.id, p);
  await fillWith(a, database.sql, t.id);
  clock.set(t.startsAt);
  tournament = await a.tournaments.advance(t.id);
  expect(tournament.status).toBe('IN_PROGRESS');
});
afterEach(async () => {
  jest.restoreAllMocks();
  await a.stop();
  await b.stop();
  await database.reset();
});

const pid = (i: number) => players[i]! as string as PlayerId;
const gamePlayers = async (gameId: string) =>
  (await a.games.findGame(gameId as GameId))!.players.map((p) => p.playerId);
const activeSeats = async (i: number) =>
  (
    await database.sql.query<{ n: number }>(
      'SELECT count(*)::int AS n FROM session_players WHERE player_id = $1 AND active',
      [players[i]],
    )
  ).rows[0]!.n;

it('arrivées simultanées sur deux instances : tables de 4, chaque place de session a sa place en partie', async () => {
  const seats = await Promise.all(
    players.map((p, i) => (i % 2 === 0 ? a : b).tournaments.join(tournament.id, p)),
  );
  const tables = new Map<string, number>();
  for (const s of seats) tables.set(s.gameId, (tables.get(s.gameId) ?? 0) + 1);
  expect([...tables.values()].sort()).toEqual([4, 4]);
  for (const [gameId] of tables) {
    const seated = await gamePlayers(gameId);
    expect(seated).toHaveLength(4);
    expect(new Set(seated).size).toBe(4);
  }
  for (let i = 0; i < players.length; i += 1) {
    expect(await gamePlayers(seats[i]!.gameId)).toContain(pid(i));
    expect(await activeSeats(i)).toBe(1);
  }
});

it('table en attente : siège et place dans la partie en une fois (D-153), sans second appel', async () => {
  const first = await a.tournaments.join(tournament.id, players[0]!);
  const spy = jest.spyOn(b.games, 'joinGame');

  const seat = await b.tournaments.join(tournament.id, players[1]!);
  expect(seat.gameId).toBe(first.gameId);
  // La place est prise par l'arrivée elle-même, sous le verrou de la partie et de la session.
  expect(spy).not.toHaveBeenCalled();
  expect(await gamePlayers(first.gameId)).toEqual([pid(0), pid(1)]);
  expect(await activeSeats(1)).toBe(1);
});

it('conflit sur la partie à l’arrivée : TOURNAMENT_BUSY, ni siège ni place, nouvel essai possible', async () => {
  const first = await a.tournaments.join(tournament.id, players[0]!);
  const spy = jest
    .spyOn(b.games, 'buildWaitingGameArrival')
    .mockImplementation((game) => {
      throw new GameVersionConflictError(game.id, 1, 2);
    });

  await expect(b.tournaments.join(tournament.id, players[1]!)).rejects.toBeInstanceOf(
    TournamentBusyError,
  );
  expect(spy).toHaveBeenCalled();
  expect(await gamePlayers(first.gameId)).toEqual([pid(0)]);
  expect(await activeSeats(1)).toBe(0);

  spy.mockRestore();
  const again = await b.tournaments.join(tournament.id, players[1]!);
  expect(again.gameId).toBe(first.gameId);
  expect(await gamePlayers(first.gameId)).toEqual([pid(0), pid(1)]);
});

it('partie démarrée entre la recherche de la table et l’arrivée : table suivante, sans erreur ni place fantôme', async () => {
  const first = await a.tournaments.join(tournament.id, players[0]!);
  await a.tournaments.join(tournament.id, players[1]!);
  // La table est trouvée « en attente », puis l'autre instance la démarre avant l'arrivée.
  const joinSession = b.sessions.joinSession.bind(b.sessions);
  jest
    .spyOn(b.sessions, 'joinSession')
    .mockImplementationOnce(async (...args) => {
      await a.games.startGame(first.gameId as GameId, pid(0));
      return joinSession(...args);
    })
    .mockImplementation(joinSession);

  const seat = await b.tournaments.join(tournament.id, players[2]!);
  expect(seat.sessionId).not.toBe(first.sessionId);
  expect(await gamePlayers(seat.gameId)).toEqual([pid(2)]);
  expect(await gamePlayers(first.gameId)).toEqual([pid(0), pid(1)]);
  expect(await activeSeats(2)).toBe(1);
});
