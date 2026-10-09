/**
 * Port du fournisseur Mobile Money (D-040). Le compte Mobile Money du joueur est celui de son
 * numéro d'inscription (`users.phone`, E.164) : il est transmis au fournisseur au moment de
 * l'appel, jamais stocké avec la transaction ni journalisé.
 *
 * Les deux opérations sont ASYNCHRONES chez les fournisseurs (validation sur le téléphone,
 * traitement différé) : la demande renvoie seulement une référence ; l'issue arrive ensuite
 * (rappel du fournisseur) et passe par `WalletService.settle`.
 *
 * Montants en jetons : la conversion jetons ↔ FCFA (1 FCFA = 1 jeton pour l'achat, D-050)
 * relève de l'implémentation du fournisseur (`CinetPayGateway`).
 */
export interface MobileMoneyRequest {
  /** Identifiant de NOTRE transaction (référence externe, idempotence chez le fournisseur). */
  transactionId: string;
  /** Numéro Mobile Money du joueur (numéro d'inscription). */
  msisdn: string;
  tokens: number;
  /**
   * Identité du payeur, exigée par les pages de paiement hébergées (CinetPay : nom, prénom,
   * e-mail). Issue du compte authentifié, jamais du client.
   */
  customer?: { firstName: string; lastName: string; email: string };
}

/** Réponse d'une demande acceptée par le fournisseur (toujours EN ATTENTE). */
export interface MobileMoneyRequestResult {
  providerReference: string;
  /** Paiement enregistré (`payments`, D-050) quand le fournisseur en crée un. */
  paymentId?: string;
  /** Page de paiement hébergée à ouvrir par le joueur (CinetPay). */
  paymentUrl?: string;
}

/** Identité du payeur transmise au fournisseur. */
export type MobileMoneyCustomer = NonNullable<MobileMoneyRequest['customer']>;

export interface MobileMoneyGateway {
  /** Faux tant qu'aucun fournisseur n'est configuré : l'interface peut l'annoncer. */
  readonly available: boolean;
  /**
   * Exigences propres au fournisseur sur le payeur, vérifiées AVANT toute écriture (lève une
   * erreur métier, ex. `PaymentProfileIncompleteError`). Absente : aucune exigence.
   */
  assertCollectionEligible?(customer: MobileMoneyCustomer): void;
  /** Faux si le fournisseur ne gère pas les retraits (CinetPay, D-050 : achat seulement). */
  readonly disbursementAvailable?: boolean;
  /** Achat : demande de paiement au joueur (collecte). */
  requestCollection(request: MobileMoneyRequest): Promise<MobileMoneyRequestResult>;
  /** Retrait : transfert vers le compte Mobile Money du joueur (décaissement). */
  requestDisbursement(request: MobileMoneyRequest): Promise<MobileMoneyRequestResult>;
}

/**
 * Aucun fournisseur choisi ni configuré (MTN MoMo, Orange Money, agrégateur… : à décider,
 * avec R-13, R-16, R-34 et T-07). Toute demande est refusée : jamais de fausse réussite.
 */
export class UnconfiguredMobileMoneyGateway implements MobileMoneyGateway {
  readonly available = false;

  requestCollection(): Promise<{ providerReference: string }> {
    return Promise.reject(new MobileMoneyNotConfiguredError());
  }

  requestDisbursement(): Promise<{ providerReference: string }> {
    return Promise.reject(new MobileMoneyNotConfiguredError());
  }
}

export class MobileMoneyNotConfiguredError extends Error {
  constructor() {
    super('Aucun fournisseur Mobile Money configuré');
    this.name = 'MobileMoneyNotConfiguredError';
  }
}
