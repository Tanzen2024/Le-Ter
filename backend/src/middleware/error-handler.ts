import { STATUS_CODES } from 'node:http';

import type { ErrorRequestHandler, Request, Response } from 'express';

import type { Logger } from '../utils/logger';
import { toApiError } from './api-errors';
import { getRequestId } from './request-id';

export function notFoundHandler(_req: Request, res: Response): void {
  res.status(404).json({ error: 'Not Found' });
}

/**
 * Dernier gestionnaire d'erreurs. Le client ne reçoit jamais de message interne :
 * seulement le statut et, pour une panne, le `requestId` à communiquer au support.
 *
 * - Erreur client signalée par Express ou body-parser (JSON mal formé, corps trop
 *   volumineux) : son statut 4xx est conservé, journalisée en `warn`.
 * - Toute autre erreur : 500, journalisée en `error`. Le corps et les en-têtes de la
 *   requête ne sont jamais journalisés (ils peuvent contenir un token ou une carte).
 *
 * - Erreur applicative connue (validation, authentification) : statut, `code` stable
 *   et message destiné à l'utilisateur (`toApiError`).
 *
 * Les erreurs du domaine de jeu (partie introuvable, accès refusé, conflit de version…)
 * seront traduites avec les routes de partie (multi-game-architecture.md §7).
 */
export function createErrorHandler(logger: Logger): ErrorRequestHandler {
  return (err: unknown, req, res, next) => {
    if (res.headersSent) {
      next(err);
      return;
    }
    const context = {
      requestId: getRequestId(res),
      method: req.method,
      path: req.path,
      errorName: err instanceof Error ? err.name : typeof err,
    };

    const known = toApiError(err);
    if (known) {
      logger.warn('request rejected', { ...context, status: known.status, code: known.body.code });
      if (known.status === 401) {
        // Ni token ni en-tête Authorization ne sont journalisés.
        res.setHeader('WWW-Authenticate', 'Bearer');
      }
      res.status(known.status).json(known.body);
      return;
    }

    const status = clientErrorStatus(err);
    if (status !== undefined) {
      logger.warn('request rejected', { ...context, status });
      res.status(status).json({ error: STATUS_CODES[status] ?? 'Bad Request' });
      return;
    }

    logger.error('request failed', {
      ...context,
      error: err instanceof Error ? err.message : String(err),
      stack: err instanceof Error ? err.stack : undefined,
    });
    res.status(500).json({ error: 'Internal Server Error', requestId: context.requestId });
  };
}

/** Statut 4xx porté par une erreur HTTP d'Express / body-parser (`status` ou `statusCode`). */
function clientErrorStatus(err: unknown): number | undefined {
  if (typeof err !== 'object' || err === null) {
    return undefined;
  }
  const { status, statusCode } = err as { status?: unknown; statusCode?: unknown };
  const value = typeof status === 'number' ? status : statusCode;
  return typeof value === 'number' && value >= 400 && value < 500 ? value : undefined;
}
