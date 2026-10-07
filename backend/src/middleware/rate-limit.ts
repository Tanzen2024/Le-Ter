import type { NextFunction, Request, RequestHandler, Response } from 'express';

export interface RateLimitOptions {
  /** Nom de la limite (logs, en-têtes). */
  name: string;
  windowMs: number;
  /** Requêtes acceptées par clé et par fenêtre. */
  max: number;
  /** Clé de comptage ; par défaut l'adresse IP. `res.locals.auth` est lisible derrière requireAuth. */
  keyOf?: (req: Request, res: Response) => string;
  clock?: () => number;
}

/**
 * Limitation de débit à fenêtre fixe, en mémoire, par instance du backend.
 *
 * Suffit pour freiner la force brute sur les routes d'authentification d'une
 * instance. Avec plusieurs instances, la limite effective est multipliée par leur
 * nombre : un compteur partagé (Redis) viendra si nécessaire (docs/TODO.md).
 */
export function createRateLimiter(options: RateLimitOptions): RequestHandler {
  const { windowMs, max, keyOf = (req) => req.ip ?? 'unknown' } = options;
  const clock = options.clock ?? Date.now;
  const windows = new Map<string, { count: number; resetAt: number }>();

  return (req: Request, res: Response, next: NextFunction) => {
    const now = clock();
    if (windows.size > 10_000) {
      for (const [key, entry] of windows) {
        if (entry.resetAt <= now) {
          windows.delete(key);
        }
      }
    }
    const key = keyOf(req, res);
    let entry = windows.get(key);
    if (!entry || entry.resetAt <= now) {
      entry = { count: 0, resetAt: now + windowMs };
      windows.set(key, entry);
    }
    entry.count += 1;
    if (entry.count > max) {
      res.setHeader('Retry-After', Math.ceil((entry.resetAt - now) / 1000).toString());
      res.status(429).json({
        error: 'Too Many Requests',
        code: 'RATE_LIMITED',
        message: 'Trop de tentatives. Réessayez plus tard.',
      });
      return;
    }
    next();
  };
}
