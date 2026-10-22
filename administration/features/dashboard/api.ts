import { queryOptions } from '@tanstack/react-query';

import { periodRange } from '@/features/shared/period';
import { api } from '@/lib/api/client';
import type { Dashboard, LedgerSource } from '@/types/admin';

/**
 * Indicateurs du tableau de bord pour une période `[from, to)` (30 jours locaux par défaut)
 * et, facultativement, une source de recettes (D-120). Une seule requête : les agrégats par
 * source sont calculés par le serveur.
 */
export function dashboardQuery(
  range: { from: string; to: string } | undefined = periodRange(30),
  source?: LedgerSource,
) {
  return queryOptions({
    queryKey: ['admin', 'dashboard', range?.from, range?.to, source ?? ''],
    queryFn: () =>
      api.get<Dashboard>('dashboard', { ...range, ...(source && { source }) }),
    enabled: range !== undefined,
  });
}
