import type { GameId, PlayerId } from '../../../src/domain/game/game-id';
import type { SessionId } from '../../../src/domain/sessions/session';
import {
  TournamentAccessDeniedError,
  TournamentOutOfTokensError,
  type Tournament,
} from '../../../src/domain/tournaments/tournament';
import type { UserId } from '../../../src/domain/users/user';
import {
  createMigratedDatabase,
  PGLITE_TIMEOUT_MS,
  type TestDatabase,
} from '../../fixtures/pglite';
import { identityRandom } from '../../fixtures/random';
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
 * Seuil de participation (D-063) : `jetons >= 2 × mise` pour créer ou rejoindre une partie
 * d'un tournoi, vérifié par le serveur à chaque entrée (table créée ou rejointe, accès direct
 * à la session, partie suivante après « Poursuivre »), sur des jetons À JOUR (la partie
 * précédente est réglée avant la lecture). Mise 100 : seuil 200. Parties réellement jouées :
 * ana perd 100 jetons à chaque partie.
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
});
afterEach(async () => {
  await stack.stop();
  await database.reset();
});

const [ANA, BEN] = [0, 1];
const pid = (i: number) => players[i]! as string as PlayerId;

/** Distribution « identité » à 2 : le 2e joueur (ben) prend le contrôle et gagne (D-035). */
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

async function startedTournament(initialTournamentTokens: number): Promise<Tournament> {
  const admin = await seedAdmin(database.sql);
  const t = await stack.tournaments.createAsAdmin(
    admin,
    tournamentInput(stack.clock, HOUR, { initialTournamentTokens, stakePerGame: 100 }),
  );
  for (const p of players) await stack.tournaments.register(t.id, p);
  await fillWith(stack, database.sql, t.id); // minimum de 20 participants (D-057)
  stack.clock.set(t.startsAt);
  return stack.tournaments.advance(t.id);
}

/** ana ouvre une table, ben la rejoint ; partie jouée jusqu'au bout, ben gagne. */
async function anaLosesAGame(t: Tournament, settle = true) {
  const seat = await stack.tournaments.join(t.id, players[ANA]!);
  await stack.tournaments.join(t.id, players[BEN]!);
  await stack.games.startGame(seat.gameId as GameId, pid(ANA));
  for (const [who, cardId] of SECOND_WINS) {
    await stack.games.playCard(seat.gameId as GameId, pid(who), cardId);
  }
  if (settle) await stack.tournaments.idle();
  await stack.sessions.idle();
  return { sessionId: seat.sessionId as SessionId, gameId: seat.gameId as GameId };
}

async function bothContinue(sessionId: SessionId) {
  await stack.sessions.decide(sessionId, pid(ANA), 'continue');
  await stack.sessions.decide(sessionId, pid(BEN), 'continue');
  await stack.sessions.idle();
  await stack.tournaments.idle();
}

const account = async (t: Tournament, i: number) =>
  (await stack.repository.findAccount(t.id, players[i]!))!;

const seatedAt = async (i: number) =>
  (await stack.sessions.findActiveSessions(pid(i))).map((s) => s.id as string);

it('exactement au seuil (200 = 2 × 100) : ACTIF, enchaîne la partie suivante', async () => {
  const t = await startedTournament(300);
  const { sessionId, gameId } = await anaLosesAGame(t);
  expect(await account(t, ANA)).toMatchObject({ currentTokens: 200, status: 'ACTIVE' });

  await bothContinue(sessionId);
  const next = (await stack.sessions.getSession(sessionId, pid(ANA))).lastGame!;
  expect(next.gameId).not.toBe(gameId);
  expect(next.playerIds).toEqual(expect.arrayContaining([pid(ANA), pid(BEN)]));
});

it('création de table exactement au seuil : jetons initiaux 200, mise 100 → accepté', async () => {
  const t = await startedTournament(200);
  const seat = await stack.tournaments.join(t.id, players[ANA]!);
  expect(seat.sessionId).toBeDefined();
});

it('juste en dessous (100 < 200) : OUT_OF_TOKENS, écarté de la partie suivante, ni table ni accès direct, toujours classé', async () => {
  const t = await startedTournament(200);
  const { sessionId } = await anaLosesAGame(t);
  expect(await account(t, ANA)).toMatchObject({ currentTokens: 100, status: 'OUT_OF_TOKENS' });
  expect(await account(t, BEN)).toMatchObject({ currentTokens: 300, status: 'ACTIVE' });

  // ana répond « Poursuivre », mais le serveur l'écarte de la partie suivante.
  await bothContinue(sessionId);
  expect(await seatedAt(ANA)).toEqual([]);
  const view = await stack.sessions.getSession(sessionId, pid(BEN));
  expect(view.lastGame?.playerIds ?? []).not.toContain(pid(ANA));

  // Ni nouvelle table, ni table existante, ni accès direct à la session.
  await expect(stack.tournaments.join(t.id, players[ANA]!)).rejects.toBeInstanceOf(
    TournamentOutOfTokensError,
  );
  await expect(stack.sessions.joinSession(sessionId, pid(ANA))).rejects.toBeInstanceOf(
    TournamentAccessDeniedError,
  );
  expect(await stack.tournaments.isAdmitted(sessionId, pid(ANA))).toBe(false);
  expect(await seatedAt(ANA)).toEqual([]);

  // Toujours classé (D-062 : tous les participants, aucune pénalité ajoutée).
  const standing = (await stack.tournaments.standings(t.id, players[BEN]!)).rows;
  expect(standing).toHaveLength(20);
  expect(standing.map((r) => r.playerId)).toContain(players[ANA]);
});

it('course : table quittée AVANT le règlement de la partie → le solde est réglé avant la décision, accès refusé', async () => {
  const t = await startedTournament(200);
  const { sessionId, gameId } = await anaLosesAGame(t);
  // Simule un règlement pas encore effectué (arrière-plan en retard ou en échec) : la partie
  // terminée n'a pas de ligne de règlement et les jetons sont ceux d'avant la partie.
  await database.sql.query('DELETE FROM tournament_games WHERE game_id = $1', [gameId]);
  await database.sql.query(
    `UPDATE tournament_player_accounts
        SET current_tokens = initial_tokens, games_played = 0, games_won = 0, status = 'ACTIVE'
      WHERE tournament_id = $1`,
    [t.id],
  );
  expect(await account(t, ANA)).toMatchObject({ currentTokens: 200, status: 'ACTIVE' });

  // ana quitte aussitôt la table et redemande une table : refusé, sur le solde réglé.
  await stack.sessions.decide(sessionId, pid(ANA), 'leave');
  await stack.sessions.idle();
  await expect(stack.tournaments.join(t.id, players[ANA]!)).rejects.toBeInstanceOf(
    TournamentOutOfTokensError,
  );
  expect(await account(t, ANA)).toMatchObject({ currentTokens: 100, status: 'OUT_OF_TOKENS' });
  const settled = await database.sql.query<{ n: number }>(
    'SELECT count(*)::int AS n FROM tournament_games WHERE game_id = $1',
    [gameId],
  );
  expect(settled.rows[0]!.n).toBe(1); // réglée une seule fois
});

it('course : « Poursuivre » avant le règlement → la partie est réglée avant de composer la suivante', async () => {
  const t = await startedTournament(200);
  const { sessionId, gameId } = await anaLosesAGame(t);
  await database.sql.query('DELETE FROM tournament_games WHERE game_id = $1', [gameId]);
  await database.sql.query(
    `UPDATE tournament_player_accounts
        SET current_tokens = initial_tokens, games_played = 0, games_won = 0, status = 'ACTIVE'
      WHERE tournament_id = $1`,
    [t.id],
  );

  await bothContinue(sessionId);
  expect(await account(t, ANA)).toMatchObject({ currentTokens: 100, status: 'OUT_OF_TOKENS' });
  expect(await seatedAt(ANA)).toEqual([]);
  const view = await stack.sessions.getSession(sessionId, pid(BEN));
  expect(view.lastGame?.playerIds ?? []).not.toContain(pid(ANA));
});
