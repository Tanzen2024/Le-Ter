import { createHash } from 'node:crypto';

/**
 * Pannes du serveur condensées pour le back-office (D-168). Une occurrence = une réponse 5xx de
 * l'API ; elles sont regroupées par empreinte (même méthode, route, statut, code et type).
 * Jamais de corps, d'en-tête, de jeton ni de mot de passe.
 */
export interface ServerErrorOccurrence {
  method: string;
  /** Route normalisée (`routeOf`), jamais l'URL brute. */
  route: string;
  status: number;
  code: string | null;
  errorName: string;
  message: string;
  requestId: string | null;
  stack: string | null;
  occurredAt: Date;
}

export interface ServerErrorGroup {
  fingerprint: string;
  method: string;
  route: string;
  status: number;
  code: string | null;
  errorName: string;
  message: string;
  occurrences: number;
  firstSeenAt: Date;
  lastSeenAt: Date;
  lastRequestId: string | null;
  lastStack: string | null;
}

export const SERVER_ERROR_MESSAGE_MAX = 1000;
export const SERVER_ERROR_STACK_MAX = 8000;
const ROUTE_MAX = 300;

/** Empreinte stable d'une panne : le message (souvent variable) n'en fait pas partie. */
export function serverErrorFingerprint(
  o: Pick<ServerErrorOccurrence, 'method' | 'route' | 'status' | 'code' | 'errorName'>,
): string {
  return createHash('sha256')
    .update([o.method, o.route, String(o.status), o.code ?? '', o.errorName].join('\n'))
    .digest('hex');
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Route d'une requête pour le regroupement : le motif Express s'il est connu (`/api/games/:gameId`),
 * sinon le chemin dont les identifiants (UUID, nombres) deviennent `:id`. Jamais la query string.
 */
export function routeOf(req: { baseUrl?: string; path: string; route?: { path?: unknown } }): string {
  const pattern = typeof req.route?.path === 'string' ? `${req.baseUrl ?? ''}${req.route.path}` : undefined;
  const route =
    pattern ??
    req.path
      .split('/')
      .map((part) => (UUID.test(part) || /^\d+$/.test(part) ? ':id' : part))
      .join('/');
  return (route || '/').slice(0, ROUTE_MAX);
}

export function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}
