import type { NextRequest } from 'next/server';

import { readServerConfig } from '@/lib/server/config';
import { openAdminEvents } from '@/lib/server/gateway';
import { gatewayRequestOf, nextResponseOf } from '@/lib/server/next-adapter';

/**
 * Flux Server-Sent Events des points d'attention (D-116), relayé depuis
 * `/api/admin/events` du backend. Aucune donnée métier : seulement « un compteur a changé ».
 * Route dédiée (prioritaire sur le relais générique `[...path]`, qui met en mémoire).
 */
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const result = await openAdminEvents(
    await gatewayRequestOf(request),
    readServerConfig(),
    fetch,
    request.signal,
  );
  return nextResponseOf(result);
}
