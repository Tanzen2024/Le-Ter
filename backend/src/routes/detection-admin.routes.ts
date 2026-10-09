import { Router } from 'express';

import { createDetectionAdminController } from '../controllers/detection-admin.controller';
import { createRequireAuth } from '../middleware/require-auth';
import { createRequireRole } from '../middleware/require-role';
import type { AuthService } from '../services/auth/auth.service';
import type { DetectionAdminService } from '../services/detection/detection-admin.service';
import type { Logger } from '../utils/logger';

/**
 * Administration de la détection (R-36, étape 5, D-049), montée sous
 * /api/admin/detection. TOUTES les routes : authentification (401), puis rôle `admin` lu
 * dans la session serveur (403). Consultation et statut des alertes uniquement.
 *
 *   GET   /alerts                                  liste paginée, filtres, tri
 *   GET   /alerts/:alertId                         détail + score au moment de l'analyse
 *   GET   /alerts/:alertId/signals                 signaux examinés (preuves minimisées)
 *   GET   /subjects/:subjectKey/score-history      historique du score (lecture seule)
 *   PATCH /alerts/:alertId/status                  { status, expectedStatus? } (audité)
 */
export function createDetectionAdminRouter(
  admin: DetectionAdminService,
  auth: AuthService,
  logger: Logger,
): Router {
  const router = Router();
  const controller = createDetectionAdminController(admin);
  router.use(createRequireAuth(auth, logger), createRequireRole('admin', logger));

  router.get('/alerts', controller.listAlerts);
  router.get('/alerts/:alertId', controller.getAlert);
  router.get('/alerts/:alertId/signals', controller.getAlertSignals);
  router.get('/subjects/:subjectKey/score-history', controller.scoreHistory);
  router.patch('/alerts/:alertId/status', controller.changeStatus);
  return router;
}
