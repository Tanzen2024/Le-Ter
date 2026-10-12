import { apiRequest } from '../lib/api-client';
import type {
  DepositChoice,
  PaymentView,
  WalletTransactionView,
  WalletView,
  WithdrawalOperator,
  WithdrawalPolicy,
  WithdrawalResult,
  WithdrawalView,
} from '../types/wallet';

export type OperationResult = {
  transaction: WalletTransactionView;
  balance: number;
  /** Achat CinetPay (D-050) : paiement en attente et page de paiement à ouvrir. */
  payment?: PaymentView;
};

/**
 * Appels HTTP du compte de jeu (D-040). Aucun identifiant ni numéro n'est envoyé : le
 * serveur identifie le joueur par son access token et utilise son numéro d'inscription.
 * Chaque opération porte une Idempotency-Key (une intention = une opération).
 */
export const walletApi = {
  get: (accessToken: string) => apiRequest<{ wallet: WalletView }>('/api/wallet', { accessToken }),

  /** Achat en FCFA : 1 FCFA = 1 jeton, devise fixée à XAF. */
  /**
   * Achat : nombre de jetons (= FCFA saisis), et le choix de paiement : `method` (direct) ou
   * `operator` (page CinetPay). Opérateur seulement : le numéro est celui du compte, le montant
   * est revalidé par le serveur.
   */
  deposit: (accessToken: string, tokens: number, idempotencyKey: string, choice?: DepositChoice) =>
    apiRequest<OperationResult>('/api/wallet/deposits', {
      method: 'POST',
      body: { tokens, currency: 'XAF', ...choice },
      accessToken,
      headers: { 'Idempotency-Key': idempotencyKey },
    }),

  /**
   * Retrait (D-075) : seulement le nombre de jetons et l'opérateur. Le destinataire est le
   * numéro d'inscription, choisi par le serveur ; aucun numéro n'est envoyé.
   */
  withdraw: (
    accessToken: string,
    input: { tokens: number; operator: WithdrawalOperator },
    idempotencyKey: string,
  ) =>
    apiRequest<WithdrawalResult>('/api/wallet/withdrawals', {
      method: 'POST',
      body: input,
      accessToken,
      headers: { 'Idempotency-Key': idempotencyKey },
    }),

  /** Historique des retraits et règles applicables (minimum, quota, opérateurs). */
  withdrawals: (accessToken: string) =>
    apiRequest<{ withdrawals: WithdrawalView[]; policy: WithdrawalPolicy }>(
      '/api/wallet/withdrawals',
      { accessToken },
    ),

  /** Statut RÉEL d'un retrait (seulement les siens), relu sur le serveur. */
  withdrawal: (accessToken: string, withdrawalId: string) =>
    apiRequest<{ withdrawal: WithdrawalView }>(
      `/api/wallet/withdrawals/${encodeURIComponent(withdrawalId)}`,
      { accessToken },
    ),

  /** Statut RÉEL d'un paiement (seulement les siens), relu sur le serveur. */
  payment: (accessToken: string, paymentId: string) =>
    apiRequest<{ payment: PaymentView }>(`/api/payments/${encodeURIComponent(paymentId)}`, {
      accessToken,
    }),
};
