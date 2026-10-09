import { apiRequest } from '../lib/api-client';
import type { PaymentView, WalletTransactionView, WalletView } from '../types/wallet';

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
  deposit: (accessToken: string, tokens: number, idempotencyKey: string) =>
    apiRequest<OperationResult>('/api/wallet/deposits', {
      method: 'POST',
      body: { tokens, currency: 'XAF' },
      accessToken,
      headers: { 'Idempotency-Key': idempotencyKey },
    }),

  withdraw: (accessToken: string, tokens: number, idempotencyKey: string) =>
    apiRequest<OperationResult>('/api/wallet/withdrawals', {
      method: 'POST',
      body: { tokens },
      accessToken,
      headers: { 'Idempotency-Key': idempotencyKey },
    }),

  /** Statut RÉEL d'un paiement (seulement les siens), relu sur le serveur. */
  payment: (accessToken: string, paymentId: string) =>
    apiRequest<{ payment: PaymentView }>(`/api/payments/${encodeURIComponent(paymentId)}`, {
      accessToken,
    }),
};
