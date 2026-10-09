import { keepPreviousData, queryOptions } from '@tanstack/react-query';

import { api, type Query } from '@/lib/api/client';
import type { GameRow, Paged, PlayerDetail, PlayerRow, WalletTransaction } from '@/types/admin';

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
