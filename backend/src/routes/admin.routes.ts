import { Router, type Request } from 'express';

import {
  createAdminEventsHandler,
  type AdminEventStreams,
} from '../controllers/admin-events.controller';
import { createAdminController, type AdminSystemInfo } from '../controllers/admin.controller';
import { createPlayerModerationController } from '../controllers/player-moderation.controller';
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
import type { PlayerModerationService } from '../services/admin/player-moderation.service';
import type { AuthService } from '../services/auth/auth.service';
import type { Logger } from '../utils/logger';
import type { AdminEventSubscriber } from '../websocket/admin-event-bus';

export interface AdminRouterDependencies {
  auth: AuthService;
  sessions: AdminSessionService;
  queries: AdminQueryService;
  moderation: PlayerModerationService;
  rateLimitStore: RateLimitStore;
  loginLimits?: AdminLoginLimits;
  system: AdminSystemInfo;
  logger: Logger;
  /** Signaux temps réel de l'administration (D-116) ; absents, GET /events répond 503. */
  events?: AdminEventSubscriber;
  /** Flux d'événements : registre (arrêt du serveur) et rythme (tests). */
  eventStream?: { streams?: AdminEventStreams; heartbeatMs?: number; recheckMs?: number };
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
 *   GET  /attention                            points d'attention seuls (cloche, D-116)
 *   GET  /events                               flux SSE « point d'attention changé » (D-116)
 *   (en-tête `X-Admin-Passive: 1` sur un GET : contrôlé sans compter comme une activité)
 *   GET  /users  /users/:userId (audité)  /users/:userId/games  /users/:userId/transactions
 *   Gestion des joueurs (D-079) — lecture :
 *   GET  /users/:userId/moderation  /sanctions  /notes  /moderation-log?includeViews
 *   Gestion des joueurs (D-079) — actions, toutes auditées :
 *   POST /users/:userId/disable  /enable                  { reason }
 *   POST /users/:userId/suspension                        { reason, comment?, endsAt? }
 *   POST /users/:userId/suspension/lift                   { reason }
 *   POST /users/:userId/sessions/revoke                   { reason? }
 *   POST /users/:userId/recovery                          { reason } → { recoveryCode } (D-135)
 *   POST /users/:userId/chat-restriction                  { reason, comment?, endsAt? }
 *   POST /users/:userId/chat-restriction/lift             { reason }
 *   POST /users/:userId/warnings     Idempotency-Key      { reason, playerMessage?, comment? }
 *   POST /users/:userId/notes        Idempotency-Key      { body }
 *   POST /users/:userId/notes/:noteId/delete              { reason }
 *   GET  /games  /games/:gameId               sans aucune donnée de jeu privée
 *   GET  /finance/overview?from&to
 *   GET  /wallet-transactions
 *   GET  /payments  /payments/:paymentId (audité)
 *   POST /payments/:paymentId/verify          Idempotency-Key ; revérification CinetPay (auditée)
 *   GET  /reconciliation/anomalies            lecture seule
 *   GET  /platform-account  /platform-account/entries
 *   GET  /reports/:report?from&to  /reports/:report/csv (audité)
 *   GET  /audit-log                           lecture seule
 *   GET  /server-errors?page&limit            pannes 5xx regroupées (D-168), lecture seule
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
  router.get('/attention', controller.attention);
  const events = deps.events;
  router.get(
    '/events',
    events
      ? createAdminEventsHandler({ auth, sessions, events, logger, ...deps.eventStream })
      : (_req, res) => {
          res.status(503).json({
            error: 'Service Unavailable',
            code: 'REALTIME_UNAVAILABLE',
            message: 'Les mises à jour en temps réel ne sont pas disponibles.',
          });
        },
  );
  router.get('/users', controller.users);
  router.get('/users/:userId', controller.user);
  router.get('/users/:userId/games', controller.userGames);
  router.get('/users/:userId/transactions', controller.userTransactions);
  const players = createPlayerModerationController(deps);
  router.get('/users/:userId/moderation', players.overview);
  router.get('/users/:userId/sanctions', players.sanctions);
  router.get('/users/:userId/notes', players.notes);
  router.get('/users/:userId/moderation-log', players.log);
  router.post('/users/:userId/disable', players.disable);
  router.post('/users/:userId/enable', players.enable);
  router.post('/users/:userId/suspension', players.suspend);
  router.post('/users/:userId/suspension/lift', players.liftSuspension);
  router.post('/users/:userId/sessions/revoke', players.revokeSessions);
  router.post('/users/:userId/recovery', players.recoverAccount);
  router.post('/users/:userId/chat-restriction', players.restrictChat);
  router.post('/users/:userId/chat-restriction/lift', players.liftChatRestriction);
  router.post('/users/:userId/warnings', players.warn);
  router.post('/users/:userId/notes', players.addNote);
  router.post('/users/:userId/notes/:noteId/delete', players.deleteNote);
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
  router.get('/server-errors', controller.serverErrors);
  router.get('/system', controller.system);
  return router;
}
