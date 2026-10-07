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

  return { nodeEnv, port, databaseUrl, redisUrl, auth };
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
