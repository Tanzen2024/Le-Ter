import request from 'supertest';

import type { GameId, PlayerId } from '../../../src/domain/game/game-id';
import type { SessionId } from '../../../src/domain/sessions/session';
import type { Tournament } from '../../../src/domain/tournaments/tournament';
import type { UserId } from '../../../src/domain/users/user';
import { adminLogin } from '../../fixtures/admin';
import { registerAndLogin } from '../../fixtures/auth';
import {
  createMigratedDatabase,
  PGLITE_TIMEOUT_MS,
  type TestDatabase,
} from '../../fixtures/pglite';
import { identityRandom } from '../../fixtures/random';
import {
  createTournamentTestStack,
  fillWith,
  fund,
  HOUR,
  saveTournamentSettings,
  seedAdmin,
  TestClock,
  tournamentInput,
  type TournamentTestStack,
} from '../../fixtures/tournaments';

/**
 * Parties d'un tournoi comptées à l'échelle du TOURNOI (D-106), jamais de la table : un joueur
 * qui change de table (session) garde son historique ; chaque partie réglée compte une fois ;
 * parties ordinaires, annulées et VOID exclues ; le classement provisoire, le classement figé,
 * l'application, l'administration et l'export CSV lisent le même total, y compris après un
 * redémarrage et quand les compteurs en cache ont dérivé (le registre des règlements fait foi).
 */
jest.setTimeout(120_000);

interface Player {
  id: UserId;
  pid: PlayerId;
  token: string;
}

let database: TestDatabase;
let stack: TournamentTestStack;
let clock: TestClock;
let admin: UserId;
let ana: Player;
let ben: Player;
let carl: Player;

beforeAll(async () => {
  database = await createMigratedDatabase();
}, PGLITE_TIMEOUT_MS);
afterAll(() => database.close());

const newStack = () =>
  createTournamentTestStack(database.sql, clock, { random: identityRandom, gameClock: true });

async function player(): Promise<Player> {
  const session = await registerAndLogin(stack.app);
  const id = session.userId as UserId;
  await fund(database.sql, id, 5000);
  return { id, pid: id as string as PlayerId, token: session.accessToken };
}

beforeEach(async () => {
  clock = new TestClock();
  stack = newStack();
  await saveTournamentSettings(database.sql);
  admin = await seedAdmin(database.sql);
  ana = await player();
  ben = await player();
  carl = await player();
});
afterEach(async () => {
  await stack.stop();
  await database.reset();
});

/** Distribution « identité » à 2 : le 2e joueur assis (ben) gagne (D-035). */
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
  const t = await stack.tournaments.createAsAdmin(admin, tournamentInput(stack.clock, HOUR));
  for (const p of [ana, ben, carl]) await stack.tournaments.register(t.id, p.id);
  await fillWith(stack, database.sql, t.id);
  stack.clock.set(t.startsAt);
  return stack.tournaments.advance(t.id);
}

/** ana puis ben s'assoient à une table du tournoi ; ana démarre ; ben gagne la partie. */
async function playTableGame(t: Tournament) {
  const seat = await stack.tournaments.join(t.id, ana.id);
  await stack.tournaments.join(t.id, ben.id);
  const gameId = seat.gameId as GameId;
  await stack.games.startGame(gameId, ana.pid);
  const who = [ana.pid, ben.pid];
  for (const [i, cardId] of SECOND_WINS) await stack.games.playCard(gameId, who[i]!, cardId);
  await stack.tournaments.idle();
  await stack.sessions.idle();
  return { sessionId: seat.sessionId as SessionId, gameId };
}

async function leaveTable(sessionId: SessionId, ...players: Player[]) {
  for (const p of players) await stack.sessions.leaveSession(sessionId, p.pid);
  await stack.sessions.idle();
}

const account = (t: Tournament, p: Player) => stack.repository.findAccount(t.id, p.id);

async function adminAgent() {
  const session = await registerAndLogin(stack.app);
  const id = session.userId as UserId;
  await database.sql.query(`UPDATE users SET role = 'admin' WHERE id = $1`, [id]);
  const { accessToken } = await adminLogin(stack.app, session.email, session.password, id);
  return (path: string) =>
    request(stack.app).get(path).set('Authorization', `Bearer ${accessToken}`);
}

describe('parties cumulées sur toutes les tables du tournoi', () => {
  it('changer de table conserve le compteur ; chaque partie compte une fois ; exclusions', async () => {
    const t = await startedTournament();

    // Table A : 1re partie, puis les deux joueurs QUITTENT la table.
    const a = await playTableGame(t);
    await leaveTable(a.sessionId, ana, ben);
    expect(await account(t, ben)).toMatchObject({ gamesPlayed: 1, gamesWon: 1 });

    // Table B (nouvelle session) : 2e partie. Le compteur continue, il ne repart pas de 0.
    const b = await playTableGame(t);
    expect(b.sessionId).not.toBe(a.sessionId);
    expect(await account(t, ben)).toMatchObject({
      gamesPlayed: 2,
      gamesWon: 2,
      currentTokens: 1200,
    });
    expect(await account(t, ana)).toMatchObject({
      gamesPlayed: 2,
      gamesWon: 0,
      currentTokens: 800,
    });

    // Règlements rejoués (reprise du worker, double fin de partie) : aucun double comptage.
    for (const gameId of [a.gameId, b.gameId]) {
      await stack.tournaments.settleGame((await stack.games.findGame(gameId))!);
    }
    await stack.tournaments.settlePendingGames(t.id);
    expect(await account(t, ben)).toMatchObject({ gamesPlayed: 2, gamesWon: 2 });

    // Partie de tournoi annulée (arrêt sans vainqueur) : réglée VOID, jamais comptée.
    await leaveTable(b.sessionId, ana, ben);
    const seat = await stack.tournaments.join(t.id, ana.id);
    await stack.tournaments.join(t.id, carl.id);
    await stack.games.startGame(seat.gameId as GameId, ana.pid);
    await stack.games.finishGame(seat.gameId as GameId);
    await stack.tournaments.idle();
    await stack.tournaments.settlePendingGames(t.id);
    const voided = await database.sql.query<{ status: string }>(
      'SELECT status FROM tournament_games WHERE game_id = $1',
      [seat.gameId],
    );
    expect(voided.rows).toEqual([{ status: 'VOID' }]);

    const ledger = await stack.repository.tallySettledGames(t.id);
    expect(ledger.get(ana.id)).toEqual({ gamesPlayed: 2, gamesWon: 0, tokenDelta: -200 });
    expect(ledger.get(ben.id)).toEqual({ gamesPlayed: 2, gamesWon: 2, tokenDelta: 200 });
    expect(ledger.has(carl.id)).toBe(false);
    const tables = await database.sql.query<{ n: number }>(
      `SELECT count(DISTINCT session_id)::int AS n FROM tournament_games
       WHERE tournament_id = $1 AND status = 'SETTLED'`,
      [t.id],
    );
    expect(tables.rows[0]!.n).toBe(2);
  });

  it('classement figé, application, administration et CSV : même total, même après redémarrage et dérive du cache', async () => {
    const t = await startedTournament();
    const a = await playTableGame(t);
    await leaveTable(a.sessionId, ana, ben);
    const b = await playTableGame(t);
    await leaveTable(b.sessionId, ana, ben);

    // Cache dérivé (compteur limité à la dernière table, incrément perdu) : le registre des
    // règlements, en base, reste la source officielle.
    await database.sql.query(
      `UPDATE tournament_player_accounts SET games_played = 1, games_won = 1, current_tokens = 1100
       WHERE tournament_id = $1 AND player_id = $2`,
      [t.id, ben.id],
    );

    // Redémarrage du backend : nouvelle pile, aucun état en mémoire.
    await stack.stop();
    stack = newStack();

    const live = await stack.tournaments.standings(t.id, ana.id);
    expect(live.live).toBe(true);
    expect(live.rows.find((r) => r.playerId === ben.id)).toMatchObject({
      gamesPlayed: 2,
      gamesWon: 2,
      remainingTokens: 1200,
    });
    const hud = await stack.tournaments.myContext(t.id, ben.id);
    expect(hud.account).toMatchObject({ gamesPlayed: 2, gamesWon: 2, currentTokens: 1200 });

    // Clôture : classement calculé sur le total global puis figé.
    stack.clock.set(t.endsAt);
    expect((await stack.tournaments.advance(t.id)).status).toBe('COMPLETED');
    const { rows } = await stack.tournaments.results(t.id);
    const byPlayer = (p: Player) => rows.find((r) => r.playerId === p.id)!;
    expect(byPlayer(ben)).toMatchObject({
      rank: 1,
      gamesPlayed: 2,
      gamesWon: 2,
      remainingTokens: 1200,
    });
    expect(byPlayer(ana)).toMatchObject({ gamesPlayed: 2, gamesWon: 0, remainingTokens: 800 });
    expect(byPlayer(carl)).toMatchObject({ gamesPlayed: 0, remainingTokens: 1000 });
    // Le compte clos porte aussi les valeurs du registre.
    expect(await account(t, ben)).toMatchObject({ gamesPlayed: 2, currentTokens: 1200 });

    // Après un second redémarrage, toutes les surfaces lisent les mêmes chiffres figés.
    await stack.stop();
    stack = newStack();
    const mobile = await request(stack.app)
      .get(`/api/tournaments/${t.id}/results`)
      .set('Authorization', `Bearer ${ana.token}`)
      .expect(200);
    const adminGet = await adminAgent();
    const back = (await adminGet(`/api/admin/tournaments/${t.id}/results`).expect(200)).body;
    const csv = (await adminGet(`/api/admin/tournaments/${t.id}/results.csv`).expect(200)).text;

    type Row = { username: string; rank: number; gamesPlayed: number; gamesWon: number };
    const pick = (list: Row[]) =>
      list.map(({ rank, username, gamesPlayed, gamesWon }) => ({
        rank,
        username,
        gamesPlayed,
        gamesWon,
      }));
    expect(pick(back.results)).toEqual(pick(mobile.body.results));
    expect(mobile.body.rules.gamesReference).toBe(back.rules.gamesReference);
    const benRow = (mobile.body.results as Row[]).find((r) => r.gamesWon === 2)!;
    expect(benRow).toMatchObject({ rank: 1, gamesPlayed: 2 });
    const csvBen = csv.split(/\r?\n/).find((line) => line.includes(`,${benRow.username},`))!;
    // Tournament,Player,Rank,Initial Tokens,Remaining Tokens,Games Played,Games Won,...
    expect(csvBen.split(',').slice(2, 7)).toEqual(['1', '1000', '1200', '2', '2']);
  });
});
