import type { CinetPayClient } from '../payments/cinetpay/cinetpay-client';

/**
 * Lecture du solde disponible chez le prestataire (D-078). Port EN LECTURE SEULE : aucune
 * méthode ne peut initier un mouvement de fonds.
 */
export interface TreasuryGateway {
  /** Identifiants configurés : la relecture est possible. */
  readonly configured: boolean;
  readonly environment: 'test' | 'live';
  /** Solde brut tel que renvoyé ; lève si le prestataire ne répond pas de façon exploitable. */
  readBalance(): Promise<{ availableBalance: string; currency?: string }>;
}

export class CinetPayTreasuryGateway implements TreasuryGateway {
  readonly configured = true;

  constructor(
    private readonly client: Pick<CinetPayClient, 'getBalance'>,
    readonly environment: 'test' | 'live',
  ) {}

  async readBalance() {
    const balance = await this.client.getBalance();
    return {
      availableBalance: balance.availableBalance,
      ...(balance.currency !== undefined && { currency: balance.currency }),
    };
  }
}

/** CinetPay non configuré : trésorerie inconnue, jamais un solde inventé. */
export class UnconfiguredTreasuryGateway implements TreasuryGateway {
  readonly configured = false;
  readonly environment = 'test' as const;

  readBalance(): Promise<never> {
    return Promise.reject(new Error('Trésorerie CinetPay non configurée'));
  }
}

/**
 * Montant renvoyé par CinetPay (chaîne, SDK) → entier XAF. Le franc CFA n'a pas de
 * subdivision : seule une valeur entière (éventuellement suivie de « .0… ») est acceptée ;
 * toute autre forme est INVALIDE (jamais arrondie ni tronquée).
 */
export function parseXafAmount(raw: string): number | null {
  const match = /^\s*(\d{1,16})(?:\.0+)?\s*$/.exec(raw);
  if (!match) return null;
  const value = Number(match[1]);
  return Number.isSafeInteger(value) ? value : null;
}
