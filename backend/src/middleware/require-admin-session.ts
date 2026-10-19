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
 * En-tête d'une lecture PASSIVE (D-116) : requête automatique de l'interface (points
 * d'attention, flux d'événements), qui ne compte pas comme une activité de l'administrateur.
 * Il ne peut que raccourcir la session de celui qui l'envoie : jamais d'accès supplémentaire.
 */
export const ADMIN_PASSIVE_HEADER = 'x-admin-passive';

/** Lecture passive : GET avec `X-Admin-Passive: 1` (toute modification reste une activité). */
export function isPassiveRead(req: Request): boolean {
  return req.method === 'GET' && req.get(ADMIN_PASSIVE_HEADER) === '1';
}

/**
 * Exige une session d'administration ouverte et non expirée (8 h absolues, 30 min
 * d'inactivité), APRÈS requireAuth et requireRole('admin'). Un jeton de session mobile,
 * même d'un compte `admin`, est refusé (401 ADMIN_SESSION_REQUIRED). Une lecture passive est
 * contrôlée de la même façon, sans enregistrer d'activité.
 */
export function createRequireAdminSession(
  sessions: AdminSessionService,
  logger: Logger,
): RequestHandler {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      res.locals.adminSession = await sessions.assertActive(getAuth(res), {
        touch: !isPassiveRead(req),
      });
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
