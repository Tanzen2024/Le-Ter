import type { WithdrawalOperator } from '../../domain/wallet/withdrawal';

/**
 * Port du fournisseur de TRANSFERT sortant (D-075), distinct de la collecte
 * (`MobileMoneyGateway.requestCollection`). Chaque réponse est classée sans ambiguïté :
 *
 * - `accepted` : transfert créé chez le fournisseur (référence connue), statut NON final
 *   pour Le Ter tant qu'il n'a pas été relu ;
 * - `not_sent` : échec AVANT tout envoi de la demande de transfert (authentification refusée
 *   ou injoignable) : fait local certain, aucune requête de transfert n'est partie ;
 * - `rejected` : refus annoncé par le fournisseur (paramètres, solde marchand…). Ce n'est
 *   JAMAIS une preuve suffisante qu'aucun transfert n'a été exécuté : rien n'est remboursé,
 *   le transfert est relu ;
 * - `already_exists` : la référence marchande existe déjà : le transfert doit être RELU ;
 * - `uncertain` : délai dépassé, réseau, réponse illisible : l'issue est inconnue, rien n'est
 *   décidé, le transfert sera relu (jamais renvoyé à l'aveugle).
 */
export interface TransferRequest {
  merchantTransactionId: string;
  /** Numéro d'inscription du joueur (E.164). Jamais journalisé. */
  phoneNumber: string;
  amount: number;
  currency: 'XAF';
  operator: WithdrawalOperator;
}

export type TransferSubmission =
  | {
      kind: 'accepted';
      providerReference: string;
      providerStatus: string;
      notifyToken?: string;
      feeAmount?: number;
    }
  | { kind: 'not_sent'; errorCode: string }
  | { kind: 'rejected'; providerStatus: string }
  | { kind: 'already_exists' }
  | { kind: 'uncertain'; errorCode: string };

/** Statut relu chez le fournisseur par NOTRE référence marchande. */
export type TransferLookup =
  | {
      found: true;
      providerReference: string;
      merchantTransactionId: string;
      providerStatus: string;
      amount?: number;
      currency?: string;
      feeAmount?: number;
    }
  | { found: false };

export interface TransferGateway {
  /**
   * Nouveaux transferts autorisés (`CINETPAY_TRANSFERS_ENABLED=true`). Faux : aucune demande
   * de retrait acceptée et AUCUN transfert envoyé, même pour un retrait déjà créé.
   */
  readonly canSubmit: boolean;
  /**
   * Relecture des transferts existants (identifiants CinetPay configurés), indépendante de
   * l'activation : réconciliation, notifications et revérifications continuent quand les
   * nouveaux transferts sont désactivés.
   */
  readonly canLookup: boolean;
  submit(request: TransferRequest): Promise<TransferSubmission>;
  /** Lève une erreur si le fournisseur ne répond pas de façon exploitable (rien n'est décidé). */
  lookup(merchantTransactionId: string): Promise<TransferLookup>;
}

/** Transferts non configurés : aucun retrait n'est accepté (jamais de fausse réussite). */
export class UnconfiguredTransferGateway implements TransferGateway {
  readonly canSubmit = false;
  readonly canLookup = false;

  submit(): Promise<TransferSubmission> {
    return Promise.reject(new Error('Transferts Mobile Money non configurés'));
  }

  lookup(): Promise<TransferLookup> {
    return Promise.reject(new Error('Transferts Mobile Money non configurés'));
  }
}
