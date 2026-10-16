import request from 'supertest';

import { GameStartClosedError } from '../../../src/domain/game/game-errors';
import type { GameId, PlayerId } from '../../../src/domain/game/game-id';
import type { SessionId } from '../../../src/domain/sessions/session';
import {
  TournamentCompletedError,
  type Tournament,
} from '../../../src/domain/tournaments/tournament';
import type { UserId } from '../../../src/domain/users/user';
import type { UserEvent } from '../../../src/websocket/user-event-bus';
import { login, registerAndLogin } from '../../fixtures/auth';
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
  MINUTE,
  saveTournamentSettings,
  seedAdmin,
  TestClock,
  tournamentInput,
  type TournamentTestStack,
} from '../../fixtures/tournaments';

/**
 * Cycle complet d'un tournoi (D-106) : capital de tournoi isolé du compte de jeu, parties
 * rattachées explicitement, fin = plus de démarrage sans interrompre les parties commencées,
 * clôture qui attend toutes les parties et leur règlement, classement officiel auditable et
 * immuable, publication (notification + signal), consultation du classement général complet
 * et de l'historique, retour au fonctionnement normal et tournoi suivant indépendant.
 */
jest.setTimeout(120_000);

interface Player {
  id: UserId;
  pid: PlayerId;
  token: string;
  email: string;
  password: string;
}

let database: TestDatabase;
let stack: TournamentTestStack;
let admin: UserId;
let ana: Player;
let ben: Player;
let signals: UserEvent[];

beforeAll(async () => {
  database = await createMigratedDatabase();
}, PGLITE_TIMEOUT_MS);
afterAll(() => database.close());

function newStack(clock = new TestClock(), userEvents?: { publish(e: UserEvent): void }) {
  return createTournamentTestStack(database.sql, clock, {
    random: identityRandom,
    gameClock: true,
    ...(userEvents && { userEvents }),
  });
}

async function player(): Promise<Player> {
  const session = await registerAndLogin(stack.app);
  const id = session.userId as UserId;
  await fund(database.sql, id, 5000);
  return {
    id,
    pid: id as string as PlayerId,
    token: session.accessToken,
    email: session.email,
    password: session.password,
  };
}

beforeEach(async () => {
  signals = [];
  stack = newStack(new TestClock(), { publish: (e) => signals.push(e) });
  await saveTournamentSettings(database.sql);
  admin = await seedAdmin(database.sql);
  ana = await player();
  ben = await player();
});
afterEach(async () => {
  await stack.stop();
  await database.reset();
});

const get = (who: Player, path: string) =>
  request(stack.app).get(path).set('Authorization', `Bearer ${who.token}`);

/** Distribution « identité » à 2 : le 2e joueur assis prend le contrôle et gagne (D-035). */
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

/** Tournoi publié, ana et ben inscrits, complété à 20, démarré (horloge = début). */
async function startedTournament(): Promise<Tournament> {
  const t = await stack.tournaments.createAsAdmin(admin, tournamentInput(stack.clock, HOUR));
  await stack.tournaments.register(t.id, ana.id);
  await stack.tournaments.register(t.id, ben.id);
  await fillWith(stack, database.sql, t.id);
  stack.clock.set(t.startsAt);
  return stack.tournaments.advance(t.id);
}

/** ana s'assoit, ben rejoint, ana démarre : la partie en cours de la table. */
async function startTable(t: Tournament) {
  const seat = await stack.tournaments.join(t.id, ana.id);
  await stack.tournaments.join(t.id, ben.id);
  await stack.games.startGame(seat.gameId as GameId, ana.pid);
  return { sessionId: seat.sessionId as SessionId, gameId: seat.gameId as GameId };
}

/** Joue les coups `from` à `to` (exclu) de la partie où ben gagne ; règlements attendus. */
async function playOut(gameId: GameId, from = 0, to = SECOND_WINS.length) {
  const who = [ana.pid, ben.pid];
  for (const [seat, cardId] of SECOND_WINS.slice(from, to)) {
    await stack.games.playCard(gameId, who[seat]!, cardId);
  }
  await stack.tournaments.idle();
  await stack.sessions.idle();
}

const account = (t: Tournament, p: Player) => stack.repository.findAccount(t.id, p.id);
const notificationTypes = async (p: Player) =>
  (await stack.notifications.list(p.id)).notifications.map((n) => n.type);

describe('capital de tournoi et rattachement des parties', () => {
  it('allocation exacte au démarrage, compte de jeu jamais crédité, aucune double allocation', async () => {
    const t = await startedTournament();
    expect(t.status).toBe('IN_PROGRESS');
    expect(t.rankingMethod).toBe('D106_CAPITAL_RATIO');
    expect(t.rankingGamesReference).toBe(42); // 2 h / 170 s
    expect(await account(t, ana)).toMatchObject({
      initialTokens: 1000,
      currentTokens: 1000,
      gamesPlayed: 0,
      status: 'ACTIVE',
    });
    // Seul le prix d'entrée a été débité ; aucun jeton de tournoi n'arrive au compte de jeu.
    expect(await balances(database.sql, ana.id)).toEqual({
      balance: 4000,
      reserved: 0,
      available: 4000,
    });
    // Reprise (planificateur, redémarrage) : rien n'est réalloué.
    await stack.tournaments.advance(t.id);
    await stack.scheduler.tick();
    const { rows } = await database.sql.query<{ n: number }>(
      'SELECT count(*)::int AS n FROM tournament_player_accounts WHERE tournament_id = $1',
      [t.id],
    );
    expect(rows[0]!.n).toBe(20);
    // Capital initial et règles officielles immuables en base.
    await expect(
      database.sql.query(
        'UPDATE tournament_player_accounts SET initial_tokens = 5 WHERE tournament_id = $1',
        [t.id],
      ),
    ).rejects.toThrow(/capital initial immuable/);
    await expect(
      database.sql.query(
        'UPDATE tournaments SET ranking_tokens_weight_bps = 10000, ranking_games_weight_bps = 0 WHERE id = $1',
        [t.id],
      ),
    ).rejects.toThrow(/figées/);
  });

  it('chaque partie de table porte son tournoi dès sa création ; une partie ordinaire jamais', async () => {
    const t = await startedTournament();
    const { gameId } = await startTable(t);
    const linked = await database.sql.query<{ tournament_id: string | null }>(
      'SELECT tournament_id FROM games WHERE id = $1',
      [gameId],
    );
    expect(linked.rows).toEqual([{ tournament_id: t.id }]);
    expect((await stack.games.getGameForPlayer(gameId, ana.pid)).tournamentId).toBe(t.id);

    // Partie ordinaire : aucun rattachement, jamais réglée en jetons de tournoi.
    const carl = await player();
    const ordinary = await stack.sessions.createSession(carl.pid, { maxPlayers: 2 });
    const plain = await database.sql.query<{ tournament_id: string | null }>(
      'SELECT tournament_id FROM games WHERE id = $1',
      [ordinary.game.id],
    );
    expect(plain.rows).toEqual([{ tournament_id: null }]);
    expect((await stack.games.getGameForPlayer(ordinary.game.id, carl.pid)).tournamentId).toBe(
      undefined,
    );

    // Garde-fous en base : rattachement immuable, règlement refusé pour une partie étrangère.
    await expect(
      database.sql.query('UPDATE games SET tournament_id = NULL WHERE id = $1', [gameId]),
    ).rejects.toThrow(/immuable/);
    await expect(
      database.sql.query(
        `INSERT INTO tournament_games (game_id, tournament_id, session_id, status, stake, pot,
           transfers, void_reason, settled_at)
         VALUES ($1, $2, $3, 'VOID', 0, 0, '{}'::jsonb, 'TEST', now())`,
        [ordinary.game.id, t.id, ordinary.session.id],
      ),
    ).rejects.toThrow(/appartient pas au tournoi/);
  });

  it('règlement : une seule fois même en concurrence, jetons du tournoi seulement', async () => {
    const t = await startedTournament();
    const { gameId } = await startTable(t);
    const game = (await stack.games.findGame(gameId))!;
    const done = finishedCopy(game, ben.id, stack.clock.now());
    await Promise.all([
      stack.tournaments.settleGame(done),
      stack.tournaments.settleGame(done),
      stack.tournaments.settleGame(done),
    ]);
    expect(await account(t, ben)).toMatchObject({ currentTokens: 1100, gamesPlayed: 1 });
    expect(await account(t, ana)).toMatchObject({ currentTokens: 900, gamesPlayed: 1 });
    const settled = await database.sql.query<{ n: number }>(
      'SELECT count(*)::int AS n FROM tournament_games WHERE game_id = $1',
      [gameId],
    );
    expect(settled.rows[0]!.n).toBe(1);
    expect((await balances(database.sql, ben.id)).balance).toBe(4000);
  });
});

describe('échéance : plus de démarrage, parties commencées menées à terme', () => {
  it('après la fin : démarrage refusé (manuel et automatique), tables en attente fermées', async () => {
    const t = await startedTournament();
    const seat = await stack.tournaments.join(t.id, ana.id);
    await stack.tournaments.join(t.id, ben.id);
    stack.clock.set(new Date(t.endsAt.getTime() + MINUTE));

    await expect(stack.games.startGame(seat.gameId as GameId, ana.pid)).rejects.toBeInstanceOf(
      GameStartClosedError,
    );
    const auto = await stack.games.handleStartDeadline(seat.gameId as GameId);
    expect(auto.status).toBe('waiting');
    expect(auto.startDeadlineAt).toBeUndefined();
    await expect(stack.tournaments.join(t.id, ana.id)).rejects.toBeInstanceOf(
      TournamentCompletedError,
    );

    // Clôture : la table en attente est fermée, ses joueurs libérés et informés.
    await stack.tournaments.advance(t.id);
    await stack.sessions.idle();
    expect(await stack.sessions.findActiveSessions(ana.pid)).toEqual([]);
    expect(await stack.sessions.findActiveSessions(ben.pid)).toEqual([]);
    expect(await notificationTypes(ana)).toContain('TOURNAMENT_TABLE_CLOSED');
    // Aucune partie n'avait commencé : classement publié sans attendre.
    expect((await stack.repository.findById(t.id))!.status).toBe('COMPLETED');

    // Retour au fonctionnement normal : une partie ordinaire est possible aussitôt.
    await expect(stack.sessions.createSession(ana.pid, { maxPlayers: 2 })).resolves.toBeDefined();
  });

  it('une partie commencée avant la fin se termine normalement, même après le délai d’alerte ; le classement l’attend', async () => {
    const t = await startedTournament();
    stack.clock.set(new Date(t.endsAt.getTime() - MINUTE));
    const { gameId } = await startTable(t);
    await playOut(gameId, 0, 4); // la moitié de la partie avant la fin

    // Bien après la fin (au-delà de l'ancien délai de grâce de 10 min) : rien n'est annulé.
    stack.clock.set(new Date(t.endsAt.getTime() + 20 * MINUTE));
    await stack.tournaments.advance(t.id);
    await stack.scheduler.tick();
    expect((await stack.repository.findById(t.id))!.status).toBe('CALCULATING_RESULTS');
    expect((await stack.games.findGame(gameId))!.status).toBe('in_progress');
    const early = await database.sql.query('SELECT 1 FROM tournament_games WHERE game_id = $1', [
      gameId,
    ]);
    expect(early.rows).toEqual([]);
    // Publication en cours : aucun classement provisoire présenté comme officiel.
    const pending = await get(ana, `/api/tournaments/${t.id}/results`);
    expect(pending.status).toBe(409);
    expect(pending.body.code).toBe('TOURNAMENT_RESULTS_UNAVAILABLE');

    // La partie se termine normalement : réglée, puis le classement est publié.
    await playOut(gameId, 4);
    const settled = await database.sql.query<{ status: string; winner_id: string }>(
      'SELECT status, winner_id FROM tournament_games WHERE game_id = $1',
      [gameId],
    );
    expect(settled.rows).toEqual([{ status: 'SETTLED', winner_id: ben.id }]);
    await stack.tournaments.advance(t.id);
    const { rows } = await stack.tournaments.results(t.id);
    expect(rows[0]).toMatchObject({ playerId: ben.id, remainingTokens: 1100, gamesPlayed: 1 });
  });
});

describe('classement officiel et consultation des résultats', () => {
  /** Tournoi joué (ben gagne une partie contre ana), terminé et publié. */
  async function completedTournament(): Promise<Tournament> {
    const t = await startedTournament();
    const { gameId } = await startTable(t);
    await playOut(gameId);
    stack.clock.set(t.endsAt);
    const done = await stack.tournaments.advance(t.id);
    expect(done.status).toBe('COMPLETED');
    return done;
  }

  it('classement général complet, ordre officiel, ma ligne et le détail de mon score', async () => {
    const t = await completedTournament();
    const res = await get(ana, `/api/tournaments/${t.id}/results`).expect(200);
    const stored = await database.sql.query<{ rank: number; player_id: string }>(
      'SELECT rank, player_id FROM tournament_results WHERE tournament_id = $1 ORDER BY rank',
      [t.id],
    );
    expect(res.body.participants).toBe(20);
    expect(res.body.results).toHaveLength(20);
    expect(res.body.results.map((r: { rank: number }) => r.rank)).toEqual(
      stored.rows.map((r) => r.rank),
    );
    // Tous les participants admissibles (les 20 comptes du tournoi) sont classés.
    const accounts = await database.sql.query<{ player_id: string }>(
      'SELECT player_id FROM tournament_player_accounts WHERE tournament_id = $1',
      [t.id],
    );
    expect(new Set(stored.rows.map((r) => r.player_id))).toEqual(
      new Set(accounts.rows.map((r) => r.player_id)),
    );
    expect(res.body.rules).toEqual({
      method: 'D106_CAPITAL_RATIO',
      tokensWeightPercent: 50,
      gamesWeightPercent: 50,
      gamesReference: 42,
    });
    // ben : 1100 / 1000 et 1 / 42 → 55 + 1,1905 ; ana : 900 / 1000 et 1 / 42 → 45 + 1,1905.
    expect(res.body.results[0]).toMatchObject({
      rank: 1,
      remainingTokens: 1100,
      gamesPlayed: 1,
      score: 56.1905,
      isViewer: false,
    });
    const mine = res.body.results.filter((r: { isViewer: boolean }) => r.isViewer);
    expect(mine).toHaveLength(1);
    expect(res.body.me).toMatchObject({
      rank: mine[0].rank,
      score: 46.1905,
      initialTokens: 1000,
      remainingTokens: 900,
      gamesPlayed: 1,
      tokensRatio: 0.9,
      gamesRatio: 0.02381,
      tokensPoints: 45,
      gamesPoints: 1.1905,
    });
    expect(stored.rows.find((r) => r.player_id === ana.id)!.rank).toBe(res.body.me.rank);

    // Données d'audit figées avec chaque rang.
    const audit = await database.sql.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM tournament_results WHERE tournament_id = $1
         AND ranking_method = 'D106_CAPITAL_RATIO' AND tokens_ratio IS NOT NULL
         AND games_ratio IS NOT NULL AND tokens_weight_bps = 5000 AND games_weight_bps = 5000
         AND games_reference = 42 AND registered_at IS NOT NULL`,
      [t.id],
    );
    expect(audit.rows[0]!.n).toBe(20);
    // Les figurants (même score exact) sont départagés, et le critère est enregistré.
    const tied = res.body.results.filter((r: { score: number }) => r.score === 50);
    expect(tied).toHaveLength(18);
    for (const row of tied) expect(row.tieBreak).toBeDefined();
    expect(res.body.results[0].tieBreak).toBeUndefined();
  });

  it('aucune donnée privée ; un non-participant voit le classement public sans détail personnel', async () => {
    const t = await completedTournament();
    const carl = await player();
    const res = await get(carl, `/api/tournaments/${t.id}/results`).expect(200);
    expect(res.body.me).toBeNull();
    expect(res.body.results.every((r: { isViewer: boolean }) => !r.isViewer)).toBe(true);
    const text = JSON.stringify(res.body);
    for (const secret of [ana.id, ben.id, ana.email, 'phone', 'balance', 'playerId']) {
      expect(text).not.toContain(secret);
    }
    const allowed = [
      'rank',
      'username',
      'initialTokens',
      'remainingTokens',
      'gamesPlayed',
      'gamesWon',
      'score',
      'tieBreak',
      'prizePercent',
      'prizeAmount',
      'paid',
      'isViewer',
    ];
    for (const row of res.body.results) {
      expect(Object.keys(row).filter((k) => !allowed.includes(k))).toEqual([]);
    }
  });

  it('publication : une notification et un signal par participant, jamais deux classements', async () => {
    const t = await completedTournament();
    const ofTournament = signals.filter((e) => e.tournamentId === t.id);
    const announced = ofTournament.filter(
      (e) => e.notificationType === 'TOURNAMENT_RESULTS_AVAILABLE',
    );
    expect(announced).toHaveLength(20);
    expect(new Set(announced.map((e) => e.userId)).size).toBe(20);
    // Gains réels (D-112) : un signal par gagnant, émis seulement après le crédit validé.
    const prizes = ofTournament.filter((e) => e.notificationType === 'TOURNAMENT_PRIZE_CREDITED');
    expect(prizes).toHaveLength(3);
    // Partie jouée AVANT la clôture (D-111) : un signal « règlement écrit » par joueur réglé
    // (les 2 de la table), jamais rejoué par la publication.
    const settledGame = ofTournament.filter((e) => e.notificationType === 'TOURNAMENT_GAME_SETTLED');
    expect(settledGame).toHaveLength(2);
    // Aucun autre signal : 20 classements + 3 gains + 2 règlements de partie.
    expect(ofTournament).toHaveLength(25);
    // Reprise (planificateur, nouvelle commande) : ni doublon de classement ni de notification.
    await stack.tournaments.advance(t.id);
    await stack.scheduler.tick();
    const counts = await database.sql.query<{ results: number; notices: number }>(
      `SELECT (SELECT count(*)::int FROM tournament_results WHERE tournament_id = $1) AS results,
              (SELECT count(*)::int FROM notifications
                WHERE type = 'TOURNAMENT_RESULTS_AVAILABLE' AND payload->>'tournamentId' = $2)
                AS notices`,
      [t.id, t.id],
    );
    expect(counts.rows).toEqual([{ results: 20, notices: 20 }]);
    expect(await notificationTypes(ana)).toContain('TOURNAMENT_RESULTS_AVAILABLE');
    // Publié = immuable en base.
    await expect(
      database.sql.query('UPDATE tournament_results SET score = 0 WHERE tournament_id = $1', [
        t.id,
      ]),
    ).rejects.toThrow(/immuable/);
    await expect(
      database.sql.query('DELETE FROM tournament_results WHERE tournament_id = $1', [t.id]),
    ).rejects.toThrow(/immuable/);
  });

  it('paramètres modifiés après coup : résultats historiques inchangés', async () => {
    const t = await completedTournament();
    const before = (await get(ana, `/api/tournaments/${t.id}/results`).expect(200)).body;
    await stack.tournaments.updateSettings(admin, {
      rankingTokensWeightPercent: 10,
      rankingGamesWeightPercent: 90,
    });
    await stack.scheduler.tick();
    const after = (await get(ana, `/api/tournaments/${t.id}/results`).expect(200)).body;
    expect(after.results).toEqual(before.results);
    expect(after.me).toEqual(before.me);
    expect(after.rules).toEqual(before.rules);
  });

  it('consultable après redémarrage, reconnexion et des semaines plus tard (historique dédié)', async () => {
    const t = await completedTournament();
    const before = (await get(ana, `/api/tournaments/${t.id}/results`).expect(200)).body;

    // Redémarrage du backend : nouvelle pile, même base PostgreSQL ; nouvelle connexion.
    const clock = stack.clock;
    await stack.stop();
    stack = newStack(clock);
    ana = { ...ana, token: (await login(stack.app, ana.email, ana.password)).accessToken };
    expect((await get(ana, `/api/tournaments/${t.id}/results`).expect(200)).body.results).toEqual(
      before.results,
    );

    // 30 jours plus tard : retiré de la liste principale (7 jours, D-072), toujours dans
    // l'historique des résultats et consultable.
    stack.clock.advance(30 * 24 * HOUR);
    const list = (await get(ana, '/api/tournaments').expect(200)).body;
    expect(list.history.map((x: { tournamentId: string }) => x.tournamentId)).not.toContain(t.id);
    const history = (await get(ana, '/api/tournaments/results').expect(200)).body;
    expect(history.tournaments).toEqual([
      expect.objectContaining({
        tournamentId: t.id,
        status: 'COMPLETED',
        participants: 20,
        myRank: before.me.rank,
        myScore: 46.1905,
      }),
    ]);
    expect(history.tournaments[0].resultsPublishedAt).toBeDefined();
    await get(ana, `/api/tournaments/${t.id}/results`).expect(200);
    // Pagination : rien avant le plus ancien ; date invalide refusée.
    const older = await get(
      ana,
      `/api/tournaments/results?before=${encodeURIComponent(history.nextBefore)}`,
    ).expect(200);
    expect(older.body.tournaments).toEqual([]);
    await get(ana, '/api/tournaments/results?before=pas-une-date').expect(400);
  });

  it('un échec du signal temps réel n’empêche ni la publication ni la consultation', async () => {
    const clock = stack.clock;
    await stack.stop();
    stack = newStack(clock, {
      publish: () => {
        throw new Error('Redis indisponible');
      },
    });
    const t = await completedTournament();
    const res = await get(ana, `/api/tournaments/${t.id}/results`).expect(200);
    expect(res.body.results).toHaveLength(20);
    expect(await notificationTypes(ana)).toContain('TOURNAMENT_RESULTS_AVAILABLE');
  });
});

describe('contexte du tournoi pendant le jeu et tournoi suivant', () => {
  it('HUD : jetons et parties de CE tournoi, rang provisoire, jamais le compte de jeu', async () => {
    const t = await startedTournament();
    const { gameId } = await startTable(t);
    await playOut(gameId);
    const ctx = (await get(ana, `/api/tournaments/${t.id}/me`).expect(200)).body.context;
    expect(ctx).toMatchObject({
      tournamentId: t.id,
      status: 'IN_PROGRESS',
      participation: 'ACTIVE',
      tokensAllocatedAtStart: 1000,
      tokensRemaining: 900,
      gamesPlayed: 1,
      participants: 20,
      rank: 20,
      rankIsOfficial: false,
    });
    expect(JSON.stringify(ctx)).not.toMatch(/balance|reserved|available/);
    const carl = await player();
    expect((await get(carl, `/api/tournaments/${t.id}/me`)).status).not.toBe(200);
  });

  it('tournoi suivant : nouveau capital, nouvel historique, le précédent reste immuable', async () => {
    const first = await startedTournament();
    const { gameId } = await startTable(first);
    await playOut(gameId);
    // Le tournoi suivant est publié pendant le premier (créneau après sa fin).
    const second = await stack.tournaments.createAsAdmin(admin, {
      ...tournamentInput(stack.clock, 0),
      startsAt: new Date(first.endsAt.getTime() + HOUR),
      endsAt: new Date(first.endsAt.getTime() + 3 * HOUR),
    });
    await stack.tournaments.register(second.id, ana.id);
    await stack.tournaments.register(second.id, ben.id);
    await fillWith(stack, database.sql, second.id);

    stack.clock.set(first.endsAt);
    await stack.tournaments.advance(first.id);
    const firstResults = (await stack.tournaments.results(first.id)).rows;

    stack.clock.set(second.startsAt);
    const started = await stack.tournaments.advance(second.id);
    expect(started.status).toBe('IN_PROGRESS');
    // Capital neuf : rien n'est repris du premier tournoi (ana y avait fini à 900).
    expect(await account(started, ana)).toMatchObject({ currentTokens: 1000, gamesPlayed: 0 });
    const table = await startTable(started);
    const game = (await stack.games.findGame(table.gameId))!;
    expect(game.tournamentId).toBe(second.id);
    await stack.tournaments.settleGame(finishedCopy(game, ana.id, stack.clock.now()));
    expect(await account(started, ana)).toMatchObject({ currentTokens: 1100, gamesPlayed: 1 });
    // Le premier tournoi ne bouge pas.
    expect((await stack.tournaments.results(first.id)).rows).toEqual(firstResults);
    expect(await stack.repository.findAccount(first.id, ana.id)).toMatchObject({
      currentTokens: 900,
      gamesPlayed: 1,
    });
    // Compte de jeu : seulement les deux prix d'entrée (aucun jeton de tournoi).
    expect((await balances(database.sql, ana.id)).balance).toBe(5000 - 1000 - 1000);
  });
});
