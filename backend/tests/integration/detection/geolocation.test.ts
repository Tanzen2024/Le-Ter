import { randomUUID } from 'node:crypto';

import type { Game } from '../../../src/domain/game/game';
import type { GameId, PlayerId } from '../../../src/domain/game/game-id';
import { PostgresDetectionRepository } from '../../../src/repositories/postgres-detection.repository';
import { PostgresGeolocationRepository } from '../../../src/repositories/postgres-geolocation.repository';
import { DetectionService } from '../../../src/services/detection/detection.service';
import { createGeoAnalyzers } from '../../../src/services/detection/geo-analyzers';
import { GeolocationService } from '../../../src/services/detection/geolocation.service';
import { createLogger } from '../../../src/utils/logger';
import { registerAndLogin } from '../../fixtures/auth';
import {
  as,
  createGameApiTestApp,
  expectStatus,
  type GameApiTestContext,
} from '../../fixtures/game-api';
import {
  createMigratedDatabase,
  PGLITE_TIMEOUT_MS,
  type TestDatabase,
} from '../../fixtures/pglite';
import { identityRandom } from '../../fixtures/random';
import { testRules } from '../../fixtures/rules';
import { GLOBAL_DETECTION_ON } from '../../fixtures/detection-switch';

/**
 * Couche géographique de la détection (R-36, étape 2, D-046) sur PostgreSQL : API des
 * positions, distances calculées par le serveur, analyses géographiques, isolation par
 * partie, conservation limitée, aucun impact sur le jeu.
 */
jest.setTimeout(60_000);

let database: TestDatabase;
let ctx: GameApiTestContext;
let positions: PostgresGeolocationRepository;
let detection: DetectionService;
let clock: { now: Date | null };

const DOUALA = { latitude: 4.0511, longitude: 9.7679 };
const YAOUNDE = { latitude: 3.848, longitude: 11.5021 };
const north = (meters: number) => ({
  latitude: DOUALA.latitude + meters / 111_195,
  longitude: DOUALA.longitude,
});

beforeAll(async () => {
  database = await createMigratedDatabase();
}, PGLITE_TIMEOUT_MS);
afterAll(() => database.close());
beforeEach(() => {
  clock = { now: null };
  positions = new PostgresGeolocationRepository(database.sql);
  const logger = createLogger({}, () => undefined);
  detection = new DetectionService({
    globalSwitch: GLOBAL_DETECTION_ON,
    repository: new PostgresDetectionRepository(database.sql),
    logger,
    // Seuil abaissé à 2 parties pour ne pas jouer 3 parties complètes (défaut : 3).
    analyzers: createGeoAnalyzers(positions, { repeatedGames: 2 }),
  });
  ctx = createGameApiTestApp(database.sql, {
    rules: testRules,
    random: identityRandom,
    decisionWindowMs: 60_000,
    turnDurationMs: 60_000,
    autoNextGame: true,
    geolocation: new GeolocationService({
      globalSwitch: GLOBAL_DETECTION_ON,
      repository: positions,
      logger,
      clock: () => clock.now ?? new Date(),
    }),
  });
  ctx.games.onGameFinished((game) => detection.observeFinishedGame(game));
});
afterEach(async () => {
  await ctx.stopTimers();
  await detection.idle();
  await database.reset();
});

async function newPlayer() {
  const session = await registerAndLogin(ctx.app);
  return {
    ...session,
    id: session.userId as PlayerId,
    api: as(ctx.app, session.accessToken),
  };
}
type Player = Awaited<ReturnType<typeof newPlayer>>;

/**
 * Table de `n` joueurs (partie en attente), détection activée ou non. Table surveillée :
 * chaque joueur consent (« Continuer », D-095) sauf `consent: false`.
 */
async function table(
  enabled: boolean,
  n = 2,
  given: Player[] = [],
  { consent = true }: { consent?: boolean } = {},
) {
  const players = [...given];
  while (players.length < n) players.push(await newPlayer());
  const [owner, ...guests] = players as [Player, ...Player[]];
  const res = await expectStatus(
    owner.api.post('/api/sessions', { maxPlayers: n, suspicionDetectionEnabled: enabled }),
    201,
  );
  const sessionId = res.body.session.sessionId as string;
  const gameId = res.body.game.gameId as GameId;
  for (const guest of guests) {
    await expectStatus(guest.api.post(`/api/sessions/${sessionId}/join`), 200);
    await expectStatus(guest.api.post(`/api/games/${gameId}/join`), 200);
  }
  if (enabled && consent) {
    for (const p of players) await expectStatus(giveConsent(p, gameId), 200);
  }
  return { players, owner, guest: guests[0]!, sessionId, gameId };
}

const giveConsent = (p: Player, gameId: string) =>
  p.api.post(`/api/games/${gameId}/geolocation/consent`, {});

const sendPosition = (
  p: Player,
  gameId: string,
  where: { latitude: number; longitude: number },
  extra: Record<string, unknown> = {},
) =>
  p.api.post(`/api/games/${gameId}/position`, {
    ...where,
    accuracy: 12,
    capturedAt: Date.now(),
    ...extra,
  });

/** Trace GPS écrite directement (dates maîtrisées), comme si le téléphone l'avait envoyée. */
async function track(
  gameId: GameId,
  playerId: PlayerId,
  points: [{ latitude: number; longitude: number }, number][],
  base = Date.now() - 10 * 60_000,
) {
  for (const [where, seconds] of points) {
    await positions.insertPosition({
      id: randomUUID(),
      gameId,
      playerId,
      ...where,
      accuracyMeters: 10,
      capturedAt: new Date(base + seconds * 1000),
      receivedAt: new Date(),
    });
  }
}

const closeTogether = async (gameId: GameId, a: PlayerId, b: PlayerId) => {
  await track(gameId, a, [
    [DOUALA, 0],
    [DOUALA, 45],
    [DOUALA, 90],
  ]);
  await track(gameId, b, [
    [north(20), 5],
    [north(20), 50],
    [north(20), 95],
  ]);
};

const count = async (table: string, gameId?: GameId) => {
  const { rows } = await database.sql.query<{ n: string }>(
    `SELECT count(*) AS n FROM ${table}${gameId ? ' WHERE game_id = $1' : ''}`,
    gameId ? [gameId] : [],
  );
  return Number(rows[0]!.n);
};
const detectionRows = async (gameId?: GameId) =>
  (await count('detection_positions', gameId)) +
  (await count('detection_signals', gameId)) +
  (await count('detection_scores', gameId));

const gameRecord = async (gameId: GameId) => (await ctx.games.findGame(gameId)) as Game;
/** Signaux d'une partie, triés (même horodatage dans une analyse : ordre non significatif). */
const signalsOf = async (gameId: GameId) =>
  (await detection.listSignals(gameId)).map((s) => [s.type, [...s.playerIds].sort()]).sort();

/** Distribution « identité » à 2 : le 2e joueur prend le contrôle et gagne. */
const SECOND_WINS: [0 | 1, string][] = [
  [0, 'COEUR-3'],
  [1, 'COEUR-6'],
  [1, 'PIQUE-3'],
  [0, 'COEUR-9'],
  [1, 'PIQUE-4'],
  [0, 'COEUR-10'],
  [1, 'COEUR-7'],
  [0, 'COEUR-4'],
];

async function playToEnd(owner: Player, guest: Player, gameId: GameId) {
  await expectStatus(owner.api.post(`/api/games/${gameId}/start`), 200);
  for (const [who, cardId] of SECOND_WINS) {
    await expectStatus(
      (who === 0 ? owner : guest).api.post(`/api/games/${gameId}/actions`, {
        commandId: randomUUID(),
        type: 'PLAY_CARD',
        payload: { cardId },
      }),
      200,
    );
  }
  await detection.idle();
}

describe('Activation par la table', () => {
  it('TEST 1 — détection désactivée : aucune position acceptée, aucune distance calculée', async () => {
    const { owner, gameId } = await table(false);
    const refused = await expectStatus(sendPosition(owner, gameId, DOUALA), 409);
    expect(refused.body.code).toBe('DETECTION_DISABLED');
    const status = await expectStatus(owner.api.get(`/api/games/${gameId}/geolocation`), 200);
    expect(status.body).toEqual({ detectionEnabled: false });
    // La base refuse aussi, même en contournant le service.
    await expect(track(gameId, owner.id, [[DOUALA, 0]])).rejects.toThrow();
    expect(await detectionRows()).toBe(0);
  });

  it('TEST 2 — détection activée : position acceptée, stockée avec une précision limitée', async () => {
    const { owner, guest, gameId } = await table(true);
    const res = await expectStatus(
      sendPosition(owner, gameId, { latitude: 4.051234567, longitude: 9.767891234 }),
      201,
    );
    expect(res.body).toEqual({
      distances: [
        { playerId: guest.id, meters: null, unavailable: 'WAITING', missingPosition: 'OTHER' },
      ],
    });
    const { rows } = await database.sql.query<{ latitude: string; longitude: string }>(
      'SELECT latitude, longitude, player_id FROM detection_positions WHERE game_id = $1',
      [gameId],
    );
    expect(rows.map((r) => [Number(r.latitude), Number(r.longitude)])).toEqual([[4.0512, 9.7679]]);
    // Vu de l'invité, c'est SA position qui manque : jamais celle de l'autre, jamais de coordonnée.
    const guestView = await expectStatus(guest.api.get(`/api/games/${gameId}/geolocation`), 200);
    expect(guestView.body.distances).toEqual([
      { playerId: owner.id, meters: null, unavailable: 'WAITING', missingPosition: 'VIEWER' },
    ]);
    const status = await expectStatus(owner.api.get(`/api/games/${gameId}/geolocation`), 200);
    expect(status.body).toMatchObject({
      detectionEnabled: true,
      collecting: true,
      collectionIntervalMs: 45_000,
    });
  });

  it('partie terminée : la collecte s’arrête (409 GAME_FINISHED, collecting = false)', async () => {
    const { owner, guest, gameId } = await table(true);
    await playToEnd(owner, guest, gameId);
    const res = await expectStatus(sendPosition(owner, gameId, DOUALA), 409);
    expect(res.body.code).toBe('GAME_FINISHED');
    const status = await expectStatus(owner.api.get(`/api/games/${gameId}/geolocation`), 200);
    expect(status.body.collecting).toBe(false);
  });
});

describe('Contrôles du serveur (identité = JWT, jamais le client)', () => {
  it('TEST 3 — utilisateur non membre : 403, rien d’enregistré', async () => {
    const { gameId } = await table(true);
    const stranger = await newPlayer();
    const res = await expectStatus(sendPosition(stranger, gameId, DOUALA), 403);
    expect(res.body.code).toBe('NOT_A_MEMBER');
    await expectStatus(stranger.api.get(`/api/games/${gameId}/geolocation`), 403);
    expect(await detectionRows()).toBe(0);
  });

  it('TEST 4 — gameId d’une autre partie : refusé (URL ou corps)', async () => {
    const a = await table(true);
    const b = await table(true);
    await expectStatus(sendPosition(a.owner, b.gameId, DOUALA), 403);
    const mismatch = await expectStatus(
      sendPosition(a.guest, a.gameId, DOUALA, { gameId: b.gameId }),
      400,
    );
    expect(mismatch.body.fields).toHaveProperty('gameId');
    await expectStatus(sendPosition(a.owner, randomUUID(), DOUALA), 404);
    // Base : une position de A ne peut pas citer un joueur de B.
    await expect(track(a.gameId, b.owner.id, [[DOUALA, 0]])).rejects.toThrow();
    expect(await detectionRows()).toBe(0);
  });

  it('un playerId envoyé est ignoré : la position est celle de l’appelant', async () => {
    const { owner, guest, gameId } = await table(true);
    await expectStatus(sendPosition(owner, gameId, DOUALA, { playerId: guest.id }), 201);
    const { rows } = await database.sql.query<{ player_id: string }>(
      'SELECT player_id FROM detection_positions',
    );
    expect(rows).toEqual([{ player_id: owner.id }]);
  });

  it.each<[string, Record<string, unknown>, string]>([
    ['TEST 5 — latitude invalide', { latitude: 123 }, 'latitude'],
    ['TEST 6 — longitude invalide', { longitude: -181 }, 'longitude'],
    ['précision déraisonnable', { accuracy: 50_000 }, 'accuracy'],
    ['position trop ancienne', { capturedAt: Date.now() - 10 * 60_000 }, 'capturedAt'],
    ['position datée du futur', { capturedAt: Date.now() + 10 * 60_000 }, 'capturedAt'],
  ])('%s : 400, rien d’enregistré', async (_label, extra, field) => {
    const { owner, gameId } = await table(true);
    const res = await expectStatus(sendPosition(owner, gameId, DOUALA, extra), 400);
    expect(res.body.code).toBe('VALIDATION_ERROR');
    expect(Object.keys(res.body.fields)).toEqual([field]);
    expect(await detectionRows()).toBe(0);
  });

  it('collecte excessive refusée (429) : jamais plusieurs positions par seconde', async () => {
    const { owner, gameId } = await table(true);
    for (let i = 0; i < 4; i += 1) {
      await expectStatus(sendPosition(owner, gameId, DOUALA), 201);
    }
    await expectStatus(sendPosition(owner, gameId, DOUALA), 429);
    expect(await count('detection_positions')).toBe(4);
  });
});

describe('Distances calculées par le serveur', () => {
  it('TEST 8 — 2 joueurs : chacun reçoit la distance de l’autre, arrondie', async () => {
    const { owner, guest, gameId } = await table(true);
    await expectStatus(sendPosition(owner, gameId, DOUALA), 201);
    const res = await expectStatus(sendPosition(guest, gameId, north(834)), 201);
    expect(res.body.distances).toEqual([{ playerId: owner.id, meters: 830 }]);
    const status = await expectStatus(owner.api.get(`/api/games/${gameId}/geolocation`), 200);
    expect(status.body.distances).toEqual([{ playerId: guest.id, meters: 830 }]);
  });

  it('TESTS 9 / 10 — 4 joueurs : 3 distances par joueur, — (null) sans position', async () => {
    const { players, gameId } = await table(true, 4);
    const [p1, p2, p3, p4] = players as [Player, Player, Player, Player];
    await expectStatus(sendPosition(p1, gameId, DOUALA), 201);
    await expectStatus(sendPosition(p2, gameId, north(100)), 201);
    await expectStatus(sendPosition(p3, gameId, north(1_000)), 201);
    // p4 a refusé la localisation : aucune position, aucune distance inventée.
    const view = await expectStatus(p1.api.get(`/api/games/${gameId}/geolocation`), 200);
    expect(view.body.distances).toEqual([
      { playerId: p2.id, meters: 100 },
      { playerId: p3.id, meters: 1_000 },
      { playerId: p4.id, meters: null, unavailable: 'WAITING', missingPosition: 'OTHER' },
    ]);
    const refused = await expectStatus(p4.api.get(`/api/games/${gameId}/geolocation`), 200);
    expect(refused.body.distances.map((d: { meters: unknown }) => d.meters)).toEqual([
      null,
      null,
      null,
    ]);
  });

  it('position trop ancienne : distance inconnue signalée STALE, sans âge ni coordonnée', async () => {
    const { owner, guest, gameId } = await table(true);
    await expectStatus(sendPosition(owner, gameId, DOUALA), 201);
    await expectStatus(sendPosition(guest, gameId, north(200)), 201);
    const fresh = await expectStatus(owner.api.get(`/api/games/${gameId}/geolocation`), 200);
    expect(fresh.body.distances).toEqual([{ playerId: guest.id, meters: 200 }]);
    // Les deux positions vieillissent au-delà de la fraîcheur d'affichage.
    await database.sql.query(
      `UPDATE detection_positions SET captured_at = captured_at - interval '10 minutes'
       WHERE game_id = $1`,
      [gameId],
    );
    const old = await expectStatus(owner.api.get(`/api/games/${gameId}/geolocation`), 200);
    expect(old.body.distances).toEqual([
      { playerId: guest.id, meters: null, unavailable: 'STALE', missingPosition: 'BOTH' },
    ]);
  });

  it('TEST 19 — aucune coordonnée dans les réponses aux joueurs', async () => {
    const { owner, guest, gameId } = await table(true);
    const precise = { latitude: 4.0517, longitude: 9.7683 };
    const responses = [
      await expectStatus(sendPosition(owner, gameId, precise), 201),
      await expectStatus(sendPosition(guest, gameId, north(300)), 201),
      await expectStatus(owner.api.get(`/api/games/${gameId}/geolocation`), 200),
      await expectStatus(guest.api.get(`/api/games/${gameId}/geolocation`), 200),
      await expectStatus(guest.api.get(`/api/games/${gameId}`), 200),
    ];
    for (const res of responses) {
      const text = JSON.stringify(res.body);
      expect(text).not.toMatch(/latitude|longitude|accuracy/i);
      expect(text).not.toContain('4.051');
      expect(text).not.toContain('9.768');
    }
  });
});

describe('Analyses géographiques (branchées sur DetectionService)', () => {
  it('TEST 11 — PROXIMITY enregistré en fin de partie, avec ses éléments ; un signal seul : aucune alerte', async () => {
    const { owner, guest, gameId } = await table(true);
    await closeTogether(gameId, owner.id, guest.id);
    await playToEnd(owner, guest, gameId);

    const signals = await detection.listSignals(gameId);
    expect(signals).toHaveLength(1);
    expect(signals[0]).toMatchObject({
      gameId,
      type: 'PROXIMITY',
      severity: 'high',
      contribution: 20,
      evidence: { strength: 'strong', samples: 3, durationMs: 90_000, medianMeters: 22 },
    });
    expect(JSON.stringify(signals[0]!.evidence)).not.toMatch(/latitude|longitude/);
    // Étape 4 (D-048) : score de la paire = ce seul signal ; un signal seul n'est jamais une alerte.
    expect(await detection.listScores(gameId)).toEqual([
      expect.objectContaining({ score: 20, level: 'low', scope: 'PAIR' }),
    ]);
    expect(await count('detection_alerts')).toBe(0);
  });

  it('TEST 13 — IMPOSSIBLE_TRAVEL et TEST 14 — INCOHERENT_LOCATION', async () => {
    const { owner, guest, gameId } = await table(true);
    await track(gameId, owner.id, [
      [DOUALA, 0],
      [YAOUNDE, 60],
      [north(30), 120],
    ]);
    await track(gameId, guest.id, [
      [YAOUNDE, 0],
      [YAOUNDE, 45],
    ]);
    await detection.analyzeGame(await gameRecord(gameId));
    expect(await signalsOf(gameId)).toEqual([
      ['IMPOSSIBLE_TRAVEL', [owner.id]],
      ['INCOHERENT_LOCATION', [owner.id]],
    ]);
  });

  it('TEST 18 — refus de localisation : aucun signal, aucun score, aucune trace du refus', async () => {
    const { owner, guest, gameId } = await table(true);
    await track(gameId, owner.id, [
      [DOUALA, 0],
      [DOUALA, 45],
      [DOUALA, 90],
    ]);
    // guest a refusé : aucune position.
    await playToEnd(owner, guest, gameId);
    expect(await count('detection_signals')).toBe(0);
    expect(await count('detection_scores')).toBe(0);
  });

  it('TEST 20 — l’analyse géographique ne modifie jamais l’état de la partie', async () => {
    const { owner, guest, gameId } = await table(true);
    await expectStatus(owner.api.post(`/api/games/${gameId}/start`), 200);
    await closeTogether(gameId, owner.id, guest.id);
    const before = await gameRecord(gameId);
    await detection.analyzeGame(before);
    const after = await gameRecord(gameId);
    expect(after).toEqual(before);
    expect(await signalsOf(gameId)).toEqual([['PROXIMITY', [owner.id, guest.id].sort()]]);
  });
});

describe('Historique de proximité entre parties surveillées', () => {
  const decide = (p: Player, sessionId: string, choice: 'continue' | 'leave') =>
    expectStatus(p.api.post(`/api/sessions/${sessionId}/decision`, { choice }), 200);

  async function nextGame(p: Player, sessionId: string, previous: GameId): Promise<GameId> {
    const until = Date.now() + 5_000;
    for (;;) {
      const res = await expectStatus(p.api.get(`/api/sessions/${sessionId}`), 200);
      const current = res.body.session.currentGame as { gameId: GameId } | null;
      if (current && current.gameId !== previous) return current.gameId;
      if (Date.now() > until) throw new Error('partie suivante non créée');
      await new Promise((r) => setTimeout(r, 50));
    }
  }

  async function waitFree(p: Player) {
    const until = Date.now() + 5_000;
    for (;;) {
      const res = await p.api.post('/api/sessions', { maxPlayers: 2 });
      if (res.status === 201) {
        // Table de sondage : quittée aussitôt (aucune partie lancée).
        const sessionId = res.body.session.sessionId as string;
        await expectStatus(p.api.post(`/api/sessions/${sessionId}/leave`), 200);
        return;
      }
      if (Date.now() > until) throw new Error(`joueur toujours occupé : ${res.status}`);
      await new Promise((r) => setTimeout(r, 50));
    }
  }

  it('TEST 12 — REPEATED_PROXIMITY : même paire proche dans deux parties surveillées', async () => {
    const first = await table(true);
    const { owner, guest } = first;
    await closeTogether(first.gameId, owner.id, guest.id);
    await playToEnd(owner, guest, first.gameId);
    expect(await signalsOf(first.gameId)).toEqual([['PROXIMITY', [owner.id, guest.id].sort()]]);

    await decide(owner, first.sessionId, 'continue');
    await decide(guest, first.sessionId, 'continue');
    const second = await nextGame(owner, first.sessionId, first.gameId);
    await closeTogether(second, owner.id, guest.id);
    await detection.analyzeGame(await gameRecord(second));

    // Signaux d'une même analyse : même horodatage, ordre non significatif.
    const signals = await detection.listSignals(second);
    expect(signals.map((s) => s.type).sort()).toEqual(['PROXIMITY', 'REPEATED_PROXIMITY']);
    expect(signals.find((s) => s.type === 'REPEATED_PROXIMITY')).toMatchObject({
      gameId: second,
      evidence: { gamesWithProximity: 2, windowDays: 30 },
    });
    // La partie précédente n'est jamais modifiée par l'analyse de la suivante.
    expect(await count('detection_signals', first.gameId)).toBe(1);
  });

  it('TEST 17 — une partie non surveillée n’alimente jamais l’historique', async () => {
    const unwatched = await table(false);
    const { owner, guest } = unwatched;
    await expectStatus(sendPosition(owner, unwatched.gameId, DOUALA), 409);
    await playToEnd(owner, guest, unwatched.gameId);
    expect(await detectionRows(unwatched.gameId)).toBe(0);

    await decide(owner, unwatched.sessionId, 'leave');
    await decide(guest, unwatched.sessionId, 'leave');
    await waitFree(owner);
    await waitFree(guest);

    const watched = await table(true, 2, [owner, guest]);
    await closeTogether(watched.gameId, owner.id, guest.id);
    await detection.analyzeGame(await gameRecord(watched.gameId));
    // Proximité dans la partie surveillée, mais aucune répétition (l'autre n'est pas surveillée).
    expect((await detection.listSignals(watched.gameId)).map((s) => s.type)).toEqual(['PROXIMITY']);
  });
});

describe('TEST 15 — isolation entre deux parties', () => {
  it('positions, distances et signaux de A jamais visibles ni écrits dans B', async () => {
    const a = await table(true);
    const b = await table(true);
    await closeTogether(a.gameId, a.owner.id, a.guest.id);
    await expectStatus(sendPosition(b.owner, b.gameId, DOUALA), 201);

    // Même lieu que les joueurs de A, mais aucune distance vers eux : B ne voit que B.
    const viewB = await expectStatus(b.owner.api.get(`/api/games/${b.gameId}/geolocation`), 200);
    expect(viewB.body.distances).toEqual([
      { playerId: b.guest.id, meters: null, unavailable: 'WAITING', missingPosition: 'OTHER' },
    ]);

    await Promise.all([
      detection.analyzeGame(await gameRecord(a.gameId)),
      detection.analyzeGame(await gameRecord(b.gameId)),
    ]);
    expect(await signalsOf(a.gameId)).toEqual([['PROXIMITY', [a.owner.id, a.guest.id].sort()]]);
    expect(await count('detection_signals', b.gameId)).toBe(0);
    expect((await positions.listPositions(b.gameId)).every((p) => p.gameId === b.gameId)).toBe(
      true,
    );
    expect(await count('detection_positions', b.gameId)).toBe(1);
  });
});

describe('TEST 16 — conservation : 24 h au plus après la fin de la partie', () => {
  it('les positions d’une partie terminée sont supprimées avant 24 h, pas trop tôt', async () => {
    const ended = await table(true);
    const running = await table(true);
    await closeTogether(ended.gameId, ended.owner.id, ended.guest.id);
    await playToEnd(ended.owner, ended.guest, ended.gameId);
    await expectStatus(sendPosition(running.owner, running.gameId, DOUALA), 201);
    const geolocation = new GeolocationService({
      globalSwitch: GLOBAL_DETECTION_ON,
      repository: positions,
      logger: createLogger({}, () => undefined),
      clock: () => clock.now ?? new Date(),
    });

    const { rows } = await database.sql.query<{ finished_at: Date }>(
      'SELECT finished_at FROM games WHERE id = $1',
      [ended.gameId],
    );
    const endedAt = rows[0]!.finished_at.getTime();

    // Nettoyage horaire : une position doit partir dès 23 h pour ne jamais dépasser 24 h.
    clock.now = new Date(endedAt + 22 * 3600_000);
    expect(await geolocation.purgeExpired()).toBe(0);
    expect(await count('detection_positions', ended.gameId)).toBe(6);

    clock.now = new Date(endedAt + 23 * 3600_000 + 1);
    expect(await geolocation.purgeExpired()).toBeGreaterThanOrEqual(6);
    expect(await count('detection_positions', ended.gameId)).toBe(0);

    // Partie en cours : au plus tard 24 h après la capture.
    clock.now = new Date(Date.now() + 23 * 3600_000 + 60_000);
    await geolocation.purgeExpired();
    expect(await count('detection_positions')).toBe(0);
    // Les signaux (sans coordonnées) restent rattachés à leur partie.
    expect(await count('detection_signals', ended.gameId)).toBe(1);
  });

  it('nettoyage automatique au démarrage puis à intervalle régulier', async () => {
    const purged: number[] = [];
    const service = new GeolocationService({
      globalSwitch: GLOBAL_DETECTION_ON,
      repository: { ...positions, purgeExpired: async () => (purged.push(Date.now()), 0) } as never,
      logger: createLogger({}, () => undefined),
    });
    const stop = service.startRetention(20);
    await new Promise((r) => setTimeout(r, 70));
    stop();
    const calls = purged.length;
    expect(calls).toBeGreaterThanOrEqual(2);
    await new Promise((r) => setTimeout(r, 50));
    expect(purged).toHaveLength(calls);
  });
});

describe('Consentement par participation (D-095)', () => {
  const geoStatus = async (p: Player, gameId: GameId) =>
    (await expectStatus(p.api.get(`/api/games/${gameId}/geolocation`), 200)).body;
  const consentRows = async () => count('detection_consents');

  it('table surveillée sans consentement : explication due, aucune position acceptée', async () => {
    const { owner, gameId } = await table(true, 2, [], { consent: false });
    expect(await geoStatus(owner, gameId)).toMatchObject({
      detectionEnabled: true,
      collecting: true,
      consentGiven: false,
    });
    const refused = await expectStatus(sendPosition(owner, gameId, DOUALA), 403);
    expect(refused.body.code).toBe('DETECTION_CONSENT_REQUIRED');
    expect(await count('detection_positions')).toBe(0);
  });

  it('« Continuer » : consentement enregistré par le serveur, puis position acceptée', async () => {
    const { owner, guest, sessionId, gameId } = await table(true, 2, [], { consent: false });
    const res = await expectStatus(giveConsent(owner, gameId), 200);
    expect(res.body).toMatchObject({ detectionEnabled: true, consentGiven: true });
    const { rows } = await database.sql.query<{ session_id: string; player_id: string; game_id: string }>(
      'SELECT session_id, player_id, game_id FROM detection_consents',
    );
    expect(rows).toEqual([{ session_id: sessionId, player_id: owner.id, game_id: gameId }]);
    await expectStatus(sendPosition(owner, gameId, DOUALA), 201);
    // Le consentement de l'un ne vaut jamais pour l'autre.
    expect((await geoStatus(guest, gameId)).consentGiven).toBe(false);
  });

  it('double clic / appels simultanés : un seul consentement, réponse identique', async () => {
    const { owner, gameId } = await table(true, 2, [], { consent: false });
    const [a, b] = await Promise.all([giveConsent(owner, gameId), giveConsent(owner, gameId)]);
    expect([a.status, b.status]).toEqual([200, 200]);
    await expectStatus(giveConsent(owner, gameId), 200);
    expect(await consentRows()).toBe(1);
  });

  it('table non surveillée : aucun consentement demandé ni enregistré, démarrage libre', async () => {
    const { owner, guest, gameId } = await table(false);
    const res = await expectStatus(giveConsent(owner, gameId), 409);
    expect(res.body.code).toBe('DETECTION_DISABLED');
    expect(await consentRows()).toBe(0);
    await expectStatus(owner.api.post(`/api/games/${gameId}/start`), 200);
    void guest;
  });

  it('démarrage refusé tant qu’un joueur n’a pas consenti, accepté ensuite', async () => {
    const { owner, guest, gameId } = await table(true, 2, [], { consent: false });
    await expectStatus(giveConsent(owner, gameId), 200);
    const refused = await expectStatus(owner.api.post(`/api/games/${gameId}/start`), 409);
    expect(refused.body).toMatchObject({
      code: 'DETECTION_CONSENT_PENDING',
      details: { pendingPlayers: 1 },
    });
    // Aucune identité ni coordonnée dans le refus.
    expect(JSON.stringify(refused.body)).not.toContain(guest.id);
    expect((await gameRecord(gameId)).status).toBe('waiting');
    await expectStatus(giveConsent(guest, gameId), 200);
    await expectStatus(owner.api.post(`/api/games/${gameId}/start`), 200);
  });

  it('« Non merci » : départ réel de la table et de la partie, idempotent, plus aucun accès', async () => {
    const { owner, guest, sessionId, gameId } = await table(true, 2, [], { consent: false });
    await expectStatus(giveConsent(owner, gameId), 200);
    // Double clic : deux départs, un seul effet.
    const [first, second] = await Promise.all([
      guest.api.post(`/api/sessions/${sessionId}/leave`),
      guest.api.post(`/api/sessions/${sessionId}/leave`),
    ]);
    expect([first.status, second.status]).toEqual([200, 200]);
    await expectStatus(guest.api.post(`/api/sessions/${sessionId}/leave`), 200);

    const game = await gameRecord(gameId);
    expect(game.players.map((p) => p.playerId)).toEqual([owner.id]);
    const session = (await expectStatus(owner.api.get(`/api/sessions/${sessionId}`), 200)).body
      .session;
    expect(session.seats.map((s: { playerId: string | null }) => s.playerId)).toEqual([
      owner.id,
      null,
    ]);
    // Le joueur parti n'a plus accès à la partie refusée.
    await expectStatus(guest.api.get(`/api/games/${gameId}/geolocation`), 403);
    await expectStatus(giveConsent(guest, gameId), 403);
    await expectStatus(sendPosition(guest, gameId, DOUALA), 403);
    expect((await expectStatus(guest.api.get('/api/games/me/active'), 200)).body.games).toEqual(
      [],
    );
    // L'autre joueur garde sa place, sa partie et son consentement.
    expect((await geoStatus(owner, gameId)).consentGiven).toBe(true);
  });

  it('retour à la table après un départ : nouvelle participation, nouveau consentement', async () => {
    const { owner, guest, sessionId, gameId } = await table(true);
    await expectStatus(guest.api.post(`/api/sessions/${sessionId}/leave`), 200);
    await expectStatus(guest.api.post(`/api/sessions/${sessionId}/join`), 200);
    await expectStatus(guest.api.post(`/api/games/${gameId}/join`), 200);
    expect((await geoStatus(guest, gameId)).consentGiven).toBe(false);
    await expectStatus(owner.api.post(`/api/games/${gameId}/start`), 409);
  });

  it('reconnexion : l’état relu du serveur fait foi, consentement conservé pour la partie suivante', async () => {
    const { owner, guest, sessionId, gameId } = await table(true);
    // Relecture après reconnexion : même réponse, aucun nouveau consentement demandé.
    expect((await geoStatus(guest, gameId)).consentGiven).toBe(true);
    await playToEnd(owner, guest, gameId);
    await expectStatus(owner.api.post(`/api/sessions/${sessionId}/decision`, { choice: 'continue' }), 200);
    await expectStatus(guest.api.post(`/api/sessions/${sessionId}/decision`, { choice: 'continue' }), 200);
    const until = Date.now() + 5_000;
    let next: GameId | null = null;
    while (!next) {
      const res = await expectStatus(owner.api.get(`/api/sessions/${sessionId}`), 200);
      const current = res.body.session.currentGame as { gameId: GameId } | null;
      if (current && current.gameId !== gameId) next = current.gameId;
      else if (Date.now() > until) throw new Error('partie suivante non créée');
      else await new Promise((r) => setTimeout(r, 50));
    }
    expect((await geoStatus(owner, next)).consentGiven).toBe(true);
    expect((await geoStatus(guest, next)).consentGiven).toBe(true);
    await expectStatus(sendPosition(guest, next, DOUALA), 201);
  });

  it('isolation : consentement et départ d’une table sans effet sur une autre table', async () => {
    const a = await table(true, 2, [], { consent: false });
    const b = await table(true, 2, [], { consent: false });
    await expectStatus(giveConsent(a.owner, a.gameId), 200);
    expect((await geoStatus(b.owner, b.gameId)).consentGiven).toBe(false);
    await expectStatus(giveConsent(b.owner, b.gameId), 200);
    await expectStatus(giveConsent(b.guest, b.gameId), 200);
    await expectStatus(a.guest.api.post(`/api/sessions/${a.sessionId}/leave`), 200);
    expect((await gameRecord(b.gameId)).players).toHaveLength(2);
    expect((await geoStatus(b.guest, b.gameId)).consentGiven).toBe(true);
    await expectStatus(b.owner.api.post(`/api/games/${b.gameId}/start`), 200);
  });
});
