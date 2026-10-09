import type { PlayerId } from '../../../src/domain/game/game-id';
import { PlayerInActiveGameError } from '../../../src/domain/sessions/session';
import type { Tournament } from '../../../src/domain/tournaments/tournament';
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
 * « Annuler la recherche » d'une table de tournoi : le client réutilise le départ de session
 * existant (`SessionService.leaveSession`, D-037), aucun second mécanisme de sortie. On
 * vérifie ici ce que ce chemin garantit pour une table de tournoi (D-065) : place libérée
 * une seule fois, inscription, réservation et compte de tournoi intacts, partie démarrée
 * jamais annulée, et une seule issue quand le départ et le démarrage se croisent.
 */
jest.setTimeout(60_000);

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
  players = await seedPlayers(database.sql, ['ana', 'ben', 'cid'], 5000);
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

const [ANA, BEN, CID] = [0, 1, 2];
const pid = (i: number) => players[i]! as string as PlayerId;
const join = (i: number) => stack.tournaments.join(tournament.id, players[i]!);
const players$ = async (gameId: string) =>
  (await stack.games.findGame(gameId as never))!.players.map((p) => p.playerId);
const wallet = async (i: number) =>
  (
    await database.sql.query<{ balance: string; reserved: string }>(
      'SELECT balance::text, reserved::text FROM wallets WHERE user_id = $1',
      [players[i]],
    )
  ).rows[0];
const mine = (i: number) => stack.tournaments.getTournament(tournament.id, players[i]!);

describe('annuler la recherche (table de tournoi en attente)', () => {
  it('libère la place, garde l’inscription, la réservation et le compte de tournoi', async () => {
    const a = await join(ANA);
    await join(BEN);
    const before = await mine(BEN);
    const walletBefore = await wallet(BEN);

    await stack.sessions.leaveSession(a.sessionId, pid(BEN));

    expect(await players$(a.gameId)).toEqual([pid(ANA)]);
    const after = await mine(BEN);
    expect(after.registration).toEqual(before.registration);
    expect(after.reservation).toEqual(before.reservation);
    expect(after.account).toEqual(before.account);
    expect(await wallet(BEN)).toEqual(walletBefore);
    // L'autre joueur reste assis ; l'échéance de 20 s est retirée (moins de 2 joueurs).
    expect((await stack.games.findGame(a.gameId))!.startDeadlineAt).toBeUndefined();
  });

  it('libération unique : une seconde annulation (nouvelle tentative réseau) ne change rien', async () => {
    const a = await join(ANA);
    await join(BEN);
    await join(CID);
    const first = await stack.sessions.leaveSession(a.sessionId, pid(BEN));
    const gameVersion = (await stack.games.findGame(a.gameId))!.version;
    const again = await stack.sessions.leaveSession(a.sessionId, pid(BEN));
    expect(again.session.version).toBe(first.session.version);
    expect((await stack.games.findGame(a.gameId))!.version).toBe(gameVersion);
    expect(await players$(a.gameId)).toEqual([pid(ANA), pid(CID)]);
  });

  it('après annulation, une nouvelle recherche attribue de nouveau une place unique', async () => {
    const a = await join(ANA);
    await join(BEN);
    await stack.sessions.leaveSession(a.sessionId, pid(BEN));
    const again = await join(BEN);
    expect(again.sessionId).toBe(a.sessionId);
    expect(await players$(a.gameId)).toEqual([pid(ANA), pid(BEN)]);
  });

  it('partie démarrée : l’annulation est refusée, personne ne quitte la partie', async () => {
    const a = await join(ANA);
    await join(BEN);
    await stack.games.startGame(a.gameId, pid(ANA));
    await expect(stack.sessions.leaveSession(a.sessionId, pid(BEN))).rejects.toBeInstanceOf(
      PlayerInActiveGameError,
    );
    const g = (await stack.games.findGame(a.gameId))!;
    expect(g.status).toBe('in_progress');
    expect(g.players.map((p) => p.playerId)).toEqual([pid(ANA), pid(BEN)]);
  });

  it('annulation et démarrage simultanés : une seule issue, état cohérent', async () => {
    const a = await join(ANA);
    await join(BEN);
    await join(CID);
    const [left, started] = await Promise.allSettled([
      stack.sessions.leaveSession(a.sessionId, pid(CID)),
      stack.games.startGame(a.gameId, pid(ANA)),
    ]);
    const g = (await stack.games.findGame(a.gameId))!;
    const seated = g.players.map((p) => p.playerId);
    if (seated.includes(pid(CID))) {
      // Le démarrage a gagné : CID joue, son départ a échoué.
      expect(g.status).toBe('in_progress');
      expect(started.status).toBe('fulfilled');
      expect(left.status).toBe('rejected');
      expect(seated).toEqual([pid(ANA), pid(BEN), pid(CID)]);
    } else {
      // Le départ a gagné ; le démarrage s'applique ensuite aux 2 joueurs restants.
      expect(left.status).toBe('fulfilled');
      expect(seated).toEqual([pid(ANA), pid(BEN)]);
    }
    expect(seated).toHaveLength(new Set(seated).size);
    // Inscription de CID intacte quelle que soit l'issue.
    expect((await mine(CID)).registration).toMatchObject({ status: 'REGISTERED' });
  });
});
