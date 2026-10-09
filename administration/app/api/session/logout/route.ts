import type { NextRequest } from 'next/server';

import { readServerConfig } from '@/lib/server/config';
import { logoutAdmin } from '@/lib/server/gateway';
import { gatewayRequestOf, nextResponseOf } from '@/lib/server/next-adapter';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  return nextResponseOf(await logoutAdmin(await gatewayRequestOf(request), readServerConfig()));
}
