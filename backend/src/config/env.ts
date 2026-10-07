import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

export type NodeEnv = 'development' | 'test' | 'production';

export interface Env {
  nodeEnv: NodeEnv;
  port: number;
  /** URI MongoDB. Absente = le serveur démarre sans base (phase de fondation). */
  mongodbUri: string | undefined;
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

  const mongodbUri = source.MONGODB_URI?.trim() || undefined;

  return { nodeEnv, port, mongodbUri };
}
