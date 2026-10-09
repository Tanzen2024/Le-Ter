import { Router } from 'express';

import type { AuthService } from '../services/auth/auth.service';
import type { ChatService } from '../services/chat/chat.service';
import type { DetectionAdminService } from '../services/detection/detection-admin.service';
import type { DetectionSettingsService } from '../services/detection/detection-settings.service';
import type { GeolocationService } from '../services/detection/geolocation.service';
import type { GameService } from '../services/game/game.service';
import type { SessionService } from '../services/sessions/session.service';
import type { PaymentService } from '../services/payments/payment.service';
import type { NotificationService } from '../services/notifications/notification.service';
import type { TournamentService } from '../services/tournaments/tournament.service';
import type { WalletService } from '../services/wallet/wallet.service';
import type { Logger } from '../utils/logger';
import { createAuthRouter, createUnavailableRouter, type AuthRateLimits } from './auth.routes';
import { createChatRouter } from './chat.routes';
import { createGameRouter, type GameRateLimits } from './game.routes';
import { createAdminRouter, type AdminRouterDependencies } from './admin.routes';
import { createAdminSettingsRouter } from './admin-settings.routes';
import { createDetectionAdminRouter } from './detection-admin.routes';
import { createGeolocationRouter } from './geolocation.routes';
import { healthRouter } from './health.routes';
import { createSessionRouter } from './session.routes';
import { createPaymentRouter, type PaymentRouterOptions } from './payment.routes';
import { createNotificationRouter } from './notification.routes';
import { createTournamentAdminRouter, createTournamentRouter } from './tournament.routes';
import { createWalletRouter, DEFAULT_WALLET_WRITE_LIMIT } from './wallet.routes';

export interface ApiRouterDependencies {
  logger: Logger;
  /** Absent : base ou JWT_SECRET non configurés, les routes /auth répondent 503. */
  auth?: AuthService;
  authRateLimits?: AuthRateLimits;
  /** Absent : base ou authentification non configurées, /games répond 503. */
  games?: GameService;
  /** Sessions (D-033) ; fournies avec `games`. */
  sessions?: SessionService;
  gameRateLimits?: GameRateLimits;
  /** Compte de jeu (D-040) ; absent, /wallet répond 503. */
  wallet?: WalletService;
  walletWriteLimit?: typeof DEFAULT_WALLET_WRITE_LIMIT;
  /** Paiements CinetPay (D-050) ; absents, /payments répond 503. */
  payments?: PaymentService;
  paymentOptions?: PaymentRouterOptions;
  /** Chat de partie (D-045), sous /games/:gameId/chat ; absent, non monté. */
  chat?: ChatService;
  /** Géolocalisation de la détection (D-046), sous /games/:gameId ; absente, non montée. */
  geolocation?: GeolocationService;
  /**
   * Plateforme d'administration (D-061) : connexion et session d'administration, lectures.
   * Absente : TOUTES les routes /api/admin/* répondent 503 (aucune administration sans
   * session d'administration bornée).
   */
  admin?: Omit<AdminRouterDependencies, 'auth' | 'logger'>;
  /** Administration de la détection (D-049), réservée au rôle admin ; absente, 503. */
  detectionAdmin?: DetectionAdminService;
  /** Interrupteur global de la détection (D-053), réservé au rôle admin ; absent, 503. */
  detectionSettings?: DetectionSettingsService;
  /** Tournois (D-054) ; absents, /tournaments et /admin/tournaments répondent 503. */
  tournaments?: TournamentService;
  /** Notifications dans l'application (D-054) ; absentes, /notifications répond 503. */
  notifications?: NotificationService;
}

export function createApiRouter({
  logger,
  auth,
  authRateLimits,
  games,
  sessions,
  gameRateLimits,
  wallet,
  walletWriteLimit,
  payments,
  paymentOptions,
  chat,
  geolocation,
  admin,
  detectionAdmin,
  detectionSettings,
  tournaments,
  notifications,
}: ApiRouterDependencies): Router {
  const router = Router();
  router.use('/health', healthRouter);
  router.use(
    '/auth',
    auth
      ? createAuthRouter(auth, logger, authRateLimits)
      : createUnavailableRouter(
          'AUTH_UNAVAILABLE',
          "L'authentification n'est pas configurée sur ce serveur.",
        ),
  );
  const gamesReady = auth && games && sessions;
  const unavailable = () =>
    createUnavailableRouter(
      'GAMES_UNAVAILABLE',
      'Les parties ne sont pas disponibles : base ou authentification non configurée.',
    );
  // Chat de partie : avant le routeur des parties, avec lequel il partage le préfixe /games.
  if (gamesReady && chat) {
    router.use('/games', createChatRouter(chat, auth, logger));
  }
  if (gamesReady && geolocation) {
    router.use('/games', createGeolocationRouter(geolocation, auth, logger));
  }
  router.use(
    '/games',
    gamesReady ? createGameRouter(games, sessions, auth, logger, gameRateLimits) : unavailable(),
  );
  router.use(
    '/sessions',
    gamesReady ? createSessionRouter(sessions, auth, logger, gameRateLimits) : unavailable(),
  );
  router.use(
    '/wallet',
    auth && wallet
      ? createWalletRouter(wallet, auth, logger, walletWriteLimit)
      : createUnavailableRouter(
          'WALLET_UNAVAILABLE',
          'Le compte de jeu n’est pas disponible : base ou authentification non configurée.',
        ),
  );
  router.use(
    '/payments',
    auth && payments
      ? createPaymentRouter(payments, auth, logger, paymentOptions)
      : createUnavailableRouter(
          'PAYMENTS_UNAVAILABLE',
          'Les paiements ne sont pas disponibles : base ou authentification non configurée.',
        ),
  );
  // Garde de TOUTE l'administration (D-061) : connexion admin, puis requireAuth →
  // requireRole('admin') → session d'administration (8 h / 30 min) pour chaque route
  // /api/admin/*, y compris celles des routeurs ci-dessous.
  router.use(
    '/admin',
    auth && admin
      ? createAdminRouter({ ...admin, auth, logger })
      : createUnavailableRouter(
          'ADMIN_UNAVAILABLE',
          "L'administration n'est pas disponible : base ou authentification non configurée.",
        ),
  );
  router.use(
    '/admin/detection',
    auth && detectionAdmin
      ? createDetectionAdminRouter(detectionAdmin, auth, logger)
      : createUnavailableRouter(
          'ADMIN_UNAVAILABLE',
          "L'administration n'est pas disponible : base ou authentification non configurée.",
        ),
  );
  router.use(
    '/admin/settings',
    auth && detectionSettings
      ? createAdminSettingsRouter(detectionSettings, auth, logger)
      : createUnavailableRouter(
          'ADMIN_UNAVAILABLE',
          "L'administration n'est pas disponible : base ou authentification non configurée.",
        ),
  );
  const tournamentsUnavailable = () =>
    createUnavailableRouter(
      'TOURNAMENTS_UNAVAILABLE',
      'Les tournois ne sont pas disponibles : base ou authentification non configurée.',
    );
  router.use(
    '/tournaments',
    auth && tournaments
      ? createTournamentRouter(tournaments, auth, logger)
      : tournamentsUnavailable(),
  );
  router.use(
    '/admin/tournaments',
    auth && tournaments
      ? createTournamentAdminRouter(tournaments, auth, logger)
      : tournamentsUnavailable(),
  );
  router.use(
    '/notifications',
    auth && notifications
      ? createNotificationRouter(notifications, auth, logger)
      : tournamentsUnavailable(),
  );
  return router;
}
