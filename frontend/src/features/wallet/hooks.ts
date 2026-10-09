import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { randomUUID } from 'expo-crypto';
import * as Linking from 'expo-linking';
import * as WebBrowser from 'expo-web-browser';
import { useEffect } from 'react';

import { walletApi } from '../../services/wallet-api';
import { useAuthStore } from '../../stores/auth-store';
import type { WalletOperation } from '../../types/wallet';
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
 * Achat ou retrait. Une Idempotency-Key par intention : un double appui ou un renvoi
 * réutilisent la même et le serveur n'exécute l'opération qu'une fois. Le solde affiché
 * n'est mis à jour qu'à partir de la réponse du serveur.
 */
export function useWalletOperation(kind: WalletOperation) {
  const queryClient = useQueryClient();
  const mutation = useMutation({
    mutationFn: ({ tokens, key }: { tokens: number; key: string }) =>
      withAccessToken((t) =>
        kind === 'deposit' ? walletApi.deposit(t, tokens, key) : walletApi.withdraw(t, tokens, key),
      ),
    onSettled: () => queryClient.invalidateQueries({ queryKey: walletKey }),
  });
  /** `newKey` : une clé par intention (appui sur le bouton), réutilisée par tout renvoi. */
  return { ...mutation, newKey: () => randomUUID() };
}

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
