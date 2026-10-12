import { Router } from 'express';

import { createAdminSettingsController } from '../controllers/admin-settings.controller';
import { createRequireAuth } from '../middleware/require-auth';
import { createRequireRole } from '../middleware/require-role';
import type { AuthService } from '../services/auth/auth.service';
import type { DetectionSettingsService } from '../services/detection/detection-settings.service';
import type { GameCommissionSettingsService } from '../services/game/game-commission-settings.service';
import type { WithdrawalService } from '../services/withdrawals/withdrawal.service';
import type { Logger } from '../utils/logger';

/**
 * Paramètres système (D-053), montés sous /api/admin/settings. TOUTES les routes :
 * authentification (401), puis rôle `admin` lu dans la session serveur (403).
 *
 *   GET   /detection    { enabled, updatedAt }
 *   PATCH /detection    { enabled } → { enabled, updatedAt, changed } (audité)
 *   GET   /game-commission   { tiers, updatedAt, limits, maxTiers, koraLossMultiplier, appliesTo } (D-074, D-080)
 *   PATCH /game-commission   { tiers } → { tiers, updatedAt, …, changed }   (audité)
 *   GET   /withdrawal-limit  { count, periodMinutes, updatedAt, bounds } (D-075, null = ∞)
 *   PATCH /withdrawal-limit  { count, periodMinutes } → { …, changed }       (audité)
 */
export function createAdminSettingsRouter(
  services: {
    detection?: DetectionSettingsService;
    gameCommission?: GameCommissionSettingsService;
    withdrawals?: WithdrawalService;
  },
  auth: AuthService,
  logger: Logger,
): Router {
  const router = Router();
  // Paramètre dont le service est absent : 503 ADMIN_UNAVAILABLE (contrôleur).
  const controller = createAdminSettingsController(services);
  router.use(createRequireAuth(auth, logger), createRequireRole('admin', logger));

  router.get('/detection', controller.getDetection);
  router.patch('/detection', controller.setDetection);
  router.get('/game-commission', controller.getGameCommission);
  router.patch('/game-commission', controller.setGameCommission);
  router.get('/withdrawal-limit', controller.getWithdrawalLimit);
  router.patch('/withdrawal-limit', controller.setWithdrawalLimit);
  return router;
}
