import { Router, type RequestHandler } from 'express';

import { createGeolocationController } from '../controllers/geolocation.controller';
import { GEOLOCATION_CONFIG } from '../domain/detection/detection-config';
import { createRateLimiter } from '../middleware/rate-limit';
import { createRequireAuth, getAuth } from '../middleware/require-auth';
import type { AuthService } from '../services/auth/auth.service';
import type { GeolocationService } from '../services/detection/geolocation.service';
import type { Logger } from '../utils/logger';
import { parseGameIdParam } from '../validators/game.validators';

/**
 * Géolocalisation de la détection (R-36, étape 2, D-046), montée sous /api/games. Routes
 * authentifiées, réservées aux joueurs de la partie (contrôle dans GeolocationService) :
 *
 *   GET  /:gameId/geolocation   activation, consentement, cadence, distances du joueur
 *   POST /:gameId/geolocation/consent  consentement explicite du joueur (D-095, idempotent)
 *   POST /:gameId/position      { latitude, longitude, accuracy, capturedAt } → distances
 *
 * Comme le chat, l'authentification est posée route par route : ce routeur partage le
 * préfixe /games avec celui des parties.
 */
export function createGeolocationRouter(
  geolocation: GeolocationService,
  auth: AuthService,
  logger: Logger,
): Router {
  const router = Router();
  const controller = createGeolocationController(geolocation);
  const requireAuth = createRequireAuth(auth, logger);
  const positions = createRateLimiter({
    name: 'detection-positions',
    windowMs: 60_000,
    max: GEOLOCATION_CONFIG.collection.maxPerMinute,
    keyOf: (_req, res) => getAuth(res).userId,
  });

  const gameId: RequestHandler = (req, res, next) => {
    try {
      res.locals.gameId = parseGameIdParam(req.params.gameId);
      next();
    } catch (err) {
      next(err);
    }
  };

  router.get('/:gameId/geolocation', requireAuth, gameId, controller.status);
  router.post('/:gameId/geolocation/consent', requireAuth, gameId, controller.consent);
  router.post('/:gameId/position', requireAuth, gameId, positions, controller.record);
  return router;
}
