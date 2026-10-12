import { keepPreviousData, queryOptions } from '@tanstack/react-query';

import { api, idempotencyKey, type Query } from '@/lib/api/client';
import type {
  Paged,
  PayoutBeneficiary,
  PlatformFinanceOverview,
  PlatformPayoutDetail,
  PlatformPayoutRow,
  PlatformPayoutStatus,
  TreasuryObservation,
} from '@/types/admin';

/**
 * Retraits des revenus de la plateforme (D-078). Tous les montants, statuts et droits
 * viennent du serveur ; l'interface n'envoie jamais de statut, de frais ni d'approbateur.
 */
const base = 'platform-finance';

export function overviewQuery() {
  return queryOptions({
    queryKey: ['admin', 'platform-finance', 'overview'],
    queryFn: () => api.get<PlatformFinanceOverview>(base),
  });
}

export function treasuryHistoryQuery() {
  return queryOptions({
    queryKey: ['admin', 'platform-finance', 'treasury'],
    queryFn: () => api.get<{ observations: TreasuryObservation[] }>(`${base}/treasury`),
  });
}

export function beneficiariesQuery() {
  return queryOptions({
    queryKey: ['admin', 'platform-finance', 'beneficiaries'],
    queryFn: () => api.get<{ beneficiaries: PayoutBeneficiary[] }>(`${base}/beneficiaries`),
  });
}

export function payoutsQuery(query: Query) {
  return queryOptions({
    queryKey: ['admin', 'platform-finance', 'payouts', query],
    queryFn: () => api.get<Paged<PlatformPayoutRow>>(`${base}/payouts`, { limit: 25, ...query }),
    placeholderData: keepPreviousData,
  });
}

/** Détail : chaque consultation est inscrite au journal d'audit par le serveur. */
export function payoutQuery(id: string) {
  return queryOptions({
    queryKey: ['admin', 'platform-finance', 'payout', id],
    queryFn: () => api.get<{ payout: PlatformPayoutDetail }>(`${base}/payouts/${id}`),
    staleTime: Infinity,
  });
}

export const observeTreasury = () =>
  api.post<{ observation: TreasuryObservation }>(`${base}/treasury/observe`, {});

/** Rapprochement : relectures seulement, jamais d'envoi de transfert. */
export const reconcile = () =>
  api.post<{ checked: number; recoveredSubmissions: number; treasury: { status: string } | null }>(
    `${base}/reconcile`,
    {},
  );

export const createBeneficiary = (body: { label: string; msisdn: string }) =>
  api.post<{ id: string; status: string; msisdn: string }>(`${base}/beneficiaries`, body);

export const verifyBeneficiary = (id: string, note: string) =>
  api.post<{ id: string; status: string }>(`${base}/beneficiaries/${id}/verify`, { note });

export const disableBeneficiary = (id: string) =>
  api.post<{ id: string; status: string }>(`${base}/beneficiaries/${id}/disable`, {});

/** Une clé d'idempotence par formulaire soumis : un double clic ne crée pas deux demandes. */
export const createPayout = (
  body: { beneficiaryId: string; amount: number; purpose: string },
  key = idempotencyKey('platform-payout'),
) =>
  api.post<{ payout: PlatformPayoutRow; replayed: boolean }>(`${base}/payouts`, body, {
    'idempotency-key': key,
  });

export type PayoutDecision = 'approve' | 'reject' | 'cancel' | 'release' | 'check';

export const decidePayout = (id: string, decision: PayoutDecision, note?: string) =>
  api.post<{ id?: string; status: PlatformPayoutStatus; outcome?: string }>(
    `${base}/payouts/${id}/${decision}`,
    note ? { note } : {},
  );
