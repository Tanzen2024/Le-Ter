import { Router } from 'express';

import {
  createPlatformFinanceController,
  createPlatformPayoutNotifyController,
} from '../controllers/platform-finance.controller';
import { createRateLimiter } from '../middleware/rate-limit';
import { createRequireAuth, getAuth } from '../middleware/require-auth';
import { createRequireRole } from '../middleware/require-role';
import type { AuthService } from '../services/auth/auth.service';
import type { PlatformPayoutService } from '../services/platform-finance/platform-payout.service';
import type { TreasuryReconciliationService } from '../services/platform-finance/treasury-reconciliation.service';
import type { Logger } from '../utils/logger';

export interface PlatformFinanceDependencies {
  payouts: PlatformPayoutService;
  treasury: TreasuryReconciliationService;
  /** Limite des relectures CinetPay par administrateur (tests : relevée). */
  providerLimit?: { windowMs: number; max: number };
}

/** Relectures CinetPay déclenchées par un administrateur : bornées (coût, quota du prestataire). */
export const DEFAULT_PLATFORM_FINANCE_PROVIDER_LIMIT = { windowMs: 60_000, max: 10 };

/**
 * Finances de la plateforme (D-078), montées sous /api/admin/platform-finance APRÈS le routeur
 * d'administration : sa garde (requireAuth → rôle admin → session d'administration bornée)
 * s'applique ; authentification et rôle sont revérifiés ici (défense en profondeur).
 *
 *   GET  /                                  indicateurs (revenus, trésorerie, retirable)
 *   GET  /treasury                          relectures de trésorerie
 *   POST /treasury/observe                  relecture du solde CinetPay (auditée)
 *   POST /reconcile                         rapprochement, AUCUN envoi (audité)
 *   GET  /beneficiaries                     bénéficiaires (numéros masqués)
 *   POST /beneficiaries                     { label, msisdn }
 *   POST /beneficiaries/:id/verify          { note } (autre administrateur)
 *   POST /beneficiaries/:id/disable
 *   GET  /payouts                           liste paginée (page, limit, status)
 *   POST /payouts                           Idempotency-Key ; { beneficiaryId, amount, purpose }
 *   GET  /payouts/:id                       détail et historique (audité)
 *   POST /payouts/:id/approve|reject|cancel { note }
 *   POST /payouts/:id/release               mise en exécution (503 tant que désactivée)
 *   POST /payouts/:id/check                 relecture du transfert chez CinetPay
 */
export function createPlatformFinanceAdminRouter(
  deps: PlatformFinanceDependencies,
  auth: AuthService,
  logger: Logger,
  providerLimit = deps.providerLimit ?? DEFAULT_PLATFORM_FINANCE_PROVIDER_LIMIT,
): Router {
  const router = Router();
  const c = createPlatformFinanceController(deps);
  const provider = createRateLimiter({
    name: 'platform-finance-provider',
    ...providerLimit,
    keyOf: (_req, res) => getAuth(res).userId,
  });
  router.use(createRequireAuth(auth, logger), createRequireRole('admin', logger));
  router.get('/', c.overview);
  router.get('/treasury', c.treasuryHistory);
  router.post('/treasury/observe', provider, c.observeTreasury);
  router.post('/reconcile', provider, c.reconcile);
  router.get('/beneficiaries', c.listBeneficiaries);
  router.post('/beneficiaries', c.createBeneficiary);
  router.post('/beneficiaries/:beneficiaryId/verify', c.verifyBeneficiary);
  router.post('/beneficiaries/:beneficiaryId/disable', c.disableBeneficiary);
  router.get('/payouts', c.list);
  router.post('/payouts', c.create);
  router.get('/payouts/:payoutId', c.get);
  router.post('/payouts/:payoutId/approve', c.approve);
  router.post('/payouts/:payoutId/reject', c.reject);
  router.post('/payouts/:payoutId/cancel', c.cancel);
  router.post('/payouts/:payoutId/release', c.release);
  router.post('/payouts/:payoutId/check', provider, c.check);
  return router;
}

export const DEFAULT_PLATFORM_PAYOUT_NOTIFY_LIMIT = { windowMs: 60_000, max: 120 };

/** POST /api/platform-payouts/cinetpay/notify : public, limité par IP, statut toujours relu. */
export function createPlatformPayoutNotifyRouter(
  payouts: PlatformPayoutService,
  limit = DEFAULT_PLATFORM_PAYOUT_NOTIFY_LIMIT,
): Router {
  const router = Router();
  const c = createPlatformPayoutNotifyController(payouts);
  router.post(
    '/cinetpay/notify',
    createRateLimiter({ name: 'platform-payout-notify', ...limit }),
    c.notifyCinetPay,
  );
  return router;
}
