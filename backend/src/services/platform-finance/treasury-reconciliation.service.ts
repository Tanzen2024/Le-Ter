import { randomUUID } from 'node:crypto';

import {
  computeTreasury,
  PLATFORM_PAYOUT_CURRENCY,
  TreasuryProviderUnavailableError,
  type TreasuryObservation,
  type TreasurySummary,
} from '../../domain/platform-finance/platform-finance';
import type { UserId } from '../../domain/users/user';
import type { PlatformFinanceStore } from '../../repositories/platform-finance.repository';
import type { Logger } from '../../utils/logger';
import { CinetPayError } from '../payments/cinetpay/cinetpay-client';
import { parseXafAmount, type TreasuryGateway } from './treasury.gateway';

/**
 * Trésorerie réelle (D-078). Le solde disponible n'est JAMAIS calculé ni saisi : il est relu
 * chez CinetPay (`GET /v1/balances`) et chaque relecture est conservée (source, date, devise,
 * statut), même en erreur. La trésorerie n'est « confirmée » que par une relecture VALIDE de
 * moins de 15 minutes ; sinon elle est inconnue, indisponible ou périmée, et rien n'est réservé
 * ni exécuté.
 */
export class TreasuryReconciliationService {
  private readonly clock: () => Date;

  constructor(
    private readonly deps: {
      store: PlatformFinanceStore;
      gateway: TreasuryGateway;
      logger: Logger;
      clock?: () => Date;
    },
  ) {
    this.clock = deps.clock ?? (() => new Date());
  }

  get configured(): boolean {
    return this.deps.gateway.configured;
  }

  /**
   * Relit le solde chez CinetPay et enregistre la constatation. Une erreur du prestataire est
   * enregistrée (ERROR) et ne décide rien. Lève si CinetPay n'est pas configuré.
   */
  async observe(requestedBy?: UserId): Promise<TreasuryObservation> {
    if (!this.deps.gateway.configured) throw new TreasuryProviderUnavailableError();
    const base = {
      id: randomUUID(),
      source: 'CINETPAY_API' as const,
      environment: this.deps.gateway.environment,
      ...(requestedBy && { requestedBy }),
    };
    let observation: TreasuryObservation;
    try {
      const raw = await this.deps.gateway.readBalance();
      const amount = parseXafAmount(raw.availableBalance);
      if (raw.currency !== PLATFORM_PAYOUT_CURRENCY) {
        observation = {
          ...base,
          status: 'INVALID',
          errorCode: 'CURRENCY_MISMATCH',
          ...(raw.currency && { currency: raw.currency.slice(0, 10) }),
          observedAt: this.clock(),
        };
      } else if (amount === null) {
        observation = {
          ...base,
          status: 'INVALID',
          errorCode: 'AMOUNT_NOT_INTEGER',
          observedAt: this.clock(),
        };
      } else {
        observation = {
          ...base,
          status: 'VALID',
          availableAmount: amount,
          currency: PLATFORM_PAYOUT_CURRENCY,
          observedAt: this.clock(),
        };
      }
    } catch (err) {
      observation = {
        ...base,
        status: 'ERROR',
        errorCode:
          err instanceof CinetPayError
            ? `CINETPAY_${err.kind.toUpperCase()}${err.details.apiCode !== undefined ? `_${err.details.apiCode}` : ''}`
            : 'PROVIDER_ERROR',
        observedAt: this.clock(),
      };
    }
    await this.deps.store.insertObservation(observation);
    this.deps.logger.info('treasury observed', {
      observationId: observation.id,
      status: observation.status,
      ...(observation.errorCode && { errorCode: observation.errorCode }),
    });
    return observation;
  }

  async summary(
    store: PlatformFinanceStore = this.deps.store,
    reservedPayouts?: number,
  ): Promise<TreasurySummary> {
    const [lastObservation, lastValidObservation, obligations, facts] = await Promise.all([
      store.lastObservation(),
      store.lastValidObservation(),
      store.playerObligations(),
      reservedPayouts === undefined ? store.revenueFacts() : Promise.resolve(null),
    ]);
    return computeTreasury({
      lastObservation,
      lastValidObservation,
      obligations,
      reservedPayouts: reservedPayouts ?? facts!.reservedPayouts.amount,
      now: this.clock(),
    });
  }

  history(limit = 20): Promise<TreasuryObservation[]> {
    return this.deps.store.listObservations(limit);
  }
}
