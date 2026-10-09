import { createHash } from 'node:crypto';

import type { NextFunction, Request, RequestHandler, Response } from 'express';
import type { RedisClientType } from 'redis';

import type { Logger } from '../utils/logger';

/** Compteur à fenêtre fixe : nombre de requêtes de la fenêtre et fin de la fenêtre. */
export interface RateLimitStore {
  readonly kind: 'redis' | 'memory';
  hit(key: string, windowMs: number): Promise<{ count: number; resetAt: number }>;
}

/** Compteur local à l'instance (même algorithme que `createRateLimiter`). */
export class MemoryRateLimitStore implements RateLimitStore {
  readonly kind = 'memory';
  private readonly windows = new Map<string, { count: number; resetAt: number }>();

  constructor(private readonly clock: () => number = Date.now) {}

  hit(key: string, windowMs: number): Promise<{ count: number; resetAt: number }> {
    const now = this.clock();
    if (this.windows.size > 10_000) {
      for (const [k, entry] of this.windows) if (entry.resetAt <= now) this.windows.delete(k);
    }
    let entry = this.windows.get(key);
    if (!entry || entry.resetAt <= now) {
      entry = { count: 0, resetAt: now + windowMs };
      this.windows.set(key, entry);
    }
    entry.count += 1;
    return Promise.resolve({ count: entry.count, resetAt: entry.resetAt });
  }
}

/** Incrémente un compteur Redis : `[valeur, durée de vie restante en ms]`. */
export type RedisCounter = (key: string, windowMs: number) => Promise<[number, number]>;

/** Compteur sur le client `redis` : `INCR`, `PEXPIRE … NX`, `PTTL` en une transaction MULTI. */
export function redisCounter(client: RedisClientType): RedisCounter {
  return async (key, windowMs) => {
    const replies = await client.multi().incr(key).pExpire(key, windowMs, 'NX').pTTL(key).exec();
    return [Number(replies[0]), Number(replies[2])];
  };
}

/**
 * Compteur partagé entre instances (Redis, D-024 : infrastructure volatile). La fenêtre
 * commence au premier essai (`PEXPIRE … NX`).
 */
export class RedisRateLimitStore implements RateLimitStore {
  readonly kind = 'redis';

  constructor(
    private readonly counter: RedisCounter,
    private readonly clock: () => number = Date.now,
  ) {}

  async hit(key: string, windowMs: number): Promise<{ count: number; resetAt: number }> {
    const [count, ttl] = await this.counter(key, windowMs);
    if (!Number.isFinite(count) || count < 1) throw new Error('Réponse Redis inattendue');
    return { count, resetAt: this.clock() + (ttl > 0 ? ttl : windowMs) };
  }
}

/**
 * Redis d'abord ; s'il échoue (coupure, réponse invalide), repli CONTRÔLÉ sur un compteur
 * local : la limite reste appliquée (par instance) et la panne est journalisée. Une panne
 * Redis ne bloque donc jamais la connexion et ne supprime jamais la limitation.
 */
export class FallbackRateLimitStore implements RateLimitStore {
  readonly kind = 'redis';

  constructor(
    private readonly primary: RateLimitStore,
    private readonly fallback: RateLimitStore,
    private readonly logger: Logger,
  ) {}

  async hit(key: string, windowMs: number) {
    try {
      return await this.primary.hit(key, windowMs);
    } catch (err) {
      this.logger.warn('rate limit store unavailable, local fallback', {
        errorName: err instanceof Error ? err.name : typeof err,
      });
      return this.fallback.hit(key, windowMs);
    }
  }
}

export interface SharedRateLimitOptions {
  name: string;
  windowMs: number;
  max: number;
  store: RateLimitStore;
  /** Clé de comptage (ne doit contenir aucune donnée personnelle en clair : voir `hashKey`). */
  keyOf: (req: Request) => string;
}

/** Empreinte courte d'une valeur personnelle (email) pour une clé de compteur. */
export function hashKey(value: string): string {
  return createHash('sha256').update(value).digest('hex').slice(0, 32);
}

/** Limitation de débit à fenêtre fixe sur un compteur éventuellement partagé. */
export function createSharedRateLimiter(options: SharedRateLimitOptions): RequestHandler {
  const { name, windowMs, max, store, keyOf } = options;
  return async (req: Request, res: Response, next: NextFunction) => {
    const { count, resetAt } = await store.hit(`le-ter:rl:${name}:${keyOf(req)}`, windowMs);
    if (count > max) {
      res.setHeader(
        'Retry-After',
        Math.max(1, Math.ceil((resetAt - Date.now()) / 1000)).toString(),
      );
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
