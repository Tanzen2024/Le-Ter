import {
  computeRevenue,
  type RevenueSummary,
} from '../../domain/platform-finance/platform-finance';
import type { PlatformFinanceStore } from '../../repositories/platform-finance.repository';

/**
 * Revenus de la plateforme (D-078) : calcul DÉTERMINISTE (`computeRevenue`) sur les faits
 * comptables enregistrés. Lecture seule : aucune écriture dans `platform_ledger`, aucune
 * commission recalculée ni réenregistrée.
 */
export class PlatformRevenueService {
  constructor(private readonly store: PlatformFinanceStore) {}

  /** `store` : celui d'une transaction en cours (verrou des fonds), sinon le dépôt. */
  async summary(store: PlatformFinanceStore = this.store): Promise<RevenueSummary> {
    return computeRevenue(await store.revenueFacts());
  }
}
