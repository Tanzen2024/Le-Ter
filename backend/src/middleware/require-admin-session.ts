import type { NextFunction, Request, RequestHandler, Response } from 'express';

import type { AdminSession } from '../domain/admin/admin';
import type { AdminSessionService } from '../services/admin/admin-session.service';
import type { Logger } from '../utils/logger';
import { getRequestId } from './request-id';
import { getAuth } from './require-auth';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Locals {
      /** Session d'administration active, posée par requireAdminSession. */
      adminSession?: AdminSession;
    }
  }
}

/**
 * Exige une session d'administration ouverte et non expirée (8 h absolues, 30 min
 * d'inactivité), APRÈS requireAuth et requireRole('admin'). Un jeton de session mobile,
 * même d'un compte `admin`, est refusé (401 ADMIN_SESSION_REQUIRED).
 */
export function createRequireAdminSession(
  sessions: AdminSessionService,
  logger: Logger,
): RequestHandler {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      res.locals.adminSession = await sessions.assertActive(getAuth(res));
      next();
    } catch (err) {
      logger.warn('admin session rejected', {
        requestId: getRequestId(res),
        method: req.method,
        path: req.path,
        errorName: err instanceof Error ? err.name : typeof err,
      });
      next(err);
    }
  };
}

export function getAdminSession(res: Response): AdminSession {
  const session = res.locals.adminSession;
  if (!session) throw new Error('getAdminSession appelé sans requireAdminSession');
  return session;
}
