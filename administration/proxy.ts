import { NextResponse, type NextRequest } from 'next/server';

import { COOKIE_NAMES } from '@/lib/server/session-cookies';

/**
 * Redirections de CONFORT seulement : sans cookie de session, les pages renvoient vers la
 * connexion. Ce n'est PAS un contrôle d'accès : chaque donnée est autorisée par le backend
 * (rôle `admin` et session d'administration vérifiés à chaque requête).
 */
export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const hasSession = request.cookies.has(COOKIE_NAMES.refresh);
  if (pathname === '/connexion') {
    return hasSession
      ? NextResponse.redirect(new URL('/tableau-de-bord', request.url))
      : NextResponse.next();
  }
  if (!hasSession) {
    const login = new URL('/connexion', request.url);
    if (pathname !== '/') login.searchParams.set('suite', pathname);
    return NextResponse.redirect(login);
  }
  if (pathname === '/') return NextResponse.redirect(new URL('/tableau-de-bord', request.url));
  return NextResponse.next();
}

export const config = {
  // Pages seulement : ni API, ni fichiers statiques.
  matcher: ['/((?!api|_next/static|_next/image|favicon.ico|icon.svg|robots.txt).*)'],
};
