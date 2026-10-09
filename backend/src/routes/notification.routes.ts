import { Router } from 'express';

import { createRequireAuth, getAuth } from '../middleware/require-auth';
import type { AuthService } from '../services/auth/auth.service';
import type { NotificationService } from '../services/notifications/notification.service';
import type { Logger } from '../utils/logger';
import { ValidationError } from '../validators/validation-error';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/**
 * Notifications dans l'application (D-054), authentifiées. Un joueur ne voit et ne marque
 * que les siennes (identité issue du JWT).
 *
 *   GET  /                      { notifications, unread }
 *   POST /:notificationId/read  marquer comme lue (404 si inconnue ou d'un autre joueur)
 */
export function createNotificationRouter(
  notifications: NotificationService,
  auth: AuthService,
  logger: Logger,
): Router {
  const router = Router();
  router.use(createRequireAuth(auth, logger));
  router.get('/', async (_req, res) => {
    res.json(await notifications.list(getAuth(res).userId));
  });
  router.post('/:notificationId/read', async (req, res) => {
    const { notificationId } = req.params;
    if (!UUID_PATTERN.test(notificationId)) {
      throw new ValidationError({ notificationId: 'Identifiant invalide.' });
    }
    if (!(await notifications.markRead(getAuth(res).userId, notificationId))) {
      res.status(404).json({
        error: 'Not Found',
        code: 'NOTIFICATION_NOT_FOUND',
        message: 'Notification introuvable.',
      });
      return;
    }
    res.json({ read: true });
  });
  return router;
}
