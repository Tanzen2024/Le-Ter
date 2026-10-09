import type { SqlClient } from '../../database/sql-client';
import { PostgresPaymentRepository } from '../../repositories/postgres-payment.repository';
import { PostgresUserRepository } from '../../repositories/postgres-user.repository';
import { PostgresWalletRepository } from '../../repositories/postgres-wallet.repository';
import type { Logger } from '../../utils/logger';
import { UnconfiguredMobileMoneyGateway, type MobileMoneyGateway } from './mobile-money.gateway';
import { WalletService } from './wallet.service';

/**
 * Compte de jeu (D-040) sur PostgreSQL. Sans fournisseur Mobile Money configuré, les achats
 * et retraits sont enregistrés puis refusés proprement (jamais de fausse réussite).
 */
export function createWalletService(options: {
  sql: SqlClient;
  logger: Logger;
  gateway?: MobileMoneyGateway;
}): WalletService {
  return new WalletService({
    wallets: new PostgresWalletRepository(options.sql),
    users: new PostgresUserRepository(options.sql),
    gateway: options.gateway ?? new UnconfiguredMobileMoneyGateway(),
    payments: new PostgresPaymentRepository(options.sql),
    logger: options.logger,
  });
}
