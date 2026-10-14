import { STATUS_CODES } from 'node:http';

import type { ErrorRequestHandler, Request, Response } from 'express';

import type { Logger } from '../utils/logger';
import { toApiError } from './api-errors';
import { getRequestDurationMs, getRequestId } from './request-id';

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
 * - Erreur connue de statut 5xx (base injoignable, fournisseur indisponible…) : la CAUSE
 *   d'origine est journalisée (nom, code `pg` ou système, message) avec la durée de la
 *   requête ; sans elle, un 503 générique masquerait la panne réelle (pool saturé, base
 *   arrêtée, délai dépassé). Le client ne reçoit toujours que le code stable.
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
      logger.warn('request rejected', {
        ...context,
        status: known.status,
        code: known.body.code,
        ...(known.status >= 500 && { durationMs: getRequestDurationMs(res), cause: causeOf(err) }),
      });
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

/**
 * Cause d'une panne, pour les logs : nom, code (`pg` : SQLSTATE, réseau : ECONNREFUSED…) et
 * message, ainsi que ceux de l'erreur enveloppée (`cause`). Les messages de `pg` et du
 * réseau ne contiennent ni mot de passe ni jeton (l'URL de connexion n'y figure jamais).
 */
function causeOf(err: unknown, depth = 0): Record<string, unknown> | undefined {
  if (!(err instanceof Error)) return undefined;
  const { code } = err as { code?: unknown };
  const inner = depth < 2 ? causeOf((err as { cause?: unknown }).cause, depth + 1) : undefined;
  return {
    name: err.name,
    ...((typeof code === 'string' || typeof code === 'number') && { code }),
    message: err.message,
    ...(inner && { cause: inner }),
  };
}
