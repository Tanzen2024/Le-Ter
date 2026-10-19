import type { ServerConfig } from './config';
import { checkCsrf, CSRF_HEADER, expectedOrigin } from './csrf';
import { clearedCookies, newCsrfToken, sessionCookies, type CookieToSet } from './session-cookies';

/**
 * Passerelle serveur (BFF) entre le navigateur et le backend Le Ter. Elle ne contient
 * AUCUNE règle métier ni décision d'autorisation : le backend contrôle l'identité, le rôle
 * `admin` et la session d'administration à chaque requête. Elle garde les jetons côté
 * serveur, contrôle l'origine et le jeton CSRF des modifications, et renouvelle l'access
 * token expiré avec le refresh token (sans jamais repousser la limite de 8 h du backend).
 */

export interface GatewayCookies {
  access?: string;
  refresh?: string;
  csrf?: string;
}

export interface GatewayRequest {
  method: string;
  url: string;
  headers: Headers;
  body: string | null;
  cookies: GatewayCookies;
}

export interface GatewayResponse {
  status: number;
  headers: Record<string, string>;
  body: string | ArrayBuffer | null;
  cookies: CookieToSet[];
}

/** Réponse en flux (événements du serveur, D-116) : corps relayé sans mise en mémoire. */
export interface GatewayStreamResponse extends Omit<GatewayResponse, 'body'> {
  body: GatewayResponse['body'] | ReadableStream<Uint8Array>;
}

type FetchLike = (input: string, init: RequestInit) => Promise<Response>;

const BACKEND_TIMEOUT_MS = 15_000;
const SEGMENT = /^[A-Za-z0-9._-]{1,100}$/;
/**
 * Routes traitées par des Route Handlers dédiés, jamais par le relais générique : session, et
 * flux d'événements (le relais générique met la réponse en mémoire et coupe après 15 s).
 */
const RESERVED = new Set(['auth/login', 'auth/logout', 'events']);
/**
 * Lecture passive (D-116) : le backend la contrôle sans la compter comme une activité de
 * l'administrateur. Relayée seulement pour un GET et la seule valeur `1`.
 */
export const PASSIVE_HEADER = 'x-admin-passive';
const FORWARDED_RESPONSE_HEADERS = ['content-type', 'content-disposition', 'retry-after'];
const SESSION_ENDED_CODES = new Set(['ADMIN_SESSION_EXPIRED', 'ADMIN_SESSION_REQUIRED']);

function json(status: number, body: unknown, cookies: CookieToSet[] = []): GatewayResponse {
  return {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
    body: JSON.stringify(body),
    cookies,
  };
}

function error(status: number, code: string, message: string, cookies: CookieToSet[] = []) {
  return json(status, { error: code, code, message }, cookies);
}

/** Chemin backend `/api/admin/<segments>` validé (aucun `..`, caractères sûrs). */
export function adminPath(segments: string[]): string | null {
  if (segments.length === 0 || segments.length > 6) return null;
  if (!segments.every((s) => SEGMENT.test(s) && s !== '.' && s !== '..')) return null;
  const joined = segments.join('/');
  return RESERVED.has(joined) ? null : `/api/admin/${joined}`;
}

async function callBackend(
  fetchImpl: FetchLike,
  url: string,
  init: RequestInit,
): Promise<Response | null> {
  try {
    return await fetchImpl(url, {
      signal: AbortSignal.timeout(BACKEND_TIMEOUT_MS),
      ...init,
      cache: 'no-store',
      redirect: 'manual',
    });
  } catch {
    return null;
  }
}

async function codeOf(response: Response): Promise<string | undefined> {
  if (!response.headers.get('content-type')?.includes('application/json')) return undefined;
  try {
    const body = (await response.clone().json()) as { code?: unknown };
    return typeof body.code === 'string' ? body.code : undefined;
  } catch {
    return undefined;
  }
}

async function toGatewayResponse(
  response: Response,
  cookies: CookieToSet[],
): Promise<GatewayResponse> {
  const headers: Record<string, string> = {};
  for (const name of FORWARDED_RESPONSE_HEADERS) {
    const value = response.headers.get(name);
    if (value) headers[name] = value;
  }
  const body = response.status === 204 ? null : await response.arrayBuffer();
  return { status: response.status, headers, body, cookies };
}

/** Relaie une requête du navigateur vers `/api/admin/*` du backend. */
export async function forwardAdminRequest(
  segments: string[],
  request: GatewayRequest,
  config: ServerConfig,
  fetchImpl: FetchLike = fetch,
): Promise<GatewayResponse> {
  const path = adminPath(segments);
  if (!path) return error(404, 'NOT_FOUND', 'Ressource introuvable.');

  const csrf = checkCsrf({
    method: request.method,
    origin: request.headers.get('origin'),
    expected: expectedOrigin(request.headers, config.publicOrigin, request.url),
    headerToken: request.headers.get(CSRF_HEADER),
    cookieToken: request.cookies.csrf,
    requireToken: true,
  });
  if (csrf)
    return error(403, 'CSRF_REJECTED', 'Requête refusée (origine ou jeton de sécurité invalide).');

  if (!request.cookies.access && !request.cookies.refresh) {
    return error(401, 'ADMIN_SESSION_REQUIRED', "Connectez-vous à l'administration.");
  }

  const search = new URL(request.url).search;
  const send = (accessToken: string | undefined) => {
    const headers: Record<string, string> = { accept: 'application/json, text/csv' };
    if (accessToken) headers.authorization = `Bearer ${accessToken}`;
    const contentType = request.headers.get('content-type');
    if (request.body !== null && contentType) headers['content-type'] = contentType;
    const idempotencyKey = request.headers.get('idempotency-key');
    if (idempotencyKey) headers['idempotency-key'] = idempotencyKey;
    if (request.method === 'GET' && request.headers.get(PASSIVE_HEADER) === '1') {
      headers[PASSIVE_HEADER] = '1';
    }
    return callBackend(fetchImpl, `${config.apiUrl}${path}${search}`, {
      method: request.method,
      headers,
      ...(request.body !== null && { body: request.body }),
    });
  };

  let cookies: CookieToSet[] = [];
  let response = await send(request.cookies.access);
  if (!response)
    return error(502, 'BACKEND_UNAVAILABLE', 'Le serveur Le Ter ne répond pas. Réessayez.');

  // Access token expiré : un seul renouvellement, puis une seule nouvelle tentative.
  if (
    response.status === 401 &&
    (await codeOf(response)) === 'UNAUTHENTICATED' &&
    request.cookies.refresh
  ) {
    const refreshed = await callBackend(fetchImpl, `${config.apiUrl}/api/auth/refresh`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ refreshToken: request.cookies.refresh }),
    });
    if (!refreshed)
      return error(502, 'BACKEND_UNAVAILABLE', 'Le serveur Le Ter ne répond pas. Réessayez.');
    if (!refreshed.ok) {
      return error(
        401,
        'ADMIN_SESSION_EXPIRED',
        "Votre session d'administration a expiré. Reconnectez-vous.",
        clearedCookies(config.secureCookies),
      );
    }
    const tokens = (await refreshed.json()) as { accessToken: string; refreshToken: string };
    cookies = sessionCookies(tokens, config.secureCookies);
    response = await send(tokens.accessToken);
    if (!response)
      return error(
        502,
        'BACKEND_UNAVAILABLE',
        'Le serveur Le Ter ne répond pas. Réessayez.',
        cookies,
      );
  }

  if (response.status === 401) {
    const code = await codeOf(response);
    if (code === 'UNAUTHENTICATED' || (code && SESSION_ENDED_CODES.has(code))) {
      cookies = clearedCookies(config.secureCookies);
    }
  }
  return toGatewayResponse(response, cookies);
}

/**
 * Flux d'événements de l'administration (D-116) : `GET /api/admin/events` du backend relayé
 * en continu (Server-Sent Events), toujours en lecture PASSIVE (un onglet ouvert ne prolonge
 * pas la session). Seul le délai d'ouverture est borné ; le flux suit ensuite la connexion du
 * navigateur (`signal`).
 *
 * Ce relais ne renouvelle JAMAIS l'access token : un refresh token ne sert qu'une fois, et deux
 * renouvellements simultanés (flux + requête de l'interface) fermeraient la session. Jeton
 * expiré : 401 UNAUTHENTICATED, cookies conservés ; le client relit ses compteurs par le relais
 * générique (qui renouvelle), puis rouvre le flux.
 */
export async function openAdminEvents(
  request: GatewayRequest,
  config: ServerConfig,
  fetchImpl: FetchLike = fetch,
  signal?: AbortSignal,
): Promise<GatewayStreamResponse> {
  if (!request.cookies.access) {
    return request.cookies.refresh
      ? error(401, 'UNAUTHENTICATED', 'Jeton à renouveler.')
      : error(401, 'ADMIN_SESSION_REQUIRED', "Connectez-vous à l'administration.");
  }
  const opening = new AbortController();
  const abort = () => opening.abort();
  signal?.addEventListener('abort', abort, { once: true });
  const timeout = setTimeout(abort, BACKEND_TIMEOUT_MS);
  const response = await callBackend(fetchImpl, `${config.apiUrl}/api/admin/events`, {
    method: 'GET',
    headers: {
      accept: 'text/event-stream',
      authorization: `Bearer ${request.cookies.access}`,
      [PASSIVE_HEADER]: '1',
    },
    signal: opening.signal,
  });
  clearTimeout(timeout);
  if (!response) {
    signal?.removeEventListener('abort', abort);
    return error(502, 'BACKEND_UNAVAILABLE', 'Le serveur Le Ter ne répond pas. Réessayez.');
  }
  if (
    response.ok &&
    response.body &&
    response.headers.get('content-type')?.startsWith('text/event-stream')
  ) {
    return {
      status: 200,
      headers: { 'content-type': 'text/event-stream; charset=utf-8', 'x-accel-buffering': 'no' },
      body: response.body,
      cookies: [],
    };
  }
  signal?.removeEventListener('abort', abort);
  const code = response.status === 401 ? await codeOf(response) : undefined;
  // Session terminée : cookies effacés comme pour toute requête ; jeton expiré : conservés.
  const cookies = code && SESSION_ENDED_CODES.has(code) ? clearedCookies(config.secureCookies) : [];
  return toGatewayResponse(response, cookies);
}

/** Connexion : identifiants transmis au backend ; jetons gardés en cookies httpOnly. */
export async function loginAdmin(
  request: GatewayRequest,
  config: ServerConfig,
  fetchImpl: FetchLike = fetch,
): Promise<GatewayResponse> {
  // Pas encore de jeton CSRF à la connexion : l'origine seule est contrôlée (login CSRF).
  const csrf = checkCsrf({
    method: request.method,
    origin: request.headers.get('origin'),
    expected: expectedOrigin(request.headers, config.publicOrigin, request.url),
    headerToken: null,
    cookieToken: undefined,
    requireToken: false,
  });
  if (csrf) return error(403, 'CSRF_REJECTED', 'Requête refusée (origine invalide).');
  const response = await callBackend(fetchImpl, `${config.apiUrl}/api/admin/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json' },
    body: request.body ?? '{}',
  });
  if (!response)
    return error(502, 'BACKEND_UNAVAILABLE', 'Le serveur Le Ter ne répond pas. Réessayez.');
  if (!response.ok) return toGatewayResponse(response, []);
  const body = (await response.json()) as {
    accessToken: string;
    refreshToken: string;
    user: unknown;
    displayRole: string;
    session: unknown;
  };
  const cookies = sessionCookies(
    { accessToken: body.accessToken, refreshToken: body.refreshToken, csrfToken: newCsrfToken() },
    config.secureCookies,
  );
  // Les jetons ne sont jamais renvoyés au navigateur.
  return json(
    200,
    { user: body.user, displayRole: body.displayRole, session: body.session },
    cookies,
  );
}

/** Déconnexion : session terminée côté backend (si possible), cookies toujours effacés. */
export async function logoutAdmin(
  request: GatewayRequest,
  config: ServerConfig,
  fetchImpl: FetchLike = fetch,
): Promise<GatewayResponse> {
  const csrf = checkCsrf({
    method: request.method,
    origin: request.headers.get('origin'),
    expected: expectedOrigin(request.headers, config.publicOrigin, request.url),
    headerToken: request.headers.get(CSRF_HEADER),
    cookieToken: request.cookies.csrf,
    requireToken: true,
  });
  if (csrf)
    return error(403, 'CSRF_REJECTED', 'Requête refusée (origine ou jeton de sécurité invalide).');
  const logout = (accessToken: string) =>
    callBackend(fetchImpl, `${config.apiUrl}/api/admin/auth/logout`, {
      method: 'POST',
      headers: { authorization: `Bearer ${accessToken}` },
    });
  const response = request.cookies.access ? await logout(request.cookies.access) : null;
  // Access token expiré : on le renouvelle pour terminer VRAIMENT la session côté serveur.
  if ((!response || response.status === 401) && request.cookies.refresh) {
    const refreshed = await callBackend(fetchImpl, `${config.apiUrl}/api/auth/refresh`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ refreshToken: request.cookies.refresh }),
    });
    if (refreshed?.ok) {
      const tokens = (await refreshed.json()) as { accessToken: string };
      await logout(tokens.accessToken);
    }
  }
  return { status: 204, headers: {}, body: null, cookies: clearedCookies(config.secureCookies) };
}
