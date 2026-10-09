import { timingSafeEqual } from 'node:crypto';

/** En-tête porteur du jeton CSRF (double soumission du cookie `leter_admin_csrf`). */
export const CSRF_HEADER = 'x-csrf-token';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

export function isMutation(method: string): boolean {
  return !SAFE_METHODS.has(method.toUpperCase());
}

/**
 * Origine attendue : `ADMIN_PUBLIC_ORIGIN` si configurée, sinon celle de l'en-tête Host
 * (protocole déduit de `x-forwarded-proto` seulement s'il vaut http ou https).
 */
export function expectedOrigin(
  headers: Headers,
  publicOrigin: string | undefined,
  requestUrl: string,
): string {
  if (publicOrigin) return publicOrigin;
  const host = headers.get('host');
  if (!host) return new URL(requestUrl).origin;
  const proto = headers.get('x-forwarded-proto');
  const scheme =
    proto === 'https' || proto === 'http' ? proto : new URL(requestUrl).protocol.slice(0, -1);
  return `${scheme}://${host}`;
}

export type CsrfFailure = 'origin' | 'token';

/**
 * Contrôle d'une requête de MODIFICATION reçue par le serveur Next.js :
 * 1. `Origin` présent et égal à l'origine de l'administration ;
 * 2. jeton CSRF de l'en-tête égal à celui du cookie (comparaison en temps constant).
 * Les cookies sont en plus `SameSite=Strict`.
 */
export function checkCsrf(input: {
  method: string;
  origin: string | null;
  expected: string;
  headerToken: string | null;
  cookieToken: string | undefined;
  requireToken: boolean;
}): CsrfFailure | null {
  if (!isMutation(input.method)) return null;
  if (!input.origin || input.origin !== input.expected) return 'origin';
  if (!input.requireToken) return null;
  const header = input.headerToken ?? '';
  const cookie = input.cookieToken ?? '';
  if (header.length === 0 || header.length !== cookie.length) return 'token';
  return timingSafeEqual(Buffer.from(header), Buffer.from(cookie)) ? null : 'token';
}
