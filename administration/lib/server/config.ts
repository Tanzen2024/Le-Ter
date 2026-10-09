/**
 * Configuration du serveur Next.js (jamais exposée au navigateur : aucune variable
 * `NEXT_PUBLIC_*`). Lue à chaque appel pour rester testable.
 */
export interface ServerConfig {
  /** URL du backend Le Ter, sans barre finale. */
  apiUrl: string;
  /** Origine publique attendue des requêtes de modification ; absente : déduite de Host. */
  publicOrigin: string | undefined;
  /** Cookies `Secure` (HTTPS). */
  secureCookies: boolean;
}

export function readServerConfig(env: NodeJS.ProcessEnv = process.env): ServerConfig {
  const raw = env.ADMIN_API_URL?.trim() || 'http://localhost:3000';
  let apiUrl: URL;
  try {
    apiUrl = new URL(raw);
  } catch {
    throw new Error('ADMIN_API_URL invalide : URL attendue');
  }
  if (apiUrl.protocol !== 'http:' && apiUrl.protocol !== 'https:') {
    throw new Error('ADMIN_API_URL invalide : http ou https attendu');
  }
  const publicOrigin = env.ADMIN_PUBLIC_ORIGIN?.trim() || undefined;
  if (publicOrigin) new URL(publicOrigin);
  const secure = env.ADMIN_COOKIE_SECURE?.trim();
  return {
    apiUrl: apiUrl.toString().replace(/\/$/, ''),
    publicOrigin: publicOrigin?.replace(/\/$/, ''),
    secureCookies:
      secure === undefined || secure === '' ? env.NODE_ENV === 'production' : secure === 'true',
  };
}
