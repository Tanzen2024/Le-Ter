import { queryOptions } from '@tanstack/react-query';

import { periodRange } from '@/features/shared/period';
import { api } from '@/lib/api/client';
import type { Dashboard } from '@/types/admin';

/** Indicateurs du tableau de bord pour une période de `days` jours locaux. */
export function dashboardQuery(days = 30) {
  const range = periodRange(days);
  return queryOptions({
    queryKey: ['admin', 'dashboard', range.from, range.to],
    queryFn: () => api.get<Dashboard>('dashboard', range),
  });
}
