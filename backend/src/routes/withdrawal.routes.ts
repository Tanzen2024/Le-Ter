import { Router } from 'express';

import {
  createWithdrawalAdminController,
  createWithdrawalNotifyController,
} from '../controllers/withdrawal.controller';
import { createRateLimiter } from '../middleware/rate-limit';
import { createRequireAuth } from '../middleware/require-auth';
import { createRequireRole } from '../middleware/require-role';
import type { AuthService } from '../services/auth/auth.service';
import type { WithdrawalAdminService } from '../services/withdrawals/withdrawal-admin.service';
import type { WithdrawalService } from '../services/withdrawals/withdrawal.service';
import type { Logger } from '../utils/logger';

/** Notifications du fournisseur : publiques, donc limitées par adresse IP. */
export const DEFAULT_WITHDRAWAL_NOTIFY_LIMIT = { windowMs: 60_000, max: 120 };

/**
 * Routes publiques /api/withdrawals (D-075) :
 *
 *   POST /cinetpay/notify   notification de transfert CinetPay (jeton vérifié, statut relu)
 */
export function createWithdrawalNotifyRouter(
  withdrawals: WithdrawalService,
  notifyLimit = DEFAULT_WITHDRAWAL_NOTIFY_LIMIT,
): Router {
  const router = Router();
  const controller = createWithdrawalNotifyController(withdrawals);
  router.post(
    '/cinetpay/notify',
    createRateLimiter({ name: 'withdrawal-notify', ...notifyLimit }),
    controller.notifyCinetPay,
  );
  return router;
}

/**
 * Administration des retraits, montée sous /api/admin/withdrawals APRÈS le routeur
 * d'administration : sa garde (requireAuth → rôle admin → session d'administration)
 * s'applique à chaque route. Authentification et rôle sont revérifiés ici (défense en
 * profondeur, comme /admin/settings).
 *
 *   GET  /                       liste filtrée (status, from, to, q = référence, userId)
 *   GET  /:withdrawalId          détail (audité)
 *   POST /:withdrawalId/verify   Idempotency-Key ; revérification CinetPay (auditée)
 */
export function createWithdrawalAdminRouter(
  admin: WithdrawalAdminService,
  auth: AuthService,
  logger: Logger,
): Router {
  const router = Router();
  const controller = createWithdrawalAdminController(admin);
  router.use(createRequireAuth(auth, logger), createRequireRole('admin', logger));
  router.get('/', controller.list);
  router.get('/:withdrawalId', controller.get);
  router.post('/:withdrawalId/verify', controller.verify);
  // Rapprochement des retraits bloqués (D-076), tout audité. AUCUNE route ne déclare un
  // retrait réussi ; un remboursement exige deux administrateurs distincts.
  router.post('/:withdrawalId/escalations', controller.escalate);
  router.post('/:withdrawalId/refund-requests', controller.proposeRefund);
  router.post('/:withdrawalId/refund-requests/:requestId/approve', controller.approveRefund);
  router.post('/:withdrawalId/refund-requests/:requestId/reject', controller.rejectRefund);
  return router;
}
