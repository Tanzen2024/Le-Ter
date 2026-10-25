import { Router } from 'express';

import {
  createReferralAdminController,
  createReferralController,
} from '../controllers/referral.controller';
import { createRequireAuth } from '../middleware/require-auth';
import { createRequireRole } from '../middleware/require-role';
import type { AuthService } from '../services/auth/auth.service';
import type { ReferralService } from '../services/referrals/referral.service';
import type { Logger } from '../utils/logger';

/**
 * Parrainage côté joueur (D-161), sous /api/referrals, authentifié :
 *
 *   GET /me   code personnel (créé au premier appel), liens, filleuls, paliers, récompenses
 *
 * Aucune route ne déclare un filleul qualifié, ne crédite ni ne change de parrain.
 */
export function createReferralRouter(referrals: ReferralService, auth: AuthService, logger: Logger) {
  const router = Router();
  const controller = createReferralController(referrals);
  router.use(createRequireAuth(auth, logger));
  router.get('/me', controller.me);
  return router;
}

/**
 * Administration du parrainage (D-161), sous /api/admin/referrals. En plus de la garde commune
 * de /api/admin (session d'administration), chaque route exige l'authentification et le rôle
 * `admin` (403). Toute écriture est auditée ; aucune ne crédite un montant choisi.
 *
 *   GET  /overview                          indicateurs et cas à vérifier
 *   GET  /referrers?q&page&limit            parrains ayant au moins un filleul
 *   GET  /referrers/:userId                 détail, recharges, paliers, registre (audité)
 *   POST /referrers/:userId/reevaluate      relance la réévaluation (file, idempotente)
 *   GET  /campaign                          statut, versions des règles, historique
 *   PATCH /campaign/rules                   { referralsPerTier, qualificationThreshold,
 *                                             rewardPerTier, maxTiers|null, reason }
 *   POST /campaign/status                   { status: ACTIVE|SUSPENDED, reason }
 *   POST /attributions/:attributionId/review { decision: FLAG|CLEAR|REJECT, reason }
 */
export function createReferralAdminRouter(
  referrals: ReferralService,
  auth: AuthService,
  logger: Logger,
) {
  const router = Router();
  const controller = createReferralAdminController(referrals);
  router.use(createRequireAuth(auth, logger), createRequireRole('admin', logger));
  router.get('/overview', controller.overview);
  router.get('/referrers', controller.referrers);
  router.get('/referrers/:userId', controller.referrer);
  router.post('/referrers/:userId/reevaluate', controller.reevaluate);
  router.get('/campaign', controller.campaign);
  router.patch('/campaign/rules', controller.updateRules);
  router.post('/campaign/status', controller.setStatus);
  router.post('/attributions/:attributionId/review', controller.review);
  return router;
}
