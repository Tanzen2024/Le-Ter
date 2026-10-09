import { keepPreviousData, queryOptions } from '@tanstack/react-query';

import { periodRange } from '@/features/shared/period';
import { api, idempotencyKey, type Query } from '@/lib/api/client';
import type {
  FinanceOverview,
  LedgerEntry,
  Paged,
  PaymentDetail,
  PaymentRow,
  PlatformAccount,
  Reconciliation,
  VerificationResult,
  WalletTransaction,
} from '@/types/admin';

export function financeOverviewQuery(days: number) {
  const range = periodRange(days);
  return queryOptions({
    queryKey: ['admin', 'finance', range.from, range.to],
    queryFn: () => api.get<FinanceOverview>('finance/overview', range),
  });
}

export function transactionsQuery(query: Query) {
  return queryOptions({
    queryKey: ['admin', 'wallet-transactions', query],
    queryFn: () =>
      api.get<Paged<WalletTransaction>>('wallet-transactions', { limit: 25, ...query }),
    placeholderData: keepPreviousData,
  });
}

export function paymentsQuery(query: Query) {
  return queryOptions({
    queryKey: ['admin', 'payments', query],
    queryFn: () => api.get<Paged<PaymentRow>>('payments', { limit: 25, ...query }),
    placeholderData: keepPreviousData,
  });
}

/** Détail d'un paiement : chaque consultation est inscrite au journal d'audit par le serveur. */
export function paymentQuery(id: string) {
  return queryOptions({
    queryKey: ['admin', 'payment', id],
    queryFn: () => api.get<{ payment: PaymentDetail }>(`payments/${id}`),
    staleTime: Infinity,
  });
}

/**
 * Revérification auprès de CinetPay, exécutée par le SERVEUR (statut relu de serveur à
 * serveur, règlement idempotent). Une clé d'idempotence par clic : un double envoi
 * renvoie le même résultat sans nouvel appel.
 */
export function verifyPayment(id: string) {
  return api.post<VerificationResult>(
    `payments/${id}/verify`,
    {},
    {
      'idempotency-key': idempotencyKey('verify'),
    },
  );
}

export function reconciliationQuery() {
  return queryOptions({
    queryKey: ['admin', 'reconciliation'],
    queryFn: () => api.get<Reconciliation>('reconciliation/anomalies'),
  });
}

export function platformAccountQuery() {
  return queryOptions({
    queryKey: ['admin', 'platform-account'],
    queryFn: () => api.get<PlatformAccount>('platform-account'),
  });
}

export function ledgerQuery(query: Query) {
  return queryOptions({
    queryKey: ['admin', 'ledger', query],
    queryFn: () => api.get<Paged<LedgerEntry>>('platform-account/entries', { limit: 25, ...query }),
    placeholderData: keepPreviousData,
  });
}
