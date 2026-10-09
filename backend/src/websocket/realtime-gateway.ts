import type { IncomingMessage, Server as HttpServer } from 'node:http';
import type { Duplex } from 'node:stream';

import jwt from 'jsonwebtoken';
import { WebSocket, WebSocketServer, type RawData } from 'ws';

import { toChatMessageJson } from '../domain/chat/chat';
import { isGameId, type GameId } from '../domain/game/game-id';
import { playerIdOf, type UserId } from '../domain/users/user';
import { toApiError } from '../middleware/api-errors';
import type { AuthService } from '../services/auth/auth.service';
import { AuthenticationRequiredError } from '../services/auth/auth-errors';
import type { ChatService } from '../services/chat/chat.service';
import type { Logger } from '../utils/logger';
import { parseChatMessageInput } from '../validators/chat.validators';

/**
 * Transport temps réel vers les clients (T-01 tranché par D-045) : WebSocket natif (`ws`),
 * une seule connexion par application, sur le chemin `/ws` du serveur HTTP de l'API.
 *
 * Protocole (trames texte JSON) :
 *
 *   client → serveur
 *     { type: 'auth', token }                               1re trame obligatoire (10 s)
 *     { type: 'chat:subscribe', gameId }                    → chat:subscribed | error
 *     { type: 'chat:unsubscribe', gameId }
 *     { type: 'chat:send', gameId, clientMessageId, content } → chat:ack | error
 *     { type: 'ping' }                                      → pong
 *
 *   serveur → client
 *     { type: 'ready' }                                     authentifié
 *     { type: 'chat:message', gameId, message }             salle `game:{gameId}:chat`
 *
 * Sécurité :
 * - Le jeton est envoyé dans la 1re trame, jamais dans l'URL (journaux, proxys) ; il n'est
 *   jamais journalisé. La connexion est fermée (4401) à son expiration : le client renouvelle
 *   son jeton et se reconnecte. Chaque commande revérifie la session (R-32 : une connexion
 *   ailleurs révoque l'ancienne).
 * - L'identité est celle du jeton ; aucun `senderId`/`userId` reçu n'est lu.
 * - Abonnement et envoi passent par ChatService, qui vérifie l'appartenance à la partie.
 * - Trames limitées en taille (`maxPayload`) et en débit par connexion.
 */
export const REALTIME_PATH = '/ws';

export const WS_CLOSE = {
  unauthenticated: 4401,
  protocolError: 4400,
} as const;

export interface RealtimeGatewayOptions {
  auth: AuthService;
  chat: ChatService;
  logger: Logger;
  /** Délai pour s'authentifier après l'ouverture. */
  authTimeoutMs?: number;
  /** Intervalle des ping de vie ; une connexion muette sur un intervalle complet est coupée. */
  heartbeatMs?: number;
}

const DEFAULT_AUTH_TIMEOUT_MS = 10_000;
const DEFAULT_HEARTBEAT_MS = 30_000;
/** Un message de 500 caractères tient très largement dans 8 Kio. */
const MAX_FRAME_BYTES = 8 * 1024;
/** Une application n'affiche qu'une partie à la fois : quelques abonnements suffisent. */
const MAX_SUBSCRIPTIONS = 4;
const FRAMES_PER_WINDOW = 40;
const FRAME_WINDOW_MS = 10_000;

export interface RealtimeGateway {
  /** Connexions ouvertes (tests, supervision). */
  readonly connectionCount: number;
  close(): Promise<void>;
}

export function attachRealtimeGateway(
  server: HttpServer,
  options: RealtimeGatewayOptions,
): RealtimeGateway {
  const wss = new WebSocketServer({ noServer: true, maxPayload: MAX_FRAME_BYTES });
  const heartbeatMs = options.heartbeatMs ?? DEFAULT_HEARTBEAT_MS;
  const alive = new WeakMap<WebSocket, boolean>();

  const onUpgrade = (req: IncomingMessage, socket: Duplex, head: Buffer) => {
    const path = new URL(req.url ?? '/', 'http://localhost').pathname;
    if (path !== REALTIME_PATH) {
      socket.write('HTTP/1.1 404 Not Found\r\nConnection: close\r\n\r\n');
      socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req));
  };
  server.on('upgrade', onUpgrade);

  wss.on('connection', (ws: WebSocket) => {
    alive.set(ws, true);
    ws.on('pong', () => alive.set(ws, true));
    new Connection(ws, options).start();
  });

  const heartbeat = setInterval(() => {
    for (const ws of wss.clients) {
      if (!alive.get(ws)) {
        ws.terminate();
        continue;
      }
      alive.set(ws, false);
      ws.ping();
    }
  }, heartbeatMs);
  heartbeat.unref();

  return {
    get connectionCount() {
      return wss.clients.size;
    },
    close: () =>
      new Promise<void>((resolve) => {
        clearInterval(heartbeat);
        server.off('upgrade', onUpgrade);
        for (const ws of wss.clients) {
          ws.terminate();
        }
        wss.close(() => resolve());
      }),
  };
}

type ClientFrame = Record<string, unknown> & { type?: unknown };

/** Une connexion : son identité authentifiée et ses abonnements, rien d'autre. */
class Connection {
  private userId: UserId | undefined;
  private token: string | undefined;
  private expiryTimer: NodeJS.Timeout | undefined;
  private readonly authTimer: NodeJS.Timeout;
  private readonly subscriptions = new Map<GameId, () => void>();
  /** Abonnements en cours de vérification : un double `chat:subscribe` n'abonne qu'une fois. */
  private readonly subscribing = new Set<GameId>();
  private frames = { count: 0, resetAt: 0 };
  /** Trames traitées dans l'ordre de réception (l'abonnement suit toujours l'`auth`). */
  private queue: Promise<void> = Promise.resolve();

  constructor(
    private readonly ws: WebSocket,
    private readonly options: RealtimeGatewayOptions,
  ) {
    this.authTimer = setTimeout(
      () => this.ws.close(WS_CLOSE.unauthenticated, 'authentication timeout'),
      options.authTimeoutMs ?? DEFAULT_AUTH_TIMEOUT_MS,
    );
    this.authTimer.unref();
  }

  start(): void {
    this.ws.on('message', (data, isBinary) => {
      this.queue = this.queue
        .then(() => this.onFrame(data, isBinary))
        .catch((err: unknown) =>
          this.options.logger.error('realtime frame failed', {
            error: err instanceof Error ? err.message : String(err),
          }),
        );
    });
    this.ws.on('close', () => this.dispose());
    this.ws.on('error', (err) =>
      this.options.logger.warn('realtime connection error', { error: err.message }),
    );
  }

  private async onFrame(data: RawData, isBinary: boolean): Promise<void> {
    if (!this.withinRate()) {
      this.send({ type: 'error', code: 'RATE_LIMITED', message: 'Trop de messages.' });
      return;
    }
    let frame: ClientFrame;
    try {
      if (isBinary) {
        throw new Error('binary');
      }
      const parsed: unknown = JSON.parse(rawToString(data));
      if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
        throw new Error('not an object');
      }
      frame = parsed as ClientFrame;
    } catch {
      this.send({ type: 'error', code: 'BAD_FRAME', message: 'Trame invalide.' });
      return;
    }

    if (frame.type === 'ping') {
      this.send({ type: 'pong' });
      return;
    }
    if (frame.type === 'auth') {
      await this.authenticate(frame.token);
      return;
    }
    if (!this.userId) {
      this.send({ type: 'error', code: 'UNAUTHENTICATED', message: 'Authentification requise.' });
      this.ws.close(WS_CLOSE.unauthenticated, 'unauthenticated');
      return;
    }

    switch (frame.type) {
      case 'chat:subscribe':
        await this.subscribe(frame.gameId);
        return;
      case 'chat:unsubscribe':
        this.unsubscribe(frame.gameId);
        return;
      case 'chat:send':
        await this.sendMessage(frame);
        return;
      default:
        this.send({ type: 'error', code: 'BAD_FRAME', message: 'Type de trame inconnu.' });
    }
  }

  private async authenticate(token: unknown): Promise<void> {
    try {
      if (typeof token !== 'string' || token.length > 4096) {
        throw new AuthenticationRequiredError('malformed_header');
      }
      const context = await this.options.auth.authenticate(token);
      if (this.userId && this.userId !== context.userId) {
        // Un autre compte sur la même connexion : jamais (ses abonnements seraient hérités).
        this.ws.close(WS_CLOSE.protocolError, 'identity change');
        return;
      }
      clearTimeout(this.authTimer);
      this.userId = context.userId;
      this.token = token;
      this.scheduleExpiry(token);
      this.send({ type: 'ready' });
    } catch (err) {
      const reason = err instanceof AuthenticationRequiredError ? err.reason : 'error';
      this.options.logger.warn('realtime auth rejected', { reason });
      this.send({ type: 'error', code: 'UNAUTHENTICATED', message: 'Connexion expirée.' });
      this.ws.close(WS_CLOSE.unauthenticated, 'unauthenticated');
    }
  }

  /** Fermeture à l'expiration du jeton (`exp`, signé et déjà vérifié par `authenticate`). */
  private scheduleExpiry(token: string): void {
    clearTimeout(this.expiryTimer);
    const exp = (jwt.decode(token) as { exp?: unknown } | null)?.exp;
    if (typeof exp !== 'number') {
      return;
    }
    this.expiryTimer = setTimeout(
      () => this.ws.close(WS_CLOSE.unauthenticated, 'token expired'),
      Math.max(0, exp * 1000 - Date.now()),
    );
    this.expiryTimer.unref();
  }

  /** Session toujours active (R-32) avant chaque commande ; sinon la connexion est fermée. */
  private async stillAuthenticated(): Promise<boolean> {
    try {
      await this.options.auth.authenticate(this.token ?? '');
      return true;
    } catch {
      this.send({ type: 'error', code: 'UNAUTHENTICATED', message: 'Connexion expirée.' });
      this.ws.close(WS_CLOSE.unauthenticated, 'unauthenticated');
      return false;
    }
  }

  private async subscribe(value: unknown): Promise<void> {
    if (!isGameId(value)) {
      this.sendValidationError('Identifiant de partie invalide.');
      return;
    }
    const gameId = value;
    if (this.subscriptions.has(gameId) || this.subscribing.has(gameId)) {
      // Réabonnement (reconnexion, double envoi) : aucun second abonnement, donc aucun doublon.
      if (this.subscriptions.has(gameId)) {
        this.send({ type: 'chat:subscribed', gameId });
      }
      return;
    }
    if (this.subscriptions.size + this.subscribing.size >= MAX_SUBSCRIPTIONS) {
      this.send({
        type: 'error',
        code: 'TOO_MANY_SUBSCRIPTIONS',
        message: 'Trop de parties suivies.',
        gameId,
      });
      return;
    }
    if (!(await this.stillAuthenticated())) {
      return;
    }
    this.subscribing.add(gameId);
    try {
      const unsubscribe = await this.options.chat.subscribe(
        gameId,
        playerIdOf(this.userId as UserId),
        (event) =>
          this.send({
            type: 'chat:message',
            gameId: event.gameId,
            message: toChatMessageJson(event.message),
          }),
      );
      if (this.ws.readyState !== WebSocket.OPEN) {
        unsubscribe();
        return;
      }
      this.subscriptions.set(gameId, unsubscribe);
      this.send({ type: 'chat:subscribed', gameId });
    } catch (err) {
      this.sendError(err, { gameId });
    } finally {
      this.subscribing.delete(gameId);
    }
  }

  private unsubscribe(value: unknown): void {
    if (!isGameId(value)) {
      return;
    }
    this.subscriptions.get(value)?.();
    this.subscriptions.delete(value);
  }

  private async sendMessage(frame: ClientFrame): Promise<void> {
    const { gameId, clientMessageId } = frame;
    const ref = typeof clientMessageId === 'string' ? clientMessageId.slice(0, 128) : undefined;
    if (!isGameId(gameId)) {
      this.sendValidationError('Identifiant de partie invalide.', ref);
      return;
    }
    if (!(await this.stillAuthenticated())) {
      return;
    }
    try {
      const input = parseChatMessageInput({ content: frame.content }, clientMessageId);
      const { message } = await this.options.chat.sendMessage(
        gameId,
        playerIdOf(this.userId as UserId),
        input,
      );
      this.send({
        type: 'chat:ack',
        gameId,
        clientMessageId: input.clientMessageId,
        message: toChatMessageJson(message),
      });
    } catch (err) {
      this.sendError(err, { gameId, ...(ref && { clientMessageId: ref }) });
    }
  }

  private sendValidationError(message: string, clientMessageId?: string): void {
    this.send({
      type: 'error',
      code: 'VALIDATION_ERROR',
      message,
      ...(clientMessageId && { clientMessageId }),
    });
  }

  /** Même `code` et même message fixe qu'en HTTP ; jamais de message interne. */
  private sendError(err: unknown, context: Record<string, string>): void {
    const known = toApiError(err);
    if (!known) {
      this.options.logger.error('realtime command failed', {
        ...context,
        error: err instanceof Error ? err.message : String(err),
      });
    }
    this.send({
      type: 'error',
      code: known?.body.code ?? 'INTERNAL_ERROR',
      message: known?.body.message ?? 'Une erreur est survenue. Réessayez.',
      ...(known?.body.fields && { fields: known.body.fields }),
      ...context,
    });
  }

  private withinRate(): boolean {
    const now = Date.now();
    if (now >= this.frames.resetAt) {
      this.frames = { count: 0, resetAt: now + FRAME_WINDOW_MS };
    }
    this.frames.count += 1;
    return this.frames.count <= FRAMES_PER_WINDOW;
  }

  private send(payload: Record<string, unknown>): void {
    if (this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(payload));
    }
  }

  private dispose(): void {
    clearTimeout(this.authTimer);
    clearTimeout(this.expiryTimer);
    for (const unsubscribe of this.subscriptions.values()) {
      unsubscribe();
    }
    this.subscriptions.clear();
  }
}

function rawToString(data: RawData): string {
  if (Array.isArray(data)) {
    return Buffer.concat(data).toString('utf8');
  }
  return Buffer.from(data as ArrayBuffer).toString('utf8');
}
