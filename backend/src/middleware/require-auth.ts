import type { NextFunction, Request, RequestHandler, Response } from 'express';

import type { AuthContext, AuthService } from '../services/auth/auth.service';
import { AuthenticationRequiredError } from '../services/auth/auth-errors';
import type { Logger } from '../utils/logger';
import { getRequestId } from './request-id';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Locals {
      /** Identité authentifiée, posée par requireAuth à partir du JWT vérifié. */
      auth?: AuthContext;
    }
  }
}

const BEARER = /^Bearer ([A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)$/;

/**
 * Exige un access token valide : `Authorization: Bearer <jwt>`, signature, expiration,
 * `sub` (UUID), session encore active et compte actif. L'identité est ensuite lue par
 * `getAuth(res)`. Aucune identité par défaut n'existe : sans jeton, 401 (R-10).
 */
export function createRequireAuth(auth: AuthService, logger: Logger): RequestHandler {
  return async (req: Request, res: Response, next: NextFunction) => {
    // Déjà authentifiée plus haut dans la même requête (garde /api/admin puis routeur) :
    // `res.locals.auth` n'est posé que par ce middleware, jamais par le client.
    if (res.locals.auth) {
      next();
      return;
    }
    const match = BEARER.exec(req.get('authorization') ?? '');
    try {
      if (!match?.[1]) {
        throw new AuthenticationRequiredError(
          req.get('authorization') ? 'malformed_header' : 'missing_header',
        );
      }
      res.locals.auth = await auth.authenticate(match[1]);
      next();
    } catch (err) {
      if (err instanceof AuthenticationRequiredError) {
        // Ni le jeton ni l'en-tête ne sont journalisés.
        logger.warn('auth rejected', {
          requestId: getRequestId(res),
          method: req.method,
          path: req.path,
          reason: err.reason,
        });
      }
      next(err);
    }
  };
}

/** Identité de la requête courante. Ne s'utilise que derrière requireAuth. */
export function getAuth(res: Response): AuthContext {
  const { auth } = res.locals;
  if (!auth) {
    throw new Error('getAuth appelé sans requireAuth');
  }
  return auth;
}
