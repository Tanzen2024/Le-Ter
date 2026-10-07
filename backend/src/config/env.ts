import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

export type NodeEnv = 'development' | 'test' | 'production';

export interface Env {
  nodeEnv: NodeEnv;
  port: number;
  /** URL PostgreSQL (source de vérité). Absente = démarrage sans base (phase de fondation). */
  databaseUrl: string | undefined;
  /** URL Redis (temps réel, coordination). Absente = diffusion limitée à une instance. */
  redisUrl: string | undefined;
}

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

  return { nodeEnv, port, databaseUrl, redisUrl };
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
