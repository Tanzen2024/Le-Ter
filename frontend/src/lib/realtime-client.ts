/**
 * Connexion temps réel unique de l'application (D-045) : WebSocket natif vers `/ws` de l'API.
 *
 * - UNE connexion pour toute l'application, ouverte tant qu'au moins un abonnement existe.
 * - Authentification par la 1re trame (`auth`), jamais par l'URL. Une fermeture 4401 (jeton
 *   expiré ou session révoquée) fait renouveler le jeton avant de se reconnecter ; toute autre
 *   fermeture (dont 1013, serveur momentanément indisponible) garde le jeton courant.
 * - Reconnexion avec un délai croissant (1 s → 30 s) ; après chaque reconnexion, tous les
 *   abonnements sont renvoyés et chaque abonné est prévenu (`onSubscribed`) pour rattraper
 *   ce qu'il a manqué par l'historique REST.
 * - Ping applicatif : une connexion devenue muette (réseau mobile coupé) est fermée puis
 *   rétablie, plutôt que de rester ouverte en apparence. Une ouverture qui n'aboutit pas à
 *   `ready` dans `HANDSHAKE_TIMEOUT_MS` (paquets perdus, VPN en veille) est abandonnée de même.
 * - Une seule tentative à la fois : ni deux sockets ouvertes, ni deux renouvellements de jeton.
 * - Diagnostic : UN avertissement par coupure (code et famille), puis un message au retour ;
 *   les tentatives intermédiaires ne sont plus signalées une à une.
 */

import { logNetworkIssue } from './api-client';

export type RealtimeStatus = 'idle' | 'connecting' | 'connected' | 'offline';

/** Sous-ensemble du WebSocket standard (React Native, navigateur) utilisé ici. */
export interface WebSocketLike {
  readonly readyState: number;
  onopen: (() => void) | null;
  onmessage: ((event: { data: unknown }) => void) | null;
  onclose: ((event: { code: number }) => void) | null;
  onerror: (() => void) | null;
  send(data: string): void;
  close(code?: number, reason?: string): void;
}

export interface RealtimeClientDeps {
  url: string;
  createSocket(url: string): WebSocketLike;
  /** Jeton d'accès courant, `null` si aucun. */
  getToken(): string | null;
  /** Renouvelle le jeton (refresh) ; `null` si la session n'est plus valide. */
  refreshToken(): Promise<string | null>;
  setTimer?: (callback: () => void, ms: number) => unknown;
  clearTimer?: (timer: unknown) => void;
  random?: () => number;
}

export interface ChatSubscriptionHandlers {
  /** Trame `chat:message` de cette partie (à revalider par l'abonné). */
  onEvent(event: unknown): void;
  /** Abonnement confirmé par le serveur : à la 1re connexion et après chaque reconnexion. */
  onSubscribed?(): void;
  /** Abonnement refusé (ex. NOT_A_MEMBER) : `code` et message du serveur. */
  onError?(error: { code: string; message: string }): void;
}

export interface GameSubscriptionHandlers {
  /**
   * Le serveur a accepté une commande de cette partie (carte jouée, tour expiré…) : `version`
   * est la nouvelle version. Seul signal transmis (D-101) : l'état se relit par l'API.
   */
  onChanged(version: number): void;
  /** Abonnement confirmé : à la 1re connexion et après chaque reconnexion (rattrapage). */
  onSubscribed?(): void;
}

const OPEN = 1;
export const UNAUTHENTICATED_CLOSE = 4401;
const MIN_RETRY_MS = 1_000;
const MAX_RETRY_MS = 30_000;
const PING_INTERVAL_MS = 25_000;
const PONG_TIMEOUT_MS = 10_000;
/** Ouverture + authentification : au-delà, la tentative est abandonnée puis reprise. */
export const HANDSHAKE_TIMEOUT_MS = 15_000;
/** Codes posés par ce client (jamais envoyés par le serveur). */
export const NO_PONG_CLOSE = 4000;
export const HANDSHAKE_TIMEOUT_CLOSE = 4408;

/** Famille d'une fermeture vue du téléphone (journaux de développement). */
export function realtimeCloseCategory(code: number): string {
  switch (code) {
    case 1000:
    case 1005:
      return 'normale';
    case 1001:
      return 'arrêt ou redémarrage du serveur';
    case UNAUTHENTICATED_CLOSE:
      return 'authentification refusée';
    case 1013:
      return 'serveur momentanément indisponible';
    case NO_PONG_CLOSE:
      return 'connexion muette (aucun pong)';
    case HANDSHAKE_TIMEOUT_CLOSE:
      return 'ouverture sans réponse';
    case 4400:
    case 1002:
    case 1003:
    case 1007:
    case 1009:
      return 'erreur de protocole';
    default:
      return 'coupure du transport (sans trame de fermeture)';
  }
}

/** Signal personnel du serveur (D-106) : une notification attend, à relire par l'API. */
export interface RealtimeNotification {
  notificationType: string;
  tournamentId?: string;
}

type Frame = {
  type?: unknown;
  gameId?: unknown;
  notificationType?: unknown;
  tournamentId?: unknown;
  code?: unknown;
  message?: unknown;
  version?: unknown;
  channel?: unknown;
};

export class RealtimeClient {
  private socket: WebSocketLike | null = null;
  private status: RealtimeStatus = 'idle';
  private readonly statusListeners = new Set<(status: RealtimeStatus) => void>();
  /** Abonnés par partie ; plusieurs écrans peuvent suivre la même partie. */
  private readonly chats = new Map<string, Set<ChatSubscriptionHandlers>>();
  /** Suivi des parties (D-101), sur la même connexion que le chat. */
  private readonly games = new Map<string, Set<GameSubscriptionHandlers>>();
  /**
   * Signaux personnels (D-106). Écouter n'ouvre PAS de connexion : ils arrivent quand une
   * connexion existe déjà (pendant une partie). Hors connexion, l'application relit ses
   * notifications par l'API au retour sur l'écran : rien n'est perdu.
   */
  private readonly notificationListeners = new Set<(n: RealtimeNotification) => void>();
  private attempt = 0;
  private retryTimer: unknown;
  private pingTimer: unknown;
  private pongTimer: unknown;
  private handshakeTimer: unknown;
  /** Tentative en cours (jeton en renouvellement inclus) : une seule à la fois. */
  private connecting = false;
  /** Coupure déjà signalée : les échecs suivants de la même panne ne sont pas répétés. */
  private outageReported = false;
  private refreshBeforeConnect = false;
  private readonly setTimer: (callback: () => void, ms: number) => unknown;
  private readonly clearTimer: (timer: unknown) => void;

  constructor(private readonly deps: RealtimeClientDeps) {
    this.setTimer = deps.setTimer ?? ((cb, ms) => setTimeout(cb, ms));
    this.clearTimer =
      deps.clearTimer ?? ((t) => clearTimeout(t as ReturnType<typeof setTimeout>));
  }

  getStatus(): RealtimeStatus {
    return this.status;
  }

  onStatus(listener: (status: RealtimeStatus) => void): () => void {
    this.statusListeners.add(listener);
    return () => this.statusListeners.delete(listener);
  }

  /** Suit le chat d'une partie ; la connexion s'ouvre au 1er abonné et se ferme au dernier. */
  subscribeChat(gameId: string, handlers: ChatSubscriptionHandlers): () => void {
    const set = this.chats.get(gameId) ?? new Set();
    const first = set.size === 0;
    set.add(handlers);
    this.chats.set(gameId, set);
    if (first && this.status === 'connected') {
      this.sendFrame({ type: 'chat:subscribe', gameId });
    } else if (this.status === 'connected') {
      // Déjà abonné sur cette connexion : le nouvel abonné rattrape lui aussi.
      handlers.onSubscribed?.();
    }
    this.ensureConnected();

    let active = true;
    return () => {
      if (!active) return;
      active = false;
      set.delete(handlers);
      if (set.size === 0) {
        this.chats.delete(gameId);
        if (this.status === 'connected') this.sendFrame({ type: 'chat:unsubscribe', gameId });
      }
      if (!this.hasSubscribers()) this.disconnect();
    };
  }

  /**
   * Suit les changements d'état d'une partie (D-101) : prévenu dès qu'une commande est
   * acceptée par le serveur, sans attendre la relecture périodique.
   */
  subscribeGame(gameId: string, handlers: GameSubscriptionHandlers): () => void {
    const set = this.games.get(gameId) ?? new Set();
    const first = set.size === 0;
    set.add(handlers);
    this.games.set(gameId, set);
    if (first && this.status === 'connected') {
      this.sendFrame({ type: 'game:subscribe', gameId });
    } else if (this.status === 'connected') {
      handlers.onSubscribed?.();
    }
    this.ensureConnected();

    let active = true;
    return () => {
      if (!active) return;
      active = false;
      set.delete(handlers);
      if (set.size === 0) {
        this.games.delete(gameId);
        if (this.status === 'connected') this.sendFrame({ type: 'game:unsubscribe', gameId });
      }
      if (!this.hasSubscribers()) this.disconnect();
    };
  }

  onNotification(listener: (n: RealtimeNotification) => void): () => void {
    this.notificationListeners.add(listener);
    return () => this.notificationListeners.delete(listener);
  }

  private hasSubscribers(): boolean {
    return this.chats.size > 0 || this.games.size > 0;
  }

  /** Retour au premier plan, réseau revenu : reconnexion immédiate si nécessaire. */
  wake(): void {
    if (!this.hasSubscribers()) return;
    if (this.socket) {
      // Connexion qui semble ouverte après une mise en veille : vérifiée tout de suite (un
      // pong la confirme, sinon elle est fermée puis rétablie) au lieu d'attendre le ping.
      if (this.status === 'connected' && this.pongTimer === undefined) {
        this.sendFrame({ type: 'ping' });
        this.armPongTimeout(true);
      }
      return;
    }
    this.clearTimer(this.retryTimer);
    this.retryTimer = undefined;
    this.attempt = 0;
    void this.connect();
  }

  private ensureConnected(): void {
    if (!this.socket && this.retryTimer === undefined) void this.connect();
  }

  private async connect(): Promise<void> {
    if (this.socket || this.connecting || !this.hasSubscribers()) return;
    this.connecting = true;
    this.setStatus('connecting');
    let token = this.deps.getToken();
    if (!token || this.refreshBeforeConnect) {
      try {
        token = await this.deps.refreshToken();
      } catch {
        token = null;
      }
      this.refreshBeforeConnect = false;
    }
    this.connecting = false;
    if (!this.hasSubscribers() || this.socket) return;
    if (!token) {
      this.setStatus('offline');
      this.scheduleRetry();
      return;
    }

    const socket = this.deps.createSocket(this.deps.url);
    this.socket = socket;
    const authToken = token;
    // Ouverture bloquée (SYN perdu, VPN en veille) : sans ce délai, aucune fermeture n'arrive
    // avant celle du système, plusieurs minutes plus tard.
    this.handshakeTimer = this.setTimer(() => {
      this.handshakeTimer = undefined;
      if (socket !== this.socket) return;
      socket.close(HANDSHAKE_TIMEOUT_CLOSE, 'handshake timeout');
      this.onClose(socket, HANDSHAKE_TIMEOUT_CLOSE);
    }, HANDSHAKE_TIMEOUT_MS);
    socket.onopen = () => this.sendFrame({ type: 'auth', token: authToken });
    socket.onmessage = (event) => this.onFrame(socket, event.data);
    socket.onerror = () => undefined; // Toujours suivi d'un `close`.
    socket.onclose = (event) => this.onClose(socket, event.code);
  }

  private onFrame(socket: WebSocketLike, data: unknown): void {
    if (socket !== this.socket || typeof data !== 'string') return;
    let frame: Frame;
    try {
      frame = JSON.parse(data) as Frame;
    } catch {
      return;
    }
    if (typeof frame !== 'object' || frame === null) return;
    this.armPongTimeout(false);

    switch (frame.type) {
      case 'ready':
        this.clearHandshake();
        if (this.outageReported && __DEV__) {
          console.info(`[réseau] TEMPS_RÉEL_RÉTABLI après ${this.attempt} tentative(s)`);
        }
        this.outageReported = false;
        this.attempt = 0;
        this.setStatus('connected');
        this.startPing();
        for (const gameId of this.chats.keys()) {
          this.sendFrame({ type: 'chat:subscribe', gameId });
        }
        for (const gameId of this.games.keys()) {
          this.sendFrame({ type: 'game:subscribe', gameId });
        }
        return;
      case 'game:subscribed':
        if (typeof frame.gameId === 'string') {
          for (const h of [...(this.games.get(frame.gameId) ?? [])]) h.onSubscribed?.();
        }
        return;
      case 'game:changed':
        if (typeof frame.gameId === 'string' && typeof frame.version === 'number') {
          const version = frame.version;
          for (const h of [...(this.games.get(frame.gameId) ?? [])]) h.onChanged(version);
        }
        return;
      case 'notification':
        if (typeof frame.notificationType === 'string') {
          const notification: RealtimeNotification = {
            notificationType: frame.notificationType,
            ...(typeof frame.tournamentId === 'string' && {
              tournamentId: frame.tournamentId,
            }),
          };
          for (const listener of [...this.notificationListeners]) listener(notification);
        }
        return;
      case 'chat:subscribed':
        if (typeof frame.gameId === 'string') {
          for (const h of [...(this.chats.get(frame.gameId) ?? [])]) h.onSubscribed?.();
        }
        return;
      case 'chat:message':
        if (typeof frame.gameId === 'string') {
          for (const h of [...(this.chats.get(frame.gameId) ?? [])]) h.onEvent(frame);
        }
        return;
      case 'error':
        // Refus d'un suivi de partie : la relecture périodique reste le filet de sécurité.
        if (frame.channel === 'game') return;
        if (typeof frame.gameId === 'string') {
          const error = {
            code: typeof frame.code === 'string' ? frame.code : 'ERROR',
            message: typeof frame.message === 'string' ? frame.message : '',
          };
          for (const h of [...(this.chats.get(frame.gameId) ?? [])]) h.onError?.(error);
        }
        return;
      default:
        return; // `pong` et trames inconnues : rien à faire.
    }
  }

  private onClose(socket: WebSocketLike, code: number): void {
    if (socket !== this.socket) return;
    this.socket = null;
    this.stopPing();
    this.clearHandshake();
    // Diagnostic (développement) : destination, code et famille de la fermeture, jamais le
    // jeton ; une seule fois par panne (les tentatives suivantes échouent pour la même cause).
    if (code !== 1000 && !this.outageReported) {
      this.outageReported = true;
      logNetworkIssue('TEMPS_RÉEL_FERMÉ', {
        url: this.deps.url,
        code,
        cause: realtimeCloseCategory(code),
      });
    }
    if (code === UNAUTHENTICATED_CLOSE) this.refreshBeforeConnect = true;
    if (!this.hasSubscribers()) {
      this.setStatus('idle');
      return;
    }
    this.setStatus('offline');
    this.scheduleRetry();
  }

  private scheduleRetry(): void {
    if (this.retryTimer !== undefined || !this.hasSubscribers()) return;
    const base = Math.min(MAX_RETRY_MS, MIN_RETRY_MS * 2 ** this.attempt);
    const delay = base * (0.75 + 0.5 * (this.deps.random ?? Math.random)());
    this.attempt += 1;
    this.retryTimer = this.setTimer(() => {
      this.retryTimer = undefined;
      void this.connect();
    }, delay);
  }

  private clearHandshake(): void {
    this.clearTimer(this.handshakeTimer);
    this.handshakeTimer = undefined;
  }

  private disconnect(): void {
    this.clearTimer(this.retryTimer);
    this.retryTimer = undefined;
    this.stopPing();
    this.clearHandshake();
    this.outageReported = false;
    const socket = this.socket;
    this.socket = null;
    this.attempt = 0;
    socket?.close(1000, 'no subscription');
    this.setStatus('idle');
  }

  private startPing(): void {
    // Seul le ping est réarmé : l'attente d'un pong en cours doit continuer.
    this.clearTimer(this.pingTimer);
    this.pingTimer = this.setTimer(() => {
      this.sendFrame({ type: 'ping' });
      this.armPongTimeout(true);
      this.startPing();
    }, PING_INTERVAL_MS);
  }

  /** `arm` : attendre une réponse ; sinon toute trame reçue prouve que la connexion vit. */
  private armPongTimeout(arm: boolean): void {
    this.clearTimer(this.pongTimer);
    this.pongTimer = undefined;
    if (!arm) return;
    const socket = this.socket;
    this.pongTimer = this.setTimer(() => {
      if (socket && socket === this.socket) {
        socket.close(NO_PONG_CLOSE, 'no pong');
        this.onClose(socket, NO_PONG_CLOSE);
      }
    }, PONG_TIMEOUT_MS);
  }

  private stopPing(): void {
    this.clearTimer(this.pingTimer);
    this.clearTimer(this.pongTimer);
    this.pingTimer = undefined;
    this.pongTimer = undefined;
  }

  private sendFrame(frame: object): void {
    if (this.socket?.readyState === OPEN) this.socket.send(JSON.stringify(frame));
  }

  private setStatus(status: RealtimeStatus): void {
    if (status === this.status) return;
    this.status = status;
    for (const listener of [...this.statusListeners]) listener(status);
  }
}

/** URL WebSocket de l'API : même hôte, schéma ws(s), chemin `/ws`. */
export function realtimeUrl(apiUrl: string): string {
  return `${apiUrl.replace(/^http/, 'ws').replace(/\/$/, '')}/ws`;
}
