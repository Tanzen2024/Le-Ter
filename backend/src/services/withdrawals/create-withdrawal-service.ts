import type { CinetPayEnv } from '../../config/env';
import type { SqlClient } from '../../database/sql-client';
import { PostgresUserRepository } from '../../repositories/postgres-user.repository';
import { PostgresWalletRepository } from '../../repositories/postgres-wallet.repository';
import { PostgresWithdrawalRepository } from '../../repositories/postgres-withdrawal.repository';
import type { Logger } from '../../utils/logger';
import type { CinetPayClient } from '../payments/cinetpay/cinetpay-client';
import { CinetPayTransferGateway } from '../payments/cinetpay/cinetpay-transfer.gateway';
import { UnconfiguredTransferGateway, type TransferGateway } from './transfer.gateway';
import type { WithdrawalAvailability } from './withdrawal-availability';
import { WithdrawalReconciler } from './withdrawal-reconciler';
import { WithdrawalService } from './withdrawal.service';

/**
 * Retraits Mobile Money (D-075, D-076) sur PostgreSQL.
 *
 * - CinetPay configuré ET `availability` sandbox ou live (D-077) : nouveaux transferts et
 *   relecture ;
 * - CinetPay configuré, retraits indisponibles (transferts désactivés, production non
 *   attestée, sandbox en production, schéma en retard…) : AUCUN nouveau transfert (aucune demande
 *   acceptée, aucun envoi, même pour un retrait déjà créé), mais la relecture continue :
 *   réconciliation, notifications et revérifications des retraits déjà ouverts ;
 * - CinetPay non configuré : ni envoi ni relecture (historique, quota, administration).
 */
export function createWithdrawalServices(options: {
  sql: SqlClient;
  logger: Logger;
  cinetpay?: CinetPayEnv;
  client?: CinetPayClient;
  /** État décidé au démarrage (`resolveWithdrawalAvailability`). */
  availability: WithdrawalAvailability;
  /** Injection pour les tests (transfert simulé, jamais réel). */
  gateway?: TransferGateway;
}): { withdrawals: WithdrawalService; reconciler?: WithdrawalReconciler } {
  const repository = new PostgresWithdrawalRepository(options.sql);
  // L'URL de notification n'est confiée à la passerelle (canSubmit) que si l'état l'autorise.
  const submitNotifyUrl =
    options.availability.mode !== 'unavailable' ? options.cinetpay?.transfers?.notifyUrl : undefined;
  const gateway =
    options.gateway ??
    (options.client && options.cinetpay
      ? new CinetPayTransferGateway({
          client: options.client,
          // Absente : relecture seulement (CinetPayTransferGateway.canSubmit = false).
          ...(submitNotifyUrl !== undefined && { notifyUrl: submitNotifyUrl }),
        })
      : new UnconfiguredTransferGateway());
  const withdrawals = new WithdrawalService({
    withdrawals: repository,
    wallets: new PostgresWalletRepository(options.sql),
    users: new PostgresUserRepository(options.sql),
    gateway,
    logger: options.logger,
    availability: options.availability,
    options: { maxSubmissionAttempts: options.cinetpay?.transfers?.maxSubmissions ?? 1 },
  });
  // Réconciliation dès que la relecture est possible, indépendamment des nouveaux transferts.
  if (!gateway.canLookup) return { withdrawals };
  return {
    withdrawals,
    reconciler: new WithdrawalReconciler({
      withdrawals,
      repository,
      logger: options.logger.child({ action: 'WITHDRAWAL_RECONCILE' }),
      options: options.cinetpay ? { tickMs: options.cinetpay.reconcileIntervalMs } : {},
    }),
  };
}
