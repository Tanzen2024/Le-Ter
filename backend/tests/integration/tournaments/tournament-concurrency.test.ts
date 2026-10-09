import type { PlayerId } from '../../../src/domain/game/game-id';
import {
  TournamentTableAvailableError,
  TournamentTableRefusedError,
  type Tournament,
} from '../../../src/domain/tournaments/tournament';
import type { UserId } from '../../../src/domain/users/user';
import { TournamentService } from '../../../src/services/tournaments/tournament.service';
import { createLogger } from '../../../src/utils/logger';
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
 * Attribution des tables d'un tournoi (D-054) sous concurrence, comme avec PLUSIEURS
 * instances du serveur (deux TournamentService indépendants : files en mémoire distinctes,
 * même base) : une seule table ouverte quand une suffit, création et rattachement au tournoi
 * atomiques, jamais de table ordinaire intermédiaire.
 */
jest.setTimeout(60_000);

let database: TestDatabase;
let stack: TournamentTestStack;
/** Seconde « instance » : même base, même SessionService, file de tables indépendante. */
let other: TournamentService;
let players: UserId[];

beforeAll(async () => {
  database = await createMigratedDatabase();
}, PGLITE_TIMEOUT_MS);
afterAll(() => database.close());
beforeEach(async () => {
  stack = createTournamentTestStack(database.sql, new TestClock());
  other = new TournamentService({
    tournaments: stack.repository,
    sessions: stack.sessions,
    games: stack.games,
    logger: createLogger({}, () => undefined),
    clock: stack.clock.now,
  });
  players = await seedPlayers(database.sql, ['p1', 'p2', 'p3', 'p4', 'p5'], 5000);
});
afterEach(async () => {
  await stack.stop();
  await database.reset();
});

const pid = (i: number) => players[i]! as string as PlayerId;

async function started(): Promise<Tournament> {
  const admin = await seedAdmin(database.sql);
  const t = await stack.tournaments.createAsAdmin(admin, tournamentInput(stack.clock, HOUR));
  for (const p of players) await stack.tournaments.register(t.id, p);
  await fillWith(stack, database.sql, t.id); // minimum de 20 participants (D-057)
  stack.clock.set(t.startsAt);
  return stack.tournaments.advance(t.id);
}

const tablesOf = async (tournamentId: string) =>
  (
    await database.sql.query<{ session_id: string }>(
      'SELECT session_id FROM tournament_sessions WHERE tournament_id = $1',
      [tournamentId],
    )
  ).rows.map((r) => r.session_id);

/** Sessions sans rattachement : aucune ne doit exister quand seules des tables de tournoi ont été créées. */
const orphanSessions = async () =>
  Number(
    (
      await database.sql.query<{ n: number }>(
        `SELECT count(*)::int AS n FROM sessions s
         WHERE NOT EXISTS (SELECT 1 FROM tournament_sessions ts WHERE ts.session_id = s.id)`,
      )
    ).rows[0]!.n,
  );

describe('allocation simultanée (plusieurs instances)', () => {
  it('deux joueurs arrivant en même temps sur deux instances partagent UNE table', async () => {
    const t = await started();
    const [a, b] = await Promise.all([
      stack.tournaments.join(t.id, players[0]!),
      other.join(t.id, players[1]!),
    ]);
    expect(a.sessionId).toBe(b.sessionId);
    expect(a.gameId).toBe(b.gameId);
    expect(await tablesOf(t.id)).toEqual([a.sessionId]);
    const game = (await stack.games.findGame(a.gameId))!;
    expect(game.players.map((p) => p.playerId).sort()).toEqual([pid(0), pid(1)].sort());
  });

  it('quatre arrivées simultanées sur deux instances : une table pleine, aucune corruption', async () => {
    const t = await started();
    const seats = await Promise.all(
      [0, 1, 2, 3].map((i) => (i % 2 === 0 ? stack.tournaments : other).join(t.id, players[i]!)),
    );
    expect(new Set(seats.map((s) => s.sessionId)).size).toBe(1);
    const [table] = await tablesOf(t.id);
    const { session } = await stack.sessions.getSession(table as never, pid(0));
    expect(session.players.filter((p) => p.active)).toHaveLength(4);
    expect(new Set(session.players.map((p) => p.seat)).size).toBe(4); // sièges distincts
    const fifth = await other.join(t.id, players[4]!);
    expect(fifth.sessionId).not.toBe(table);
    expect(await tablesOf(t.id)).toHaveLength(2);
    expect(await orphanSessions()).toBe(0);
  });
});

describe('atomicité création de table → tournoi', () => {
  it('une table de tournoi est rattachée dans la même transaction que sa création', async () => {
    const t = await started();
    const seat = await stack.tournaments.join(t.id, players[0]!);
    expect(await tablesOf(t.id)).toEqual([seat.sessionId]);
    expect(await orphanSessions()).toBe(0);
    expect(await stack.sessions.listOpenTables(pid(4))).toEqual([]);
  });

  it('création refusée sous verrou (tournoi plus en cours) : rien n’est écrit', async () => {
    const t = await started();
    stack.clock.set(t.endsAt);
    await stack.tournaments.advance(t.id); // clôture
    await expect(
      stack.sessions.createSession(pid(0), { maxPlayers: 4, tournamentId: t.id }),
    ).rejects.toBeInstanceOf(TournamentTableRefusedError);
    expect(await tablesOf(t.id)).toEqual([]);
    expect(await stack.sessions.findActiveSessions(pid(0))).toEqual([]);
    expect(
      Number(
        (await database.sql.query<{ n: number }>('SELECT count(*)::int AS n FROM sessions'))
          .rows[0]!.n,
      ),
    ).toBe(0);
  });

  it('une table joignable existe déjà : la création est refusée (rejoindre celle-ci), rien n’est écrit', async () => {
    const t = await started();
    const first = await stack.tournaments.join(t.id, players[0]!);
    await expect(
      stack.sessions.createSession(pid(1), { maxPlayers: 4, tournamentId: t.id }),
    ).rejects.toBeInstanceOf(TournamentTableAvailableError);
    expect(await tablesOf(t.id)).toEqual([first.sessionId]);
    expect(await stack.sessions.findActiveSessions(pid(1))).toEqual([]);
  });

  it('les tables ordinaires restent inchangées (aucun rattachement, toujours listées)', async () => {
    const { session } = await stack.sessions.createSession(pid(0), { maxPlayers: 2 });
    expect(await orphanSessions()).toBe(1);
    expect((await stack.sessions.listOpenTables(pid(1))).map((x) => x.sessionId)).toEqual([
      session.id,
    ]);
  });
});
