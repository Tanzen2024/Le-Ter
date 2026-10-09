import { Router } from 'express';

import { createPaymentController } from '../controllers/payment.controller';
import { createRateLimiter } from '../middleware/rate-limit';
import { createRequireAuth } from '../middleware/require-auth';
import type { AuthService } from '../services/auth/auth.service';
import type { PaymentService } from '../services/payments/payment.service';
import type { Logger } from '../utils/logger';

/** Retour par défaut dans l'application (scheme `leter`, route Expo Router `payment/return`). */
export const DEFAULT_APP_RETURN_URL = 'leter://payment/return';

/** Notifications du fournisseur : publiques, donc limitées par adresse IP. */
export const DEFAULT_PAYMENT_NOTIFY_LIMIT = { windowMs: 60_000, max: 120 };

export interface PaymentRouterOptions {
  appReturnUrl?: string;
  notifyLimit?: { windowMs: number; max: number };
}

/**
 * Routes /api/payments (D-050) :
 *
 *   POST /cinetpay/notify             notification CinetPay (publique, vérifiée serveur à serveur)
 *   GET  /cinetpay/return/:paymentId  retour du navigateur → leter://payment/return (publique)
 *   GET  /:id                         paiement du joueur authentifié uniquement
 */
export function createPaymentRouter(
  payments: PaymentService,
  auth: AuthService,
  logger: Logger,
  options: PaymentRouterOptions = {},
): Router {
  const router = Router();
  const controller = createPaymentController(
    payments,
    options.appReturnUrl ?? DEFAULT_APP_RETURN_URL,
  );
  const notifyLimit = createRateLimiter({
    name: 'payment-notify',
    ...(options.notifyLimit ?? DEFAULT_PAYMENT_NOTIFY_LIMIT),
  });
  router.post('/cinetpay/notify', notifyLimit, controller.notifyCinetPay);
  router.get('/cinetpay/return/:paymentId', notifyLimit, controller.returnToApp);
  router.get('/:id', createRequireAuth(auth, logger), controller.get);
  return router;
}
