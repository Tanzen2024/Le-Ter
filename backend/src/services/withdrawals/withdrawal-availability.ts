import { CINETPAY_URLS, type CinetPayEnv, type NodeEnv } from '../../config/env';

/**
 * Disponibilité des NOUVEAUX retraits (D-077). Trois états distincts :
 *
 * - `unavailable` : un prérequis manque ; aucune demande n'est acceptée et aucun transfert
 *   n'est envoyé (la relecture des retraits existants continue si CinetPay est configuré) ;
 * - `sandbox` : clé `sk_test_` et activation explicite ; CinetPay simule les transferts, aucun
 *   fonds réel ne circule. Refusé sur un serveur de production ;
 * - `live` : clé `sk_live_`, activation explicite ET attestation des prérequis de production
 *   (`CINETPAY_TRANSFERS_LIVE_CONFIRMED`), serveur de production, notification HTTPS publique.
 *
 * La présence des identifiants CinetPay ne suffit JAMAIS : elle n'autorise que les achats et
 * la relecture des transferts.
 */
export type WithdrawalMode = 'unavailable' | 'sandbox' | 'live';

/** Motif stable d'indisponibilité, transmis au joueur (message générique) et à l'administration. */
export type WithdrawalUnavailableReason =
  /** Aucun identifiant CinetPay : ni achat, ni retrait. */
  | 'PROVIDER_NOT_CONFIGURED'
  /** `CINETPAY_TRANSFERS_ENABLED` absent ou `false`. */
  | 'TRANSFERS_DISABLED'
  /** Clé `sk_live_` sans `CINETPAY_TRANSFERS_LIVE_CONFIRMED=true`. */
  | 'LIVE_NOT_CONFIRMED'
  /** Clé `sk_live_` sur un serveur qui n'est pas en `NODE_ENV=production`. */
  | 'LIVE_OUTSIDE_PRODUCTION'
  /** Clé `sk_test_` sur un serveur de production : des jetons réels partiraient vers un transfert simulé. */
  | 'SANDBOX_IN_PRODUCTION'
  /** `CINETPAY_BASE_URL` désigne l'environnement CinetPay opposé à celui de la clé. */
  | 'ENVIRONMENT_MISMATCH'
  /** URL de notification des transferts non HTTPS ou non publique (fonds réels). */
  | 'NOTIFY_URL_NOT_PUBLIC'
  /** Migrations des retraits non appliquées (`npm run db:migrate`). */
  | 'SCHEMA_OUTDATED';

/** Avertissements d'exploitation non bloquants (journalisés, montrés à l'administration). */
export type WithdrawalAvailabilityWarning =
  /** Notification non HTTPS ou locale : CinetPay ne pourra pas la joindre (réconciliation seule). */
  'TRANSFER_NOTIFY_URL_NOT_PUBLIC';

export interface WithdrawalAvailability {
  mode: WithdrawalMode;
  reason?: WithdrawalUnavailableReason;
  warnings: WithdrawalAvailabilityWarning[];
}

/** Migrations sans lesquelles les retraits ne fonctionnent pas (D-075, D-076). */
export const WITHDRAWAL_MIGRATIONS = [
  '0031_withdrawals.sql',
  '0032_withdrawal_refund_reviews.sql',
] as const;

const unavailable = (
  reason: WithdrawalUnavailableReason,
  warnings: WithdrawalAvailabilityWarning[] = [],
): WithdrawalAvailability => ({ mode: 'unavailable', reason, warnings });

/** Vrai si CinetPay peut joindre l'URL : HTTPS et hôte qui n'est ni local ni privé. */
export function isPublicHttpsUrl(url: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  if (parsed.protocol !== 'https:') return false;
  const host = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local')) return false;
  if (host.includes(':')) {
    // IPv6 : boucle locale, adresses uniques locales (fc00::/7), lien local (fe80::/10).
    return !(host === '::1' || /^f[cd]/.test(host) || /^fe[89ab]/.test(host));
  }
  const ipv4 = /^(\d{1,3})\.(\d{1,3})\.\d{1,3}\.\d{1,3}$/.exec(host);
  if (ipv4) {
    const [a, b] = [Number(ipv4[1]), Number(ipv4[2])];
    if (a === 10 || a === 127 || a === 0) return false;
    if (a === 169 && b === 254) return false;
    if (a === 172 && b >= 16 && b <= 31) return false;
    if (a === 192 && b === 168) return false;
  }
  return true;
}

/**
 * Décide l'état des nouveaux retraits à partir de la configuration chargée au démarrage.
 * Fonction pure : ne contacte pas CinetPay (le solde marchand et l'activation du transfert
 * chez CinetPay ne sont pas vérifiables sans transfert ; l'exploitant les atteste).
 */
export function resolveWithdrawalAvailability(input: {
  nodeEnv: NodeEnv;
  cinetpay: CinetPayEnv | undefined;
  /** Migrations des retraits appliquées (`WITHDRAWAL_MIGRATIONS`). */
  schemaReady: boolean;
}): WithdrawalAvailability {
  const { nodeEnv, cinetpay, schemaReady } = input;
  if (!cinetpay) return unavailable('PROVIDER_NOT_CONFIGURED');
  const transfers = cinetpay.transfers;
  if (!transfers) return unavailable('TRANSFERS_DISABLED');

  const warnings: WithdrawalAvailabilityWarning[] = isPublicHttpsUrl(transfers.notifyUrl)
    ? []
    : ['TRANSFER_NOTIFY_URL_NOT_PUBLIC'];
  const other = cinetpay.environment === 'live' ? CINETPAY_URLS.test : CINETPAY_URLS.live;
  if (new URL(cinetpay.baseUrl).origin === new URL(other).origin) {
    return unavailable('ENVIRONMENT_MISMATCH', warnings);
  }
  if (!schemaReady) return unavailable('SCHEMA_OUTDATED', warnings);

  if (cinetpay.environment === 'test') {
    return nodeEnv === 'production'
      ? unavailable('SANDBOX_IN_PRODUCTION', warnings)
      : { mode: 'sandbox', warnings };
  }
  // Fonds réels : chaque prérequis vérifiable est exigé, en plus de l'attestation explicite.
  if (nodeEnv !== 'production') return unavailable('LIVE_OUTSIDE_PRODUCTION', warnings);
  if (!transfers.liveConfirmed) return unavailable('LIVE_NOT_CONFIRMED', warnings);
  if (warnings.length > 0) return unavailable('NOTIFY_URL_NOT_PUBLIC', warnings);
  return { mode: 'live', warnings };
}
