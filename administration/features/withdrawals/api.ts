import { keepPreviousData, queryOptions } from '@tanstack/react-query';

import { api, idempotencyKey, type Query } from '@/lib/api/client';
import type {
  Paged,
  WithdrawalDetail,
  WithdrawalLimitSetting,
  WithdrawalRow,
  WithdrawalVerificationResult,
} from '@/types/admin';

export function withdrawalsQuery(query: Query) {
  return queryOptions({
    queryKey: ['admin', 'withdrawals', query],
    queryFn: () => api.get<Paged<WithdrawalRow>>('withdrawals', { limit: 25, ...query }),
    placeholderData: keepPreviousData,
  });
}

/** Détail d'un retrait : chaque consultation est inscrite au journal d'audit par le serveur. */
export function withdrawalQuery(id: string) {
  return queryOptions({
    queryKey: ['admin', 'withdrawal', id],
    queryFn: () => api.get<{ withdrawal: WithdrawalDetail }>(`withdrawals/${id}`),
    staleTime: Infinity,
  });
}

/**
 * Revérification auprès de CinetPay, exécutée par le SERVEUR (statut relu par la référence
 * marchande, règlement idempotent). Une clé d'idempotence par clic.
 */
export function verifyWithdrawal(id: string) {
  return api.post<WithdrawalVerificationResult>(
    `withdrawals/${id}/verify`,
    {},
    { 'idempotency-key': idempotencyKey('verify-withdrawal') },
  );
}

export function withdrawalLimitQuery() {
  return queryOptions({
    queryKey: ['admin', 'withdrawal-limit'],
    queryFn: () => api.get<WithdrawalLimitSetting>('settings/withdrawal-limit'),
  });
}

export function setWithdrawalLimit(limit: { count: number | null; periodMinutes: number | null }) {
  return api.patch<WithdrawalLimitSetting & { changed: boolean }>(
    'settings/withdrawal-limit',
    limit,
  );
}

/** Escalade vers CinetPay : trace auditée, sans effet sur le retrait ni le solde. */
export function escalateWithdrawal(id: string, body: { providerTicket?: string; note: string }) {
  return api.post<{ escalated: true }>(`withdrawals/${id}/escalations`, body);
}

/**
 * Proposition de remboursement (1er administrateur). Le serveur relit le transfert chez
 * CinetPay : un succès ou un échec final confirmé est appliqué sans demande.
 */
export function proposeWithdrawalRefund(
  id: string,
  body: { providerTicket: string; justification: string },
) {
  return api.post<
    | { outcome: 'proposed'; requestId: string; status: 'PENDING' }
    | { outcome: 'settled_by_provider'; status: string }
  >(`withdrawals/${id}/refund-requests`, body);
}

/** Décision d'un AUTRE administrateur ; l'approbation relit de nouveau le transfert. */
export function decideWithdrawalRefund(
  id: string,
  requestId: string,
  decision: 'approve' | 'reject',
  note?: string,
) {
  return api.post<{ requestId: string; requestStatus: string; withdrawalStatus: string }>(
    `withdrawals/${id}/refund-requests/${requestId}/${decision}`,
    note ? { note } : {},
  );
}
