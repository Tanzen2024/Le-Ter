import { Router } from 'express';

import { createGameController } from '../controllers/game.controller';
import type { GameId } from '../domain/game/game-id';
import { createRateLimiter } from '../middleware/rate-limit';
import { createRequireAuth, getAuth } from '../middleware/require-auth';
import type { AuthService } from '../services/auth/auth.service';
import type { GameService } from '../services/game/game.service';
import type { SessionService } from '../services/sessions/session.service';
import type { Logger } from '../utils/logger';
import { parseGameIdParam } from '../validators/game.validators';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Locals {
      /** `:gameId` de l'URL, validé (UUID). */
      gameId?: GameId;
    }
  }
}

export interface GameRateLimits {
  /** Écritures (création, adhésion, actions) par utilisateur. */
  writes: { windowMs: number; max: number };
}

export const DEFAULT_GAME_RATE_LIMITS: GameRateLimits = {
  writes: { windowMs: 60_000, max: 120 },
};

/**
 * Routes /api/games (multi-game-architecture.md §7, D-030). Toutes authentifiées.
 *
 *   POST /                    créer une partie : ouvre une session dont c'est la 1re partie
 *   GET  /me/active           parties actives du joueur (reconnexion)
 *   GET  /:gameId             vue joueur (membre seulement)
 *   POST /:gameId/join        rejoindre (R-18 : une seule partie active)
 *   POST /:gameId/start       démarrer (créateur seulement, au moins 2 joueurs : R-23)
 *   POST /:gameId/actions     action de jeu (PLAY_CARD, DECLARE_WIN, FLEE)
 *
 * Volontairement absents : lobby (visibilité et parties privées : R-22), quitter (R-19).
 */
export function createGameRouter(
  games: GameService,
  sessions: SessionService,
  auth: AuthService,
  logger: Logger,
  limits: GameRateLimits = DEFAULT_GAME_RATE_LIMITS,
): Router {
  const router = Router();
  const controller = createGameController(games, sessions);
  const writes = createRateLimiter({
    name: 'game-writes',
    ...limits.writes,
    keyOf: (_req, res) => getAuth(res).userId,
  });

  router.use(createRequireAuth(auth, logger));
  // Unique point de lecture du gameId : validé avant tout contrôleur (400 sinon).
  router.param('gameId', (_req, res, next, value: unknown) => {
    try {
      res.locals.gameId = parseGameIdParam(value);
      next();
    } catch (err) {
      next(err);
    }
  });

  router.post('/', writes, controller.create);
  router.get('/me/active', controller.listActive);
  router.get('/:gameId', controller.get);
  router.post('/:gameId/join', writes, controller.join);
  router.post('/:gameId/start', writes, controller.start);
  router.post('/:gameId/actions', writes, controller.act);

  return router;
}
