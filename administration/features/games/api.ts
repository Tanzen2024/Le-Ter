import { keepPreviousData, queryOptions } from '@tanstack/react-query';

import { api, type Query } from '@/lib/api/client';
import type { GameDetail, GameRow, Paged } from '@/types/admin';

export function gamesQuery(query: Query) {
  return queryOptions({
    queryKey: ['admin', 'games', query],
    queryFn: () => api.get<Paged<GameRow>>('games', { limit: 25, ...query }),
    placeholderData: keepPreviousData,
  });
}

export function gameQuery(id: string) {
  return queryOptions({
    queryKey: ['admin', 'game', id],
    queryFn: () => api.get<{ game: GameDetail }>(`games/${id}`),
  });
}
