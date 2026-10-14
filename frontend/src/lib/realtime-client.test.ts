/// <reference types="jest" />
import {
  HANDSHAKE_TIMEOUT_CLOSE,
  HANDSHAKE_TIMEOUT_MS,
  RealtimeClient,
  realtimeUrl,
  UNAUTHENTICATED_CLOSE,
  type WebSocketLike,
} from './realtime-client';

const GAME = '11111111-1111-4111-8111-111111111111';
const OTHER = '22222222-2222-4222-8222-222222222222';

/** Faux WebSocket piloté par le test : trames envoyées, ouverture, trames reçues, fermeture. */
class FakeSocket implements WebSocketLike {
  readyState = 0;
  sent: Record<string, unknown>[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: unknown }) => void) | null = null;
  onclose: ((event: { code: number }) => void) | null = null;
  onerror: (() => void) | null = null;
  closedWith: number | undefined;

  constructor(readonly url: string) {}

  send(data: string) {
    this.sent.push(JSON.parse(data));
  }
  close(code = 1000) {
    this.closedWith = code;
    this.readyState = 3;
  }
  open() {
    this.readyState = 1;
    this.onopen?.();
  }
  receive(frame: object) {
    this.onmessage?.({ data: JSON.stringify(frame) });
  }
  drop(code = 1006) {
    this.readyState = 3;
    this.onclose?.({ code });
  }
  types() {
    return this.sent.map((f) => f.type);
  }
}

/** Minuterie manuelle : les délais ne s'écoulent que sur demande. */
function manualTimers() {
  let next = 1;
  const pending = new Map<number, { cb: () => void; ms: number }>();
  return {
    setTimer: (cb: () => void, ms: number) => {
      const id = next++;
      pending.set(id, { cb, ms });
      return id;
    },
    clearTimer: (id: unknown) => pending.delete(id as number),
    /** Déclenche les minuteries de durée `ms` (ou toutes). */
    fire(ms?: number) {
      for (const [id, t] of [...pending]) {
        if (ms === undefined || t.ms === ms) {
          pending.delete(id);
          t.cb();
        }
      }
    },
    delays: () => [...pending.values()].map((t) => t.ms),
  };
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

function setup(options: { token?: string | null; refreshed?: string | null } = {}) {
  const sockets: FakeSocket[] = [];
  const timers = manualTimers();
  const refreshToken = jest.fn(async () =>
    options.refreshed === undefined ? 'jeton-neuf' : options.refreshed,
  );
  const client = new RealtimeClient({
    url: 'ws://api.test/ws',
    createSocket: (url) => {
      const socket = new FakeSocket(url);
      sockets.push(socket);
      return socket;
    },
    getToken: () => (options.token === undefined ? 'jeton' : options.token),
    refreshToken,
    setTimer: timers.setTimer,
    clearTimer: timers.clearTimer,
    random: () => 0.5,
  });
  return { client, sockets, timers, refreshToken, last: () => sockets[sockets.length - 1]! };
}

/** Ouvre la connexion courante et la déclare authentifiée par le serveur. */
async function connectReady(last: () => FakeSocket) {
  await flush();
  last().open();
  last().receive({ type: 'ready' });
}

describe('RealtimeClient', () => {
  it('URL WebSocket dérivée de l’API', () => {
    expect(realtimeUrl('http://10.0.2.2:3000')).toBe('ws://10.0.2.2:3000/ws');
    expect(realtimeUrl('https://api.le-ter.test/')).toBe('wss://api.le-ter.test/ws');
  });

  it('s’authentifie par la 1re trame puis s’abonne au chat de la partie', async () => {
    const { client, last } = setup();
    const onSubscribed = jest.fn();
    client.subscribeChat(GAME, { onEvent: jest.fn(), onSubscribed });
    await flush();
    last().open();
    expect(last().sent[0]).toEqual({ type: 'auth', token: 'jeton' });
    expect(last().url).toBe('ws://api.test/ws'); // Jamais de jeton dans l'URL.

    last().receive({ type: 'ready' });
    expect(client.getStatus()).toBe('connected');
    expect(last().sent[1]).toEqual({ type: 'chat:subscribe', gameId: GAME });
    last().receive({ type: 'chat:subscribed', gameId: GAME });
    expect(onSubscribed).toHaveBeenCalledTimes(1);
  });

  it('ne remet un message qu’aux abonnés de SA partie', async () => {
    const { client, last } = setup();
    const mine = jest.fn();
    const other = jest.fn();
    client.subscribeChat(GAME, { onEvent: mine });
    client.subscribeChat(OTHER, { onEvent: other });
    await connectReady(last);

    last().receive({ type: 'chat:message', gameId: GAME, message: { id: 'm1' } });
    expect(mine).toHaveBeenCalledTimes(1);
    expect(other).not.toHaveBeenCalled();
  });

  it('deux écrans sur la même partie : un seul abonnement serveur', async () => {
    const { client, last } = setup();
    client.subscribeChat(GAME, { onEvent: jest.fn() });
    const second = jest.fn();
    await connectReady(last);
    client.subscribeChat(GAME, { onEvent: jest.fn(), onSubscribed: second });
    expect(last().types().filter((t) => t === 'chat:subscribe')).toHaveLength(1);
    expect(second).toHaveBeenCalledTimes(1); // Le nouvel abonné rattrape aussi.
  });

  it('reconnexion après coupure : délai croissant, réabonnement, rattrapage signalé', async () => {
    const { client, sockets, timers, last } = setup();
    const onSubscribed = jest.fn();
    client.subscribeChat(GAME, { onEvent: jest.fn(), onSubscribed });
    await connectReady(last);
    last().receive({ type: 'chat:subscribed', gameId: GAME });

    last().drop();
    expect(client.getStatus()).toBe('offline');
    expect(timers.delays()).toEqual([1_000]);
    timers.fire(1_000);
    await flush();
    last().drop(); // Échec de la 1re tentative : délai doublé.
    expect(timers.delays()).toEqual([2_000]);
    timers.fire(2_000);
    await connectReady(last);

    expect(sockets).toHaveLength(3);
    expect(last().types()).toEqual(['auth', 'chat:subscribe']);
    last().receive({ type: 'chat:subscribed', gameId: GAME });
    expect(onSubscribed).toHaveBeenCalledTimes(2);
  });

  it('fermeture 4401 (jeton expiré) : renouvelle le jeton avant de se reconnecter', async () => {
    const { client, timers, refreshToken, last } = setup();
    client.subscribeChat(GAME, { onEvent: jest.fn() });
    await connectReady(last);
    last().drop(UNAUTHENTICATED_CLOSE);
    timers.fire(1_000);
    await flush();
    expect(refreshToken).toHaveBeenCalledTimes(1);
    last().open();
    expect(last().sent[0]).toEqual({ type: 'auth', token: 'jeton-neuf' });
  });

  it('fermeture 1013 (serveur indisponible) : se reconnecte avec le même jeton, sans refresh', async () => {
    const { client, timers, refreshToken, last } = setup();
    client.subscribeChat(GAME, { onEvent: jest.fn() });
    await connectReady(last);
    last().drop(1013);
    timers.fire(1_000);
    await flush();
    expect(refreshToken).not.toHaveBeenCalled();
    last().open();
    expect(last().sent[0]).toEqual({ type: 'auth', token: 'jeton' });
  });

  it('session invalide : pas de connexion, nouvel essai plus tard', async () => {
    const { client, sockets, timers } = setup({ token: null, refreshed: null });
    client.subscribeChat(GAME, { onEvent: jest.fn() });
    await flush();
    expect(sockets).toHaveLength(0);
    expect(client.getStatus()).toBe('offline');
    expect(timers.delays()).toHaveLength(1);
  });

  it('connexion muette (aucun pong) : fermée puis rétablie', async () => {
    const { client, sockets, timers, last } = setup();
    client.subscribeChat(GAME, { onEvent: jest.fn() });
    await connectReady(last);
    timers.fire(25_000); // ping envoyé
    expect(last().types()).toContain('ping');
    timers.fire(10_000); // aucune réponse
    expect(sockets[0]!.closedWith).toBe(4000);
    expect(client.getStatus()).toBe('offline');
  });

  it('dernier désabonnement : se désabonne puis ferme la connexion', async () => {
    const { client, last } = setup();
    const unsubscribe = client.subscribeChat(GAME, { onEvent: jest.fn() });
    await connectReady(last);
    unsubscribe();
    expect(last().sent.at(-1)).toEqual({ type: 'chat:unsubscribe', gameId: GAME });
    expect(last().closedWith).toBe(1000);
    expect(client.getStatus()).toBe('idle');
  });

  it('remet une erreur d’abonnement (non membre) à l’abonné', async () => {
    const { client, last } = setup();
    const onError = jest.fn();
    client.subscribeChat(GAME, { onEvent: jest.fn(), onError });
    await connectReady(last);
    last().receive({ type: 'error', code: 'NOT_A_MEMBER', message: 'Refusé', gameId: GAME });
    expect(onError).toHaveBeenCalledWith({ code: 'NOT_A_MEMBER', message: 'Refusé' });
  });
  it('ouverture sans réponse : abandonnée après le délai, puis nouvelle tentative', async () => {
    const { client, sockets, timers } = setup();
    client.subscribeChat(GAME, { onEvent: jest.fn() });
    await flush();
    expect(sockets).toHaveLength(1); // Socket restée en CONNECTING (aucun onopen).
    timers.fire(HANDSHAKE_TIMEOUT_MS);
    expect(sockets[0]!.closedWith).toBe(HANDSHAKE_TIMEOUT_CLOSE);
    expect(client.getStatus()).toBe('offline');
    expect(timers.delays()).toEqual([1_000]);
    // Une fermeture tardive de l'ancienne socket ne touche pas à la nouvelle tentative.
    sockets[0]!.drop(1006);
    expect(timers.delays()).toEqual([1_000]);
  });

  it('une seule tentative à la fois, même pendant le renouvellement du jeton', async () => {
    const { client, sockets, refreshToken } = setup({ token: null });
    client.subscribeChat(GAME, { onEvent: jest.fn() });
    client.subscribeChat(OTHER, { onEvent: jest.fn() });
    client.wake();
    await flush();
    expect(refreshToken).toHaveBeenCalledTimes(1);
    expect(sockets).toHaveLength(1);
  });

  it('panne : un seul avertissement, quel que soit le nombre de tentatives', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    const info = jest.spyOn(console, 'info').mockImplementation(() => undefined);
    try {
      const { client, timers, last } = setup();
      client.subscribeChat(GAME, { onEvent: jest.fn() });
      await connectReady(last);
      last().drop(1006);
      for (const delay of [1_000, 2_000, 4_000]) {
        timers.fire(delay);
        await flush();
        last().drop(1006);
      }
      const closes = warn.mock.calls.filter((c) => String(c[0]).includes('TEMPS_RÉEL_FERMÉ'));
      expect(closes).toHaveLength(1);
      expect(closes[0]![1]).toMatchObject({ code: 1006 });
      timers.fire(8_000);
      await connectReady(last);
      expect(info.mock.calls.some((c) => String(c[0]).includes('TEMPS_RÉEL_RÉTABLI'))).toBe(true);
    } finally {
      warn.mockRestore();
      info.mockRestore();
    }
  });

  it('retour au premier plan : une connexion ouverte est vérifiée par un ping immédiat', async () => {
    const { client, timers, last } = setup();
    client.subscribeChat(GAME, { onEvent: jest.fn() });
    await connectReady(last);
    client.wake();
    expect(last().types()).toContain('ping');
    timers.fire(10_000); // Aucun pong : connexion morte pendant la veille.
    expect(last().closedWith).toBe(4000);
    expect(client.getStatus()).toBe('offline');
  });
});

describe('RealtimeClient : suivi de partie (D-101)', () => {
  it('s’abonne à la partie et ne signale une version qu’aux abonnés de SA partie', async () => {
    const { client, last } = setup();
    const mine = jest.fn();
    const other = jest.fn();
    const onSubscribed = jest.fn();
    client.subscribeGame(GAME, { onChanged: mine, onSubscribed });
    client.subscribeGame(OTHER, { onChanged: other });
    await connectReady(last);
    expect(last().sent).toContainEqual({ type: 'game:subscribe', gameId: GAME });
    last().receive({ type: 'game:subscribed', gameId: GAME });
    expect(onSubscribed).toHaveBeenCalledTimes(1);

    last().receive({ type: 'game:changed', gameId: GAME, version: 7 });
    expect(mine).toHaveBeenCalledWith(7);
    expect(other).not.toHaveBeenCalled();
    // Trame incomplète : ignorée.
    last().receive({ type: 'game:changed', gameId: GAME });
    expect(mine).toHaveBeenCalledTimes(1);
  });

  it('partage la connexion du chat ; réabonnement et rattrapage après une reconnexion', async () => {
    const { client, sockets, timers, last } = setup();
    client.subscribeChat(GAME, { onEvent: jest.fn() });
    const onSubscribed = jest.fn();
    client.subscribeGame(GAME, { onChanged: jest.fn(), onSubscribed });
    await connectReady(last);
    expect(sockets).toHaveLength(1);
    expect(last().types()).toEqual(['auth', 'chat:subscribe', 'game:subscribe']);

    last().drop();
    timers.fire(1_000);
    await connectReady(last);
    expect(last().types()).toEqual(['auth', 'chat:subscribe', 'game:subscribe']);
    last().receive({ type: 'game:subscribed', gameId: GAME });
    expect(onSubscribed).toHaveBeenCalledTimes(1);
  });

  it('dernier abonné parti : désabonnement, puis fermeture s’il ne reste rien', async () => {
    const { client, last } = setup();
    const stopChat = client.subscribeChat(GAME, { onEvent: jest.fn() });
    const stopGame = client.subscribeGame(GAME, { onChanged: jest.fn() });
    await connectReady(last);
    stopGame();
    expect(last().sent).toContainEqual({ type: 'game:unsubscribe', gameId: GAME });
    expect(client.getStatus()).toBe('connected'); // Le chat suit encore la partie.
    stopChat();
    expect(last().closedWith).toBe(1000);
    expect(client.getStatus()).toBe('idle');
  });

  it('suivi refusé par le serveur : aucun abonné du chat n’est prévenu à tort', async () => {
    const { client, last } = setup();
    const onError = jest.fn();
    client.subscribeChat(GAME, { onEvent: jest.fn(), onError });
    client.subscribeGame(GAME, { onChanged: jest.fn() });
    await connectReady(last);
    last().receive({ type: 'error', code: 'NOT_A_MEMBER', gameId: GAME, channel: 'game' });
    expect(onError).not.toHaveBeenCalled();
  });
});
