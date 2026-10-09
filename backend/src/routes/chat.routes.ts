import { Router, type RequestHandler } from 'express';

import { createChatController } from '../controllers/chat.controller';
import { createRequireAuth } from '../middleware/require-auth';
import type { AuthService } from '../services/auth/auth.service';
import type { ChatService } from '../services/chat/chat.service';
import type { Logger } from '../utils/logger';
import { parseGameIdParam } from '../validators/game.validators';

/**
 * Chat d'une partie (D-045), monté sous /api/games. Toutes les routes sont authentifiées et
 * réservées aux joueurs de la partie (contrôle dans ChatService) :
 *
 *   GET  /:gameId/chat/messages   historique paginé (?before=<id> | ?after=<id>, ?limit=1..50)
 *   POST /:gameId/chat/messages   envoyer { content } ; en-tête Idempotency-Key obligatoire
 *
 * L'authentification est posée route par route : ce routeur partage le préfixe /games avec
 * celui des parties et ne doit pas s'appliquer à ses autres chemins.
 */
export function createChatRouter(chat: ChatService, auth: AuthService, logger: Logger): Router {
  const router = Router();
  const controller = createChatController(chat);
  const requireAuth = createRequireAuth(auth, logger);

  // Authentification d'abord (401), puis forme du gameId (400), comme les routes de partie.
  const gameId: RequestHandler = (req, res, next) => {
    try {
      res.locals.gameId = parseGameIdParam(req.params.gameId);
      next();
    } catch (err) {
      next(err);
    }
  };

  router.get('/:gameId/chat/messages', requireAuth, gameId, controller.list);
  router.post('/:gameId/chat/messages', requireAuth, gameId, controller.send);
  return router;
}
