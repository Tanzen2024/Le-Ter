import type { NextFunction, Request, RequestHandler, Response } from 'express';

import type { UserRole } from '../domain/users/user';
import type { Logger } from '../utils/logger';
import { getRequestId } from './request-id';
import { getAuth } from './require-auth';

/** Compte authentifié, mais sans le rôle requis (403). */
export class AccessForbiddenError extends Error {
  constructor(readonly requiredRole: UserRole) {
    super(`Rôle requis : ${requiredRole}`);
    this.name = 'AccessForbiddenError';
  }
}

/**
 * Exige un rôle, lu dans la session SERVEUR (`getAuth(res).role`, relu en base à chaque
 * requête par requireAuth) : jamais un en-tête, un paramètre ou un corps envoyé par le
 * client. À placer APRÈS requireAuth (401 sans jeton, puis 403 sans le rôle).
 */
export function createRequireRole(role: UserRole, logger: Logger): RequestHandler {
  return (req: Request, res: Response, next: NextFunction) => {
    const auth = getAuth(res);
    if (auth.role !== role) {
      logger.warn('role required', {
        requestId: getRequestId(res),
        method: req.method,
        path: req.path,
        userId: auth.userId,
        requiredRole: role,
      });
      next(new AccessForbiddenError(role));
      return;
    }
    next();
  };
}
