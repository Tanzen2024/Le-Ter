import { Router, type Request } from 'express';

import { createAuthController } from '../controllers/auth.controller';
import { createRateLimiter } from '../middleware/rate-limit';
import { createRequireAuth } from '../middleware/require-auth';
import type { AuthService } from '../services/auth/auth.service';
import type { Logger } from '../utils/logger';

export interface AuthRateLimits {
  /** Inscriptions par IP. */
  register: { windowMs: number; max: number };
  /** Tentatives de connexion par couple IP + email (force brute ciblée). */
  loginPerAccount: { windowMs: number; max: number };
  /** Tentatives de connexion par IP. Large : de nombreux mobiles partagent une IP (CGNAT). */
  loginPerIp: { windowMs: number; max: number };
  refresh: { windowMs: number; max: number };
}

const FIFTEEN_MINUTES = 15 * 60 * 1000;

export const DEFAULT_AUTH_RATE_LIMITS: AuthRateLimits = {
  register: { windowMs: 60 * 60 * 1000, max: 20 },
  loginPerAccount: { windowMs: FIFTEEN_MINUTES, max: 10 },
  loginPerIp: { windowMs: FIFTEEN_MINUTES, max: 100 },
  refresh: { windowMs: FIFTEEN_MINUTES, max: 300 },
};

export function createAuthRouter(
  auth: AuthService,
  logger: Logger,
  limits: AuthRateLimits = DEFAULT_AUTH_RATE_LIMITS,
): Router {
  const router = Router();
  const controller = createAuthController(auth);
  const ip = (req: Request) => req.ip ?? 'unknown';
  const emailOf = (req: Request) => {
    const email: unknown = (req.body as { email?: unknown } | undefined)?.email;
    return typeof email === 'string' ? email.trim().toLowerCase() : '';
  };

  router.post(
    '/register',
    createRateLimiter({ name: 'register', ...limits.register }),
    controller.register,
  );
  router.post(
    '/login',
    createRateLimiter({ name: 'login-ip', ...limits.loginPerIp }),
    createRateLimiter({
      name: 'login-account',
      ...limits.loginPerAccount,
      keyOf: (req) => `${ip(req)}|${emailOf(req)}`,
    }),
    controller.login,
  );
  router.post(
    '/refresh',
    createRateLimiter({ name: 'refresh', ...limits.refresh }),
    controller.refresh,
  );
  router.post('/logout', controller.logout);
  router.get('/me', createRequireAuth(auth, logger), controller.me);

  return router;
}

/** Fonction non configurée sur ce serveur : 503 explicite plutôt qu'un 404 trompeur. */
export function createUnavailableRouter(code: string, message: string): Router {
  const router = Router();
  router.use((_req, res) => {
    res.status(503).json({ error: 'Service Unavailable', code, message });
  });
  return router;
}
