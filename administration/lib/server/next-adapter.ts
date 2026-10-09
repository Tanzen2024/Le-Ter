import { NextResponse, type NextRequest } from 'next/server';

import { COOKIE_NAMES } from './session-cookies';
import type { GatewayRequest, GatewayResponse } from './gateway';

/** Requête Next.js → entrée de la passerelle (cookies de session lus côté serveur). */
export async function gatewayRequestOf(request: NextRequest): Promise<GatewayRequest> {
  const hasBody = request.method !== 'GET' && request.method !== 'HEAD';
  const body = hasBody ? await request.text() : null;
  return {
    method: request.method,
    url: request.url,
    headers: request.headers,
    // Taille limitée par le backend (32 ko) : un corps trop gros y est refusé (413).
    body: body && body.length > 0 ? body : null,
    cookies: {
      access: request.cookies.get(COOKIE_NAMES.access)?.value,
      refresh: request.cookies.get(COOKIE_NAMES.refresh)?.value,
      csrf: request.cookies.get(COOKIE_NAMES.csrf)?.value,
    },
  };
}

/** Réponse de la passerelle → réponse Next.js (cookies posés ou effacés, jamais en cache). */
export function nextResponseOf(result: GatewayResponse): NextResponse {
  const response = new NextResponse(result.body, {
    status: result.status,
    headers: result.headers,
  });
  response.headers.set('cache-control', 'no-store');
  for (const cookie of result.cookies) {
    response.cookies.set(cookie.name, cookie.value, cookie.options);
  }
  return response;
}
