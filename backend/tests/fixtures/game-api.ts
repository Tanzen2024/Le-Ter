import { randomUUID } from 'node:crypto';

import type { Express } from 'express';
import request from 'supertest';

import { createApp } from '../../src/app';
import type { SqlClient, SqlExecutor } from '../../src/database/sql-client';
import type { RandomSource } from '../../src/domain/cards/random-source';
import type { TerRuleSet } from '../../src/domain/rules/rule-set';
import { PostgresGameRepository } from '../../src/repositories/postgres-game.repository';
import { PasswordService } from '../../src/services/auth/password.service';
import { PostgresSessionRepository } from '../../src/repositories/postgres-session.repository';
import { SessionService } from '../../src/services/sessions/session.service';
import { InMemorySessionEventHub } from '../../src/websocket/session-event-publisher';
import type { AuthService } from '../../src/services/auth/auth.service';
import { createAuthService } from '../../src/services/auth/create-auth-service';
import type { ChatService } from '../../src/services/chat/chat.service';
import type { DetectionAdminService } from '../../src/services/detection/detection-admin.service';
import type { DetectionSettingsService } from '../../src/services/detection/detection-settings.service';
import type { GeolocationService } from '../../src/services/detection/geolocation.service';
import { GameService, type ParticipationPolicy } from '../../src/services/game/game.service';
import {
  GameTimerRegistry,
  SessionTimerRegistry,
} from '../../src/services/game/game-timer-registry';
import { DeadlineSupervisor } from '../../src/services/timers/deadline-supervisor';
import type { AutomaticCardSelectionStrategy } from '../../src/domain/game/automatic-card-selection';
import { singleActiveGameParticipation } from '../../src/services/game/participation-policies';
import { createLogger, type Logger } from '../../src/utils/logger';
import { testAdminDependencies } from './admin';
import type {
  GameEventPublisher,
  GameEventSubscriber,
} from '../../src/websocket/game-event-publisher';
import { InMemoryGameEventHub } from '../../src/websocket/in-memory-game-event-hub';
import { NO_RATE_LIMITS, TEST_JWT_SECRET } from './auth';
import { defaultTestRandom } from './random';

export interface GameApiTestContext {
  app: Express;
  /** Authentification de l'application (connexions temps réel des tests). */
  auth: AuthService;
  games: GameService;
  sessions: SessionService;
  sessionEvents: InMemorySessionEventHub;
  timers: GameTimerRegistry;
  sessionTimers: SessionTimerRegistry;
  supervisor: DeadlineSupervisor;
  logLines: Record<string, unknown>[];
  /**
   * Annule tous les timers (tour et décision) et attend les commandes déjà lancées : à
   * attendre après chaque test, avant de vider la base.
   */
  stopTimers(): Promise<void>;
}

/**
 * Application complète (auth + sessions + parties) sur une base PGlite migrée, assemblée
 * comme en production (create-game-service.ts) :
 * HTTP → requireAuth → SessionService / GameService → dépôts → PostgreSQL, et
 * GameService → bus d'événements. Politique de participation et règles injectables :
 * les tests qui en dépendent les fournissent explicitement (R-18, règles du Ter).
 */
export function createGameApiTestApp(
  sql: SqlClient,
  options: {
    participationPolicy?: ParticipationPolicy;
    rules?: TerRuleSet;
    random?: RandomSource;
    bus?: GameEventPublisher & GameEventSubscriber;
    gameWritesPerMinute?: number;
    /** Durées des timers (15 s par défaut, comme en production, D-034, D-068). */
    turnDurationMs?: number;
    decisionWindowMs?: number;
    autoCardSelection?: AutomaticCardSelectionStrategy;
    /** Présentation du 5e tour avant la ronde (D-041) ; 0 par défaut dans les tests. */
    lastTrickPresentationMs?: (cards: number) => number;
    /** Partie suivante automatique après « Poursuivre » (D-042) ; désactivée par défaut. */
    autoNextGame?: boolean;
    /** Chat de partie (D-045) ; absent, ses routes ne sont pas montées. */
    chat?: ChatService;
    /** Géolocalisation de la détection (D-046) ; absente, ses routes ne sont pas montées. */
    geolocation?: GeolocationService;
    /** Administration de la détection (D-049) ; absente, 503. */
    detectionAdmin?: DetectionAdminService;
    /** Interrupteur global de la détection (D-053) ; absent, 503. */
    detectionSettings?: DetectionSettingsService;
  } = {},
): GameApiTestContext {
  const logLines: Record<string, unknown>[] = [];
  const logger: Logger = createLogger({}, (line) => logLines.push(JSON.parse(line)));
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
  const bus = options.bus ?? new InMemoryGameEventHub();
  const timers = new GameTimerRegistry();
  const repository = new PostgresGameRepository(sql);
  const sessionRepository = new PostgresSessionRepository(sql);
  const games = new GameService({
    repository,
    publisher: bus,
    subscriber: bus,
    timers,
    // Règle officielle R-18 par défaut, comme en production (create-game-service.ts).
    participationPolicy: options.participationPolicy ?? singleActiveGameParticipation(repository),
    sessionSeats: sessionRepository,
    logger,
    rules: options.rules,
    random: options.random ?? defaultTestRandom(),
    turnDurationMs: options.turnDurationMs,
    autoCardSelection: options.autoCardSelection,
  });
  const sessionEvents = new InMemorySessionEventHub();
  const sessionTimers = new SessionTimerRegistry();
  const sessions = new SessionService({
    sessions: sessionRepository,
    games,
    publisher: sessionEvents,
    logger,
    timers: sessionTimers,
    // Coût bcrypt minimal : les mots de passe de partie (D-039) restent rapides en test.
    passwords: new PasswordService(4),
    // Échéances de ronde exactes : la présentation du 5e tour (D-041) est testée à part.
    lastTrickPresentationMs: options.lastTrickPresentationMs ?? (() => 0),
    // Les tests historiques créent la partie suivante eux-mêmes (POST …/games).
    autoNextGame: options.autoNextGame ?? false,
    decisionWindowMs: options.decisionWindowMs,
  });
  const supervisor = new DeadlineSupervisor({ games, sessions, logger });
  const app = createApp({
    logger,
    auth,
    games,
    sessions,
    authRateLimits: NO_RATE_LIMITS,
    gameRateLimits: { writes: { windowMs: 60_000, max: options.gameWritesPerMinute ?? 100_000 } },
    chat: options.chat,
    geolocation: options.geolocation,
    detectionAdmin: options.detectionAdmin,
    detectionSettings: options.detectionSettings,
    admin: testAdminDependencies(sql, auth, logger),
  });
  return {
    app,
    auth,
    games,
    sessions,
    sessionEvents,
    timers,
    sessionTimers,
    supervisor,
    logLines,
    stopTimers: async () => {
      supervisor.stop();
      timers.cancelAll();
      sessionTimers.cancelAll();
      await sessions.idle();
    },
  };
}

/**
 * Requêtes authentifiées d'un utilisateur. Pour POST /api/games, une Idempotency-Key
 * neuve est ajoutée (une intention de création par appel) ; les tests d'idempotence
 * fixent la leur explicitement.
 */
export function as(app: Express, accessToken: string) {
  const auth = `Bearer ${accessToken}`;
  return {
    get: (path: string) => request(app).get(path).set('Authorization', auth),
    post: (path: string, body: object = {}) => {
      const req = request(app).post(path).set('Authorization', auth);
      const creates = path === '/api/games' || /^\/api\/sessions(\/[^/]+\/games)?$/.test(path);
      return (creates ? req.set('Idempotency-Key', randomUUID()) : req).send(body);
    },
  };
}

/**
 * Entrer dans une partie comme un joueur réel (D-033) : rejoindre d'abord sa session,
 * puis la partie. Renvoie la réponse de l'adhésion à la partie.
 */
export async function enterGame(
  api: ReturnType<typeof as>,
  sql: SqlExecutor,
  gameId: string,
): Promise<request.Response> {
  const { rows } = await sql.query<{ session_id: string }>(
    'SELECT session_id FROM games WHERE id = $1',
    [gameId],
  );
  const sessionId = rows[0]?.session_id;
  if (sessionId) {
    const joined = await api.post(`/api/sessions/${sessionId}/join`);
    if (joined.status !== 200) {
      return joined;
    }
  }
  return api.post(`/api/games/${gameId}/join`);
}

/** Attend une réponse et vérifie son statut (message d'erreur avec le corps reçu). */
export async function expectStatus(
  pending: Promise<request.Response>,
  status: number,
): Promise<request.Response> {
  const res = await pending;
  if (res.status !== status) {
    throw new Error(`attendu ${status}, reçu ${res.status} ${JSON.stringify(res.body)}`);
  }
  return res;
}
