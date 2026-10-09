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
  /** Faux si le fournisseur ne gère pas les retraits (CinetPay : achat seulement, D-050). */
  withdrawalAvailable: boolean;
}

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

export interface PaymentView {
  id: string;
  status: PaymentStatus;
  /** Montant en FCFA (XAF). 1 FCFA = 1 jeton. */
  amount: number;
  currency: 'XAF';
  /** Page de paiement CinetPay, tant que le paiement est en attente. */
  paymentUrl?: string;
  tokens?: number;
  createdAt?: string;
  completedAt?: string;
}
