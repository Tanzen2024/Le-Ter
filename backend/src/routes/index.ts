import { Router } from 'express';

import type { AuthService } from '../services/auth/auth.service';
import type { GameService } from '../services/game/game.service';
import type { SessionService } from '../services/sessions/session.service';
import type { Logger } from '../utils/logger';
import { createAuthRouter, createUnavailableRouter, type AuthRateLimits } from './auth.routes';
import { createGameRouter, type GameRateLimits } from './game.routes';
import { healthRouter } from './health.routes';
import { createSessionRouter } from './session.routes';

export interface ApiRouterDependencies {
  logger: Logger;
  /** Absent : base ou JWT_SECRET non configurés, les routes /auth répondent 503. */
  auth?: AuthService;
  authRateLimits?: AuthRateLimits;
  /** Absent : base ou authentification non configurées, /games répond 503. */
  games?: GameService;
  /** Sessions (D-033) ; fournies avec `games`. */
  sessions?: SessionService;
  gameRateLimits?: GameRateLimits;
}

export function createApiRouter({
  logger,
  auth,
  authRateLimits,
  games,
  sessions,
  gameRateLimits,
}: ApiRouterDependencies): Router {
  const router = Router();
  router.use('/health', healthRouter);
  router.use(
    '/auth',
    auth
      ? createAuthRouter(auth, logger, authRateLimits)
      : createUnavailableRouter(
          'AUTH_UNAVAILABLE',
          "L'authentification n'est pas configurée sur ce serveur.",
        ),
  );
  const gamesReady = auth && games && sessions;
  const unavailable = () =>
    createUnavailableRouter(
      'GAMES_UNAVAILABLE',
      'Les parties ne sont pas disponibles : base ou authentification non configurée.',
    );
  router.use(
    '/games',
    gamesReady ? createGameRouter(games, sessions, auth, logger, gameRateLimits) : unavailable(),
  );
  router.use(
    '/sessions',
    gamesReady ? createSessionRouter(sessions, auth, logger, gameRateLimits) : unavailable(),
  );
  return router;
}
