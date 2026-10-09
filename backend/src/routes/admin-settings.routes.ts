import { Router } from 'express';

import { createAdminSettingsController } from '../controllers/admin-settings.controller';
import { createRequireAuth } from '../middleware/require-auth';
import { createRequireRole } from '../middleware/require-role';
import type { AuthService } from '../services/auth/auth.service';
import type { DetectionSettingsService } from '../services/detection/detection-settings.service';
import type { Logger } from '../utils/logger';

/**
 * Paramètres système (D-053), montés sous /api/admin/settings. TOUTES les routes :
 * authentification (401), puis rôle `admin` lu dans la session serveur (403).
 *
 *   GET   /detection    { enabled, updatedAt }
 *   PATCH /detection    { enabled } → { enabled, updatedAt, changed } (audité)
 */
export function createAdminSettingsRouter(
  settings: DetectionSettingsService,
  auth: AuthService,
  logger: Logger,
): Router {
  const router = Router();
  const controller = createAdminSettingsController(settings);
  router.use(createRequireAuth(auth, logger), createRequireRole('admin', logger));

  router.get('/detection', controller.getDetection);
  router.patch('/detection', controller.setDetection);
  return router;
}
