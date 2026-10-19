import { ApiError, SESSION_CODES } from './errors';

/**
 * Client HTTP du navigateur : il ne parle QU'AU serveur Next.js (`/api/admin/*`,
 * `/api/session/*`). Aucun jeton n'est manipulé ici : ils sont en cookies httpOnly.
 */
const CSRF_COOKIE = 'leter_admin_csrf';

function csrfToken(): string | undefined {
  if (typeof document === 'undefined') return undefined;
  return document.cookie
    .split('; ')
    .find((c) => c.startsWith(`${CSRF_COOKIE}=`))
    ?.slice(CSRF_COOKIE.length + 1);
}

/** Session terminée (expiration, autre connexion) : retour à la page de connexion. */
function onSessionEnded(code: string) {
  if (typeof window === 'undefined') return;
  const reason = code === 'ADMIN_SESSION_EXPIRED' ? 'expiree' : 'requise';
  const next = encodeURIComponent(window.location.pathname);
  // Rechargement complet : le cache des données de la session close est abandonné.
  window.location.replace(
    new URL(`/connexion?session=${reason}&suite=${next}`, window.location.origin),
  );
}

export type Query = Record<string, string | number | undefined | null | false>;

export function withQuery(path: string, query: Query = {}): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined && value !== null && value !== '' && value !== false) {
      params.set(key, String(value));
    }
  }
  const qs = params.toString();
  return qs ? `${path}?${qs}` : path;
}

async function request<T>(
  method: 'GET' | 'POST' | 'PATCH',
  path: string,
  options: {
    body?: unknown;
    headers?: Record<string, string>;
    redirectOnSessionEnd?: boolean;
  } = {},
): Promise<T> {
  const headers: Record<string, string> = { accept: 'application/json', ...options.headers };
  if (method !== 'GET') {
    headers['content-type'] = 'application/json';
    const token = csrfToken();
    if (token) headers['x-csrf-token'] = token;
  }
  let response: Response;
  try {
    response = await fetch(path, {
      method,
      headers,
      credentials: 'same-origin',
      cache: 'no-store',
      ...(options.body !== undefined && { body: JSON.stringify(options.body) }),
    });
  } catch {
    throw new ApiError(0, 'NETWORK', 'Impossible de joindre le serveur. Vérifiez votre connexion.');
  }
  if (response.status === 204) return undefined as T;
  const isJson = response.headers.get('content-type')?.includes('application/json');
  const body = isJson ? ((await response.json()) as Record<string, unknown>) : undefined;
  if (!response.ok) {
    const code = typeof body?.code === 'string' ? body.code : `HTTP_${response.status}`;
    const message = typeof body?.message === 'string' ? body.message : '';
    if (
      response.status === 401 &&
      SESSION_CODES.has(code) &&
      options.redirectOnSessionEnd !== false
    ) {
      onSessionEnded(code);
    }
    throw new ApiError(
      response.status,
      code,
      message,
      body?.fields as Record<string, string> | undefined,
    );
  }
  return body as T;
}

/**
 * Lecture PASSIVE (D-116) : requête automatique de l'interface (points d'attention), contrôlée
 * par le backend sans compter comme une activité : elle ne prolonge jamais la session.
 */
const PASSIVE_HEADERS = { 'x-admin-passive': '1' };

export const api = {
  get: <T>(path: string, query?: Query, options: { passive?: boolean } = {}) =>
    request<T>('GET', withQuery(`/api/admin/${path}`, query), {
      ...(options.passive && { headers: PASSIVE_HEADERS }),
    }),
  post: <T>(path: string, body?: unknown, headers?: Record<string, string>) =>
    request<T>('POST', `/api/admin/${path}`, { body: body ?? {}, headers }),
  patch: <T>(path: string, body: unknown) => request<T>('PATCH', `/api/admin/${path}`, { body }),
};

export const sessionApi = {
  login: <T>(email: string, password: string) =>
    request<T>('POST', '/api/session/login', {
      body: { email, password },
      redirectOnSessionEnd: false,
    }),
  logout: () => request<void>('POST', '/api/session/logout', { redirectOnSessionEnd: false }),
};

/** URL d'un export (GET simple, cookies de même origine). */
export function downloadUrl(path: string, query?: Query): string {
  return withQuery(`/api/admin/${path}`, query);
}

/** Clé d'idempotence d'une opération (une par intention de l'utilisateur). */
export function idempotencyKey(prefix: string): string {
  return `${prefix}-${crypto.randomUUID()}`;
}
