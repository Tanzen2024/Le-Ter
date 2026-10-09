import type { NextRequest } from 'next/server';

import { readServerConfig } from '@/lib/server/config';
import { forwardAdminRequest } from '@/lib/server/gateway';
import { gatewayRequestOf, nextResponseOf } from '@/lib/server/next-adapter';

/**
 * Relais serveur vers `/api/admin/*` du backend Le Ter. Toute l'autorisation est vérifiée
 * par le backend (identité, rôle `admin`, session d'administration) ; ce relais ajoute le
 * jeton gardé en cookie httpOnly et contrôle l'origine et le jeton CSRF des modifications.
 */
export const dynamic = 'force-dynamic';

async function handle(request: NextRequest, ctx: { params: Promise<{ path: string[] }> }) {
  const { path } = await ctx.params;
  const result = await forwardAdminRequest(
    path,
    await gatewayRequestOf(request),
    readServerConfig(),
  );
  return nextResponseOf(result);
}

export const GET = handle;
export const POST = handle;
export const PATCH = handle;
