import { keepPreviousData, queryOptions } from '@tanstack/react-query';

import { api, downloadUrl, idempotencyKey, type Query } from '@/lib/api/client';
import type { Paged } from '@/types/admin';
import type {
  AdminComplaintDetail,
  ComplaintPriority,
  ComplaintRow,
  ComplaintStatus,
} from '@/types/complaints';

export function complaintsQuery(query: Query) {
  return queryOptions({
    queryKey: ['admin', 'complaints', query],
    queryFn: () => api.get<Paged<ComplaintRow>>('complaints', { limit: 25, ...query }),
    placeholderData: keepPreviousData,
  });
}

/** Détail : chaque consultation est inscrite au journal d'audit par le serveur. */
export function complaintQuery(id: string) {
  return queryOptions({
    queryKey: ['admin', 'complaint', id],
    queryFn: () => api.get<AdminComplaintDetail>(`complaints/${id}`),
  });
}

export function assigneesQuery() {
  return queryOptions({
    queryKey: ['admin', 'complaint-assignees'],
    queryFn: () =>
      api.get<{ assignees: { id: string; username: string }[] }>('complaints/assignees'),
    staleTime: 5 * 60_000,
  });
}

/** Pièce justificative, servie par la passerelle (cookies de même origine, consultation auditée). */
export function attachmentUrl(id: string, attachmentId: string) {
  return downloadUrl(`complaints/${id}/attachments/${attachmentId}`);
}

export const complaintActions = {
  reply: (id: string, body: string, internal: boolean) =>
    api.post<{ message: unknown }>(
      `complaints/${id}/messages`,
      { body, internal },
      { 'idempotency-key': idempotencyKey('complaint-reply') },
    ),
  requestInfo: (id: string, message: string, expectedStatus: ComplaintStatus) =>
    api.post<{ status: ComplaintStatus }>(`complaints/${id}/request-info`, {
      message,
      expectedStatus,
    }),
  assign: (id: string, assigneeId: string | null) =>
    api.post<{ status: ComplaintStatus }>(`complaints/${id}/assign`, { assigneeId }),
  priority: (id: string, priority: ComplaintPriority) =>
    api.post<{ priority: ComplaintPriority }>(`complaints/${id}/priority`, { priority }),
  status: (
    id: string,
    body: {
      status: ComplaintStatus;
      expectedStatus: ComplaintStatus;
      decision?: string;
      reason?: string;
    },
  ) => api.post<{ status: ComplaintStatus }>(`complaints/${id}/status`, body),
};
