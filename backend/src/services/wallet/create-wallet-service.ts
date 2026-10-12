import type { SqlClient } from '../../database/sql-client';
import { PostgresPaymentRepository } from '../../repositories/postgres-payment.repository';
import { PostgresUserRepository } from '../../repositories/postgres-user.repository';
import { PostgresWalletRepository } from '../../repositories/postgres-wallet.repository';
import type { Logger } from '../../utils/logger';
import type { WithdrawalAvailability } from '../withdrawals/withdrawal-availability';
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
  /** Retraits (D-075, D-077) : état annoncé par `GET /api/wallet`. */
  withdrawalAvailability?: () => WithdrawalAvailability;
}): WalletService {
  return new WalletService({
    wallets: new PostgresWalletRepository(options.sql),
    users: new PostgresUserRepository(options.sql),
    gateway: options.gateway ?? new UnconfiguredMobileMoneyGateway(),
    payments: new PostgresPaymentRepository(options.sql),
    withdrawalAvailability: options.withdrawalAvailability,
    logger: options.logger,
  });
}
