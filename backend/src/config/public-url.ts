import { isIP } from 'node:net';

/**
 * Une URL que CinetPay doit appeler (notification) ou ouvrir dans le navigateur du payeur
 * (retour) doit être joignable DEPUIS INTERNET (D-100). Une adresse locale, privée (réseau
 * d'entreprise, box) ou de VPN (Tailscale, 100.64.0.0/10) ne l'est pas : CinetPay ne peut pas y
 * livrer ses notifications, et seule la réconciliation retrouve alors les paiements.
 *
 * Renvoie la raison du problème, ou `undefined` si l'hôte peut être public. Seule la forme de
 * l'hôte est examinée (aucune résolution DNS) ; jamais la valeur de l'URL dans un message.
 */
export type PublicUrlProblem =
  | 'NOT_HTTPS'
  | 'LOCALHOST'
  | 'PRIVATE_ADDRESS'
  | 'VPN_ADDRESS'
  | 'LINK_LOCAL_ADDRESS'
  | 'TEMPORARY_TUNNEL';

export function publicUrlProblems(value: string): PublicUrlProblem[] {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return [];
  }
  const problems: PublicUrlProblem[] = [];
  if (url.protocol !== 'https:') problems.push('NOT_HTTPS');
  const host = url.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (host === 'localhost' || host.endsWith('.localhost')) problems.push('LOCALHOST');
  // Quick Tunnel Cloudflare : une nouvelle adresse à chaque lancement (docs/android-apk-test.md).
  if (host.endsWith('.trycloudflare.com')) problems.push('TEMPORARY_TUNNEL');
  if (isIP(host) === 4) {
    const [a = 0, b = 0] = host.split('.').map(Number);
    if (a === 127) problems.push('LOCALHOST');
    else if (a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168)) {
      problems.push('PRIVATE_ADDRESS');
    } else if (a === 100 && b >= 64 && b <= 127) problems.push('VPN_ADDRESS');
    else if (a === 169 && b === 254) problems.push('LINK_LOCAL_ADDRESS');
    else if (a === 0) problems.push('LOCALHOST');
  } else if (isIP(host) === 6) {
    if (host === '::1') problems.push('LOCALHOST');
    else if (/^f[cd]/.test(host)) problems.push('PRIVATE_ADDRESS');
    else if (/^fe[89ab]/.test(host)) problems.push('LINK_LOCAL_ADDRESS');
  }
  return problems;
}

/** Explication courte (journaux de démarrage, diagnostic), sans la valeur de l'URL. */
export function describePublicUrlProblems(problems: readonly PublicUrlProblem[]): string {
  const text: Record<PublicUrlProblem, string> = {
    NOT_HTTPS: 'protocole http (https exigé en production)',
    LOCALHOST: 'adresse locale du serveur',
    PRIVATE_ADDRESS: 'adresse de réseau privé, injoignable depuis Internet',
    VPN_ADDRESS: 'adresse de VPN (Tailscale), injoignable par CinetPay',
    LINK_LOCAL_ADDRESS: 'adresse de lien local',
    TEMPORARY_TUNNEL: 'tunnel temporaire (adresse changeante)',
  };
  return problems.map((p) => text[p]).join(', ');
}
