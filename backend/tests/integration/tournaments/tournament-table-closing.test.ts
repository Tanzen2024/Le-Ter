import type { GameId, PlayerId } from '../../../src/domain/game/game-id';
import { SessionClosedError, type SessionId } from '../../../src/domain/sessions/session';
import type { Tournament } from '../../../src/domain/tournaments/tournament';
import type { UserId } from '../../../src/domain/users/user';
import { tournamentTableContinuation } from '../../../src/services/tournaments/tournament-admission';
import {
  createMigratedDatabase,
  PGLITE_TIMEOUT_MS,
  type TestDatabase,
} from '../../fixtures/pglite';
import { identityRandom } from '../../fixtures/random';
import {
  createTournamentTestStack,
  fillWith,
  saveTournamentSettings,
  HOUR,
  MINUTE,
  seedAdmin,
  seedPlayers,
  TestClock,
  tournamentInput,
  type TournamentTestStack,
} from '../../fixtures/tournaments';

/**
 * Fin d'un tournoi et tables (D-056) : pendant le tournoi, « Poursuivre » enchaîne la partie
 * suivante (D-042) ; après la fin, aucune nouvelle partie n'est créée et les joueurs encore
 * assis sont informés, tandis qu'une partie commencée avant la fin est toujours réglée dans
 * le délai de grâce (D-054).
 */
jest.setTimeout(60_000);

let database: TestDatabase;
let stack: TournamentTestStack;
let players: UserId[];

beforeAll(async () => {
  database = await createMigratedDatabase();
}, PGLITE_TIMEOUT_MS);
afterAll(() => database.close());
beforeEach(async () => {
  stack = createTournamentTestStack(database.sql, new TestClock(), {
    autoNextGame: true, // comportement de production (D-042)
    random: identityRandom,
  });
  players = await seedPlayers(database.sql, ['ana', 'ben'], 5000);
  await saveTournamentSettings(database.sql);
});
afterEach(async () => {
  await stack.stop();
  await database.reset();
});

const pid = (i: number) => players[i]! as string as PlayerId;

/** Distribution « identité » à 2 : le 2e joueur prend le contrôle et gagne (D-035). */
const SECOND_WINS: [0 | 1, string][] = [
  [0, 'COEUR-3'],
  [1, 'COEUR-6'],
  [1, 'PIQUE-3'],
  [0, 'COEUR-9'],
  [1, 'PIQUE-4'],
  [0, 'COEUR-10'],
  [1, 'COEUR-7'],
  [0, 'COEUR-4'],
];

async function startedTournament(): Promise<Tournament> {
  const admin = await seedAdmin(database.sql);
  const t = await stack.tournaments.createAsAdmin(admin, tournamentInput(stack.clock, HOUR));
  for (const p of players) await stack.tournaments.register(t.id, p);
  await fillWith(stack, database.sql, t.id); // minimum de 20 participants (D-057)
  stack.clock.set(t.startsAt);
  return stack.tournaments.advance(t.id);
}

/** Table du tournoi, partie jouée jusqu'au bout ; `beforeLastCard` s'exécute avant la dernière carte. */
async function playToTheEnd(t: Tournament, beforeLastCard?: () => void) {
  const seat = await stack.tournaments.join(t.id, players[0]!);
  await stack.tournaments.join(t.id, players[1]!);
  await stack.games.startGame(seat.gameId as GameId, pid(0));
  for (const [index, [who, cardId]] of SECOND_WINS.entries()) {
    if (index === SECOND_WINS.length - 1) beforeLastCard?.();
    await stack.games.playCard(seat.gameId as GameId, pid(who), cardId);
  }
  await stack.tournaments.idle();
  await stack.sessions.idle();
  return { sessionId: seat.sessionId as SessionId, gameId: seat.gameId as GameId };
}

async function bothContinue(sessionId: SessionId) {
  await stack.sessions.decide(sessionId, pid(0), 'continue');
  await stack.sessions.decide(sessionId, pid(1), 'continue');
  await stack.sessions.idle();
}

const lastGameId = async (sessionId: SessionId) =>
  (await stack.sessions.getSession(sessionId, pid(0))).lastGame?.gameId;

const settlement = async (gameId: string) =>
  (
    await database.sql.query<{ status: string; winner_id: string | null }>(
      'SELECT status, winner_id FROM tournament_games WHERE game_id = $1',
      [gameId],
    )
  ).rows[0];

const notificationTypes = async (user: UserId) =>
  (await stack.notifications.list(user)).notifications.map((n) => n.type);

it('pendant le tournoi : « Poursuivre » enchaîne la partie suivante à la même table', async () => {
  const t = await startedTournament();
  const { sessionId, gameId } = await playToTheEnd(t);
  expect(await settlement(gameId)).toEqual({ status: 'SETTLED', winner_id: players[1] });
  await bothContinue(sessionId);
  expect(await lastGameId(sessionId)).not.toBe(gameId);
});

it('après la fin : partie commencée avant la fin réglée (grâce), aucune nouvelle partie, joueurs informés', async () => {
  const t = await startedTournament();
  // La dernière carte est jouée après la fin du tournoi, dans le délai de grâce.
  const { sessionId, gameId } = await playToTheEnd(t, () =>
    stack.clock.set(new Date(t.endsAt.getTime() + MINUTE)),
  );
  expect(await settlement(gameId)).toEqual({ status: 'SETTLED', winner_id: players[1] });
  expect((await stack.repository.findAccount(t.id, players[1]!))!.currentTokens).toBe(1100);

  await bothContinue(sessionId);
  expect(await lastGameId(sessionId)).toBe(gameId); // aucune nouvelle partie
  for (const p of players) {
    expect(await notificationTypes(p)).toContain('TOURNAMENT_TABLE_CLOSED');
  }
  // Notification unique même si la ronde est resynchronisée.
  await stack.sessions.syncSession(sessionId);
  await stack.sessions.idle();
  const closed = (await stack.notifications.list(players[0]!)).notifications.filter(
    (n) => n.type === 'TOURNAMENT_TABLE_CLOSED',
  );
  expect(closed).toHaveLength(1);
});

it('après la fin : la partie suivante demandée explicitement est refusée (SESSION_CLOSED)', async () => {
  const t = await startedTournament();
  const { sessionId } = await playToTheEnd(t);
  stack.clock.set(t.endsAt);
  await expect(
    stack.sessions.createNextGame(sessionId, pid(1), { creationKey: 'next-after-end-1' }),
  ).rejects.toBeInstanceOf(SessionClosedError);
});

it('les tables ordinaires enchaînent toujours (politique sans effet hors tournoi)', async () => {
  expect(
    await stack.sessions.createSession(pid(0), { maxPlayers: 2 }).then(({ session }) => session.id),
  ).toBeDefined();
  // La politique laisse passer toute session qui n'appartient à aucun tournoi.
  const policy = tournamentTableContinuation(stack.repository, stack.clock.now);
  const [ordinary] = await stack.sessions.findActiveSessions(pid(0));
  expect(await policy.allowsNewGame(ordinary!.id)).toBe(true);
});
