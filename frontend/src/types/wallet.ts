/**
 * Compte de jeu (D-040) tel que l'API l'envoie : jetons utilisables dans Le Ter. Le compte
 * Mobile Money personnel (numéro d'inscription) est un autre compte : seul son numéro
 * masqué est connu de l'application.
 */
export interface WalletView {
  balance: number;
  /** Bloqué par des inscriptions à des tournois non démarrés (D-054). */
  reserved?: number;
  /** Utilisable : solde − réservé. */
  available?: number;
  /** Numéro d'inscription masqué (« +23*******271 »). */
  mobileMoneyNumber: string;
  phoneVerified: boolean;
  /** Faux tant qu'aucun fournisseur Mobile Money n'est configuré côté serveur. */
  mobileMoneyAvailable: boolean;
  /** Montant d'achat saisi : entier en FCFA dans ces limites (D-085), revalidé par le serveur. */
  depositLimits?: DepositLimits;
  /**
   * Opérateurs proposés en paiement DIRECT sur le numéro d'inscription (validation sur le
   * téléphone, sans page de paiement, D-083). Absent ou vide : page CinetPay seulement.
   */
  directPayOperators?: DirectPayOperator[];
  /**
   * Opérateurs présélectionnés sur la page CinetPay (D-087). Absent de la liste : la page
   * propose toutes les méthodes du pays activées sur le compte (opérateur non garanti).
   */
  pageOperators?: DirectPayOperator[];
  /**
   * Moyen de paiement du compte, déduit par le serveur du numéro d'inscription (D-090) ;
   * `null` : numéro non pris en charge (aucun paiement proposé).
   */
  paymentOperator?: DirectPayOperator | null;
  /** Nouveaux retraits acceptés par le serveur, en mode test ou en production (D-077). */
  withdrawalAvailable: boolean;
  /** Absent sur un serveur antérieur à D-077 : seul `withdrawalAvailable` fait foi. */
  withdrawalMode?: WithdrawalMode;
  /** Motif stable quand `withdrawalMode` vaut `unavailable`. */
  withdrawalUnavailableReason?: WithdrawalUnavailableReason;
}

/**
 * État des retraits décidé par le serveur (D-077) :
 * - `unavailable` : un prérequis manque, aucune demande n'est acceptée ;
 * - `sandbox` : environnement de TEST, transferts simulés, aucun argent réel ;
 * - `live` : production, transferts réels.
 */
export type WithdrawalMode = 'unavailable' | 'sandbox' | 'live';

/** Motifs connus ; tout autre code est affiché comme une indisponibilité générique. */
export type WithdrawalUnavailableReason =
  | 'PROVIDER_NOT_CONFIGURED'
  | 'TRANSFERS_DISABLED'
  | 'LIVE_NOT_CONFIRMED'
  | 'LIVE_OUTSIDE_PRODUCTION'
  | 'SANDBOX_IN_PRODUCTION'
  | 'ENVIRONMENT_MISMATCH'
  | 'NOTIFY_URL_NOT_PUBLIC'
  | 'SCHEMA_OUTDATED'
  | (string & {});

export type WalletOperation = 'deposit' | 'withdrawal';

export interface WalletTransactionView {
  id: string;
  kind: WalletOperation;
  /** `pending` : en attente de la confirmation du fournisseur Mobile Money. */
  status: 'pending' | 'succeeded' | 'failed';
  tokens: number;
  createdAt: string;
  completedAt?: string;
  failureCode?: string;
}

/**
 * Paiement CinetPay d'un achat (D-050), tel que le serveur le décrit. Seul le serveur décide
 * de son statut : l'écran ne fait que l'afficher.
 */
export type PaymentStatus = 'PENDING' | 'SUCCESS' | 'FAILED' | 'EXPIRED';

/** Limites du montant d'achat saisi, annoncées par le serveur (D-085). */
export interface DepositLimits {
  min: number;
  max: number;
  currency: 'XAF';
}

/** Opérateurs Mobile Money CinetPay au Cameroun. */
export type DirectPayOperator = 'MTN_CM' | 'OM_CM';

/**
 * Choix de paiement d'une recharge : `method` = paiement DIRECT (validation sur le téléphone),
 * `operator` = page CinetPay hébergée avec cet opérateur souhaité (D-087). Jamais les deux.
 */
export type DepositChoice = { method: DirectPayOperator } | { operator: DirectPayOperator };

export interface PaymentView {
  id: string;
  status: PaymentStatus;
  /** Montant en FCFA (XAF). 1 FCFA = 1 jeton. */
  amount: number;
  currency: 'XAF';
  /**
   * `DIRECT` : validation sur le téléphone, aucune page à ouvrir. `REDIRECT` (ou absent,
   * serveur antérieur) : page CinetPay.
   */
  mode?: 'DIRECT' | 'REDIRECT';
  /** Opérateur d'un paiement direct. */
  operator?: DirectPayOperator;
  /** Page de paiement CinetPay, tant que le paiement est en attente. */
  paymentUrl?: string;
  tokens?: number;
  createdAt?: string;
  completedAt?: string;
}

/**
 * Retrait Mobile Money (D-075). Le serveur décide de tout (montant minimum, quota, solde,
 * destinataire = numéro d'inscription) ; l'écran n'affiche que ce qu'il renvoie.
 *
 * - CREATED : jetons débités, transfert en cours d'envoi au fournisseur ;
 * - PROCESSING : transfert accepté par le fournisseur, en attente de confirmation ;
 * - SUCCEEDED : transfert confirmé par le fournisseur ;
 * - FAILED : échec confirmé, jetons recrédités.
 */
export type WithdrawalStatus = 'CREATED' | 'PROCESSING' | 'SUCCEEDED' | 'FAILED';
export type WithdrawalOperator = 'OM_CM' | 'MTN_CM';

export interface WithdrawalView {
  id: string;
  /** Référence du retrait, à communiquer à l'assistance. */
  reference: string;
  status: WithdrawalStatus;
  tokens: number;
  /** Montant envoyé, en FCFA (1 jeton = 1 FCFA). */
  amount: number;
  currency: 'XAF';
  operator: WithdrawalOperator;
  operatorLabel: string;
  /** Numéro destinataire masqué. */
  msisdn: string;
  /** Issue en cours de vérification avec l'opérateur (jetons toujours réservés, D-076). */
  underReview?: boolean;
  failureCode?: string;
  createdAt: string;
  completedAt?: string;
}

export interface WithdrawalPolicy {
  available: boolean;
  mode?: WithdrawalMode;
  unavailableReason?: WithdrawalUnavailableReason;
  minTokens: number;
  maxTokens: number;
  currency: 'XAF';
  tokensPerUnit: number;
  /** Frais Le Ter : 0 (aucun frais configuré). */
  platformFeeTokens: number;
  operators: { code: WithdrawalOperator; label: string }[];
  msisdn: string;
  msisdnSupported: boolean;
  limit: {
    /** `null` = illimité. */
    count: number | null;
    periodMinutes: number | null;
    used: number;
    remaining: number | null;
    nextAvailableAt: string | null;
  };
}

export interface WithdrawalResult {
  withdrawal: WithdrawalView;
  balance: { balance: number; reserved: number; available: number };
  replayed: boolean;
}
