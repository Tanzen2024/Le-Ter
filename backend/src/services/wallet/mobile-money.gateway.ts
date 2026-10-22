import type { DirectPayOperator } from '../../domain/payments/payment';

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
  customer?: {
    firstName: string;
    lastName: string;
    /** Facultatif (D-135) : un joueur sans email est transmis sans email, jamais avec une adresse inventée. */
    email: string | null;
    /** Numéro d'inscription, format international (`+237…`), transmis à CinetPay (D-088). */
    phone?: string;
  };
  /**
   * Paiement DIRECT (sans redirection) avec cet opérateur, sur le numéro `msisdn` : le joueur
   * valide sur son téléphone. Absent : page de paiement hébergée.
   */
  directOperator?: DirectPayOperator;
  /**
   * Page hébergée : opérateur souhaité par le joueur. Présélectionné seulement s'il figure dans
   * `pagePreselectOperators` ; sinon la page propose toutes les méthodes (aucune garantie).
   */
  pageOperator?: DirectPayOperator;
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
  /** Opérateurs proposés en paiement direct (vide ou absent : page hébergée seulement). */
  readonly directPayOperators?: readonly DirectPayOperator[];
  /** Opérateurs présélectionnables sur la page hébergée (vide : page générique). */
  readonly pagePreselectOperators?: readonly DirectPayOperator[];
  /**
   * Paiement direct possible avec cet opérateur et ce numéro ? Vérifié AVANT toute écriture ;
   * lève `DirectPaymentUnavailableError` sinon.
   */
  assertDirectPayEligible?(operator: DirectPayOperator, msisdn: string): void;
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

/**
 * Erreur du FOURNISSEUR Mobile Money (injoignable, refus, non configuré) : la seule famille
 * d'erreurs qui permet d'affirmer « service indisponible » (D-091). Toute autre erreur pendant
 * une recharge (base de données, panne interne) laisse l'issue INCONNUE.
 */
export class MobileMoneyProviderError extends Error {}

/**
 * Issue d'une recharge inconnue (D-091) : une erreur interne (base indisponible…) est survenue
 * pendant sa création. Rien n'est déclaré échoué ni crédité ; le statut sera vérifié auprès du
 * fournisseur (réconciliation). Le joueur ne doit pas relancer immédiatement.
 */
export class DepositOutcomeUnknownError extends Error {
  constructor(readonly transactionId: string) {
    super('Issue de la recharge inconnue : vérification en cours');
    this.name = 'DepositOutcomeUnknownError';
  }
}

export class MobileMoneyNotConfiguredError extends MobileMoneyProviderError {
  constructor() {
    super('Aucun fournisseur Mobile Money configuré');
    this.name = 'MobileMoneyNotConfiguredError';
  }
}
