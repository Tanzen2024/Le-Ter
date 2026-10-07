import type { Request, Response } from 'express';

import { getDatabaseStatus } from '../config/database';
import { getRedisStatus } from '../config/redis';

/**
 * Vivacité du processus et état des dépendances. Une panne Redis ne rend pas
 * l'API indisponible : elle n'affecte que la diffusion inter-instances (D-024).
 */
export async function getHealth(_req: Request, res: Response): Promise<void> {
  res.json({ status: 'ok', database: await getDatabaseStatus(), redis: getRedisStatus() });
}
