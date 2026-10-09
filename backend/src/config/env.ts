import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

export type NodeEnv = 'development' | 'test' | 'production';

export interface Env {
  nodeEnv: NodeEnv;
  port: number;
  /** URL PostgreSQL (source de vérité). Absente = démarrage sans base, refusé en production. */
  databaseUrl: string | undefined;
  /** URL Redis (temps réel, coordination). Absente = diffusion limitée à une instance. */
  redisUrl: string | undefined;
  auth: AuthEnv;
  /** Paiements CinetPay (D-050). Absent = aucun fournisseur : achats refusés proprement. */
  cinetpay: CinetPayEnv | undefined;
  /**
   * Proxys de confiance (`TRUST_PROXY`, Express `trust proxy`). Absent par défaut : `req.ip`
   * est l'adresse du pair TCP et `X-Forwarded-For` est ignoré.
   */
  trustProxy: number | string | undefined;
}

export interface CinetPayEnv {
  /** Clé API v1 (`sk_test_…` sandbox, `sk_live_…` production). Jamais journalisée. */
  apiKey: string;
  /** Mot de passe API v1. Jamais journalisé. */
  apiPassword: string;
  /** https://api.cinetpay.net (sandbox) ou https://api.cinetpay.co (production). */
  baseUrl: string;
  /** URL publique de POST /api/payments/cinetpay/notify (≤ 120 caractères). */
  notifyUrl: string;
  /** URL publique de GET /api/payments/cinetpay/return (l'identifiant y est ajouté). */
  returnUrl: string;
  /** Lien de retour dans l'application (défaut leter://payment/return). */
  appReturnUrl: string;
  timeoutMs: number;
}

export interface AuthEnv {
  /** Secret de signature des access tokens. Absent = authentification désactivée (refusé en production). */
  jwtSecret: string | undefined;
  /** Durée de vie d'un access token (JWT_ACCESS_TOKEN_EXPIRES_IN, défaut 15m). */
  accessTokenTtlSeconds: number;
  /** Durée de vie d'un refresh token, renouvelée à chaque rotation (REFRESH_TOKEN_EXPIRES_IN, défaut 30d). */
  refreshTokenTtlSeconds: number;
}

const MIN_JWT_SECRET_LENGTH = 32;

const NODE_ENVS: readonly NodeEnv[] = ['development', 'test', 'production'];

/**
 * Charge backend/.env dans process.env s'il existe.
 * Utilise le chargeur natif de Node (>= 20.12), sans dépendance dotenv.
 */
export function loadEnvFile(path = resolve(process.cwd(), '.env')): void {
  if (existsSync(path)) {
    process.loadEnvFile(path);
  }
}

export function readEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const nodeEnv = (source.NODE_ENV ?? 'development') as NodeEnv;
  if (!NODE_ENVS.includes(nodeEnv)) {
    throw new Error(`NODE_ENV invalide : "${source.NODE_ENV}"`);
  }

  const port = Number(source.PORT ?? 3000);
  if (!Number.isInteger(port) || port <= 0 || port > 65535) {
    throw new Error(`PORT invalide : "${source.PORT}"`);
  }

  const databaseUrl = optionalUrl(source.DATABASE_URL, 'DATABASE_URL', [
    'postgres:',
    'postgresql:',
  ]);
  const redisUrl = optionalUrl(source.REDIS_URL, 'REDIS_URL', ['redis:', 'rediss:']);

  // Démarrer sans base n'a de sens qu'en développement : en production, une API
  // sans source de vérité accepterait des requêtes qu'elle ne peut pas servir.
  if (nodeEnv === 'production' && !databaseUrl) {
    throw new Error('DATABASE_URL requis en production');
  }

  // Aucun secret par défaut : sans JWT_SECRET, l'authentification est désactivée.
  const jwtSecret = source.JWT_SECRET?.trim() || undefined;
  if (nodeEnv === 'production' && !jwtSecret) {
    throw new Error('JWT_SECRET requis en production');
  }
  if (jwtSecret && jwtSecret.length < MIN_JWT_SECRET_LENGTH) {
    // Ne jamais recopier le secret dans l'erreur.
    throw new Error(`JWT_SECRET invalide : ${MIN_JWT_SECRET_LENGTH} caractères minimum`);
  }
  const auth: AuthEnv = {
    jwtSecret,
    accessTokenTtlSeconds: duration(
      source.JWT_ACCESS_TOKEN_EXPIRES_IN,
      '15m',
      'JWT_ACCESS_TOKEN_EXPIRES_IN',
    ),
    refreshTokenTtlSeconds: duration(
      source.REFRESH_TOKEN_EXPIRES_IN,
      '30d',
      'REFRESH_TOKEN_EXPIRES_IN',
    ),
  };

  return {
    nodeEnv,
    port,
    databaseUrl,
    redisUrl,
    auth,
    cinetpay: readCinetPayEnv(source, nodeEnv),
    trustProxy: readTrustProxy(source.TRUST_PROXY),
  };
}

const TRUST_PROXY_NAMES = ['loopback', 'linklocal', 'uniquelocal'];
const IP_OR_CIDR = /^[0-9a-fA-F:.]+(\/\d{1,3})?$/;

/**
 * `TRUST_PROXY` : vide ou `false` = aucun proxy de confiance (défaut). Sinon un nombre de
 * sauts (1 à 10), `loopback` / `linklocal` / `uniquelocal`, ou des adresses / CIDR séparés par
 * des virgules. `true` (faire confiance à tout le monde) est refusé : il rendrait l'adresse
 * du client falsifiable et contournerait la limitation par IP.
 */
export function readTrustProxy(value: string | undefined): number | string | undefined {
  const raw = value?.trim();
  if (!raw || raw === 'false') return undefined;
  if (/^\d+$/.test(raw)) {
    const hops = Number(raw);
    if (hops < 1 || hops > 10)
      throw new Error('TRUST_PROXY invalide : nombre de sauts entre 1 et 10');
    return hops;
  }
  const parts = raw.split(',').map((p) => p.trim());
  if (parts.every((p) => TRUST_PROXY_NAMES.includes(p) || IP_OR_CIDR.test(p)))
    return parts.join(',');
  throw new Error(
    'TRUST_PROXY invalide : sauts, loopback, linklocal, uniquelocal ou adresses IP / CIDR',
  );
}

const CINETPAY_URLS = { test: 'https://api.cinetpay.net', live: 'https://api.cinetpay.co' };

/**
 * Configuration CinetPay v1. Clé et mot de passe vont ensemble ; sans eux, CinetPay est
 * désactivé. Les erreurs ne recopient JAMAIS une valeur (secrets, URL).
 */
function readCinetPayEnv(source: NodeJS.ProcessEnv, nodeEnv: NodeEnv): CinetPayEnv | undefined {
  const apiKey = source.CINETPAY_API_KEY?.trim() || undefined;
  const apiPassword = source.CINETPAY_API_PASSWORD?.trim() || undefined;
  if (!apiKey && !apiPassword) return undefined;
  if (!apiKey || !apiPassword) {
    throw new Error('CINETPAY_API_KEY et CINETPAY_API_PASSWORD doivent être définis ensemble');
  }
  const environment = apiKey.startsWith('sk_live_')
    ? 'live'
    : apiKey.startsWith('sk_test_')
      ? 'test'
      : undefined;
  if (!environment) {
    throw new Error('CINETPAY_API_KEY invalide : préfixe sk_test_ ou sk_live_ attendu');
  }
  const baseUrl =
    optionalUrl(source.CINETPAY_BASE_URL, 'CINETPAY_BASE_URL', ['https:']) ??
    CINETPAY_URLS[environment];
  const publicProtocols = nodeEnv === 'production' ? ['https:'] : ['https:', 'http:'];
  const notifyUrl = optionalUrl(source.CINETPAY_NOTIFY_URL, 'CINETPAY_NOTIFY_URL', publicProtocols);
  const returnUrl = optionalUrl(source.CINETPAY_RETURN_URL, 'CINETPAY_RETURN_URL', publicProtocols);
  if (!notifyUrl || !returnUrl) {
    throw new Error('CINETPAY_NOTIFY_URL et CINETPAY_RETURN_URL sont requis avec CinetPay');
  }
  const appReturnUrl = source.CINETPAY_APP_RETURN_URL?.trim() || 'leter://payment/return';
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(appReturnUrl)) {
    throw new Error('CINETPAY_APP_RETURN_URL invalide : URL attendue (ex. leter://payment/return)');
  }
  const timeoutMs = Number(source.CINETPAY_TIMEOUT_MS ?? 15_000);
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1_000 || timeoutMs > 60_000) {
    throw new Error('CINETPAY_TIMEOUT_MS invalide : entier entre 1000 et 60000');
  }
  return { apiKey, apiPassword, baseUrl, notifyUrl, returnUrl, appReturnUrl, timeoutMs };
}

const DURATION_UNITS: Record<string, number> = { s: 1, m: 60, h: 3600, d: 86_400 };

/** Durée « <entier><s|m|h|d> » (ex. 15m, 30d), en secondes. */
function duration(value: string | undefined, fallback: string, name: string): number {
  const raw = value?.trim() || fallback;
  const match = /^(\d+)([smhd])$/.exec(raw);
  const seconds = match ? Number(match[1]) * (DURATION_UNITS[match[2] as string] ?? 0) : 0;
  if (!Number.isSafeInteger(seconds) || seconds <= 0) {
    throw new Error(`${name} invalide : "${raw}" (format attendu : 15m, 12h, 30d…)`);
  }
  return seconds;
}

function optionalUrl(
  value: string | undefined,
  name: string,
  protocols: readonly string[],
): string | undefined {
  const trimmed = value?.trim();
  if (!trimmed) {
    return undefined;
  }
  let protocol: string;
  try {
    protocol = new URL(trimmed).protocol;
  } catch {
    // Ne jamais recopier la valeur : elle peut contenir un mot de passe.
    throw new Error(`${name} invalide : URL mal formée`);
  }
  if (!protocols.includes(protocol)) {
    throw new Error(`${name} invalide : protocole attendu ${protocols.join(' ou ')}`);
  }
  return trimmed;
}
