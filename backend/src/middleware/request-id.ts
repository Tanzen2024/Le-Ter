import { randomUUID } from 'node:crypto';

import type { NextFunction, Request, Response } from 'express';

/** Identifiant accepté depuis l'appelant (proxy, client) : court, sans caractère spécial. */
const VALID_REQUEST_ID = /^[A-Za-z0-9._-]{1,64}$/;

/**
 * Corrèle les logs d'une requête : reprend `X-Request-Id` s'il est valide, sinon en
 * génère un. Il est renvoyé dans la réponse et disponible dans `res.locals.requestId`.
 */
export function requestId(req: Request, res: Response, next: NextFunction): void {
  const incoming = req.get('x-request-id');
  const id = incoming && VALID_REQUEST_ID.test(incoming) ? incoming : randomUUID();
  res.locals.requestId = id;
  res.setHeader('X-Request-Id', id);
  next();
}

export function getRequestId(res: Response): string | undefined {
  const id: unknown = res.locals.requestId;
  return typeof id === 'string' ? id : undefined;
}
