import type { Game } from '../../../src/domain/game/game';
import type { GameId, PlayerId } from '../../../src/domain/game/game-id';
import type { SessionId } from '../../../src/domain/sessions/session';
import type { Tournament } from '../../../src/domain/tournaments/tournament';
import type { UserId } from '../../../src/domain/users/user';
import type { UserEvent } from '../../../src/websocket/user-event-bus';
import { registerAndLogin } from '../../fixtures/auth';
import {
  createMigratedDatabase,
  PGLITE_TIMEOUT_MS,
  type TestDatabase,
} from '../../fixtures/pglite';
import { identityRandom } from '../../fixtures/random';
import {
  balances,
  createTournamentTestStack,
  fillWith,
  finishedCopy,
  fund,
  HOUR,
  saveTournamentSettings,
  seedAdmin,
  TestClock,
  tournamentInput,
  type TournamentTestStack,
} from '../../fixtures/tournaments';

/**
 * Parties de tournoi réglées comme des parties ordinaires (D-111), sur le compte FICTIF du
 * tournoi seulement : le portefeuille réel n'est jamais touché par une partie (ni engagement,
 * ni débit, ni crédit, ni commission) ; une partie ordinaire ne touche jamais un compte fictif ;
 * règlement unique, même rejoué ou concurrent ; contexte invalide = aucun mouvement ; comptes
 * dissous après la publication, sans mouvement réel ni perte de données ; tournois isolés.
 */
jest.setTimeout(120_000);

interface Player {
  id: UserId;
  pid: PlayerId;
}

let database: TestDatabase;
let stack: TournamentTestStack;
let admin: UserId;
let ana: Player;
let ben: Player;
/** Signaux temps réel personnels publiés après COMMIT. */
let signals: UserEvent[];
/** Lignes du journal (JSON), pour les anomalies. */
let logs: string[];

beforeAll(async () => {
  database = await createMigratedDatabase();
}, PGLITE_TIMEOUT_MS);
afterAll(() => database.close());

async function player(): Promise<Player> {
  const session = await registerAndLogin(stack.app);
  const id = session.userId as UserId;
  await fund(database.sql, id, 5000);
  return { id, pid: id as string as PlayerId };
}

beforeEach(async () => {
  signals = [];
  logs = [];
  stack = createTournamentTestStack(database.sql, new TestClock(), {
    random: identityRandom,
    gameClock: true,
    userEvents: { publish: (event) => void signals.push(event) },
    logSink: (line) => void logs.push(line),
  });
  await saveTournamentSettings(database.sql);
  admin = await seedAdmin(database.sql);
  ana = await player();
  ben = await player();
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

async function startedTournament(startsInMs = HOUR): Promise<Tournament> {
  const t = await stack.tournaments.createAsAdmin(admin, tournamentInput(stack.clock, startsInMs));
  await stack.tournaments.register(t.id, ana.id);
  await stack.tournaments.register(t.id, ben.id);
  await fillWith(stack, database.sql, t.id);
  stack.clock.set(t.startsAt);
  return stack.tournaments.advance(t.id);
}

/** Une partie complète à une table du tournoi (ben gagne), puis les deux quittent la table. */
async function playAndLeave(t: Tournament) {
  const seat = await stack.tournaments.join(t.id, ana.id);
  await stack.tournaments.join(t.id, ben.id);
  const gameId = seat.gameId as GameId;
  await stack.games.startGame(gameId, ana.pid);
  const who = [ana.pid, ben.pid];
  for (const [i, cardId] of SECOND_WINS) await stack.games.playCard(gameId, who[i]!, cardId);
  await stack.tournaments.idle();
  await stack.sessions.idle();
  for (const p of [ana, ben]) await stack.sessions.leaveSession(seat.sessionId as SessionId, p.pid);
  await stack.sessions.idle();
  return gameId;
}

const account = (t: Tournament, p: Player) => stack.repository.findAccount(t.id, p.id);

/** Toute trace d'une partie dans le compte de jeu RÉEL. */
async function realWalletTraces(gameIds: readonly string[]) {
  const count = async (sql: string) =>
    Number(
      (await database.sql.query<{ n: number }>(sql, [gameIds])).rows[0]!.n,
    );
  return {
    transactions: await count(
      'SELECT count(*)::int AS n FROM wallet_transactions WHERE game_id = ANY($1::uuid[])',
    ),
    reservations: await count(
      'SELECT count(*)::int AS n FROM wallet_reservations WHERE game_id = ANY($1::uuid[])',
    ),
    settlements: await count(
      'SELECT count(*)::int AS n FROM game_settlements WHERE game_id = ANY($1::uuid[])',
    ),
    commissions: await count(
      'SELECT count(*)::int AS n FROM platform_ledger WHERE game_id = ANY($1::uuid[])',
    ),
  };
}

const NO_TRACE = { transactions: 0, reservations: 0, settlements: 0, commissions: 0 };

describe('parties de tournoi : compte fictif seulement', () => {
  it('victoires et défaites sur plusieurs tables : jetons fictifs selon les règles ordinaires, portefeuille réel intact', async () => {
    const t = await startedTournament();
    expect(t.settlementRule).toBe('D111_ORDINARY_RULES');
    const before = { ana: await balances(database.sql, ana.id), ben: await balances(database.sql, ben.id) };

    const games = [await playAndLeave(t), await playAndLeave(t)];

    const rows = await database.sql.query<{
      status: string;
      winner_id: string;
      victory_type: string;
      settlement_rule: string;
      transfers: Record<string, number>;
    }>(
      `SELECT status, winner_id, victory_type, settlement_rule, transfers FROM tournament_games
       WHERE game_id = ANY($1::uuid[]) ORDER BY settled_at`,
      [games],
    );
    expect(rows.rows).toHaveLength(2);
    let anaDelta = 0;
    let benDelta = 0;
    for (const row of rows.rows) {
      // Même résultat et même perte qu'une partie ordinaire (M, ou 2M en Kora), sans commission.
      const loss = (row.victory_type === 'KORA' ? 2 : 1) * t.stakePerGame;
      expect(row).toMatchObject({
        status: 'SETTLED',
        winner_id: ben.id,
        settlement_rule: 'D111_ORDINARY_RULES',
        transfers: { [ana.id]: -loss, [ben.id]: loss },
      });
      anaDelta -= loss;
      benDelta += loss;
    }
    expect(await account(t, ben)).toMatchObject({
      currentTokens: t.initialTournamentTokens + benDelta,
      gamesPlayed: 2,
      gamesWon: 2,
    });
    expect(await account(t, ana)).toMatchObject({
      currentTokens: t.initialTournamentTokens + anaDelta,
      gamesPlayed: 2,
      gamesWon: 0,
    });

    // Portefeuille réel : strictement inchangé, aucune trace des parties.
    expect(await balances(database.sql, ana.id)).toEqual(before.ana);
    expect(await balances(database.sql, ben.id)).toEqual(before.ben);
    expect(await realWalletTraces(games)).toEqual(NO_TRACE);

    // Même bilan qu'une partie ordinaire à l'écran, sur le compte FICTIF.
    const view = await stack.games.getGameForPlayer(games[0]!, ben.pid);
    expect(view.result?.winnerId).toBe(ben.pid);
    expect(view.mySettlement).toEqual({
      delta: rows.rows[0]!.transfers[ben.id],
      account: 'TOURNAMENT',
    });
    expect((await stack.games.getGameForPlayer(games[0]!, ana.pid)).mySettlement).toEqual({
      delta: rows.rows[0]!.transfers[ana.id],
      account: 'TOURNAMENT',
    });
  });

  it('règlement rejoué et concurrent : une seule ligne, aucun mouvement en double', async () => {
    const t = await startedTournament();
    const gameId = await playAndLeave(t);
    const after = { ana: await account(t, ana), ben: await account(t, ben) };
    const game = (await stack.games.findGame(gameId))!;
    await Promise.all([
      stack.tournaments.settleGame(game),
      stack.tournaments.settleGame(game),
      stack.tournaments.settleGame(game),
    ]);
    await stack.tournaments.settlePendingGames(t.id);
    expect(await account(t, ana)).toEqual(after.ana);
    expect(await account(t, ben)).toEqual(after.ben);
    const n = await database.sql.query<{ n: number }>(
      'SELECT count(*)::int AS n FROM tournament_games WHERE game_id = $1',
      [gameId],
    );
    expect(n.rows[0]!.n).toBe(1);
    // Un règlement écrit est une preuve : ni modifiable ni supprimable.
    await expect(
      database.sql.query('UPDATE tournament_games SET pot = 0 WHERE game_id = $1', [gameId]),
    ).rejects.toThrow(/immuable/);
    await expect(
      database.sql.query('DELETE FROM tournament_games WHERE game_id = $1', [gameId]),
    ).rejects.toThrow(/immuable/);
  });

  it('règlement écrit : signal temps réel aux joueurs réglés, une seule fois (écran de fin relu)', async () => {
    const t = await startedTournament();
    const gameId = await playAndLeave(t);
    const settledSignals = () =>
      signals.filter((s) => s.notificationType === 'TOURNAMENT_GAME_SETTLED');
    expect(settledSignals().map((s) => s.userId).sort()).toEqual([ana.id, ben.id].sort());
    expect(settledSignals().every((s) => s.tournamentId === t.id)).toBe(true);
    // Règlement rejoué (reprise, concurrence) : aucun mouvement, donc aucun nouveau signal.
    await stack.tournaments.settleGame((await stack.games.findGame(gameId))!);
    expect(settledSignals()).toHaveLength(2);
  });

  it('contexte invalide (participant sans compte du tournoi) : VOID, aucun mouvement partiel', async () => {
    const t = await startedTournament();
    const seat = await stack.tournaments.join(t.id, ana.id);
    await stack.tournaments.join(t.id, ben.id);
    await stack.games.startGame(seat.gameId as GameId, ana.pid);
    const outsider = await player();
    const game = (await stack.games.findGame(seat.gameId as GameId))!;
    const forged: Game = {
      ...finishedCopy(game, ben.id, stack.clock.now()),
      players: [...game.players, { ...game.players[0]!, playerId: outsider.pid, seat: 2 }],
    };
    const before = { ana: await account(t, ana), ben: await account(t, ben) };
    await stack.tournaments.settleGame(forged);
    const row = await database.sql.query<{ status: string; void_reason: string; transfers: object }>(
      'SELECT status, void_reason, transfers FROM tournament_games WHERE game_id = $1',
      [seat.gameId],
    );
    expect(row.rows).toEqual([
      { status: 'VOID', void_reason: 'PARTICIPANT_WITHOUT_ACCOUNT', transfers: {} },
    ]);
    expect(await account(t, ana)).toEqual(before.ana);
    expect(await account(t, ben)).toEqual(before.ben);
    expect(await stack.repository.findAccount(t.id, outsider.id)).toBeNull();
  });

  it('partie rattachée à un tournoi introuvable : aucun mouvement, anomalie journalisée', async () => {
    const t = await startedTournament();
    const seat = await stack.tournaments.join(t.id, ana.id);
    await stack.tournaments.join(t.id, ben.id);
    await stack.games.startGame(seat.gameId as GameId, ana.pid);
    const game = (await stack.games.findGame(seat.gameId as GameId))!;
    const unknown = '00000000-0000-4000-8000-000000000000';
    const orphan: Game = { ...finishedCopy(game, ben.id, stack.clock.now()), tournamentId: unknown };
    const before = {
      ana: await account(t, ana),
      ben: await account(t, ben),
      wallets: [await balances(database.sql, ana.id), await balances(database.sql, ben.id)],
    };
    await stack.tournaments.settleGame(orphan);
    const rows = await database.sql.query('SELECT 1 FROM tournament_games WHERE game_id = $1', [
      game.id,
    ]);
    expect(rows.rows).toEqual([]);
    expect(await account(t, ana)).toEqual(before.ana);
    expect(await account(t, ben)).toEqual(before.ben);
    expect([await balances(database.sql, ana.id), await balances(database.sql, ben.id)]).toEqual(
      before.wallets,
    );
    expect(await realWalletTraces([game.id])).toEqual(NO_TRACE);
    const refused = logs
      .map((line) => JSON.parse(line) as Record<string, unknown>)
      .filter((l) => l.message === 'TOURNAMENT_GAME_SETTLEMENT_REFUSED');
    expect(refused).toEqual([
      expect.objectContaining({ level: 'error', reason: 'TOURNAMENT_NOT_FOUND', gameId: game.id }),
    ]);
    expect(signals.filter((s) => s.notificationType === 'TOURNAMENT_GAME_SETTLED')).toEqual([]);
  });

  it('une partie ordinaire ne touche jamais un compte fictif', async () => {
    const t = await startedTournament();
    const carl = await player();
    const ordinary = await stack.sessions.createSession(carl.pid, { maxPlayers: 2 });
    const done = finishedCopy(ordinary.game, carl.id, stack.clock.now());
    const before = { ana: await account(t, ana), ben: await account(t, ben) };
    await stack.tournaments.settleGame(done);
    const rows = await database.sql.query('SELECT 1 FROM tournament_games WHERE game_id = $1', [
      ordinary.game.id,
    ]);
    expect(rows.rows).toEqual([]);
    expect(await account(t, ana)).toEqual(before.ana);
    expect(await account(t, ben)).toEqual(before.ben);
  });
});

describe('fin du tournoi : dissolution des comptes fictifs', () => {
  it('après publication et versements : comptes DISSOLVED, données conservées, aucun mouvement réel ; tournoi suivant isolé', async () => {
    const t = await startedTournament();
    await playAndLeave(t);
    stack.clock.set(t.endsAt);
    expect((await stack.tournaments.advance(t.id)).status).toBe('COMPLETED');

    const kept = await database.sql.query<{
      status: string;
      dissolved_at: Date | null;
      current_tokens: number;
      games_played: number;
      rank: number;
    }>(
      `SELECT status, dissolved_at, current_tokens, games_played, rank
       FROM tournament_player_accounts WHERE tournament_id = $1 AND player_id = $2`,
      [t.id, ben.id],
    );
    expect(kept.rows[0]).toMatchObject({ status: 'DISSOLVED', games_played: 1, rank: 1 });
    expect(kept.rows[0]!.dissolved_at).not.toBeNull();
    const results = await stack.tournaments.results(t.id);
    const wallets = { ana: await balances(database.sql, ana.id), ben: await balances(database.sql, ben.id) };

    // Dissolution rejouée : idempotente, ni portefeuille ni résultats modifiés.
    expect(await stack.repository.transaction((uow) => uow.dissolveAccounts(t.id, stack.clock.now()))).toBe(0);
    expect(await balances(database.sql, ana.id)).toEqual(wallets.ana);
    expect(await balances(database.sql, ben.id)).toEqual(wallets.ben);
    expect((await stack.tournaments.results(t.id)).rows).toEqual(results.rows);
    // Définitive : un compte dissous ne redevient jamais utilisable.
    await expect(
      database.sql.query(
        `UPDATE tournament_player_accounts SET status = 'ACTIVE', dissolved_at = NULL
         WHERE tournament_id = $1`,
        [t.id],
      ),
    ).rejects.toThrow();

    // Tournoi suivant : nouveau compte fictif ; l'ancien n'est jamais modifié.
    const old = { ana: await account(t, ana), ben: await account(t, ben) };
    const next = await startedTournament(3 * HOUR);
    expect(next.id).not.toBe(t.id);
    await playAndLeave(next);
    expect(await account(next, ben)).toMatchObject({ gamesPlayed: 1, status: 'ACTIVE' });
    expect(await account(t, ana)).toEqual(old.ana);
    expect(await account(t, ben)).toEqual(old.ben);
  });
});
