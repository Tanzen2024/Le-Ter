import { Router, type Request } from 'express';

import { createAuthController } from '../controllers/auth.controller';
import { createRateLimiter } from '../middleware/rate-limit';
import { createRequireAuth, getAuth } from '../middleware/require-auth';
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
  /** Changements de mot de passe par utilisateur authentifié (essais du mot de passe actuel). */
  passwordChange?: { windowMs: number; max: number };
  /**
   * Récupération par code (D-135), en plus du blocage EN BASE du compte après 5 codes faux :
   * essais par IP, et par numéro (toutes IP confondues sur cette instance).
   */
  recoveryPerIp?: { windowMs: number; max: number };
  recoveryPerPhone?: { windowMs: number; max: number };
  /** Réinitialisations et nouveaux codes du Profil. */
  recoveryReset?: { windowMs: number; max: number };
}

const FIFTEEN_MINUTES = 15 * 60 * 1000;

export const DEFAULT_AUTH_RATE_LIMITS: AuthRateLimits = {
  register: { windowMs: 60 * 60 * 1000, max: 20 },
  loginPerAccount: { windowMs: FIFTEEN_MINUTES, max: 10 },
  loginPerIp: { windowMs: FIFTEEN_MINUTES, max: 100 },
  refresh: { windowMs: FIFTEEN_MINUTES, max: 300 },
  passwordChange: { windowMs: FIFTEEN_MINUTES, max: 10 },
  recoveryPerIp: { windowMs: FIFTEEN_MINUTES, max: 30 },
  recoveryPerPhone: { windowMs: FIFTEEN_MINUTES, max: 10 },
  recoveryReset: { windowMs: FIFTEEN_MINUTES, max: 10 },
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
  // Clé grossière du numéro (chiffres seulement) : suffit à regrouper les essais sur un compte.
  const phoneOf = (req: Request) => {
    const phone: unknown = (req.body as { phone?: unknown } | undefined)?.phone;
    return typeof phone === 'string' ? phone.replace(/\D/g, '') : '';
  };
  const recoveryReset = limits.recoveryReset ?? DEFAULT_AUTH_RATE_LIMITS.recoveryReset!;

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
      // Email ou téléphone (D-135) : chaque identifiant a son propre compteur.
      keyOf: (req) => `${ip(req)}|${emailOf(req) || phoneOf(req)}`,
    }),
    controller.login,
  );
  router.post(
    '/recovery/verify',
    createRateLimiter({
      name: 'recovery-ip',
      ...(limits.recoveryPerIp ?? DEFAULT_AUTH_RATE_LIMITS.recoveryPerIp!),
    }),
    createRateLimiter({
      name: 'recovery-phone',
      ...(limits.recoveryPerPhone ?? DEFAULT_AUTH_RATE_LIMITS.recoveryPerPhone!),
      // Téléphone ou email (D-142), dans l'ordre du validateur (le téléphone l'emporte) :
      // ajouter un email inventé ne donne jamais un nouveau compteur au même numéro.
      keyOf: (req) => phoneOf(req) || emailOf(req),
    }),
    controller.verifyRecovery,
  );
  router.post(
    '/recovery/reset',
    createRateLimiter({ name: 'recovery-reset', ...recoveryReset }),
    controller.resetPassword,
  );
  router.post(
    '/recovery-code',
    createRequireAuth(auth, logger),
    createRateLimiter({
      name: 'recovery-code',
      ...recoveryReset,
      keyOf: (_req, res) => getAuth(res).userId,
    }),
    controller.regenerateRecoveryCode,
  );
  router.post(
    '/refresh',
    createRateLimiter({ name: 'refresh', ...limits.refresh }),
    controller.refresh,
  );
  router.post('/logout', controller.logout);
  router.get('/me', createRequireAuth(auth, logger), controller.me);
  router.post(
    '/password',
    createRequireAuth(auth, logger),
    createRateLimiter({
      name: 'password-change',
      ...(limits.passwordChange ?? DEFAULT_AUTH_RATE_LIMITS.passwordChange!),
      keyOf: (_req, res) => getAuth(res).userId,
    }),
    controller.changePassword,
  );

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
