import { InvalidPlayerCountError } from '../../../src/domain/game/game-errors';
import { parseGameId, toPlayerId, type PlayerId } from '../../../src/domain/game/game-id';
import {
  NoDecisionPendingError,
  NotASessionMemberError,
  PlayerInActiveGameError,
  SESSION_DECISION_WINDOW_MS,
  SessionClosedError,
  SessionDecisionInProgressError,
  SessionFullError,
  arrivalOrder,
  decide,
  joinSession,
  leaveSession,
  newSession,
  nextByArrival,
  pendingDecisions,
  seatMap,
  syncDecisionRound,
  type LastGameInfo,
  type Session,
} from '../../../src/domain/sessions/session';
import {
  determineFirstPlayer,
  getNextPlayer,
  nextOccupiedSeat,
  rotateFrom,
} from '../../../src/domain/sessions/table-order';

const NOW = new Date('2026-10-07T10:00:00Z');
const at = (ms: number) => new Date(NOW.getTime() + ms);
const [A, B, C, D, E] = ['A', 'B', 'C', 'D', 'E'].map(toPlayerId) as [
  PlayerId,
  PlayerId,
  PlayerId,
  PlayerId,
  PlayerId,
];
const G1 = parseGameId('00000000-0000-4000-8000-000000000001');
const ORDER = [A, B, C, D]; // sièges 0..3 = sens antihoraire

/** Session à 4 places : A (créateur, siège 0), puis B, C, D aux sièges 1, 2, 3. */
function table(maxPlayers = 4, players: PlayerId[] = [B, C, D]): Session {
  let s = newSession(A, maxPlayers, NOW);
  for (const p of players) {
    s = joinSession(s, p, NOW).session;
  }
  return s;
}

const seats = (s: Session) => seatMap(s).map((p) => p ?? 'VACANT');

const finished = (overrides: Partial<LastGameInfo> = {}): LastGameInfo => ({
  gameId: G1,
  status: 'finished',
  finishedAt: NOW,
  endReason: 'CONTROL_AFTER_LAST_TRICK',
  firstPlayerId: A,
  creatorId: A,
  playerIds: [A, B, C, D],
  ...overrides,
});

/** Départ entre deux parties : la dernière est terminée, l'historique existe. */
const AFTER_GAME = { lastGame: finished(), hasFinishedGames: true };

describe('Ordre de la table (sens antihoraire, implémentation unique)', () => {
  it('rotateFrom part de J1 et boucle : J4 → J1', () => {
    expect(rotateFrom(ORDER, A)).toEqual([A, B, C, D]);
    expect(rotateFrom(ORDER, C)).toEqual([C, D, A, B]);
    expect(rotateFrom(ORDER, D)).toEqual([D, A, B, C]);
  });

  it.each([
    [
      [A, B],
      [B, A],
    ],
    [
      [A, B, C],
      [B, C, A],
    ],
    [
      [A, B, C, D],
      [B, C, D, A],
    ],
  ])('getNextPlayer à %j joueurs : J1→J2→…→J1', (order, expected) => {
    expect(order.map((p) => getNextPlayer(order, p))).toEqual(expected);
  });

  it('nextOccupiedSeat : part du siège suivant, saute les vacants, finit par le siège de départ', () => {
    const occupants: (PlayerId | undefined)[] = [A, undefined, undefined, D];
    expect(nextOccupiedSeat(4, 1, (s) => occupants[s])).toBe(D);
    expect(nextOccupiedSeat(4, 3, (s) => occupants[s])).toBe(A);
    expect(nextOccupiedSeat(4, 0, (s) => [A, undefined, undefined, undefined][s])).toBe(A);
    expect(nextOccupiedSeat(4, 2, () => undefined)).toBeUndefined();
  });
});

describe('Capacité de la session (D-034)', () => {
  it.each([2, 3, 4])('maxPlayers = %i accepté, persisté dans la session', (n) => {
    expect(newSession(A, n, NOW).maxPlayers).toBe(n);
  });

  it.each([0, 1, 5, 2.5, -2])('maxPlayers = %p refusé', (n) => {
    expect(() => newSession(A, n, NOW)).toThrow(InvalidPlayerCountError);
  });

  it.each([2, 3, 4])('maxPlayers = %i : jamais plus de joueurs présents que de sièges', (n) => {
    let s = newSession(A, n, NOW);
    for (const p of [B, C, D].slice(0, n - 1)) {
      s = joinSession(s, p, NOW).session;
    }
    expect(s.players.filter((p) => p.active)).toHaveLength(n);
    expect(() => joinSession(s, E, NOW)).toThrow(SessionFullError);
  });
});

describe('Sièges fixes (D-034)', () => {
  it('attribution initiale : créateur au siège 0, puis les sièges libres dans l’ordre', () => {
    expect(seats(table())).toEqual([A, B, C, D]);
    expect(seats(table(4, [B]))).toEqual([A, B, 'VACANT', 'VACANT']);
  });

  it('un départ libère le siège : il devient VACANT, les autres ne bougent pas', () => {
    const s = leaveSession(table(), C, NOW, AFTER_GAME).session;
    expect(seats(s)).toEqual([A, B, 'VACANT', D]);
  });

  it('un nouveau joueur prend le siège vacant, pas « la fin »', () => {
    let s = leaveSession(table(), C, NOW, AFTER_GAME).session;
    const joined = joinSession(s, E, NOW);
    s = joined.session;
    expect(seats(s)).toEqual([A, B, E, D]);
    expect(joined.events).toEqual([
      { type: 'session:player_joined', payload: { playerId: E, seat: 2 } },
    ]);
  });

  it('le premier siège vacant (le plus petit) est pris en priorité', () => {
    let s = leaveSession(table(), D, NOW, AFTER_GAME).session;
    s = leaveSession(s, B, NOW, AFTER_GAME).session;
    expect(seats(s)).toEqual([A, 'VACANT', C, 'VACANT']);
    s = joinSession(s, E, NOW).session;
    expect(seats(s)).toEqual([A, E, C, 'VACANT']);
  });

  it('un ancien joueur qui revient suit la même règle (siège vacant)', () => {
    let s = leaveSession(table(), B, NOW, AFTER_GAME).session;
    s = leaveSession(s, D, NOW, AFTER_GAME).session;
    s = joinSession(s, D, NOW).session; // D revient : premier siège libre = 1
    expect(seats(s)).toEqual([A, D, C, 'VACANT']);
    // Historique : une seule ligne par joueur, B reste parti.
    expect(s.players.find((p) => p.playerId === B)).toMatchObject({ active: false });
  });

  it('rejoindre deux fois est sans effet', () => {
    const s = table();
    expect(joinSession(s, B, NOW)).toEqual({ session: s, events: [] });
  });
});

describe('J1 d’une nouvelle partie (D-033, D-034)', () => {
  const j1 = (
    s: Session,
    previousGame: { winnerId?: PlayerId; winnerSeat?: number; tieFirstPlayerId?: PlayerId } | null,
  ) => {
    const occupants = seatMap(s);
    return determineFirstPlayer({
      creatorId: s.creatorId,
      seatCount: s.maxPlayers,
      occupantOf: (seat) => occupants[seat],
      isActive: (p) => s.players.some((x) => x.playerId === p && x.active),
      previousGame,
    });
  };

  it('TEST 1 — première partie : J1 = créateur de la session', () => {
    expect(j1(table(), null)).toEqual({ kind: 'first', playerId: A });
  });

  it('TEST 2 — partie suivante : J1 = gagnant précédent présent', () => {
    expect(j1(table(), { winnerId: B, winnerSeat: 1 })).toEqual({ kind: 'first', playerId: B });
  });

  it('TEST 3 — gagnant B parti : J1 = C, premier siège occupé après celui de B', () => {
    const s = leaveSession(table(), B, NOW, AFTER_GAME).session;
    expect(j1(s, { winnerId: B, winnerSeat: 1 })).toEqual({ kind: 'first', playerId: C });
  });

  it('TEST 4 — B et C partis : D ; puis D aussi : tour de la table jusqu’à A', () => {
    let s = leaveSession(table(), B, NOW, AFTER_GAME).session;
    s = leaveSession(s, C, NOW, AFTER_GAME).session;
    expect(j1(s, { winnerId: B, winnerSeat: 1 })).toEqual({ kind: 'first', playerId: D });
    s = leaveSession(s, D, NOW, AFTER_GAME).session;
    expect(j1(s, { winnerId: B, winnerSeat: 1 })).toEqual({ kind: 'first', playerId: A });
  });

  it('TEST 5 — gagnant D (siège 3) parti : on repart au siège 0 (circulaire)', () => {
    const s = leaveSession(table(), D, NOW, AFTER_GAME).session;
    expect(j1(s, { winnerId: D, winnerSeat: 3 })).toEqual({ kind: 'first', playerId: A });
  });

  it('TEST 6 — le siège du gagnant repris par un nouveau venu est examiné en dernier', () => {
    let s = leaveSession(table(4, [B]), B, NOW, AFTER_GAME).session;
    s = joinSession(s, E, NOW).session; // E prend le siège 1, celui du gagnant B
    expect(seats(s)).toEqual([A, E, 'VACANT', 'VACANT']);
    expect(j1(s, { winnerId: B, winnerSeat: 1 })).toEqual({ kind: 'first', playerId: A });
    const alone = leaveSession(s, A, NOW, AFTER_GAME).session;
    expect(j1(alone, { winnerId: B, winnerSeat: 1 })).toEqual({ kind: 'first', playerId: E });
  });

  it('les sièges ne changent JAMAIS quand J1 change', () => {
    const s = table();
    const before = seats(s);
    expect(j1(s, { winnerId: C, winnerSeat: 2 })).toEqual({ kind: 'first', playerId: C });
    expect(seats(s)).toEqual(before);
  });

  it('TEST 7 — reprise après égalité de priorité : le MÊME J1 (décision 23), sièges inchangés', () => {
    const s = table();
    expect(j1(s, { tieFirstPlayerId: C })).toEqual({ kind: 'first', playerId: C });
    expect(seats(s)).toEqual([A, B, C, D]);
    const without = leaveSession(s, C, NOW, AFTER_GAME).session;
    expect(j1(without, { tieFirstPlayerId: C })).toEqual({ kind: 'undetermined' });
  });

  it('dernière partie terminée sans gagnant : J1 indéterminé (aucune règle, pas de choix arbitraire)', () => {
    expect(j1(table(), {})).toEqual({ kind: 'undetermined' });
  });
});

describe('Départ et fermeture', () => {
  it('quitter : refusé dans la partie EN COURS ; le dernier départ ferme la session (historique)', () => {
    let s = table(2, [B]);
    const inProgress = finished({ status: 'in_progress', playerIds: [A, B] });
    expect(() =>
      leaveSession(s, A, NOW, { lastGame: inProgress, hasFinishedGames: false }),
    ).toThrow(PlayerInActiveGameError);
    s = leaveSession(s, A, NOW, AFTER_GAME).session;
    expect(s.status).toBe('open');
    const last = leaveSession(s, B, NOW, AFTER_GAME);
    expect(last.events.map((e) => e.type)).toEqual(['session:player_left', 'session:closed']);
    expect(last.session).toMatchObject({ status: 'closed', closedAt: NOW });
    expect(last.session.players).toHaveLength(2); // historique conservé
  });

  it('session fermée : ni arrivée, ni décision ; quitter deux fois est sans effet', () => {
    const closed = leaveSession(newSession(A, 2, NOW), A, NOW, AFTER_GAME).session;
    expect(() => joinSession(closed, B, NOW)).toThrow(SessionClosedError);
    expect(() => decide(closed, A, 'continue', NOW)).toThrow(SessionClosedError);
    expect(leaveSession(closed, A, NOW, AFTER_GAME).events).toEqual([]);
    expect(() => leaveSession(closed, B, NOW, AFTER_GAME)).toThrow(NotASessionMemberError);
  });
});

describe('Poursuivre / Quitter entre deux parties (D-034)', () => {
  const open = (s: Session = table()) => syncDecisionRound(s, finished(), NOW).session;

  it('la fin de partie ouvre une ronde de 10 s pour tous les présents', () => {
    expect(SESSION_DECISION_WINDOW_MS).toBe(13_000); // D-098 : 10 s affichées + 3 s de marge;
    const { session, events } = syncDecisionRound(table(), finished(), at(1));
    expect(session.round).toMatchObject({
      gameId: G1,
      openedAt: NOW,
      deadlineAt: at(SESSION_DECISION_WINDOW_MS),
    });
    expect(events).toEqual([
      {
        type: 'session:decision_started',
        payload: { gameId: G1, deadlineAt: at(SESSION_DECISION_WINDOW_MS).toISOString(), playerIds: [A, B, C, D] },
      },
    ]);
    expect(pendingDecisions(session)).toEqual([A, B, C, D]);
    // Idempotente : la même partie n'ouvre pas une seconde ronde.
    expect(syncDecisionRound(session, finished(), at(2)).events).toEqual([]);
  });

  it('égalité de priorité : AUCUNE ronde Poursuivre/Quitter (reprise immédiate, décision 17)', () => {
    const s = table();
    expect(syncDecisionRound(s, finished({ endReason: 'INSTANT_WIN_TIE' }), NOW).events).toEqual(
      [],
    );
    expect(
      syncDecisionRound(s, finished({ endReason: 'INSTANT_WIN_TIE' }), at(60_000)).events,
    ).toEqual([]);
  });

  it('pas de ronde tant que la partie n’est pas terminée', () => {
    const s = table();
    expect(syncDecisionRound(s, finished({ status: 'in_progress' }), NOW).events).toEqual([]);
  });

  it('Poursuivre : le joueur reste ; répéter le choix est sans effet', () => {
    const s = decide(open(), B, 'continue', at(1)).session;
    expect(s.round?.decisions[B]).toEqual({ choice: 'continue', decidedAt: at(1) });
    expect(seats(s)).toEqual([A, B, C, D]);
    expect(decide(s, B, 'continue', at(2)).events).toEqual([]);
  });

  it('Quitter : le joueur part tout de suite, son siège est vacant', () => {
    const { session, events } = decide(open(), C, 'leave', at(1));
    expect(seats(session)).toEqual([A, B, 'VACANT', D]);
    expect(events.map((e) => e.type)).toEqual(['session:decision', 'session:player_left']);
  });

  it('tous ont répondu : la ronde est résolue avant l’échéance', () => {
    let s = open();
    for (const p of [A, B, C]) s = decide(s, p, 'continue', at(1)).session;
    const last = decide(s, D, 'leave', at(2));
    expect(last.session.round?.resolvedAt).toEqual(at(2));
    expect(last.events.at(-1)).toEqual({
      type: 'session:decision_closed',
      payload: { gameId: G1, continuingPlayerIds: [A, B, C] },
    });
  });

  it('absence de réponse : départ AUTOMATIQUE à 10 s, siège libéré', () => {
    let s = decide(open(), A, 'continue', at(1)).session;
    s = decide(s, B, 'continue', at(1)).session;
    expect(syncDecisionRound(s, finished(), at(SESSION_DECISION_WINDOW_MS - 1)).events).toEqual([]); // pas encore
    const { session, events } = syncDecisionRound(s, finished(), at(SESSION_DECISION_WINDOW_MS));
    expect(seats(session)).toEqual([A, B, 'VACANT', 'VACANT']);
    expect(session.round?.decisions[C]).toEqual({ choice: 'auto_leave', decidedAt: at(SESSION_DECISION_WINDOW_MS) });
    expect(events.map((e) => e.type)).toEqual([
      'session:auto_leave',
      'session:player_left',
      'session:auto_leave',
      'session:player_left',
      'session:decision_closed',
    ]);
    expect(session.status).toBe('open');
  });

  it('personne ne répond : tout le monde part, la session est FERMÉE', () => {
    const { session, events } = syncDecisionRound(open(), finished(), at(SESSION_DECISION_WINDOW_MS));
    expect(session).toMatchObject({ status: 'closed' });
    expect(session.players.every((p) => !p.active)).toBe(true);
    expect(events.filter((e) => e.type === 'session:closed')).toHaveLength(1);
  });

  it('pendant la ronde : arrivée refusée ; quitter vaut « Quitter »', () => {
    const s = open(table(4, [B]));
    expect(() => joinSession(s, E, NOW)).toThrow(SessionDecisionInProgressError);
    const left = leaveSession(s, B, at(1), AFTER_GAME);
    expect(left.session.round?.decisions[B]?.choice).toBe('leave');
  });

  it('un joueur arrivé pendant la partie participe aussi à la ronde', () => {
    // E rejoint pendant la partie (il n'en est pas joueur) puis la partie se termine.
    const s = joinSession(table(4, [B]), E, NOW).session;
    const { session } = syncDecisionRound(s, finished({ playerIds: [A, B] }), NOW);
    expect(pendingDecisions(session)).toEqual([A, B, E]);
  });

  it('aucune ronde ouverte : rien à décider', () => {
    expect(() => decide(table(), A, 'continue', NOW)).toThrow(NoDecisionPendingError);
  });
});

describe('Quitter une session dont la partie est EN ATTENTE (R-19, D-037)', () => {
  /** Partie en attente de la session : créateur et J1 = A par défaut, joueurs donnés. */
  const waiting = (playerIds: PlayerId[], overrides: Partial<LastGameInfo> = {}) => ({
    lastGame: finished({ status: 'waiting', playerIds, ...overrides }),
    hasFinishedGames: false,
  });

  it('TEST 1 / 5 / 6 — un joueur non-J1 part : siège vacant, autres sièges et J1 inchangés', () => {
    const s = table(4, [B, C]);
    const left = leaveSession(s, B, NOW, waiting([A, B, C]));
    expect(seats(left.session)).toEqual([A, 'VACANT', C, 'VACANT']);
    expect(left.session.status).toBe('open');
    expect(left.deleteSession).toBe(false);
    expect(left.waitingGame).toEqual({
      kind: 'remove_player',
      gameId: G1,
      playerId: B,
      firstPlayerId: A,
      creatorId: A,
    });
  });

  it('TEST 2 — J1 (créateur) part : J2 devient J1 et peut démarrer ; creatorId historique conservé', () => {
    const left = leaveSession(table(4, [B, C]), A, NOW, waiting([A, B, C]));
    expect(seats(left.session)).toEqual(['VACANT', B, C, 'VACANT']);
    expect(left.session.creatorId).toBe(A);
    expect(left.waitingGame).toMatchObject({
      kind: 'remove_player',
      firstPlayerId: B,
      creatorId: B,
    });
  });

  it('TEST 3 — départs successifs des J1 : A → B → C → D (ordre d’arrivée)', () => {
    let s = table(4, [B, C, D]);
    let game = waiting([A, B, C, D]);
    const expected: [PlayerId, PlayerId][] = [
      [A, B],
      [B, C],
      [C, D],
    ];
    for (const [leaver, next] of expected) {
      const left = leaveSession(s, leaver, NOW, game);
      expect(left.waitingGame).toMatchObject({ firstPlayerId: next, creatorId: next });
      s = left.session;
      game = waiting(
        game.lastGame.playerIds.filter((id) => id !== leaver),
        {
          firstPlayerId: next,
          creatorId: next,
        },
      );
    }
    // TEST 4 — D, dernier : partie supprimée, puis session supprimée (Q1).
    const last = leaveSession(s, D, NOW, game);
    expect(last.waitingGame).toEqual({ kind: 'delete', gameId: G1 });
    expect(last.deleteSession).toBe(true);
    expect(last.events.map((e) => e.type)).toEqual(['session:player_left', 'session:deleted']);
  });

  it('Q2 — l’ordre d’ARRIVÉE décide, pas le siège : un arrivant tardif au siège 1 passe après', () => {
    // A (siège 0), B (1), C (2) ; B part, E arrive et prend le siège 1, puis A part.
    let s = table(4, [B, C]);
    s = leaveSession(s, B, NOW, waiting([A, C])).session;
    s = joinSession(s, E, NOW).session;
    expect(seats(s)).toEqual([A, E, C, 'VACANT']);
    const left = leaveSession(s, A, NOW, waiting([A, C, E]));
    // Ordre d'arrivée : A, B (parti), C, E → C, bien qu'E soit assis avant lui.
    expect(left.waitingGame).toMatchObject({ firstPlayerId: C, creatorId: C });
  });

  it('Q2 — un joueur qui revient est le DERNIER arrivé', () => {
    let s = table(4, [B, C]);
    s = leaveSession(s, B, NOW, waiting([A])).session;
    s = joinSession(s, B, NOW).session; // B revient : rang 4
    expect(s.players.find((p) => p.playerId === B)?.arrival).toBe(4);
    const left = leaveSession(s, A, NOW, waiting([A, B, C]));
    expect(left.waitingGame).toMatchObject({ firstPlayerId: C });
  });

  it('J1 hors de la partie qui reste : seul le droit de démarrer change de main', () => {
    // Partie suivante créée par C, J1 = B (gagnant) qui ne l'a pas encore rejointe.
    const game = waiting([C, D], { firstPlayerId: B, creatorId: C });
    const left = leaveSession(table(4, [B, C, D]), C, NOW, game);
    expect(left.waitingGame).toMatchObject({
      kind: 'remove_player',
      firstPlayerId: B,
      creatorId: D,
    });
  });

  it('partie sans plus aucun joueur : supprimée ; la session continue avec les présents', () => {
    const left = leaveSession(table(4, [B]), A, NOW, waiting([A]));
    expect(left.waitingGame).toEqual({ kind: 'delete', gameId: G1 });
    expect(left.deleteSession).toBe(false);
    expect(left.session.status).toBe('open');
  });

  it('joueur présent hors de la partie en attente : la partie ne change pas', () => {
    const left = leaveSession(table(4, [B, C]), C, NOW, waiting([A, B]));
    expect(left.waitingGame).toBeUndefined();
  });

  it('TEST 10 / Q1 — seul joueur, sans historique : session SUPPRIMÉE avec sa partie', () => {
    const left = leaveSession(newSession(A, 2, NOW), A, NOW, waiting([A]));
    expect(left.deleteSession).toBe(true);
    expect(left.waitingGame).toEqual({ kind: 'delete', gameId: G1 });
  });

  it('Q1 — dernier départ avec un historique : session FERMÉE, partie en attente supprimée', () => {
    const left = leaveSession(newSession(A, 2, NOW), A, NOW, {
      ...waiting([A]),
      hasFinishedGames: true,
    });
    expect(left.deleteSession).toBe(false);
    expect(left.session.status).toBe('closed');
    expect(left.waitingGame).toEqual({ kind: 'delete', gameId: G1 });
  });

  it('TEST 7 — partie EN COURS : refusé à un participant, accepté à un présent hors partie', () => {
    const inProgress = {
      lastGame: finished({ status: 'in_progress', playerIds: [A, B] }),
      hasFinishedGames: false,
    };
    expect(() => leaveSession(table(4, [B, C]), B, NOW, inProgress)).toThrow(
      PlayerInActiveGameError,
    );
    const left = leaveSession(table(4, [B, C]), C, NOW, inProgress);
    expect(left.waitingGame).toBeUndefined();
    expect(seats(left.session)).toEqual([A, B, 'VACANT', 'VACANT']);
  });

  it('J1 de la 1re partie quand le créateur est parti : le présent suivant dans l’ordre d’arrivée', () => {
    const s = leaveSession(table(4, [B, C]), A, NOW, waiting([A])).session;
    const occupants = seatMap(s);
    expect(
      determineFirstPlayer({
        creatorId: s.creatorId,
        arrivalOrder: arrivalOrder(s),
        seatCount: s.maxPlayers,
        occupantOf: (seat) => occupants[seat],
        isActive: (p) => s.players.some((x) => x.playerId === p && x.active),
        previousGame: null,
      }),
    ).toEqual({ kind: 'first', playerId: B });
    expect(nextByArrival(s, A, () => true)).toBe(B);
  });
});
