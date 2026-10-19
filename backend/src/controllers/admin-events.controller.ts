import type { Request, Response } from 'express';

import { toApiError } from '../middleware/api-errors';
import { getRequestId } from '../middleware/request-id';
import { getAuth } from '../middleware/require-auth';
import type { AdminSessionService } from '../services/admin/admin-session.service';
import type { AuthService } from '../services/auth/auth.service';
import type { Logger } from '../utils/logger';
import type { AdminEventSubscriber } from '../websocket/admin-event-bus';

const BEARER = /^Bearer (\S+)$/;
const DEFAULT_HEARTBEAT_MS = 25_000;
const DEFAULT_RECHECK_MS = 60_000;
/** Délai de reconnexion suggéré au navigateur (EventSource). */
const RETRY_MS = 5_000;

/**
 * Flux ouverts d'UNE application (arrêt du serveur) : `closeAll` les termine pour que
 * `server.close()` n'attende pas l'arrêt forcé ; les navigateurs se reconnectent ailleurs.
 */
export class AdminEventStreams {
  private readonly open = new Set<(code: string) => void>();

  add(close: (code: string) => void): () => void {
    this.open.add(close);
    return () => {
      this.open.delete(close);
    };
  }

  closeAll(code = 'SERVER_SHUTDOWN'): void {
    for (const close of [...this.open]) close(code);
  }

  get size(): number {
    return this.open.size;
  }
}

export interface AdminEventsOptions {
  auth: AuthService;
  sessions: AdminSessionService;
  events: AdminEventSubscriber;
  logger: Logger;
  /** Commentaire de vie (proxys, coupures silencieuses). */
  heartbeatMs?: number;
  /** Revérification du jeton et de la session d'administration (lecture passive). */
  recheckMs?: number;
  /** Registre des flux ouverts, fermés à l'arrêt du serveur. */
  streams?: AdminEventStreams;
}

/**
 * Flux Server-Sent Events de l'administration (D-116), derrière la garde commune de
 * /api/admin/* (jeton, rôle admin, session d'administration) :
 *
 *   event: ready      data: {}                         flux ouvert (le client relit ses compteurs)
 *   event: attention  data: { source }                 un point d'attention a changé
 *   event: end        data: { code }                   flux fermé (jeton expiré, session close…)
 *
 * Aucune donnée métier n'est transmise : le client relit `GET /api/admin/attention`. Le flux
 * n'enregistre jamais d'activité (session contrôlée en lecture passive) : un onglet ouvert
 * n'empêche pas l'expiration après 30 min d'inactivité. Jeton et session sont revérifiés
 * périodiquement ; à l'échec, le flux se ferme et le client se reconnecte (le relais Next.js
 * renouvelle alors l'access token) ou retourne à la connexion.
 */
export function createAdminEventsHandler(options: AdminEventsOptions) {
  const heartbeatMs = options.heartbeatMs ?? DEFAULT_HEARTBEAT_MS;
  const recheckMs = options.recheckMs ?? DEFAULT_RECHECK_MS;

  return (req: Request, res: Response): void => {
    const token = BEARER.exec(req.get('authorization') ?? '')?.[1];
    const requestId = getRequestId(res);
    res.status(200);
    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Connection', 'keep-alive');
    // Pas de mise en mémoire tampon par un proxy (nginx).
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders();

    let closed = false;
    const send = (event: string, data: unknown) => {
      if (!closed) res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    };

    const unsubscribe = options.events.subscribe((event) =>
      send('attention', { source: event.source }),
    );
    const heartbeat = setInterval(() => {
      if (!closed) res.write(': ping\n\n');
    }, heartbeatMs);
    const recheck = setInterval(() => {
      void verify();
    }, recheckMs);

    let unregister = () => {};
    const close = (code?: string) => {
      if (closed) return;
      if (code) send('end', { code });
      closed = true;
      clearInterval(heartbeat);
      clearInterval(recheck);
      unsubscribe();
      unregister();
      res.end();
    };
    if (options.streams) unregister = options.streams.add(close);

    async function verify(): Promise<void> {
      try {
        if (!token) throw new Error('missing token');
        const auth = await options.auth.authenticate(token);
        if (auth.userId !== getAuth(res).userId || auth.sessionId !== getAuth(res).sessionId) {
          close('ADMIN_SESSION_REQUIRED');
          return;
        }
        await options.sessions.assertActive(auth, { touch: false });
      } catch (err) {
        const code = toApiError(err)?.body.code ?? 'UNAVAILABLE';
        if (code === 'UNAVAILABLE') {
          options.logger.warn('admin event stream recheck failed', {
            requestId,
            error: err instanceof Error ? err.message : String(err),
          });
        }
        close(code);
      }
    }

    // Navigateur parti, relais coupé : on libère l'abonnement et les minuteurs.
    res.on('close', () => close());
    res.write(`retry: ${RETRY_MS}\n\n`);
    send('ready', {});
  };
}
