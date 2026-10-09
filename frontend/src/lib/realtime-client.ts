/**
 * Connexion temps réel unique de l'application (D-045) : WebSocket natif vers `/ws` de l'API.
 *
 * - UNE connexion pour toute l'application, ouverte tant qu'au moins un abonnement existe.
 * - Authentification par la 1re trame (`auth`), jamais par l'URL. Une fermeture 4401 (jeton
 *   expiré ou session révoquée) fait renouveler le jeton avant de se reconnecter.
 * - Reconnexion avec un délai croissant (1 s → 30 s) ; après chaque reconnexion, tous les
 *   abonnements sont renvoyés et chaque abonné est prévenu (`onSubscribed`) pour rattraper
 *   ce qu'il a manqué par l'historique REST.
 * - Ping applicatif : une connexion devenue muette (réseau mobile coupé) est fermée puis
 *   rétablie, plutôt que de rester ouverte en apparence.
 */

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

const OPEN = 1;
export const UNAUTHENTICATED_CLOSE = 4401;
const MIN_RETRY_MS = 1_000;
const MAX_RETRY_MS = 30_000;
const PING_INTERVAL_MS = 25_000;
const PONG_TIMEOUT_MS = 10_000;

type Frame = { type?: unknown; gameId?: unknown; code?: unknown; message?: unknown };

export class RealtimeClient {
  private socket: WebSocketLike | null = null;
  private status: RealtimeStatus = 'idle';
  private readonly statusListeners = new Set<(status: RealtimeStatus) => void>();
  /** Abonnés par partie ; plusieurs écrans peuvent suivre la même partie. */
  private readonly chats = new Map<string, Set<ChatSubscriptionHandlers>>();
  private attempt = 0;
  private retryTimer: unknown;
  private pingTimer: unknown;
  private pongTimer: unknown;
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
      if (this.chats.size === 0) this.disconnect();
    };
  }

  /** Retour au premier plan, réseau revenu : reconnexion immédiate si nécessaire. */
  wake(): void {
    if (this.chats.size === 0 || this.socket) return;
    this.clearTimer(this.retryTimer);
    this.retryTimer = undefined;
    this.attempt = 0;
    void this.connect();
  }

  private ensureConnected(): void {
    if (!this.socket && this.retryTimer === undefined) void this.connect();
  }

  private async connect(): Promise<void> {
    if (this.socket || this.chats.size === 0) return;
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
    if (this.chats.size === 0 || this.socket) return;
    if (!token) {
      this.setStatus('offline');
      this.scheduleRetry();
      return;
    }

    const socket = this.deps.createSocket(this.deps.url);
    this.socket = socket;
    const authToken = token;
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
        this.attempt = 0;
        this.setStatus('connected');
        this.startPing();
        for (const gameId of this.chats.keys()) {
          this.sendFrame({ type: 'chat:subscribe', gameId });
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
    if (code === UNAUTHENTICATED_CLOSE) this.refreshBeforeConnect = true;
    if (this.chats.size === 0) {
      this.setStatus('idle');
      return;
    }
    this.setStatus('offline');
    this.scheduleRetry();
  }

  private scheduleRetry(): void {
    if (this.retryTimer !== undefined || this.chats.size === 0) return;
    const base = Math.min(MAX_RETRY_MS, MIN_RETRY_MS * 2 ** this.attempt);
    const delay = base * (0.75 + 0.5 * (this.deps.random ?? Math.random)());
    this.attempt += 1;
    this.retryTimer = this.setTimer(() => {
      this.retryTimer = undefined;
      void this.connect();
    }, delay);
  }

  private disconnect(): void {
    this.clearTimer(this.retryTimer);
    this.retryTimer = undefined;
    this.stopPing();
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
        socket.close(4000, 'no pong');
        this.onClose(socket, 4000);
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
