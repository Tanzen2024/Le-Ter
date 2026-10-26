import { describePublicUrlProblems, publicUrlProblems } from './public-url';

/**
 * Environnement de TEST derrière un tunnel LOCAL (ngrok, tunnel Cloudflare nommé ; D-170) :
 * variables imposées pour la session, sans modifier `backend/.env` (les variables du processus
 * l'emportent sur le fichier). Rien d'autre n'est touché : base, Redis, clés CinetPay (sandbox
 * seulement, `readEnv` refuse toute clé `sk_live_` hors production).
 *
 * - `HOST=127.0.0.1` : l'API n'écoute plus que le loopback, où se connecte l'agent du tunnel ;
 *   elle n'est plus joignable directement depuis le réseau local.
 * - `TRUST_PROXY=loopback` : seul ce saut local est de confiance ; l'adresse du joueur est la
 *   dernière valeur de `X-Forwarded-For`, celle que le tunnel ajoute (jamais celles du client).
 * - URL CinetPay (notification, retour, notification des transferts) sur l'URL publique : les
 *   routes et méthodes existantes, inchangées.
 */
export const CINETPAY_CALLBACK_PATHS = {
  CINETPAY_NOTIFY_URL: '/api/payments/cinetpay/notify',
  CINETPAY_RETURN_URL: '/api/payments/cinetpay/return',
  CINETPAY_TRANSFER_NOTIFY_URL: '/api/withdrawals/cinetpay/notify',
} as const;

/** Longueur maximale d'une URL transmise à CinetPay (identifiant de paiement compris). */
const CINETPAY_MAX_URL_LENGTH = 120;
/** Identifiant ajouté à l'URL de retour par la passerelle (`/<uuid>`). */
const RETURN_ID_LENGTH = 37;

export function tunnelEnvironment(publicUrl: string): Record<string, string> {
  let url: URL;
  try {
    url = new URL(publicUrl.trim());
  } catch {
    throw new Error('URL du tunnel invalide : https://<domaine du tunnel> attendu');
  }
  if (url.pathname !== '/' || url.search || url.hash || url.username || url.password) {
    throw new Error('URL du tunnel invalide : origine seule attendue (https://<domaine>), sans chemin');
  }
  const problems = publicUrlProblems(url.origin);
  if (problems.length > 0) {
    throw new Error(`URL du tunnel refusée : ${describePublicUrlProblems(problems)}`);
  }
  const origin = url.origin;
  const callbacks = Object.fromEntries(
    Object.entries(CINETPAY_CALLBACK_PATHS).map(([name, path]) => [name, origin + path]),
  );
  for (const [name, value] of Object.entries(callbacks)) {
    const reserve = name === 'CINETPAY_RETURN_URL' ? RETURN_ID_LENGTH : 0;
    if (value.length + reserve > CINETPAY_MAX_URL_LENGTH) {
      throw new Error(`URL du tunnel trop longue : ${name} dépasserait ${CINETPAY_MAX_URL_LENGTH} caractères`);
    }
  }
  return { HOST: '127.0.0.1', TRUST_PROXY: 'loopback', ...callbacks };
}
