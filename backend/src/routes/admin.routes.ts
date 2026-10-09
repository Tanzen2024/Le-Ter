import { Router, type Request } from 'express';

import { createAdminController, type AdminSystemInfo } from '../controllers/admin.controller';
import { ADMIN_LOGIN_LIMITS, type AdminLoginLimits } from '../domain/admin/admin';
import { createRequireAdminSession } from '../middleware/require-admin-session';
import { createRequireAuth } from '../middleware/require-auth';
import { createRequireRole } from '../middleware/require-role';
import {
  createSharedRateLimiter,
  hashKey,
  type RateLimitStore,
} from '../middleware/shared-rate-limit';
import type { AdminQueryService } from '../services/admin/admin-query.service';
import type { AdminSessionService } from '../services/admin/admin-session.service';
import type { AuthService } from '../services/auth/auth.service';
import type { Logger } from '../utils/logger';

export interface AdminRouterDependencies {
  auth: AuthService;
  sessions: AdminSessionService;
  queries: AdminQueryService;
  rateLimitStore: RateLimitStore;
  loginLimits?: AdminLoginLimits;
  system: AdminSystemInfo;
  logger: Logger;
}

/**
 * Administration de la plateforme (D-061), montée sous /api/admin AVANT les routeurs
 * administratifs existants (détection, paramètres, tournois).
 *
 *   POST /auth/login          publique, limitée (IP + email, email, IP) ; rôle admin exigé
 *
 * Puis, pour TOUTE route /api/admin/* (y compris celles des autres routeurs) :
 * requireAuth (401) → requireRole('admin') (403) → requireAdminSession (401, 8 h / 30 min).
 *
 *   POST /auth/logout                          déconnexion effective (auditée)
 *   GET  /auth/session                         compte et session courants
 *   GET  /dashboard?from&to                    indicateurs réels
 *   GET  /users  /users/:userId (audité)  /users/:userId/games  /users/:userId/transactions
 *   GET  /games  /games/:gameId               sans aucune donnée de jeu privée
 *   GET  /finance/overview?from&to
 *   GET  /wallet-transactions
 *   GET  /payments  /payments/:paymentId (audité)
 *   POST /payments/:paymentId/verify          Idempotency-Key ; revérification CinetPay (auditée)
 *   GET  /reconciliation/anomalies            lecture seule
 *   GET  /platform-account  /platform-account/entries
 *   GET  /reports/:report?from&to  /reports/:report/csv (audité)
 *   GET  /audit-log                           lecture seule
 *   GET  /system                              état des services, informations non sensibles
 */
export function createAdminRouter(deps: AdminRouterDependencies): Router {
  const { auth, sessions, logger, rateLimitStore } = deps;
  const limits = deps.loginLimits ?? ADMIN_LOGIN_LIMITS;
  const router = Router();
  const controller = createAdminController(deps);

  const ip = (req: Request) => req.ip ?? 'unknown';
  const email = (req: Request) => {
    const value: unknown = (req.body as { email?: unknown } | undefined)?.email;
    return typeof value === 'string' ? value.trim().toLowerCase() : '';
  };
  router.post(
    '/auth/login',
    createSharedRateLimiter({
      name: 'admin-login-ip',
      ...limits.perIp,
      store: rateLimitStore,
      keyOf: (req) => hashKey(ip(req)),
    }),
    createSharedRateLimiter({
      name: 'admin-login-email',
      ...limits.perEmail,
      store: rateLimitStore,
      keyOf: (req) => hashKey(email(req)),
    }),
    createSharedRateLimiter({
      name: 'admin-login-account',
      ...limits.perAccount,
      store: rateLimitStore,
      keyOf: (req) => hashKey(`${ip(req)}|${email(req)}`),
    }),
    controller.login,
  );

  // Garde commune à toutes les routes /api/admin/* qui suivent, ici et dans les autres routeurs.
  router.use(
    createRequireAuth(auth, logger),
    createRequireRole('admin', logger),
    createRequireAdminSession(sessions, logger),
  );

  router.post('/auth/logout', controller.logout);
  router.get('/auth/session', controller.session);
  router.get('/dashboard', controller.dashboard);
  router.get('/users', controller.users);
  router.get('/users/:userId', controller.user);
  router.get('/users/:userId/games', controller.userGames);
  router.get('/users/:userId/transactions', controller.userTransactions);
  router.get('/games', controller.games);
  router.get('/games/:gameId', controller.game);
  router.get('/finance/overview', controller.financeOverview);
  router.get('/wallet-transactions', controller.walletTransactions);
  router.get('/payments', controller.payments);
  router.get('/payments/:paymentId', controller.payment);
  router.post('/payments/:paymentId/verify', controller.verifyPayment);
  router.get('/reconciliation/anomalies', controller.anomalies);
  router.get('/platform-account', controller.platformAccount);
  router.get('/platform-account/entries', controller.ledgerEntries);
  router.get('/reports/:report', controller.report);
  router.get('/reports/:report/csv', controller.exportReport);
  router.get('/audit-log', controller.auditLog);
  router.get('/system', controller.system);
  return router;
}
