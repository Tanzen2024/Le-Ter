import express, { type Express } from 'express';

import { createErrorHandler, notFoundHandler } from './middleware/error-handler';
import { requestId } from './middleware/request-id';
import { securityHeaders } from './middleware/security-headers';
import { createApiRouter } from './routes';
import type { AuthRateLimits } from './routes/auth.routes';
import type { GameRateLimits } from './routes/game.routes';
import type { AuthService } from './services/auth/auth.service';
import type { GameService } from './services/game/game.service';
import type { SessionService } from './services/sessions/session.service';
import { createLogger, type Logger } from './utils/logger';

export interface AppDependencies {
  logger?: Logger;
  /** Service d'authentification ; absent, les routes /api/auth répondent 503. */
  auth?: AuthService;
  authRateLimits?: AuthRateLimits;
  /** Service des parties ; absent, les routes /api/games répondent 503. */
  games?: GameService;
  /** Sessions multi-parties (D-033) ; fournies avec `games`. */
  sessions?: SessionService;
  gameRateLimits?: GameRateLimits;
}

/** Les commandes de jeu sont de petits messages : un corps plus gros est un abus. */
const JSON_BODY_LIMIT = '32kb';

export function createApp({
  logger = createLogger(),
  auth,
  authRateLimits,
  games,
  sessions,
  gameRateLimits,
}: AppDependencies = {}): Express {
  const app = express();

  app.disable('x-powered-by');
  app.use(requestId);
  app.use(securityHeaders);
  app.use(express.json({ limit: JSON_BODY_LIMIT }));

  app.use(
    '/api',
    createApiRouter({ logger, auth, authRateLimits, games, sessions, gameRateLimits }),
  );

  app.use(notFoundHandler);
  app.use(createErrorHandler(logger));

  return app;
}
