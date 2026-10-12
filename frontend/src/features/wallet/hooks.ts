import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { randomUUID } from 'expo-crypto';
import * as Linking from 'expo-linking';
import * as WebBrowser from 'expo-web-browser';
import { useEffect } from 'react';

import { walletApi } from '../../services/wallet-api';
import { useAuthStore } from '../../stores/auth-store';
import type { DepositChoice, WithdrawalOperator } from '../../types/wallet';
import { withAccessToken } from '../auth/session';

export const walletKey = ['wallet'] as const;

/** Une opération en attente peut être confirmée à tout moment par le fournisseur. */
const WALLET_REFRESH_MS = 30_000;

/** Solde RÉEL du compte de jeu : seul le serveur le modifie, jamais l'écran. */
export function useWallet() {
  const status = useAuthStore((s) => s.status);
  return useQuery({
    queryKey: walletKey,
    queryFn: async () => (await withAccessToken((t) => walletApi.get(t))).wallet,
    enabled: status === 'signedIn',
    refetchInterval: WALLET_REFRESH_MS,
  });
}

/** Plafond technique, identique au serveur (R-16 : aucun minimum métier défini). */
export const MAX_TOKENS_PER_OPERATION = 1_000_000_000;

/**
 * Nombre de jetons saisi : un entier strictement positif, chiffres seulement. Refusés :
 * vide, 0, négatif, décimal, caractères non numériques.
 */
export function parseTokens(input: string): number | undefined {
  if (!/^\d+$/.test(input)) return undefined;
  const value = Number(input);
  return Number.isSafeInteger(value) && value > 0 && value <= MAX_TOKENS_PER_OPERATION
    ? value
    : undefined;
}

/**
 * Achat. Une Idempotency-Key par intention : un double appui ou un renvoi réutilisent la
 * même et le serveur n'exécute l'opération qu'une fois. Le solde affiché n'est mis à jour
 * qu'à partir de la réponse du serveur.
 */
export function useWalletOperation(kind: 'deposit') {
  const queryClient = useQueryClient();
  const mutation = useMutation({
    mutationFn: ({
      tokens,
      key,
      choice,
    }: {
      tokens: number;
      key: string;
      /** Direct (`method`) ou page CinetPay (`operator`) ; absent : page générique. */
      choice?: DepositChoice;
    }) =>
      withAccessToken((t) =>
        choice ? walletApi.deposit(t, tokens, key, choice) : walletApi.deposit(t, tokens, key),
      ),
    onSettled: () => queryClient.invalidateQueries({ queryKey: walletKey }),
  });
  /** `newKey` : une clé par intention (appui sur le bouton), réutilisée par tout renvoi. */
  return { ...mutation, newKey: () => randomUUID() };
}

export const withdrawalsKey = ['withdrawals'] as const;
export const withdrawalKey = (id: string) => ['withdrawal', id] as const;

/** Un retrait ouvert est relu régulièrement ; le serveur revérifie auprès du fournisseur. */
const WITHDRAWAL_POLL_MS = 5_000;

/** Historique des retraits du joueur et règles applicables (minimum, quota, opérateurs). */
export function useWithdrawals() {
  const status = useAuthStore((s) => s.status);
  return useQuery({
    queryKey: withdrawalsKey,
    queryFn: () => withAccessToken((t) => walletApi.withdrawals(t)),
    enabled: status === 'signedIn',
  });
}

/** Statut RÉEL d'un retrait, relu tant qu'il est ouvert ; solde rechargé quand il se règle. */
export function useWithdrawal(withdrawalId: string | undefined) {
  const queryClient = useQueryClient();
  const status = useAuthStore((s) => s.status);
  const query = useQuery({
    queryKey: withdrawalKey(withdrawalId ?? ''),
    queryFn: async () =>
      (await withAccessToken((t) => walletApi.withdrawal(t, withdrawalId!))).withdrawal,
    enabled: Boolean(withdrawalId) && status === 'signedIn',
    refetchInterval: (q) => {
      const s = q.state.data?.status;
      return s === 'CREATED' || s === 'PROCESSING' ? WITHDRAWAL_POLL_MS : false;
    },
  });
  const final = query.data?.status === 'SUCCEEDED' || query.data?.status === 'FAILED';
  useEffect(() => {
    if (final) {
      void queryClient.invalidateQueries({ queryKey: walletKey });
      void queryClient.invalidateQueries({ queryKey: withdrawalsKey });
    }
  }, [final, queryClient]);
  return query;
}

/**
 * Demande de retrait. La clé d'idempotence est fournie par l'appelant : créée UNE fois par
 * confirmation, elle est réutilisée par tout nouvel essai (coupure réseau), si bien que le
 * serveur n'exécute jamais deux fois le même retrait.
 */
export function useRequestWithdrawal() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationKey: ['wallet', 'withdrawal'],
    mutationFn: ({
      tokens,
      operator,
      key,
    }: {
      tokens: number;
      operator: WithdrawalOperator;
      key: string;
    }) => withAccessToken((t) => walletApi.withdraw(t, { tokens, operator }, key)),
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: walletKey });
      void queryClient.invalidateQueries({ queryKey: withdrawalsKey });
    },
  });
}

export const newIdempotencyKey = () => randomUUID();

export const paymentKey = (paymentId: string) => ['payment', paymentId] as const;

/** Un paiement en attente est relu régulièrement ; le serveur revérifie auprès de CinetPay. */
const PAYMENT_POLL_MS = 3_000;

/**
 * Statut RÉEL d'un paiement CinetPay (D-050), lu sur le serveur, relu tant qu'il est en
 * attente. Dès qu'il est final, le solde du compte de jeu est rechargé depuis le serveur.
 */
export function usePayment(paymentId: string | undefined) {
  const queryClient = useQueryClient();
  const status = useAuthStore((s) => s.status);
  const query = useQuery({
    queryKey: paymentKey(paymentId ?? ''),
    queryFn: async () => (await withAccessToken((t) => walletApi.payment(t, paymentId!))).payment,
    enabled: Boolean(paymentId) && status === 'signedIn',
    refetchInterval: (q) => (q.state.data?.status === 'PENDING' ? PAYMENT_POLL_MS : false),
  });
  const final = query.data !== undefined && query.data.status !== 'PENDING';
  useEffect(() => {
    if (final) void queryClient.invalidateQueries({ queryKey: walletKey });
  }, [final, queryClient]);
  return query;
}

/** Lien de retour attendu par le serveur (D-050) : `leter://payment/return` en production. */
export const paymentReturnUrl = () => Linking.createURL('payment/return');

/**
 * Ouvre la page de paiement CinetPay dans un navigateur intégré. Le navigateur se ferme au
 * retour vers l'application (ou par le joueur) : l'issue n'est JAMAIS déduite de cette
 * fermeture, l'écran relit le paiement sur le serveur.
 */
export async function openPaymentPage(paymentUrl: string): Promise<void> {
  await WebBrowser.openAuthSessionAsync(paymentUrl, paymentReturnUrl());
}
