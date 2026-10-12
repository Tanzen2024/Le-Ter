/**
 * Paiement d'un achat de jetons (D-050) : le détail fournisseur d'une transaction `deposit`
 * du compte de jeu (D-040). Le compte de jeu reste la seule source de vérité : un paiement
 * ne crédite jamais lui-même, il est réglé avec sa transaction par `settle` (une seule fois).
 */
export type PaymentProvider = 'cinetpay';
export type PaymentStatus = 'PENDING' | 'SUCCESS' | 'FAILED' | 'EXPIRED';
export type PaymentCurrency = 'XAF';

/** Devise unique des achats (Cameroun, FCFA BEAC). */
export const PAYMENT_CURRENCY: PaymentCurrency = 'XAF';

/** Conversion validée (D-050, R-13 pour l'achat) : 1 FCFA = 1 jeton. */
export const TOKENS_PER_XAF = 1;

/**
 * Montant d'achat SAISI par le joueur (D-085, remplace la liste fixe 500 / 1 000 / 2 000 /
 * 5 000 de D-050) : entier en FCFA, dans les limites du contrat de l'API CinetPay v1 pour un
 * paiement (`amount` entier de 100 à 2 500 000, validation des SDK officiels `cinetpay-js` et
 * `cinetpay-go`). Un plafond plus bas propre au compte marchand ou à l'opérateur n'est pas
 * documenté : CinetPay le refuserait alors à la création (rien n'est crédité).
 */
export const DEPOSIT_LIMITS_XAF = { min: 100, max: 2_500_000 } as const;

/** Montant d'achat acceptable : entier sûr, de `DEPOSIT_LIMITS_XAF.min` à `.max` inclus. */
export function isAllowedDepositAmount(amount: unknown): amount is number {
  return (
    typeof amount === 'number' &&
    Number.isSafeInteger(amount) &&
    amount >= DEPOSIT_LIMITS_XAF.min &&
    amount <= DEPOSIT_LIMITS_XAF.max
  );
}

/** « 2 500 000 » : groupes de milliers (messages d'erreur). */
const groupThousands = (value: number) => String(value).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');

/** Message de refus d'un montant d'achat hors limites ou mal formé. */
export const DEPOSIT_AMOUNT_MESSAGE = `Montant de recharge invalide : nombre entier de FCFA entre ${groupThousands(DEPOSIT_LIMITS_XAF.min)} et ${groupThousands(DEPOSIT_LIMITS_XAF.max)}.`;

/** Jetons crédités pour un montant payé. */
export function tokensForAmount(amountXaf: number): number {
  return amountXaf * TOKENS_PER_XAF;
}

/** Montant à payer pour des jetons (1:1, donc toujours entier). */
export function amountForTokens(tokens: number): number {
  return tokens / TOKENS_PER_XAF;
}

/**
 * Paiement DIRECT (sans redirection) : `POST /v1/payment` avec `direct_pay: true`, l'opérateur
 * (`payment_method`) et le numéro du payeur (`client_phone_number`), même API v1, même
 * authentification, même statut et même notification que le paiement par page hébergée
 * (SDK officiel `cinetpay-js`, `serializePaymentRequest`). Le joueur valide sur son téléphone.
 *
 * Opérateurs XAF connus de l'API (code pays CM). Orange Money exige en mode direct un code OTP
 * saisi par le payeur (`otp_code`) : sa collecte n'est pas autorisée, OM_CM n'est donc jamais
 * proposé en direct (il reste payable par la page CinetPay).
 */
export const DIRECT_PAY_OPERATORS = ['MTN_CM', 'OM_CM'] as const;
export type DirectPayOperator = (typeof DIRECT_PAY_OPERATORS)[number];
/** Opérateurs dont le paiement direct exige un OTP : jamais activables ici. */
export const OTP_REQUIRED_OPERATORS: readonly DirectPayOperator[] = ['OM_CM'];

export const isDirectPayOperator = (value: unknown): value is DirectPayOperator =>
  typeof value === 'string' && (DIRECT_PAY_OPERATORS as readonly string[]).includes(value);

/**
 * Opérateur du numéro d'inscription (D-090), déduit du PLAN DE NUMÉROTATION camerounais (CinetPay
 * n'offre aucune recherche d'opérateur) : `+237` puis 9 chiffres,
 * - MTN Mobile Money : 650 à 654, 67x, 680 à 684 ;
 * - Orange Money : 655 à 659, 69x, 685 à 689.
 * Tout autre numéro (Nexttel 66x, fixes, autres pays) : `null`, aucun moyen de paiement proposé.
 * Limite : un numéro PORTÉ vers un autre opérateur serait mal identifié (CinetPay refuserait
 * alors le paiement ; rien n'est crédité).
 */
export function operatorOfPhone(phone: string): DirectPayOperator | null {
  const match = /^\+237(6\d{2})\d{6}$/.exec(phone);
  if (!match) return null;
  const prefix = Number(match[1]);
  if (
    (prefix >= 650 && prefix <= 654) ||
    (prefix >= 670 && prefix <= 679) ||
    (prefix >= 680 && prefix <= 684)
  ) {
    return 'MTN_CM';
  }
  if (
    (prefix >= 655 && prefix <= 659) ||
    (prefix >= 690 && prefix <= 699) ||
    (prefix >= 685 && prefix <= 689)
  ) {
    return 'OM_CM';
  }
  return null;
}

/**
 * Aucun moyen de paiement pour ce compte : numéro d'inscription hors MTN / Orange Money
 * Cameroun (D-090). Rien n'est créé.
 */
export class PaymentOperatorUnsupportedError extends Error {
  constructor() {
    super('Aucun moyen de paiement pour le numéro du compte');
    this.name = 'PaymentOperatorUnsupportedError';
  }
}

/** Mode d'un paiement vu par le joueur : validation sur le téléphone, ou page CinetPay. */
export type PaymentMode = 'DIRECT' | 'REDIRECT';

export interface Payment {
  id: string;
  walletTransactionId: string;
  /** Propriétaire (celui de la transaction du compte de jeu). */
  userId: string;
  provider: PaymentProvider;
  /** Notre identifiant chez le fournisseur (30 caractères max). */
  merchantTransactionId: string;
  /** Identifiant du fournisseur, connu après l'initialisation acceptée. */
  providerReference?: string;
  amount: number;
  currency: PaymentCurrency;
  status: PaymentStatus;
  providerStatus?: string;
  paymentMethod?: string;
  paymentUrl?: string;
  /** SHA-256 (hex) du `notify_token` : le jeton lui-même n'est jamais stocké. */
  notifyTokenHash?: string;
  /**
   * Paiement direct dont la création a pu partir chez CinetPay sans réponse exploitable
   * (délai, réseau) : jamais crédité ni clos à l'aveugle ; la réconciliation le recherche par
   * `merchantTransactionId`.
   */
  initializationUncertain?: boolean;
  createdAt: Date;
  updatedAt: Date;
  completedAt?: Date;
}

/** Paiement inconnu, ou appartenant à un autre joueur (même réponse : pas de fuite). */
export class PaymentNotFoundError extends Error {
  constructor() {
    super('Paiement introuvable');
    this.name = 'PaymentNotFoundError';
  }
}

/** Notification refusée : jeton ou référence ne correspondent pas au paiement. */
export class PaymentNotificationRejectedError extends Error {
  constructor(readonly reason: string) {
    super(`Notification refusée : ${reason}`);
    this.name = 'PaymentNotificationRejectedError';
  }
}

/**
 * Le statut relu auprès du fournisseur ne correspond pas au paiement enregistré (référence,
 * montant ou devise) : rien n'est crédité.
 */
export class PaymentVerificationError extends Error {
  constructor(readonly reason: string) {
    super(`Vérification du paiement impossible : ${reason}`);
    this.name = 'PaymentVerificationError';
  }
}

/**
 * Le profil ne remplit pas les exigences du fournisseur (CinetPay : prénom et nom de 2 à
 * 255 caractères, alors qu'un compte Le Ter accepte 1 caractère). Détecté AVANT toute
 * écriture : aucune transaction ni aucun paiement n'est créé. Rien n'est inventé ni complété.
 */
/**
 * Numéro du payeur transmis à CinetPay (D-088) : le numéro d'INSCRIPTION du compte, au format
 * international avec l'indicatif du pays (`+237692130271`), comme l'exige l'API (`+` puis 8 à
 * 15 chiffres, validation des SDK officiels). Jamais saisi ni envoyé par l'application.
 */
export const isPayerPhoneNumber = (phone: string): boolean => /^\+\d{8,15}$/.test(phone);

export class PaymentProfileIncompleteError extends Error {
  constructor(readonly fields: readonly ('firstName' | 'lastName' | 'phone')[]) {
    super(`Profil incompatible avec le paiement : ${fields.join(', ')}`);
    this.name = 'PaymentProfileIncompleteError';
  }
}

/**
 * Paiement direct impossible : opérateur non activé (compte CinetPay), numéro d'inscription
 * hors Cameroun, ou refus explicite de CinetPay à l'initialisation. Rien n'est crédité ; le
 * joueur peut payer par la page CinetPay.
 */
export class DirectPaymentUnavailableError extends Error {
  constructor(readonly reason: 'METHOD_NOT_ENABLED' | 'PHONE_UNSUPPORTED' | 'PROVIDER_REFUSED') {
    super(`Paiement direct indisponible : ${reason}`);
    this.name = 'DirectPaymentUnavailableError';
  }
}

/**
 * Création d'un paiement direct envoyée sans réponse exploitable : la demande a peut-être
 * atteint le téléphone. Le paiement reste EN ATTENTE (aucun crédit, aucun échec déclaré) et
 * la réconciliation le retrouve chez CinetPay.
 */
export class PaymentInitializationUncertainError extends Error {
  constructor(readonly paymentId: string) {
    super('Issue de l’initialisation du paiement inconnue');
    this.name = 'PaymentInitializationUncertainError';
  }
}
