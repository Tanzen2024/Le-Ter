import type { PlayerId } from '../../../src/domain/game/game-id';
import { PlayerAlreadyInSessionError } from '../../../src/domain/sessions/session';
import {
  AlreadyRegisteredError,
  InvalidTournamentTransitionError,
  NotRegisteredError,
  TooManyPendingTournamentsError,
  TooManyWaitingTournamentsError,
  TournamentAccessDeniedError,
  TournamentCompletedError,
  TournamentFullError,
  TournamentNotStartedError,
  TournamentOutOfTokensError,
  TournamentOverlapError,
  TournamentRegistrationClosedError,
  TournamentStartedError,
  type Tournament,
} from '../../../src/domain/tournaments/tournament';
import type { UserId } from '../../../src/domain/users/user';
import { InsufficientBalanceError } from '../../../src/domain/wallet/wallet';
import {
  createMigratedDatabase,
  PGLITE_TIMEOUT_MS,
  type TestDatabase,
} from '../../fixtures/pglite';
import {
  balances,
  createTournamentTestStack,
  fillWith,
  saveTournamentSettings,
  finishedCopy,
  HOUR,
  MINUTE,
  seedAdmin,
  seedPlayers,
  TestClock,
  tournamentInput,
  type TournamentTestStack,
} from '../../fixtures/tournaments';

/**
 * TournamentService (D-054, D-057) sur PostgreSQL (PGlite), de la création au versement des
 * gains : réservation, libération, capture, cagnotte, tables (SessionService), jetons de
 * tournoi, classement, gains idempotents, notifications. Minimum de 20 participants : les
 * joueurs nommés sont complétés par des « figurants » réellement inscrits (`fillWith`).
 */
jest.setTimeout(90_000);

let database: TestDatabase;
let stack: TournamentTestStack;
let admin: UserId;
let players: UserId[];
const NAMES = ['ana', 'ben', 'cid', 'dan', 'eva', 'fay'];

beforeAll(async () => {
  database = await createMigratedDatabase();
}, PGLITE_TIMEOUT_MS);
afterAll(() => database.close());
beforeEach(async () => {
  stack = createTournamentTestStack(database.sql, new TestClock());
  admin = await seedAdmin(database.sql);
  players = await seedPlayers(database.sql, NAMES, 5000);
  await saveTournamentSettings(database.sql);
});
afterEach(async () => {
  await stack.stop();
  await database.reset();
});

const [ANA, BEN, CID, DAN, EVA, FAY] = [0, 1, 2, 3, 4, 5];
const p = (i: number) => players[i]!;
const pid = (i: number) => players[i]! as string as PlayerId;

/** Tournoi publié par l'admin (20 à 100 joueurs), commençant dans 1 h (inscriptions ouvertes). */
const published = (extra = {}) =>
  stack.tournaments.createAsAdmin(admin, tournamentInput(stack.clock, HOUR, extra));

/** Inscrit les joueurs nommés (dans cet ordre), puis des figurants jusqu'au minimum de 20. */
async function registerWith(t: Tournament, ...who: number[]): Promise<UserId[]> {
  for (const i of who) {
    await stack.tournaments.register(t.id, p(i));
    stack.clock.advance(1000); // ordre d'inscription distinct (départage du classement)
  }
  return fillWith(stack, database.sql, t.id);
}

async function startWith(t: Tournament, ...who: number[]): Promise<Tournament> {
  await registerWith(t, ...who);
  stack.clock.set(t.startsAt);
  return stack.tournaments.advance(t.id);
}

const count = async (sql: string, params: unknown[]) =>
  Number((await database.sql.query<{ n: number }>(sql, params)).rows[0]?.n ?? 0);

const notificationTypes = async (user: UserId) =>
  (await stack.notifications.list(user)).notifications.map((n) => n.type).sort();

describe('création, approbation, chevauchement', () => {
  it('admin : publié directement, inscriptions ouvertes, commission copiée, audité', async () => {
    const t = await published();
    expect(t.status).toBe('REGISTRATION_OPEN');
    expect(t.platformFeeBps).toBe(1000);
    expect(t.registrationClosesAt?.toISOString()).toBe(t.startsAt.toISOString());
    expect(
      await count(`SELECT count(*)::int AS n FROM admin_audit_log WHERE target_id = $1`, [t.id]),
    ).toBe(1);
  });

  it('la commission d’un tournoi publié ne change plus avec le paramètre', async () => {
    const t = await published();
    await stack.tournaments.updateSettings(admin, { platformFeePercent: 12 });
    expect((await stack.repository.findById(t.id))?.platformFeeBps).toBe(1000);
    const next = await stack.tournaments.createAsAdmin(
      admin,
      tournamentInput(stack.clock, 5 * HOUR),
    );
    expect(next.platformFeeBps).toBe(1200);
  });

  it('joueur : brouillon → en attente → approuvé (notifié) ; limite d’un en attente', async () => {
    const draft = await stack.tournaments.createAsPlayer(
      p(ANA),
      tournamentInput(stack.clock, 2 * HOUR),
    );
    expect(draft.status).toBe('DRAFT');
    expect(draft.platformFeeBps).toBeUndefined();
    await expect(
      stack.tournaments.createAsPlayer(p(ANA), tournamentInput(stack.clock, 6 * HOUR)),
    ).rejects.toBeInstanceOf(TooManyPendingTournamentsError);
    expect((await stack.tournaments.submit(draft.id, p(ANA))).status).toBe('PENDING_APPROVAL');
    const approved = await stack.tournaments.approve(draft.id, admin);
    expect(approved.status).toBe('REGISTRATION_OPEN');
    expect(approved.platformFeeBps).toBe(1000);
    expect(await notificationTypes(p(ANA))).toEqual(['TOURNAMENT_APPROVED']);
  });

  it('un joueur ne peut pas publier ni approuver lui-même : seul l’admin approuve', async () => {
    const draft = await stack.tournaments.createAsPlayer(
      p(ANA),
      tournamentInput(stack.clock, 2 * HOUR),
    );
    await expect(stack.tournaments.approve(draft.id, admin)).rejects.toBeInstanceOf(
      InvalidTournamentTransitionError,
    ); // DRAFT : il doit d'abord être soumis
  });

  it('refus : annulé (APPROVAL_REJECTED), le créateur est notifié', async () => {
    const draft = await stack.tournaments.createAsPlayer(
      p(ANA),
      tournamentInput(stack.clock, 2 * HOUR),
    );
    await stack.tournaments.submit(draft.id, p(ANA));
    const rejected = await stack.tournaments.reject(draft.id, admin);
    expect(rejected).toMatchObject({
      status: 'CANCELLED',
      cancellationReason: 'APPROVAL_REJECTED',
    });
    expect(await notificationTypes(p(ANA))).toEqual(['TOURNAMENT_CANCELLED']);
  });

  it('chevauchement refusé (création, soumission D-113, approbation par PostgreSQL)', async () => {
    await published();
    await expect(published()).rejects.toBeInstanceOf(TournamentOverlapError);
    const proposal = await stack.tournaments.createAsPlayer(
      p(BEN),
      tournamentInput(stack.clock, 2 * HOUR),
    );
    // D-113 : refusé dès la soumission (avant toute préinscription).
    await expect(stack.tournaments.submit(proposal.id, p(BEN))).rejects.toBeInstanceOf(
      TournamentOverlapError,
    );
    // Tournoi publié APRÈS la soumission : l'approbation reste refusée par PostgreSQL.
    const later = await stack.tournaments.createAsPlayer(
      p(CID),
      tournamentInput(stack.clock, 10 * HOUR),
    );
    await stack.tournaments.submit(later.id, p(CID));
    await stack.tournaments.createAsAdmin(admin, tournamentInput(stack.clock, 10 * HOUR));
    await expect(stack.tournaments.approve(later.id, admin)).rejects.toBeInstanceOf(
      TournamentOverlapError,
    );
  });

  it('période de transition : bloque le créneau qui suit la fin', async () => {
    await stack.tournaments.updateSettings(admin, { tournamentTransitionMinutes: 30 });
    const t = await published();
    const after = new Date(t.endsAt.getTime() + 10 * MINUTE);
    await expect(
      stack.tournaments.createAsAdmin(admin, {
        ...tournamentInput(stack.clock, 0),
        startsAt: after,
        endsAt: new Date(after.getTime() + HOUR),
      }),
    ).rejects.toBeInstanceOf(TournamentOverlapError);
  });

  it('un tournoi annulé libère son créneau', async () => {
    const t = await published();
    await stack.tournaments.cancel(t.id, { userId: admin, isAdmin: true });
    await expect(published()).resolves.toBeDefined();
  });
});

describe('inscription et réservation', () => {
  it('réserve le prix sans débit et notifie la confirmation', async () => {
    const t = await published();
    const snapshot = await stack.tournaments.register(t.id, p(ANA));
    expect(snapshot.registration?.status).toBe('REGISTERED');
    expect(snapshot.reservation).toMatchObject({ amount: 1000, status: 'ACTIVE' });
    expect(await balances(database.sql, p(ANA))).toEqual({
      balance: 5000,
      reserved: 1000,
      available: 4000,
    });
    expect(await notificationTypes(p(ANA))).toEqual(['TOURNAMENT_REGISTRATION_CONFIRMED']);
  });

  it('double inscription refusée, même simultanée : une seule réservation', async () => {
    const t = await published();
    const results = await Promise.allSettled([
      stack.tournaments.register(t.id, p(ANA)),
      stack.tournaments.register(t.id, p(ANA)),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    await expect(stack.tournaments.register(t.id, p(ANA))).rejects.toBeInstanceOf(
      AlreadyRegisteredError,
    );
    expect((await balances(database.sql, p(ANA))).reserved).toBe(1000);
  });

  it('solde disponible insuffisant : ni inscription ni réservation (rollback)', async () => {
    const [poor] = await seedPlayers(database.sql, ['poor'], 500);
    const t = await published();
    await expect(stack.tournaments.register(t.id, poor!)).rejects.toBeInstanceOf(
      InsufficientBalanceError,
    );
    expect(await stack.repository.findRegistration(t.id, poor!)).toBeNull();
    expect((await balances(database.sql, poor!)).reserved).toBe(0);
  });

  it('capacité maximale respectée (maximum 20, le 21e est refusé sans réservation)', async () => {
    const t = await published({ maximumPlayers: 20 });
    await fillWith(stack, database.sql, t.id, 20);
    await expect(stack.tournaments.register(t.id, p(CID))).rejects.toBeInstanceOf(
      TournamentFullError,
    );
    expect(await stack.repository.findRegistration(t.id, p(CID))).toBeNull();
    expect((await balances(database.sql, p(CID))).reserved).toBe(0);
  });

  it('inscriptions simultanées au-delà de la capacité : jamais plus que le maximum', async () => {
    const t = await published({ maximumPlayers: 20 });
    await fillWith(stack, database.sql, t.id, 18);
    const results = await Promise.allSettled(
      [ANA, BEN, CID, DAN, EVA].map((i) => stack.tournaments.register(t.id, p(i))),
    );
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(2);
    for (const r of results.filter((x) => x.status === 'rejected')) {
      expect((r as PromiseRejectedResult).reason).toBeInstanceOf(TournamentFullError);
    }
    expect(await stack.repository.countActiveRegistrations(t.id)).toBe(20);
  });

  it('désinscription avant la fermeture : réservation libérée ; réinscription possible', async () => {
    const t = await published();
    await stack.tournaments.register(t.id, p(ANA));
    const after = await stack.tournaments.unregister(t.id, p(ANA));
    expect(after.registration?.status).toBe('CANCELLED');
    expect(await balances(database.sql, p(ANA))).toMatchObject({ reserved: 0, available: 5000 });
    await stack.tournaments.register(t.id, p(ANA));
    expect((await balances(database.sql, p(ANA))).reserved).toBe(1000);
  });

  it('après la fermeture : inscription et désinscription refusées ; après le démarrage : TOURNAMENT_STARTED', async () => {
    const t = await published({ registrationClosesAt: undefined });
    await registerWith(t, ANA, BEN);
    stack.clock.set(t.registrationClosesAt!);
    await expect(stack.tournaments.register(t.id, p(CID))).rejects.toBeInstanceOf(
      TournamentRegistrationClosedError,
    );
    await stack.tournaments.advance(t.id);
    expect((await stack.repository.findById(t.id))?.status).toBe('IN_PROGRESS');
    await expect(stack.tournaments.unregister(t.id, p(ANA))).rejects.toBeInstanceOf(
      TournamentStartedError,
    );
  });
});

describe('annulation et démarrage', () => {
  it('annulation admin avant démarrage : toutes les réservations libérées, inscrits notifiés', async () => {
    const t = await published();
    await stack.tournaments.register(t.id, p(ANA));
    await stack.tournaments.register(t.id, p(BEN));
    const cancelled = await stack.tournaments.cancel(t.id, { userId: admin, isAdmin: true });
    expect(cancelled).toMatchObject({ status: 'CANCELLED', cancellationReason: 'ADMIN_CANCELLED' });
    for (const i of [ANA, BEN]) {
      expect(await balances(database.sql, p(i))).toEqual({
        balance: 5000,
        reserved: 0,
        available: 5000,
      });
      expect(await notificationTypes(p(i))).toContain('TOURNAMENT_CANCELLED');
    }
    expect(
      await count(
        `SELECT count(*)::int AS n FROM wallet_transactions WHERE kind = 'tournament_entry'`,
        [],
      ),
    ).toBe(0);
  });

  it('minimum (20) non atteint au début : CANCELLED (INSUFFICIENT_PLAYERS), réservations libérées', async () => {
    const t = await published();
    for (const i of [ANA, BEN]) await stack.tournaments.register(t.id, p(i));
    await fillWith(stack, database.sql, t.id, 19);
    stack.clock.set(t.startsAt);
    const after = await stack.tournaments.advance(t.id);
    expect(after).toMatchObject({
      status: 'CANCELLED',
      cancellationReason: 'INSUFFICIENT_PLAYERS',
    });
    expect(await balances(database.sql, p(ANA))).toMatchObject({ balance: 5000, reserved: 0 });
  });

  it('minimum atteint : capture, commission au registre plateforme, cagnotte figée, comptes de tournoi', async () => {
    const t = await published();
    const started = await startWith(t, ANA, BEN, CID);
    expect(started).toMatchObject({
      status: 'IN_PROGRESS',
      participants: 20,
      grossPool: 20_000,
      platformFee: 2000,
      prizePool: 18_000,
    });
    expect(await balances(database.sql, p(ANA))).toEqual({
      balance: 4000,
      reserved: 0,
      available: 4000,
    });
    const ledger = await database.sql.query<{ kind: string; amount: string; fee_bps: number }>(
      'SELECT kind, amount, fee_bps FROM platform_ledger WHERE tournament_id = $1',
      [t.id],
    );
    expect(ledger.rows.map((r) => [r.kind, Number(r.amount), r.fee_bps])).toEqual([
      ['TOURNAMENT_PLATFORM_FEE', 2000, 1000],
    ]);
    const account = await stack.repository.findAccount(t.id, p(BEN));
    expect(account).toMatchObject({ initialTokens: 1000, currentTokens: 1000, status: 'ACTIVE' });
    expect(await notificationTypes(p(CID))).toContain('TOURNAMENT_STARTED');
    // Rejouer le démarrage ne capture rien de plus.
    await stack.tournaments.advance(t.id);
    expect(
      await count(
        `SELECT count(*)::int AS n FROM wallet_transactions WHERE kind = 'tournament_entry'`,
        [],
      ),
    ).toBe(20);
  });

  it('annulation refusée après la capture', async () => {
    const t = await startWith(await published(), ANA, BEN);
    await expect(
      stack.tournaments.cancel(t.id, { userId: admin, isAdmin: true }),
    ).rejects.toBeInstanceOf(TournamentStartedError);
  });
});

describe('tables de tournoi (SessionService)', () => {
  it('avant le début, non inscrit, après la fin : refusés sans session créée', async () => {
    const t = await published();
    await registerWith(t, ANA, BEN);
    await expect(stack.tournaments.join(t.id, p(ANA))).rejects.toBeInstanceOf(
      TournamentNotStartedError,
    );
    stack.clock.set(t.startsAt);
    await expect(stack.tournaments.join(t.id, p(CID))).rejects.toBeInstanceOf(NotRegisteredError);
    expect(await stack.sessions.findActiveSessions(pid(CID))).toEqual([]);
    stack.clock.set(t.endsAt);
    await expect(stack.tournaments.join(t.id, p(ANA))).rejects.toBeInstanceOf(
      TournamentCompletedError,
    );
  });

  it('tables de 4 : les participants s’assoient à la même table, le 5e en ouvre une autre', async () => {
    const t = await startWith(await published(), ANA, BEN, CID, DAN, EVA);
    const first = await stack.tournaments.join(t.id, p(ANA));
    for (const i of [BEN, CID, DAN])
      expect(await stack.tournaments.join(t.id, p(i))).toEqual(first);
    const fifth = await stack.tournaments.join(t.id, p(EVA));
    expect(fifth.sessionId).not.toBe(first.sessionId);
    const { session } = await stack.sessions.getSession(first.sessionId, pid(ANA));
    expect(session.maxPlayers).toBe(4);
    expect(session.creatorId).toBe(pid(ANA));
    const linked = await database.sql.query<{ tournament_id: string }>(
      `SELECT ts.tournament_id FROM tournament_sessions ts JOIN games g ON g.session_id = ts.session_id
       WHERE g.id = $1`,
      [first.gameId],
    );
    expect(linked.rows).toEqual([{ tournament_id: t.id }]);
  });

  it('déjà dans une autre session : ALREADY_IN_SESSION', async () => {
    const t = await startWith(await published(), ANA, BEN);
    await stack.sessions.createSession(pid(ANA), { maxPlayers: 2 });
    await expect(stack.tournaments.join(t.id, p(ANA))).rejects.toBeInstanceOf(
      PlayerAlreadyInSessionError,
    );
  });

  it('accès direct à une table de tournoi refusé aux non-participants ; table absente des tables ouvertes', async () => {
    const t = await startWith(await published(), ANA, BEN);
    const seat = await stack.tournaments.join(t.id, p(ANA));
    expect(await stack.sessions.listOpenTables(pid(FAY))).toEqual([]);
    await expect(stack.sessions.joinSession(seat.sessionId, pid(FAY))).rejects.toBeInstanceOf(
      TournamentAccessDeniedError,
    );
    await expect(stack.sessions.joinSession(seat.sessionId, pid(BEN))).resolves.toBeDefined();
  });
});

describe('jetons de tournoi, classement, gains', () => {
  /** Partie à 3 : ana crée, ben et cid rejoignent, ana démarre ; `winner` gagne. */
  async function playGame(t: Tournament, winner: number, seats = [ANA, BEN, CID]) {
    const seat = await stack.tournaments.join(t.id, p(seats[0]!));
    for (const i of seats.slice(1)) await stack.tournaments.join(t.id, p(i));
    await stack.games.startGame(seat.gameId, pid(seats[0]!));
    const game = (await stack.games.findGame(seat.gameId))!;
    await stack.tournaments.settleGame(finishedCopy(game, p(winner), new Date()));
    await stack.games.finishGame(seat.gameId); // la vraie partie se termine (sans double règlement)
    await stack.tournaments.idle();
    return seat;
  }

  it('mise 100 : le gagnant prend 200 aux deux autres ; règlement unique par partie', async () => {
    const t = await startWith(await published(), ANA, BEN, CID);
    const seat = await playGame(t, BEN);
    const tokens = async (i: number) => (await stack.repository.findAccount(t.id, p(i)))!;
    expect(await tokens(BEN)).toMatchObject({ currentTokens: 1200, gamesPlayed: 1, gamesWon: 1 });
    expect(await tokens(ANA)).toMatchObject({ currentTokens: 900, gamesPlayed: 1, gamesWon: 0 });
    const game = (await stack.games.findGame(seat.gameId))!;
    await stack.tournaments.settleGame(finishedCopy(game, p(ANA), new Date()));
    expect((await tokens(BEN)).currentTokens).toBe(1200); // déjà réglée : rien ne change
    const row = await database.sql.query<{ status: string; pot: number }>(
      'SELECT status, pot FROM tournament_games WHERE game_id = $1',
      [seat.gameId],
    );
    expect(row.rows).toEqual([{ status: 'SETTLED', pot: 300 }]);
    // Le compte de jeu n'est jamais touché par une partie.
    expect((await balances(database.sql, p(BEN))).balance).toBe(4000);
  });

  it('partie sans gagnant (arrêt administratif) : VOID, aucun mouvement', async () => {
    const t = await startWith(await published(), ANA, BEN);
    const seat = await stack.tournaments.join(t.id, p(ANA));
    await stack.tournaments.join(t.id, p(BEN));
    await stack.games.startGame(seat.gameId, pid(ANA));
    await stack.games.finishGame(seat.gameId);
    await stack.tournaments.idle();
    const row = await database.sql.query<{ status: string }>(
      'SELECT status FROM tournament_games WHERE game_id = $1',
      [seat.gameId],
    );
    expect(row.rows).toEqual([{ status: 'VOID' }]);
    expect((await stack.repository.findAccount(t.id, p(ANA)))!.gamesPlayed).toBe(0);
  });

  it('sous le seuil (2 × mise, D-063) : OUT_OF_TOKENS, plus de nouvelle table, classement conservé', async () => {
    // 200 jetons, mise 100 : seuil 200 atteint au départ ; une défaite → 100, sous le seuil.
    await stack.tournaments.updateSettings(admin, {
      initialTokensCoefficient: 0.2,
      stakePerGameCoefficient: 0.1,
    });
    const t = await startWith(await published(), ANA, BEN);
    await playGame(t, ANA, [ANA, BEN]);
    expect(await stack.repository.findAccount(t.id, p(BEN))).toMatchObject({
      currentTokens: 100,
      status: 'OUT_OF_TOKENS',
    });
    // ben quitte sa table (ronde Poursuivre/Quitter : vaut « Quitter »), puis redemande une table.
    const [table] = await stack.sessions.findActiveSessions(pid(BEN));
    await stack.sessions.leaveSession(table!.id, pid(BEN));
    await expect(stack.tournaments.join(t.id, p(BEN))).rejects.toBeInstanceOf(
      TournamentOutOfTokensError,
    );
    const standing = (await stack.tournaments.standings(t.id, p(ANA))).rows.map((r) => r.playerId);
    expect(standing).toHaveLength(20);
    expect(standing[0]).toBe(p(ANA)); // 300 jetons, 1 partie
    expect(standing[19]).toBe(p(BEN)); // 100 jetons, 1 partie : classé, dernier
  });

  it('de bout en bout : classement, gains (reste au 1er), versements idempotents, résultats annoncés', async () => {
    const t = await published();
    const fillers = await registerWith(t, ANA, BEN, CID, DAN);
    stack.clock.set(t.startsAt);
    const started = await stack.tournaments.advance(t.id);
    expect(started.prizePool).toBe(18_000); // 20 × 1000 − 10 %
    await playGame(started, CID, [ANA, BEN, CID]);
    stack.clock.set(t.endsAt);
    const done = await stack.tournaments.advance(t.id);
    expect(done.status).toBe('COMPLETED');

    const { rows } = await stack.tournaments.results(t.id);
    expect(rows).toHaveLength(20);
    // cid 1200 ; puis 1000 jetons sans partie : dan (inscrit avant les figurants), puis un
    // figurant ; ana et ben 900 (1 partie) derniers, ana avant ben (ordre d'inscription).
    expect(
      rows.slice(0, 2).map((r) => [r.rank, r.playerId, r.remainingTokens, r.prizeAmount]),
    ).toEqual([
      [1, p(CID), 1200, 9000],
      [2, p(DAN), 1000, 5400],
    ]);
    expect(rows[2]).toMatchObject({ rank: 3, remainingTokens: 1000, prizeAmount: 3600 });
    expect(fillers).toContain(rows[2]!.playerId);
    expect(rows.slice(18).map((r) => [r.rank, r.playerId, r.prizeAmount])).toEqual([
      [19, p(ANA), 0],
      [20, p(BEN), 0],
    ]);
    expect((await balances(database.sql, p(CID))).balance).toBe(4000 + 9000);
    expect((await balances(database.sql, p(BEN))).balance).toBe(4000);

    // Reprise du traitement : jamais un second paiement.
    await stack.tournaments.advance(t.id);
    await stack.scheduler.tick();
    expect(
      await count(
        `SELECT count(*)::int AS n FROM wallet_transactions WHERE kind = 'tournament_prize'`,
        [],
      ),
    ).toBe(3);
    expect(await notificationTypes(p(CID))).toEqual(
      expect.arrayContaining(['TOURNAMENT_PRIZE_CREDITED', 'TOURNAMENT_RESULTS_AVAILABLE']),
    );
    expect(await notificationTypes(p(BEN))).not.toContain('TOURNAMENT_PRIZE_CREDITED');
  });

  it('score pondéré figé (D-062, D-106) : poids copiés à la publication, méthode figée au démarrage, classement publié jamais recalculé', async () => {
    const t = await published();
    expect(t.rankingWeights).toEqual({ tokensBps: 5000, gamesBps: 5000 });
    await registerWith(t, ANA, BEN, CID, DAN);
    stack.clock.set(t.startsAt);
    const started = await stack.tournaments.advance(t.id);
    await playGame(started, CID, [ANA, BEN, CID]);

    // Changement de configuration PENDANT le tournoi : sans effet sur lui.
    await stack.tournaments.updateSettings(admin, {
      rankingTokensWeightPercent: 10,
      rankingGamesWeightPercent: 90,
    });
    expect((await stack.repository.findById(t.id))?.rankingWeights).toEqual({
      tokensBps: 5000,
      gamesBps: 5000,
    });
    stack.clock.set(t.endsAt);
    expect((await stack.tournaments.advance(t.id)).status).toBe('COMPLETED');

    // Méthode D-106 (figée au démarrage) : jetons restants / 1 000 de capital, parties
    // jouées / 42 parties de référence (2 h), plafonné à 1. À 50 / 50 :
    // cid 1200 j. / 1 partie = 60 + 1,1905 = 61,1905 ; dan 1000 j. / 0 partie = 50 ;
    // ana 900 j. / 1 = 45 + 1,1905 = 46,1905. (À 10 / 90, ana passerait devant dan :
    // 11,1429 contre 10.)
    expect((await stack.repository.findById(t.id))?.rankingMethod).toBe('D106_CAPITAL_RATIO');
    const snapshot = async () =>
      (await stack.tournaments.results(t.id)).rows.map((r) => [r.rank, r.playerId, r.score]);
    const before = await snapshot();
    expect(before.slice(0, 2)).toEqual([
      [1, p(CID), 61.1905],
      [2, p(DAN), 50],
    ]);
    expect(before.slice(18)).toEqual([
      [19, p(ANA), 46.1905],
      [20, p(BEN), 46.1905],
    ]);
    const stored = await database.sql.query<{ score: string }>(
      'SELECT score::text AS score FROM tournament_results WHERE tournament_id = $1 AND rank = 1',
      [t.id],
    );
    expect(stored.rows).toEqual([{ score: '61.1905' }]);

    // Nouveau changement APRÈS publication des résultats, puis reprise : rien ne bouge.
    await stack.tournaments.updateSettings(admin, {
      rankingTokensWeightPercent: 100,
      rankingGamesWeightPercent: 0,
    });
    await stack.scheduler.tick();
    expect(await snapshot()).toEqual(before);
    expect((await stack.tournaments.standings(t.id, p(ANA))).rows.map((r) => r.score)).toEqual(
      before.map((r) => r[2]),
    );

    // Les nouveaux tournois reçoivent la configuration courante.
    const next = await stack.tournaments.createAsAdmin(
      admin,
      tournamentInput(stack.clock, 5 * HOUR),
    );
    expect(next.rankingWeights).toEqual({ tokensBps: 10_000, gamesBps: 0 });
  });

  it('poids du classement : somme exactement 100 %, validée côté serveur', async () => {
    await expect(
      stack.tournaments.updateSettings(admin, { rankingTokensWeightPercent: 60 }),
    ).rejects.toMatchObject({
      name: 'InvalidTournamentError',
      fields: { rankingTokensWeightPercent: 'La somme des poids doit être exactement 100 %.' },
    });
    await expect(
      stack.tournaments.updateSettings(admin, {
        rankingTokensWeightPercent: 101,
        rankingGamesWeightPercent: -1,
      }),
    ).rejects.toMatchObject({ name: 'InvalidTournamentError' });
    expect(await stack.tournaments.getSettings()).toMatchObject({
      rankingTokensWeightPercent: 50,
      rankingGamesWeightPercent: 50,
    });
    await stack.tournaments.updateSettings(admin, {
      rankingTokensWeightPercent: 60,
      rankingGamesWeightPercent: 40,
    });
    expect(await stack.tournaments.getSettings()).toMatchObject({
      rankingTokensWeightPercent: 60,
      rankingGamesWeightPercent: 40,
    });
  });

  it('20 participants au moins, 10 rangs au plus : tous les rangs payés, rien de non attribué', async () => {
    // D-057 : le minimum (20) dépasse toujours le nombre de rangs payés (10 au plus). Le cas
    // « part non attribuée » reste couvert par les tests unitaires de computePrizes.
    const t = await startWith(await published(), ANA, BEN);
    stack.clock.set(t.endsAt);
    await stack.tournaments.advance(t.id);
    const after = (await stack.repository.findById(t.id))!;
    expect(after).toMatchObject({ status: 'COMPLETED', prizePool: 18_000, unallocatedPrize: 0 });
    const ledger = await database.sql.query<{ kind: string; amount: string }>(
      `SELECT kind, amount FROM platform_ledger WHERE tournament_id = $1 ORDER BY kind`,
      [t.id],
    );
    expect(ledger.rows.map((r) => [r.kind, Number(r.amount)])).toEqual([
      ['TOURNAMENT_PLATFORM_FEE', 2000],
    ]);
  });

  it('le planificateur applique les échéances sans commande', async () => {
    const t = await published();
    await registerWith(t, ANA, BEN);
    stack.clock.set(t.startsAt);
    await stack.scheduler.tick();
    expect((await stack.repository.findById(t.id))?.status).toBe('IN_PROGRESS');
    stack.clock.set(t.endsAt);
    await stack.scheduler.tick();
    expect((await stack.repository.findById(t.id))?.status).toBe('COMPLETED');
  });
});

describe('délai minimal d’une proposition (D-056, D-108)', () => {
  it('soumission refusée à moins d’1 h du début', async () => {
    const draft = await stack.tournaments.createAsPlayer(
      p(ANA),
      tournamentInput(stack.clock, 2 * HOUR),
    );
    stack.clock.advance(90 * MINUTE);
    await expect(stack.tournaments.submit(draft.id, p(ANA))).rejects.toMatchObject({
      name: 'InvalidTournamentError',
      fields: { startsAt: 'Le tournoi doit commencer au moins 1 h plus tard.' },
    });
    expect((await stack.repository.findById(draft.id))?.status).toBe('DRAFT');
  });

  it('D-108 : approbation acceptée à moins d’1 h du début (seul un début passé est refusé)', async () => {
    const draft = await stack.tournaments.createAsPlayer(
      p(ANA),
      tournamentInput(stack.clock, 2 * HOUR),
    );
    await stack.tournaments.submit(draft.id, p(ANA));
    stack.clock.advance(70 * MINUTE);
    expect((await stack.tournaments.approve(draft.id, admin)).status).toBe('REGISTRATION_OPEN');
  });
});

describe('règles revérifiées à la soumission, à l’approbation et à la modification (D-057)', () => {
  it('soumission refusée pour un brouillon créé sous d’anciennes limites (2 joueurs, 20 min)', async () => {
    const draft = await stack.tournaments.createAsPlayer(
      p(ANA),
      tournamentInput(stack.clock, 3 * HOUR),
    );
    // Donnée historique : écrite directement, comme avant D-057.
    await database.sql.query(
      `UPDATE tournaments SET minimum_players = 2, maximum_players = NULL,
         ends_at = starts_at + interval '20 minutes' WHERE id = $1`,
      [draft.id],
    );
    await expect(stack.tournaments.submit(draft.id, p(ANA))).rejects.toMatchObject({
      name: 'InvalidTournamentError',
      fields: expect.objectContaining({
        minimumPlayers: expect.any(String),
        endsAt: 'Durée entre 45 minutes et 120 minutes.',
      }),
    });
    expect((await stack.repository.findById(draft.id))?.status).toBe('DRAFT');
  });

  it('approbation refusée pour une proposition hors des nouvelles limites (3 h)', async () => {
    const draft = await stack.tournaments.createAsPlayer(
      p(ANA),
      tournamentInput(stack.clock, 3 * HOUR),
    );
    await stack.tournaments.submit(draft.id, p(ANA));
    await database.sql.query(
      `UPDATE tournaments SET ends_at = starts_at + interval '3 hours' WHERE id = $1`,
      [draft.id],
    );
    await expect(stack.tournaments.approve(draft.id, admin)).rejects.toMatchObject({
      name: 'InvalidTournamentError',
      fields: expect.objectContaining({ endsAt: 'Durée entre 45 minutes et 120 minutes.' }),
    });
    expect((await stack.repository.findById(draft.id))?.status).toBe('PENDING_APPROVAL');
  });

  it('modification autorisée validée elle aussi (maximum 19 refusé ; au-delà du plafond réglé, refusé)', async () => {
    const t = await published();
    const actor = { userId: admin, isAdmin: true };
    await expect(
      stack.tournaments.update(t.id, actor, { maximumPlayers: 19 }),
    ).rejects.toMatchObject({ name: 'InvalidTournamentError' });
    await expect(
      stack.tournaments.update(t.id, actor, { maximumPlayers: 1000 }),
    ).resolves.toMatchObject({ maximumPlayers: 1000 });
    // Aucun plafond par défaut (∞) ; un plafond réglé s'applique aux modifications.
    await expect(
      stack.tournaments.update(t.id, actor, { maximumPlayers: 1001 }),
    ).resolves.toMatchObject({ maximumPlayers: 1001 });
    await stack.tournaments.updateSettings(admin, { tournamentMaximumPlayers: 1000 });
    await expect(
      stack.tournaments.update(t.id, actor, { maximumPlayers: 1001 }),
    ).rejects.toMatchObject({ name: 'InvalidTournamentError' });
  });
});

describe('limite de 5 tournois aux inscriptions ouvertes ou à ouvrir (D-059, D-072)', () => {
  /** Créneau n°i : début dans (1 + 3i) h, durée 1 h, jamais de chevauchement entre créneaux. */
  const slot = (i: number, extra = {}) => {
    const startsIn = HOUR + i * 3 * HOUR;
    return tournamentInput(stack.clock, startsIn, {
      endsAt: new Date(stack.clock.now().getTime() + startsIn + HOUR),
      ...extra,
    });
  };
  /** Tournois comptés dans la limite (D-072) : inscriptions ouvertes, ou à ouvrir. */
  const waiting = () =>
    count(
      `SELECT count(*)::int AS n FROM tournaments
       WHERE status IN ('SCHEDULED', 'REGISTRATION_OPEN')`,
      [],
    );
  const statusOf = async (id: string) => (await stack.repository.findById(id as never))?.status;

  it('inscriptions closes (REGISTRATION_CLOSED) ou démarrage (STARTING) : place libérée', async () => {
    const created: Tournament[] = [];
    for (let i = 0; i < 5; i += 1) {
      // Créneau 0 : inscriptions closes 30 min avant le début.
      const closes = i === 0 ? { registrationClosesAt: new Date(stack.clock.now().getTime() + 30 * MINUTE) } : {};
      created.push(await stack.tournaments.createAsAdmin(admin, slot(i, closes)));
    }
    expect(await waiting()).toBe(5);
    await expect(stack.tournaments.createAsAdmin(admin, slot(5))).rejects.toBeInstanceOf(
      TooManyWaitingTournamentsError,
    );

    stack.clock.advance(30 * MINUTE);
    expect((await stack.tournaments.advance(created[0]!.id)).status).toBe('REGISTRATION_CLOSED');
    expect(await waiting()).toBe(4);
    await expect(stack.tournaments.createAsAdmin(admin, slot(5))).resolves.toBeDefined();

    // STARTING (donnée de test : état transitoire du démarrage) ne compte pas non plus.
    await database.sql.query(`UPDATE tournaments SET status = 'STARTING' WHERE id = $1`, [
      created[1]!.id,
    ]);
    await expect(stack.tournaments.createAsAdmin(admin, slot(6))).resolves.toBeDefined();
    expect(await waiting()).toBe(5);
  });

  it('tournoi publié dont les inscriptions s’ouvriront plus tard (SCHEDULED) : compté', async () => {
    const later = await stack.tournaments.createAsAdmin(
      admin,
      slot(0, { registrationOpensAt: new Date(stack.clock.now().getTime() + 30 * MINUTE) }),
    );
    expect(await statusOf(later.id)).toBe('SCHEDULED');
    for (let i = 1; i < 5; i += 1) await stack.tournaments.createAsAdmin(admin, slot(i));
    await expect(stack.tournaments.createAsAdmin(admin, slot(5))).rejects.toBeInstanceOf(
      TooManyWaitingTournamentsError,
    );
    // Il s'ouvre à son heure, sans dépasser la limite : jamais plus de 5 ouverts.
    stack.clock.advance(30 * MINUTE);
    expect((await stack.tournaments.advance(later.id)).status).toBe('REGISTRATION_OPEN');
    expect(
      await count(`SELECT count(*)::int AS n FROM tournaments WHERE status = 'REGISTRATION_OPEN'`, []),
    ).toBe(5);
  });

  it('4 en attente : le 5e est accepté ; le 6e est refusé', async () => {
    for (let i = 0; i < 4; i += 1) await stack.tournaments.createAsAdmin(admin, slot(i));
    await expect(stack.tournaments.createAsAdmin(admin, slot(4))).resolves.toBeDefined();
    await expect(stack.tournaments.createAsAdmin(admin, slot(5))).rejects.toBeInstanceOf(
      TooManyWaitingTournamentsError,
    );
    expect(await waiting()).toBe(5);
  });

  it('limite globale : approbation et proposition d’un joueur refusées aussi', async () => {
    // Proposition dont la fenêtre de préinscription se ferme : elle ne compte plus (D-113)…
    const draft = await stack.tournaments.createAsPlayer(
      p(ANA),
      slot(5, { registrationClosesAt: new Date(stack.clock.now().getTime() + 30 * MINUTE) }),
    );
    await stack.tournaments.submit(draft.id, p(ANA));
    stack.clock.advance(31 * MINUTE);
    for (let i = 0; i < 5; i += 1) await stack.tournaments.createAsAdmin(admin, slot(i));
    // … et sa publication dépasserait la limite : refusée.
    await expect(stack.tournaments.approve(draft.id, admin)).rejects.toBeInstanceOf(
      TooManyWaitingTournamentsError,
    );
    expect((await stack.repository.findById(draft.id))?.status).toBe('PENDING_APPROVAL');
    await expect(stack.tournaments.createAsPlayer(p(BEN), slot(6))).rejects.toBeInstanceOf(
      TooManyWaitingTournamentsError,
    );
  });

  it('brouillons : ne comptent pas ; propositions ouvertes aux préinscriptions : comptent (D-113)', async () => {
    for (const [i, who] of [ANA, BEN, CID].entries()) {
      const draft = await stack.tournaments.createAsPlayer(p(who), slot(10 + i));
      if (i > 0) await stack.tournaments.submit(draft.id, p(who));
    }
    // 1 brouillon (non compté) + 2 propositions en attente (comptées) : 3 places publiées.
    for (let i = 0; i < 3; i += 1) await stack.tournaments.createAsAdmin(admin, slot(i));
    await expect(stack.tournaments.createAsAdmin(admin, slot(3))).rejects.toBeInstanceOf(
      TooManyWaitingTournamentsError,
    );
    expect(await waiting()).toBe(3);
  });

  it('place libérée (annulation, démarrage) : nouvelle création possible', async () => {
    const created: Tournament[] = [];
    for (let i = 0; i < 5; i += 1) {
      created.push(await stack.tournaments.createAsAdmin(admin, slot(i)));
    }
    await stack.tournaments.cancel(created[4]!.id, { userId: admin, isAdmin: true });
    await expect(stack.tournaments.createAsAdmin(admin, slot(5))).resolves.toBeDefined();

    // Le 1er tournoi commence (20 inscrits) : il quitte les tournois en attente.
    await fillWith(stack, database.sql, created[0]!.id);
    stack.clock.set(created[0]!.startsAt);
    expect((await stack.tournaments.advance(created[0]!.id)).status).toBe('IN_PROGRESS');
    await expect(stack.tournaments.createAsAdmin(admin, slot(6))).resolves.toBeDefined();
    expect(await waiting()).toBe(5);
  });

  it('créations simultanées : jamais plus de 5 en attente', async () => {
    for (let i = 0; i < 3; i += 1) await stack.tournaments.createAsAdmin(admin, slot(i));
    const results = await Promise.allSettled(
      [3, 4, 5, 6, 7, 8].map((i) => stack.tournaments.createAsAdmin(admin, slot(i))),
    );
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(2);
    for (const r of results.filter((x) => x.status === 'rejected')) {
      expect((r as PromiseRejectedResult).reason).toBeInstanceOf(TooManyWaitingTournamentsError);
    }
    expect(await waiting()).toBe(5);
  });
});

describe('liste des joueurs : terminés et annulés visibles 7 jours (D-072)', () => {
  const DAY = 24 * HOUR;
  const historyIds = async () =>
    (await stack.tournaments.listForPlayer(p(ANA))).history.map((s) => s.tournament.id);
  const stillStored = async (id: string) =>
    count('SELECT count(*)::int AS n FROM tournaments WHERE id = $1', [id]);

  it('COMPLETED : visible jusqu’à 7 jours après la fin PRÉVUE, puis retiré (jamais supprimé)', async () => {
    const t = await published();
    // Donnée de test : tournoi terminé (le cycle complet est couvert ailleurs). Fin réelle
    // (completed_at) postérieure à la fin prévue : c'est la fin PRÉVUE qui compte.
    await database.sql.query(
      `UPDATE tournaments SET status = 'COMPLETED', completed_at = $2 WHERE id = $1`,
      [t.id, new Date(t.endsAt.getTime() + 2 * DAY).toISOString()],
    );
    stack.clock.set(new Date(t.endsAt.getTime() + 7 * DAY - MINUTE));
    expect(await historyIds()).toContain(t.id);
    stack.clock.set(new Date(t.endsAt.getTime() + 7 * DAY + MINUTE));
    expect(await historyIds()).not.toContain(t.id);
    expect(await stillStored(t.id)).toBe(1);
    expect((await stack.repository.findById(t.id))?.status).toBe('COMPLETED');
  });

  it('CANCELLED : visible jusqu’à 7 jours après l’annulation RÉELLE, puis retiré (jamais supprimé)', async () => {
    // Début dans 10 jours : la fin prévue est postérieure au délai, seule l'annulation compte.
    const t = await stack.tournaments.createAsAdmin(admin, tournamentInput(stack.clock, 10 * DAY));
    await registerWith(t, ANA);
    const cancelledAt = stack.clock.now().getTime();
    await stack.tournaments.cancel(t.id, { userId: admin, isAdmin: true });
    stack.clock.set(new Date(cancelledAt + 7 * DAY - MINUTE));
    expect(await historyIds()).toContain(t.id);
    stack.clock.set(new Date(cancelledAt + 7 * DAY + MINUTE));
    expect(await historyIds()).not.toContain(t.id);
    // Rien n'est supprimé : tournoi, inscriptions, réservations libérées.
    expect(await stillStored(t.id)).toBe(1);
    expect((await stack.repository.findById(t.id))?.status).toBe('CANCELLED');
    expect(
      await count(
        'SELECT count(*)::int AS n FROM tournament_registrations WHERE tournament_id = $1',
        [t.id],
      ),
    ).toBeGreaterThanOrEqual(20);
  });

  it('résultats ou gains en traitement : jamais traités comme COMPLETED', async () => {
    const t = await published();
    await database.sql.query(`UPDATE tournaments SET status = 'DISTRIBUTING_PRIZES' WHERE id = $1`, [
      t.id,
    ]);
    // Bien au-delà des 7 jours après la fin prévue : toujours dans la liste courante.
    const since = new Date(t.endsAt.getTime() + 30 * DAY);
    const history = await stack.repository.listPublished({
      scope: 'history',
      limit: 10,
      visibleSince: since,
    });
    const current = await stack.repository.listPublished({ scope: 'current', limit: 20 });
    expect(history.map((x) => x.id)).not.toContain(t.id);
    expect(current.map((x) => x.id)).toContain(t.id);
  });

  it('inscription refusée : tournoi annulé, ou fin prévue atteinte', async () => {
    const cancelled = await published();
    await stack.tournaments.cancel(cancelled.id, { userId: admin, isAdmin: true });
    await expect(stack.tournaments.register(cancelled.id, p(ANA))).rejects.toBeInstanceOf(
      TournamentRegistrationClosedError,
    );

    const ended = await stack.tournaments.createAsAdmin(
      admin,
      tournamentInput(stack.clock, 4 * HOUR),
    );
    stack.clock.set(ended.endsAt);
    await expect(stack.tournaments.register(ended.id, p(BEN))).rejects.toBeInstanceOf(
      TournamentRegistrationClosedError,
    );
    expect(
      await count(
        'SELECT count(*)::int AS n FROM tournament_registrations WHERE tournament_id = $1',
        [ended.id],
      ),
    ).toBe(0);
  });
});

describe('chevauchement des périodes (D-059 : début A < fin B ET début B < fin A)', () => {
  /** Tournoi de l'admin de `from` h à `to` h, comptées depuis « maintenant + 24 h ». */
  const period = (from: number, to: number) => {
    const base = stack.clock.now().getTime() + 24 * HOUR;
    return stack.tournaments.createAsAdmin(admin, {
      ...tournamentInput(stack.clock, 0),
      startsAt: new Date(base + from * HOUR),
      endsAt: new Date(base + to * HOUR),
    });
  };

  it('14:00–15:00 puis 15:00–16:00 (et 13:00–14:00) : périodes qui se suivent, acceptées', async () => {
    await period(14, 15);
    await expect(period(15, 16)).resolves.toBeDefined();
    await expect(period(13, 14)).resolves.toBeDefined();
  });

  it('14:00–15:00 puis 14:30–15:30 : refusé', async () => {
    await period(14, 15);
    await expect(period(14.5, 15.5)).rejects.toBeInstanceOf(TournamentOverlapError);
  });

  it('durée complète prise en compte : englobant, englobé, début avant et fin pendant', async () => {
    await period(14, 15);
    await expect(period(13.5, 15.5)).rejects.toBeInstanceOf(TournamentOverlapError);
    // Englobé : 48 min, dans la durée minimale par défaut (45 min, D-104).
    await expect(period(14.1, 14.9)).rejects.toBeInstanceOf(TournamentOverlapError);
    await expect(period(13.5, 14.5)).rejects.toBeInstanceOf(TournamentOverlapError);
  });

  it('un tournoi annulé ou terminé ne bloque pas le créneau', async () => {
    const cancelled = await period(14, 15);
    await stack.tournaments.cancel(cancelled.id, { userId: admin, isAdmin: true });
    const completed = await period(14.5, 15.5);
    // Donnée de test : tournoi déjà terminé (le cycle complet est couvert ailleurs).
    await database.sql.query(
      `UPDATE tournaments SET status = 'COMPLETED', completed_at = $2 WHERE id = $1`,
      [completed.id, stack.clock.now().toISOString()],
    );
    await expect(period(14, 15.5)).resolves.toBeDefined();
  });

  it('créations simultanées sur le même créneau : une seule acceptée', async () => {
    const results = await Promise.allSettled([period(14, 15), period(14.5, 15.5), period(14, 15)]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    for (const r of results.filter((x) => x.status === 'rejected')) {
      expect((r as PromiseRejectedResult).reason).toBeInstanceOf(TournamentOverlapError);
    }
  });
});

describe('un joueur peut participer à plusieurs tournois (D-059)', () => {
  it('inscrit à deux tournois différents ; doublon sur le même tournoi refusé', async () => {
    const first = await published();
    const second = await stack.tournaments.createAsAdmin(
      admin,
      tournamentInput(stack.clock, 4 * HOUR),
    );
    await stack.tournaments.register(first.id, p(ANA));
    await stack.tournaments.register(second.id, p(ANA));
    await expect(stack.tournaments.register(second.id, p(ANA))).rejects.toBeInstanceOf(
      AlreadyRegisteredError,
    );
    expect(await balances(database.sql, p(ANA))).toEqual({
      balance: 5000,
      reserved: 2000,
      available: 3000,
    });
  });
});

describe('prochain tournoi inscrit à venir (D-059)', () => {
  const at = (startsIn: number) =>
    stack.tournaments.createAsAdmin(admin, tournamentInput(stack.clock, startsIn));

  it('aucun tournoi inscrit à venir : null (aucune donnée inventée)', async () => {
    await published(); // publié, mais ANA n'y est pas inscrite
    expect(await stack.tournaments.nextRegistered(p(ANA))).toBeNull();
  });

  it('le plus proche parmi ceux où le joueur est inscrit, puis suivi des changements', async () => {
    const soonest = await at(HOUR); // ANA n'y est pas inscrite
    const later = await at(10 * HOUR);
    const sooner = await at(4 * HOUR);
    for (const t of [later, sooner]) await stack.tournaments.register(t.id, p(ANA));
    await stack.tournaments.register(soonest.id, p(BEN));

    expect(await stack.tournaments.nextRegistered(p(ANA))).toMatchObject({
      id: sooner.id,
      startsAt: sooner.startsAt,
      endsAt: sooner.endsAt,
    });
    // Désinscription : le suivant prend la place.
    await stack.tournaments.unregister(sooner.id, p(ANA));
    expect((await stack.tournaments.nextRegistered(p(ANA)))?.id).toBe(later.id);
    // Annulation : plus rien à venir.
    await stack.tournaments.cancel(later.id, { userId: admin, isAdmin: true });
    expect(await stack.tournaments.nextRegistered(p(ANA))).toBeNull();
  });

  it('un tournoi dont l’heure de début est passée n’est plus « à venir »', async () => {
    const t = await published();
    await stack.tournaments.register(t.id, p(ANA));
    expect((await stack.tournaments.nextRegistered(p(ANA)))?.id).toBe(t.id);
    stack.clock.set(new Date(t.startsAt.getTime() + 1000));
    expect(await stack.tournaments.nextRegistered(p(ANA))).toBeNull();
  });
});
