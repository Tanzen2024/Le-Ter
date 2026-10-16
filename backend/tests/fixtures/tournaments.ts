import { randomUUID } from 'node:crypto';

import { createApp } from '../../src/app';
import type { SqlClient } from '../../src/database/sql-client';
import type { Game } from '../../src/domain/game/game';
import type { GameId, PlayerId } from '../../src/domain/game/game-id';
import type { TournamentId, TournamentInput } from '../../src/domain/tournaments/tournament';
import type { UserId } from '../../src/domain/users/user';
import { PostgresGameStakeLedger } from '../../src/repositories/game-stake-ledger';
import { PostgresGameRepository } from '../../src/repositories/postgres-game.repository';
import { PostgresSessionRepository } from '../../src/repositories/postgres-session.repository';
import { PostgresGameSettlementReader } from '../../src/repositories/postgres-game-settlement.repository';
import { PostgresTournamentRepository } from '../../src/repositories/postgres-tournament.repository';
import { readWalletBalances } from '../../src/repositories/wallet-reservations';
import { PasswordService } from '../../src/services/auth/password.service';
import { createAuthService } from '../../src/services/auth/create-auth-service';
import { testAdminDependencies } from './admin';
import { GameService } from '../../src/services/game/game.service';
import {
  GameTimerRegistry,
  SessionTimerRegistry,
} from '../../src/services/game/game-timer-registry';
import { singleActiveGameParticipation } from '../../src/services/game/participation-policies';
import { NotificationService } from '../../src/services/notifications/notification.service';
import { SessionService } from '../../src/services/sessions/session.service';
import {
  tournamentGameStartWindow,
  tournamentSessionAdmission,
  tournamentTableContinuation,
} from '../../src/services/tournaments/tournament-admission';
import { TournamentScheduler } from '../../src/services/tournaments/tournament-scheduler';
import { TournamentService } from '../../src/services/tournaments/tournament.service';
import { createLogger } from '../../src/utils/logger';
import { InMemoryGameEventHub } from '../../src/websocket/in-memory-game-event-hub';
import { InMemorySessionEventHub } from '../../src/websocket/session-event-publisher';
import type { UserEventPublisher } from '../../src/websocket/user-event-bus';
import { NO_RATE_LIMITS, TEST_JWT_SECRET } from './auth';
import type { RandomSource } from '../../src/domain/cards/random-source';
import { defaultTestRandom } from './random';
import { seedUsers, testUserId } from './users';

export const MINUTE = 60 * 1000;
export const HOUR = 60 * MINUTE;

/** Horloge des tournois réglable : toutes les échéances se mesurent sur elle (D-054). */
export class TestClock {
  constructor(private current = new Date()) {}
  now = (): Date => new Date(this.current);
  set(date: Date): void {
    this.current = new Date(date);
  }
  advance(ms: number): void {
    this.current = new Date(this.current.getTime() + ms);
  }
}

/**
 * Pile des tournois sur une base PGlite migrée, assemblée comme en production
 * (create-game-service.ts) : GameService (R-18), SessionService avec la politique d'accès
 * aux tables de tournoi, TournamentService, planificateur, notifications, et l'API HTTP.
 */
export function createTournamentTestStack(
  sql: SqlClient,
  clock = new TestClock(),
  options: {
    autoNextGame?: boolean;
    random?: RandomSource;
    /** Les parties suivent aussi l'horloge de test (échéances de démarrage, D-065). */
    gameClock?: boolean;
    /** Signaux temps réel des résultats (D-106). */
    userEvents?: UserEventPublisher;
    /** Journal observé par le test (anomalies) ; muet par défaut. */
    logSink?: (line: string) => void;
  } = {},
) {
  const logger = createLogger({}, options.logSink ?? (() => undefined));
  const bus = new InMemoryGameEventHub();
  // Séquestre des mises câblé comme en production (D-074) : les tables de tournoi en sont
  // exclues (jetons de tournoi) ; aucun test de tournoi ne doit réserver de jetons.
  const stakeLedger = new PostgresGameStakeLedger({ logger });
  const gameRepository = new PostgresGameRepository(sql, { stakeLedger });
  const sessionRepository = new PostgresSessionRepository(sql, { stakeLedger });
  const repository = new PostgresTournamentRepository(sql);
  const timers = new GameTimerRegistry();
  const games = new GameService({
    repository: gameRepository,
    publisher: bus,
    subscriber: bus,
    timers,
    participationPolicy: singleActiveGameParticipation(gameRepository),
    sessionSeats: sessionRepository,
    logger,
    random: options.random ?? defaultTestRandom(),
    turnDurationMs: 60 * MINUTE,
    // D-102 : distribution confirmée au démarrage (la phase se teste dans deal-phase.test.ts).
    dealDurationMs: () => 0,
    startWindow: tournamentGameStartWindow(repository, clock.now),
    // Bilan du joueur en fin de partie, comme en production (compte réel ou fictif, D-111).
    settlements: new PostgresGameSettlementReader(sql),
    ...(options.gameClock && { clock: clock.now }),
  });
  const sessionTimers = new SessionTimerRegistry();
  // TournamentService est construit après SessionService : appel résolu à l'exécution.
  const settlePending = (id: TournamentId): Promise<number> => tournaments.settlePendingGames(id);
  const sessions = new SessionService({
    sessions: sessionRepository,
    games,
    publisher: new InMemorySessionEventHub(),
    logger,
    timers: sessionTimers,
    passwords: new PasswordService(4),
    lastTrickPresentationMs: () => 0,
    autoNextGame: options.autoNextGame ?? false,
    decisionWindowMs: 60 * MINUTE,
    admission: tournamentSessionAdmission(repository, clock.now, settlePending),
    continuation: tournamentTableContinuation(repository, clock.now, settlePending),
  });
  const tournaments = new TournamentService({
    tournaments: repository,
    sessions,
    games,
    logger,
    clock: clock.now,
    ...(options.userEvents && { userEvents: options.userEvents }),
  });
  games.onGameFinished((game) => tournaments.observeFinishedGame(game));
  const scheduler = new TournamentScheduler({ tournaments, repository, logger, clock: clock.now });
  const notifications = new NotificationService(repository, clock.now);
  const auth = createAuthService(
    sql,
    {
      jwtSecret: TEST_JWT_SECRET,
      accessTokenTtlSeconds: 900,
      refreshTokenTtlSeconds: 3600,
      bcryptCost: 4,
    },
    logger,
  );
  const app = createApp({
    logger,
    auth,
    games,
    sessions,
    tournaments,
    notifications,
    authRateLimits: NO_RATE_LIMITS,
    gameRateLimits: { writes: { windowMs: 60_000, max: 100_000 } },
    admin: testAdminDependencies(sql, auth, logger),
  });
  return {
    clock,
    games,
    sessions,
    tournaments,
    repository,
    scheduler,
    notifications,
    auth,
    app,
    async stop() {
      scheduler.stop();
      timers.cancelAll();
      games.cancelStartTimers();
      sessionTimers.cancelAll();
      await scheduler.idle();
      await tournaments.idle();
      await sessions.idle();
    },
  };
}

export type TournamentTestStack = ReturnType<typeof createTournamentTestStack>;

/** Joueurs de test : comptes créés, portefeuille crédité par une vraie transaction. */
export async function seedPlayers(
  sql: SqlClient,
  names: readonly string[],
  balance = 0,
): Promise<UserId[]> {
  await seedUsers(sql, names);
  const ids = names.map(testUserId);
  for (const id of ids) {
    if (balance > 0) await fund(sql, id, balance);
  }
  return ids;
}

/** Crédite un portefeuille comme un achat réglé (jamais une écriture de solde sans transaction). */
export async function fund(sql: SqlClient, userId: UserId, tokens: number): Promise<void> {
  await sql.transaction(async (tx) => {
    const now = new Date().toISOString();
    await tx.query(
      `INSERT INTO wallets (user_id, balance, created_at, updated_at) VALUES ($1, 0, $2, $2)
       ON CONFLICT (user_id) DO NOTHING`,
      [userId, now],
    );
    await tx.query(
      `INSERT INTO wallet_transactions (id, user_id, kind, status, tokens, idempotency_key,
         created_at, updated_at, completed_at)
       VALUES ($1, $2, 'deposit', 'succeeded', $3, $4, $5, $5, $5)`,
      [randomUUID(), userId, tokens, `test-fund-${randomUUID()}`, now],
    );
    await tx.query('UPDATE wallets SET balance = balance + $2 WHERE user_id = $1', [
      userId,
      tokens,
    ]);
  });
}

export async function seedAdmin(sql: SqlClient, name = 'admin'): Promise<UserId> {
  await seedUsers(sql, [name]);
  const id = testUserId(name);
  await sql.query(`UPDATE users SET role = 'admin' WHERE id = $1`, [id]);
  return id;
}

/**
 * Réglages ENREGISTRÉS comme par l'administration (D-071 : ils priment sur les valeurs
 * initiales) : commission 10 %, coefficients 1 et 0,1 (prix 1 000 → 1 000 jetons, mise 100),
 * poids 50 / 50. Les suites qui comptent jetons, commission et classement gardent leurs montants.
 */
export async function saveTournamentSettings(sql: SqlClient): Promise<void> {
  const values: [string, number][] = [
    ['tournament_platform_fee_percent', 10],
    ['tournament_initial_tokens_coefficient', 1],
    ['tournament_stake_per_game_coefficient', 0.1],
    ['tournament_ranking_tokens_weight_percent', 50],
    ['tournament_ranking_games_weight_percent', 50],
  ];
  for (const [key, value] of values) {
    await sql.query(
      `INSERT INTO system_settings (key, value, updated_at) VALUES ($1, $2::jsonb, now())
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
      [key, JSON.stringify(value)],
    );
  }
}

export const balances = (sql: SqlClient, userId: UserId) => readWalletBalances(sql, userId);

/** Tournoi valide commençant `startsInMs` après l'horloge, 2 h, 50/30/20. */
export function tournamentInput(
  clock: TestClock,
  startsInMs: number,
  extra: Partial<TournamentInput> = {},
): TournamentInput {
  const startsAt = new Date(clock.now().getTime() + startsInMs);
  return {
    startsAt,
    endsAt: new Date(startsAt.getTime() + 2 * HOUR),
    entryFee: 1000,
    minimumPlayers: 20,
    maximumPlayers: 100,
    prizeRules: [
      { rank: 1, shareBps: 5000 },
      { rank: 2, shareBps: 3000 },
      { rank: 3, shareBps: 2000 },
    ],
    ...extra,
  };
}

/**
 * Partie TERMINÉE avec un gagnant, construite à partir d'une vraie partie démarrée : le
 * règlement des jetons ne lit que les joueurs, le gagnant, les dates et la session.
 */
export function finishedCopy(game: Game, winner: UserId | PlayerId, finishedAt: Date): Game {
  return {
    ...game,
    status: 'finished',
    finishedAt,
    endReason: 'CONTROL_AFTER_LAST_TRICK',
    result: {
      winnerId: winner as PlayerId,
      method: 'CONTROL_AFTER_LAST_TRICK',
      remainingOpponentIds: [],
      fledPlayerIds: [],
    },
  };
}

export const asGameId = (id: string) => id as GameId;

/** Minimum de participants d'un tournoi (D-057). */
export const MIN_PARTICIPANTS = 20;

/**
 * Complète les inscriptions d'un tournoi jusqu'à `total` participants avec des joueurs
 * « figurants » (comptes réels, portefeuille crédité, inscription par le service : prix
 * réservé). Les figurants ne jouent aucune partie : 1 000 jetons, 0 partie.
 */
export async function fillWith(
  stack: { tournaments: { register(id: never, userId: UserId): Promise<unknown> } },
  sql: SqlClient,
  tournamentId: string,
  total = MIN_PARTICIPANTS,
): Promise<UserId[]> {
  const { rows } = await sql.query<{ n: number }>(
    `SELECT count(*)::int AS n FROM tournament_registrations
     WHERE tournament_id = $1 AND status = 'REGISTERED'`,
    [tournamentId],
  );
  const missing = total - Number(rows[0]?.n ?? 0);
  if (missing <= 0) return [];
  const names = Array.from({ length: missing }, (_, i) => `filler-${i}-${randomUUID()}`);
  const fillers = await seedPlayers(sql, names, 5000);
  for (const f of fillers) await stack.tournaments.register(tournamentId as never, f);
  return fillers;
}
