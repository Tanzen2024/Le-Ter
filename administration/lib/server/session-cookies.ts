import { randomBytes } from 'node:crypto';

/**
 * Cookies de la session d'administration, posés par le serveur Next.js :
 *
 * - `leter_admin_at` : access token du backend (httpOnly) ;
 * - `leter_admin_rt` : refresh token du backend (httpOnly), 8 h au plus ;
 * - `leter_admin_csrf` : jeton CSRF (lisible par le script : double soumission).
 *
 * Les jetons du backend ne sont JAMAIS lisibles par JavaScript dans le navigateur. Les
 * limites de durée (8 h absolues, 30 min d'inactivité) sont imposées par le BACKEND ; les
 * durées de vie ci-dessous ne font que nettoyer le navigateur.
 */
export const COOKIE_NAMES = {
  access: 'leter_admin_at',
  refresh: 'leter_admin_rt',
  csrf: 'leter_admin_csrf',
} as const;

/** Durée de vie maximale d'un cookie de session : la session admin dure 8 h au plus. */
export const SESSION_COOKIE_MAX_AGE_SECONDS = 8 * 3600;

export interface CookieToSet {
  name: string;
  value: string;
  options: {
    httpOnly: boolean;
    secure: boolean;
    sameSite: 'strict';
    path: '/';
    maxAge: number;
  };
}

export function newCsrfToken(): string {
  return randomBytes(32).toString('base64url');
}

export function sessionCookies(
  tokens: { accessToken: string; refreshToken: string; csrfToken?: string },
  secure: boolean,
  maxAgeSeconds = SESSION_COOKIE_MAX_AGE_SECONDS,
): CookieToSet[] {
  const base = { secure, sameSite: 'strict' as const, path: '/' as const, maxAge: maxAgeSeconds };
  const cookies: CookieToSet[] = [
    { name: COOKIE_NAMES.access, value: tokens.accessToken, options: { ...base, httpOnly: true } },
    {
      name: COOKIE_NAMES.refresh,
      value: tokens.refreshToken,
      options: { ...base, httpOnly: true },
    },
  ];
  if (tokens.csrfToken) {
    cookies.push({
      name: COOKIE_NAMES.csrf,
      value: tokens.csrfToken,
      options: { ...base, httpOnly: false },
    });
  }
  return cookies;
}

/** Effacement de tous les cookies de session (déconnexion, session expirée). */
export function clearedCookies(secure: boolean): CookieToSet[] {
  return Object.values(COOKIE_NAMES).map((name) => ({
    name,
    value: '',
    options: {
      httpOnly: name !== COOKIE_NAMES.csrf,
      secure,
      sameSite: 'strict',
      path: '/',
      maxAge: 0,
    },
  }));
}
