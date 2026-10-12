import { keepPreviousData, queryOptions } from '@tanstack/react-query';

import { api, type Query } from '@/lib/api/client';
import type {
  AdminNote,
  AuditEvent,
  GameRow,
  Paged,
  PlayerDetail,
  PlayerModeration,
  PlayerRow,
  Sanction,
  WalletTransaction,
} from '@/types/admin';

export const PAGE_SIZE = 25;

export function playersQuery(query: Query) {
  return queryOptions({
    queryKey: ['admin', 'players', query],
    queryFn: () => api.get<Paged<PlayerRow>>('users', { limit: PAGE_SIZE, ...query }),
    placeholderData: keepPreviousData,
  });
}

/** Détail d'un joueur : chaque consultation est inscrite au journal d'audit par le serveur. */
export function playerQuery(id: string) {
  return queryOptions({
    queryKey: ['admin', 'player', id],
    queryFn: () => api.get<{ user: PlayerDetail }>(`users/${id}`),
    staleTime: Infinity,
  });
}

export function playerGamesQuery(id: string, page: number) {
  return queryOptions({
    queryKey: ['admin', 'player', id, 'games', page],
    queryFn: () => api.get<Paged<GameRow>>(`users/${id}/games`, { page, limit: 10 }),
    placeholderData: keepPreviousData,
  });
}

export function playerTransactionsQuery(id: string, page: number) {
  return queryOptions({
    queryKey: ['admin', 'player', id, 'transactions', page],
    queryFn: () =>
      api.get<Paged<WalletTransaction>>(`users/${id}/transactions`, { page, limit: 10 }),
    placeholderData: keepPreviousData,
  });
}

// --- Gestion des joueurs (D-079) -------------------------------------------------------------

/** État de modération et sécurité du compte (aucun jeton n'est jamais renvoyé). */
export function playerModerationQuery(id: string) {
  return queryOptions({
    queryKey: ['admin', 'player', id, 'moderation'],
    queryFn: () => api.get<PlayerModeration>(`users/${id}/moderation`),
  });
}

export function playerSanctionsQuery(id: string, page: number) {
  return queryOptions({
    queryKey: ['admin', 'player', id, 'sanctions', page],
    queryFn: () => api.get<Paged<Sanction>>(`users/${id}/sanctions`, { page, limit: 10 }),
    placeholderData: keepPreviousData,
  });
}

export function playerNotesQuery(id: string, page: number) {
  return queryOptions({
    queryKey: ['admin', 'player', id, 'notes', page],
    queryFn: () => api.get<Paged<AdminNote>>(`users/${id}/notes`, { page, limit: 10 }),
    placeholderData: keepPreviousData,
  });
}

/** Journal de modération : `admin_audit_log` du joueur, sans les consultations par défaut. */
export function playerModerationLogQuery(id: string, page: number, includeViews: boolean) {
  return queryOptions({
    queryKey: ['admin', 'player', id, 'moderation-log', page, includeViews],
    queryFn: () =>
      api.get<Paged<AuditEvent>>(`users/${id}/moderation-log`, {
        page,
        limit: 10,
        includeViews: includeViews ? 'true' : undefined,
      }),
    placeholderData: keepPreviousData,
  });
}

export interface RestrictionBody {
  reason: string;
  comment?: string;
  /** ISO 8601 ; absent : durée indéterminée. */
  endsAt?: string;
}

export const playerActions = {
  setEnabled: (id: string, enabled: boolean, reason: string) =>
    api.post<{ status: 'active' | 'disabled'; changed: boolean; revokedSessions: number }>(
      `users/${id}/${enabled ? 'enable' : 'disable'}`,
      { reason },
    ),
  suspend: (id: string, body: RestrictionBody) =>
    api.post<{ sanctionId: string; revokedSessions: number }>(`users/${id}/suspension`, body),
  liftSuspension: (id: string, reason: string) =>
    api.post<{ sanctionId: string }>(`users/${id}/suspension/lift`, { reason }),
  revokeSessions: (id: string, reason?: string) =>
    api.post<{ revokedSessions: number }>(`users/${id}/sessions/revoke`, reason ? { reason } : {}),
  restrictChat: (id: string, body: RestrictionBody) =>
    api.post<{ sanctionId: string }>(`users/${id}/chat-restriction`, body),
  liftChatRestriction: (id: string, reason: string) =>
    api.post<{ sanctionId: string }>(`users/${id}/chat-restriction/lift`, { reason }),
  /** Une clé d'idempotence par intention : un double clic ne crée qu'un avertissement. */
  warn: (
    id: string,
    body: { reason: string; playerMessage?: string; comment?: string },
    key: string,
  ) =>
    api.post<{ sanctionId: string; delivered: boolean; replayed: boolean }>(
      `users/${id}/warnings`,
      body,
      { 'idempotency-key': key },
    ),
  addNote: (id: string, body: string, key: string) =>
    api.post<{ noteId: string; replayed: boolean }>(
      `users/${id}/notes`,
      { body },
      { 'idempotency-key': key },
    ),
  deleteNote: (id: string, noteId: string, reason: string) =>
    api.post<{ noteId: string }>(`users/${id}/notes/${noteId}/delete`, { reason }),
};
