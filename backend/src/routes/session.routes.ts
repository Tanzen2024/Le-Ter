import { Router } from 'express';

import { createSessionController } from '../controllers/session.controller';
import { parseSessionId, type SessionId } from '../domain/sessions/session';
import { createRateLimiter } from '../middleware/rate-limit';
import { createRequireAuth, getAuth } from '../middleware/require-auth';
import type { AuthService } from '../services/auth/auth.service';
import type { SessionService } from '../services/sessions/session.service';
import type { Logger } from '../utils/logger';
import { ValidationError } from '../validators/validation-error';
import type { GameRateLimits } from './game.routes';
import { DEFAULT_GAME_RATE_LIMITS } from './game.routes';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Locals {
      /** `:sessionId` de l'URL, validé (UUID). */
      sessionId?: SessionId;
    }
  }
}

/**
 * Routes /api/sessions (D-033), toutes authentifiées :
 *
 *   POST /                       créer une session et sa première partie (Idempotency-Key)
 *   GET  /me/active              sessions ouvertes où je suis présent
 *   GET  /open                   tables ouvertes à rejoindre (partie en attente, siège libre)
 *   GET  /:sessionId             détail (membres actuels ou anciens)
 *   POST /:sessionId/join        rejoindre une session ouverte
 *   POST /:sessionId/leave       quitter (siège vacant ; le dernier départ ferme la session)
 *   POST /:sessionId/decision    Poursuivre / Quitter entre deux parties ({ choice })
 *   GET  /:sessionId/games       historique des parties
 *   POST /:sessionId/games       partie suivante (Idempotency-Key ; J1 calculé par le serveur)
 */
export function createSessionRouter(
  sessions: SessionService,
  auth: AuthService,
  logger: Logger,
  limits: GameRateLimits = DEFAULT_GAME_RATE_LIMITS,
): Router {
  const router = Router();
  const controller = createSessionController(sessions);
  const writes = createRateLimiter({
    name: 'session-writes',
    ...limits.writes,
    keyOf: (_req, res) => getAuth(res).userId,
  });

  router.use(createRequireAuth(auth, logger));
  router.param('sessionId', (_req, res, next, value: unknown) => {
    try {
      res.locals.sessionId = parseSessionId(value);
      next();
    } catch {
      next(new ValidationError({ sessionId: 'Identifiant de session invalide.' }));
    }
  });

  router.post('/', writes, controller.create);
  router.get('/me/active', controller.listMine);
  router.get('/open', controller.listOpen);
  router.get('/:sessionId', controller.get);
  router.post('/:sessionId/join', writes, controller.join);
  router.post('/:sessionId/leave', writes, controller.leave);
  router.post('/:sessionId/decision', writes, controller.decide);
  router.get('/:sessionId/games', controller.listGames);
  router.post('/:sessionId/games', writes, controller.createGame);

  return router;
}
