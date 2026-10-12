import type { CinetPayEnv } from '../../config/env';
import type { SqlClient } from '../../database/sql-client';
import { PostgresPaymentRepository } from '../../repositories/postgres-payment.repository';
import type { Logger } from '../../utils/logger';
import type { MobileMoneyGateway } from '../wallet/mobile-money.gateway';
import { CinetPayClient } from './cinetpay/cinetpay-client';
import { CinetPayGateway } from './cinetpay/cinetpay.gateway';
import { PaymentReconciler } from './payment-reconciler';
import { PaymentService } from './payment.service';

/**
 * Paiements (D-050) sur PostgreSQL. Avec CinetPay configuré : le fournisseur du port
 * `MobileMoneyGateway` (achats), la vérification des notifications et la réconciliation
 * automatique des paiements en attente. Sans configuration : aucun gateway (le compte de jeu
 * garde `UnconfiguredMobileMoneyGateway`) et aucune notification ne peut être vérifiée, donc
 * jamais réglée.
 */
export function createPaymentServices(options: {
  sql: SqlClient;
  logger: Logger;
  cinetpay?: CinetPayEnv;
}): {
  payments: PaymentService;
  gateway?: MobileMoneyGateway;
  reconciler?: PaymentReconciler;
  /** Client v1 partagé (jeton mis en cache une fois) : réutilisé pour les transferts (D-075). */
  client?: CinetPayClient;
} {
  const repository = new PostgresPaymentRepository(options.sql);
  if (!options.cinetpay) {
    return { payments: new PaymentService({ payments: repository, logger: options.logger }) };
  }
  const config = options.cinetpay;
  const client = new CinetPayClient({
    baseUrl: config.baseUrl,
    apiKey: config.apiKey,
    apiPassword: config.apiPassword,
    timeoutMs: config.timeoutMs,
    logger: options.logger.child({ action: 'CINETPAY' }),
  });
  const payments = new PaymentService({
    payments: repository,
    cinetpay: client,
    logger: options.logger,
  });
  return {
    payments,
    client,
    gateway: new CinetPayGateway({
      client,
      payments: repository,
      logger: options.logger,
      notifyUrl: config.notifyUrl,
      returnUrl: config.returnUrl,
      directPayOperators: config.directPayMethods,
      pagePreselectOperators: config.pagePreselectMethods,
    }),
    // Paiements en attente revérifiés sans notification ni application ouverte.
    reconciler: new PaymentReconciler({
      payments,
      repository,
      logger: options.logger.child({ action: 'PAYMENT_RECONCILE' }),
      options: { tickMs: config.reconcileIntervalMs },
    }),
  };
}
