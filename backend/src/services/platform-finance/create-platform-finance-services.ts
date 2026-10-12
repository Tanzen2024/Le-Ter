import type { CinetPayEnv } from '../../config/env';
import type { PlatformPayoutEnv } from '../../config/platform-payout-env';
import type { SqlClient } from '../../database/sql-client';
import { PostgresPlatformFinanceRepository } from '../../repositories/postgres-platform-finance.repository';
import type { Logger } from '../../utils/logger';
import type { CinetPayClient } from '../payments/cinetpay/cinetpay-client';
import { CinetPayTransferGateway } from '../payments/cinetpay/cinetpay-transfer.gateway';
import { UnconfiguredTransferGateway, type TransferGateway } from '../withdrawals/transfer.gateway';
import type { WithdrawalAvailability } from '../withdrawals/withdrawal-availability';
import { PlatformPayoutExecutor } from './platform-payout-executor';
import { PlatformPayoutService, type PayoutExecutionState } from './platform-payout.service';
import { PlatformRevenueService } from './platform-revenue.service';
import {
  CinetPayTreasuryGateway,
  UnconfiguredTreasuryGateway,
  type TreasuryGateway,
} from './treasury.gateway';
import { TreasuryReconciliationService } from './treasury-reconciliation.service';

/** Motif transmis à CinetPay (sans donnée personnelle). */
const PLATFORM_TRANSFER_REASON = 'Retrait des revenus Le Ter';

/**
 * État d'exécution, décidé UNE FOIS au démarrage. Trois verrous cumulés, tous requis :
 * 1. `PLATFORM_PAYOUTS_ENABLED=true` (défaut : faux) ;
 * 2. transferts CinetPay disponibles au sens de D-077 (`CINETPAY_TRANSFERS_ENABLED`,
 *    attestation de production, environnement cohérent…) ;
 * 3. URL de notification dédiée.
 * Sinon : ni mise en exécution, ni envoi (la relecture continue si CinetPay est configuré).
 */
export function resolvePayoutExecution(input: {
  env: PlatformPayoutEnv;
  transferAvailability: WithdrawalAvailability;
}): PayoutExecutionState {
  if (!input.env.enabled)
    return { enabled: false, reason: 'PLATFORM_PAYOUTS_DISABLED', mode: 'disabled' };
  if (input.transferAvailability.mode === 'unavailable') {
    return {
      enabled: false,
      reason: `TRANSFERS_${input.transferAvailability.reason ?? 'UNAVAILABLE'}`,
      mode: 'disabled',
    };
  }
  if (!input.env.notifyUrl)
    return { enabled: false, reason: 'NOTIFY_URL_MISSING', mode: 'disabled' };
  return { enabled: true, mode: input.transferAvailability.mode };
}

export function createPlatformFinanceServices(options: {
  sql: SqlClient;
  logger: Logger;
  env: PlatformPayoutEnv;
  cinetpay?: CinetPayEnv;
  client?: CinetPayClient;
  transferAvailability: WithdrawalAvailability;
  /** Injection pour les tests : passerelles simulées, jamais réelles. */
  transfers?: TransferGateway;
  treasuryGateway?: TreasuryGateway;
  execution?: PayoutExecutionState;
  clock?: () => Date;
}) {
  const repository = new PostgresPlatformFinanceRepository(options.sql);
  const execution =
    options.execution ??
    resolvePayoutExecution({
      env: options.env,
      transferAvailability: options.transferAvailability,
    });
  const transfers =
    options.transfers ??
    (options.client && options.cinetpay
      ? new CinetPayTransferGateway({
          client: options.client,
          reason: PLATFORM_TRANSFER_REASON,
          // Sans URL : CinetPayTransferGateway.canSubmit = false (relecture seulement).
          ...(execution.enabled && options.env.notifyUrl && { notifyUrl: options.env.notifyUrl }),
        })
      : new UnconfiguredTransferGateway());
  const treasuryGateway =
    options.treasuryGateway ??
    (options.client && options.cinetpay
      ? new CinetPayTreasuryGateway(options.client, options.cinetpay.environment)
      : new UnconfiguredTreasuryGateway());
  const logger = options.logger.child({ action: 'PLATFORM_PAYOUT' });
  const revenue = new PlatformRevenueService(repository);
  const treasury = new TreasuryReconciliationService({
    store: repository,
    gateway: treasuryGateway,
    logger,
    ...(options.clock && { clock: options.clock }),
  });
  const payouts = new PlatformPayoutService({
    repository,
    revenue,
    treasury,
    transfers,
    execution,
    fees: options.env.fees,
    logger,
    ...(options.clock && { clock: options.clock }),
  });
  const executor = new PlatformPayoutExecutor({
    payouts,
    repository,
    logger,
    ...(options.clock && { clock: options.clock }),
  });
  return { repository, revenue, treasury, payouts, executor };
}
