import express, { type Express } from 'express';

import { createErrorHandler, notFoundHandler } from './middleware/error-handler';
import { requestId } from './middleware/request-id';
import { securityHeaders } from './middleware/security-headers';
import { createApiRouter } from './routes';
import type { AuthRateLimits } from './routes/auth.routes';
import type { GameRateLimits } from './routes/game.routes';
import type { AdminRouterDependencies } from './routes/admin.routes';
import type { PaymentRouterOptions } from './routes/payment.routes';
import type { AuthService } from './services/auth/auth.service';
import type { ChatService } from './services/chat/chat.service';
import type { DetectionAdminService } from './services/detection/detection-admin.service';
import type { DetectionSettingsService } from './services/detection/detection-settings.service';
import type { GeolocationService } from './services/detection/geolocation.service';
import type { GameService } from './services/game/game.service';
import type { SessionService } from './services/sessions/session.service';
import type { PaymentService } from './services/payments/payment.service';
import type { NotificationService } from './services/notifications/notification.service';
import type { TournamentService } from './services/tournaments/tournament.service';
import type { WalletService } from './services/wallet/wallet.service';
import { createLogger, type Logger } from './utils/logger';

export interface AppDependencies {
  logger?: Logger;
  /** Service d'authentification ; absent, les routes /api/auth répondent 503. */
  auth?: AuthService;
  authRateLimits?: AuthRateLimits;
  /** Service des parties ; absent, les routes /api/games répondent 503. */
  games?: GameService;
  /** Sessions multi-parties (D-033) ; fournies avec `games`. */
  sessions?: SessionService;
  gameRateLimits?: GameRateLimits;
  /** Compte de jeu (D-040) ; absent, les routes /api/wallet répondent 503. */
  wallet?: WalletService;
  walletWriteLimit?: { windowMs: number; max: number };
  /** Paiements CinetPay (D-050) ; absents, /api/payments répond 503. */
  payments?: PaymentService;
  paymentOptions?: PaymentRouterOptions;
  /** Chat de partie (D-045) ; absent, ses routes ne sont pas montées. */
  chat?: ChatService;
  /** Géolocalisation de la détection (D-046) ; absente, ses routes ne sont pas montées. */
  geolocation?: GeolocationService;
  /** Administration de la détection (D-049) ; absente, /api/admin/detection répond 503. */
  detectionAdmin?: DetectionAdminService;
  /** Interrupteur global de la détection (D-053) ; absent, /api/admin/settings répond 503. */
  detectionSettings?: DetectionSettingsService;
  /** Tournois (D-054) ; absents, /api/tournaments répond 503. */
  tournaments?: TournamentService;
  /** Notifications dans l'application (D-054) ; absentes, /api/notifications répond 503. */
  notifications?: NotificationService;
  /** Plateforme d'administration (D-061) ; absente, toutes les routes /api/admin/* : 503. */
  admin?: Omit<AdminRouterDependencies, 'auth' | 'logger'>;
  /**
   * Proxys de confiance (`TRUST_PROXY`) : absent = aucun (req.ip = pair TCP). Ne jamais
   * l'activer sans connaître l'infrastructure réelle (X-Forwarded-For falsifiable).
   */
  trustProxy?: number | string;
}

/** Les commandes de jeu sont de petits messages : un corps plus gros est un abus. */
const JSON_BODY_LIMIT = '32kb';

export function createApp({
  logger = createLogger(),
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
  detectionAdmin,
  detectionSettings,
  tournaments,
  notifications,
  admin,
  trustProxy,
}: AppDependencies = {}): Express {
  const app = express();

  app.disable('x-powered-by');
  if (trustProxy !== undefined) {
    app.set('trust proxy', trustProxy);
  }
  app.use(requestId);
  app.use(securityHeaders);
  app.use(express.json({ limit: JSON_BODY_LIMIT }));

  app.use(
    '/api',
    createApiRouter({
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
      detectionAdmin,
      detectionSettings,
      tournaments,
      notifications,
      admin,
    }),
  );

  app.use(notFoundHandler);
  app.use(createErrorHandler(logger));

  return app;
}
