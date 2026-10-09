import type { CinetPayEnv } from '../../config/env';
import type { SqlClient } from '../../database/sql-client';
import { PostgresPaymentRepository } from '../../repositories/postgres-payment.repository';
import type { Logger } from '../../utils/logger';
import type { MobileMoneyGateway } from '../wallet/mobile-money.gateway';
import { CinetPayClient } from './cinetpay/cinetpay-client';
import { CinetPayGateway } from './cinetpay/cinetpay.gateway';
import { PaymentService } from './payment.service';

/**
 * Paiements (D-050) sur PostgreSQL. Avec CinetPay configuré : le fournisseur du port
 * `MobileMoneyGateway` (achats) et la vérification des notifications. Sans configuration :
 * aucun gateway (le compte de jeu garde `UnconfiguredMobileMoneyGateway`) et aucune
 * notification ne peut être vérifiée, donc jamais réglée.
 */
export function createPaymentServices(options: {
  sql: SqlClient;
  logger: Logger;
  cinetpay?: CinetPayEnv;
}): { payments: PaymentService; gateway?: MobileMoneyGateway } {
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
  return {
    payments: new PaymentService({
      payments: repository,
      cinetpay: client,
      logger: options.logger,
    }),
    gateway: new CinetPayGateway({
      client,
      payments: repository,
      logger: options.logger,
      notifyUrl: config.notifyUrl,
      returnUrl: config.returnUrl,
    }),
  };
}
