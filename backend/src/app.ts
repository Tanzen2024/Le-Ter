import express, { type Express } from 'express';

import { createErrorHandler, notFoundHandler } from './middleware/error-handler';
import { requestId } from './middleware/request-id';
import { securityHeaders } from './middleware/security-headers';
import { createApiRouter } from './routes';
import type { AuthRateLimits } from './routes/auth.routes';
import type { GameRateLimits } from './routes/game.routes';
import type { AdminRouterDependencies } from './routes/admin.routes';
import type { ComplaintRouterDependencies } from './routes/complaint.routes';
import type { PaymentRouterOptions } from './routes/payment.routes';
import type { AuthService } from './services/auth/auth.service';
import type { ChatService } from './services/chat/chat.service';
import type { DetectionAdminService } from './services/detection/detection-admin.service';
import type { GameCommissionSettingsService } from './services/game/game-commission-settings.service';
import type { DetectionSettingsService } from './services/detection/detection-settings.service';
import type { GeolocationService } from './services/detection/geolocation.service';
import type { GameService } from './services/game/game.service';
import type { SessionService } from './services/sessions/session.service';
import type { PaymentService } from './services/payments/payment.service';
import type { ReferralService } from './services/referrals/referral.service';
import type { NotificationService } from './services/notifications/notification.service';
import type { TournamentService } from './services/tournaments/tournament.service';
import type { WalletService } from './services/wallet/wallet.service';
import type { PlatformFinanceDependencies } from './routes/platform-finance.routes';
import type { WithdrawalAdminService } from './services/withdrawals/withdrawal-admin.service';
import type { WithdrawalService } from './services/withdrawals/withdrawal.service';
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
  /** Retraits Mobile Money (D-075) ; absents, les retraits répondent 503. */
  withdrawals?: WithdrawalService;
  /** Administration des retraits (D-075) ; absente, /api/admin/withdrawals répond 503. */
  withdrawalAdmin?: WithdrawalAdminService;
  /** Retraits des revenus de la plateforme (D-078) ; absents, /api/admin/platform-finance : 503. */
  platformFinance?: PlatformFinanceDependencies;
  /** Chat de partie (D-045) ; absent, ses routes ne sont pas montées. */
  chat?: ChatService;
  /** Géolocalisation de la détection (D-046) ; absente, ses routes ne sont pas montées. */
  geolocation?: GeolocationService;
  /** Administration de la détection (D-049) ; absente, /api/admin/detection répond 503. */
  detectionAdmin?: DetectionAdminService;
  /** Interrupteur global de la détection (D-053) ; absent, /api/admin/settings répond 503. */
  detectionSettings?: DetectionSettingsService;
  /** Commission sur les gains des parties (D-074) ; absente, /api/admin/settings/game-commission : 503. */
  gameCommissionSettings?: GameCommissionSettingsService;
  /** Tournois (D-054) ; absents, /api/tournaments répond 503. */
  tournaments?: TournamentService;
  /** Notifications dans l'application (D-054) ; absentes, /api/notifications répond 503. */
  notifications?: NotificationService;
  /** Plateforme d'administration (D-061) ; absente, toutes les routes /api/admin/* : 503. */
  admin?: Omit<AdminRouterDependencies, 'auth' | 'logger'>;
  /** Réclamations et assistant (D-114) ; absents, /api/complaints et /api/support : 503. */
  complaints?: ComplaintRouterDependencies;
  /** Parrainage (D-161) ; absent, /api/referrals et /api/admin/referrals : 503. */
  referrals?: ReferralService;
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
  withdrawals,
  withdrawalAdmin,
  platformFinance,
  chat,
  geolocation,
  detectionAdmin,
  detectionSettings,
  gameCommissionSettings,
  tournaments,
  notifications,
  admin,
  complaints,
  referrals,
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
      withdrawals,
      withdrawalAdmin,
      platformFinance,
      chat,
      geolocation,
      detectionAdmin,
      detectionSettings,
      gameCommissionSettings,
      tournaments,
      notifications,
      admin,
      complaints,
      referrals,
    }),
  );

  app.use(notFoundHandler);
  app.use(createErrorHandler(logger));

  return app;
}
