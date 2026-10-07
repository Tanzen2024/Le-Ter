import { randomUUID } from 'node:crypto';

import { Pool } from 'pg';

import { loadMigrations, runMigrations } from '../../../src/database/migrator';
import { createPgSqlClient, type SqlClient } from '../../../src/database/sql-client';
import type { CardId } from '../../../src/domain/cards/card';
import { registerAndLogin } from '../../fixtures/auth';
import {
  as,
  createGameApiTestApp,
  expectStatus,
  type GameApiTestContext,
} from '../../fixtures/game-api';
import { deckForHands, decksRandom } from '../../fixtures/random';

/**
 * SIÈGES FIXES (décisions 9-12, 22-23), vérifiés sur PostgreSQL RÉEL, par l'API HTTP.
 *
 * Le test compare des valeurs réelles, joueur par joueur : la table `playerId → siège`
 * capturée AVANT est égale à celle d'APRÈS. Sources comparées :
 * - le siège de session (`GET /api/sessions/:id`, `session_players.seat`) ;
 * - le siège porté par chaque joueur dans la partie (`tablePosition`,
 *   `game_players.table_position`), qui doit être le siège de session.
 *
 * Exécuté quand TEST_DATABASE_URL est défini (schéma temporaire supprimé à la fin).
 */
const databaseUrl = process.env.TEST_DATABASE_URL;
const describeWithPostgres = databaseUrl ? describe : describe.skip;
jest.setTimeout(60_000);

type SeatMap = Record<string, number>;

describeWithPostgres('Sièges fixes — PostgreSQL réel', () => {
  const schema = `seat_test_${randomUUID().replace(/-/g, '')}`;
  let pool: Pool;
  let sql: SqlClient;
  let ctx: GameApiTestContext;

  beforeAll(async () => {
    const admin = new Pool({ connectionString: databaseUrl, max: 1 });
    await admin.query(`CREATE SCHEMA ${schema}`);
    await admin.end();
    pool = new Pool({ connectionString: databaseUrl, max: 8, options: `-c search_path=${schema}` });
    sql = createPgSqlClient(pool);
    await runMigrations(sql, await loadMigrations());
  });

  afterEach(async () => {
    await ctx?.stopTimers();
  });

  afterAll(async () => {
    await pool?.query(`DROP SCHEMA ${schema} CASCADE`);
    await pool?.end();
  });

  type Player = Awaited<ReturnType<typeof newPlayer>>;
  async function newPlayer() {
    const s = await registerAndLogin(ctx.app);
    return { id: s.userId, api: as(ctx.app, s.accessToken) };
  }

  /** `playerId → siège` des joueurs PRÉSENTS dans la session (vue HTTP). */
  async function sessionSeats(p: Player, sessionId: string): Promise<SeatMap> {
    const view = (await expectStatus(p.api.get(`/api/sessions/${sessionId}`), 200)).body.session;
    return Object.fromEntries(
      (view.seats as { seat: number; playerId: string | null }[])
        .filter((s) => s.playerId)
        .map((s) => [s.playerId as string, s.seat]),
    );
  }

  /** `playerId → siège` portés par les joueurs d'une partie (vue HTTP). */
  async function gameSeats(p: Player, gameId: string): Promise<SeatMap> {
    const view = (await expectStatus(p.api.get(`/api/games/${gameId}`), 200)).body.game;
    return Object.fromEntries(
      (view.players as { playerId: string; tablePosition: number }[]).map((x) => [
        x.playerId,
        x.tablePosition,
      ]),
    );
  }

  /** Même table, lue directement en base (contrôle indépendant de l'API). */
  async function storedGameSeats(gameId: string): Promise<SeatMap> {
    const { rows } = await sql.query<{ player_id: string; table_position: number }>(
      'SELECT player_id, table_position FROM game_players WHERE game_id = $1',
      [gameId],
    );
    return Object.fromEntries(rows.map((r) => [r.player_id, r.table_position]));
  }

  /** Session à 4 : J1 (créateur), J2, J3, J4 aux sièges 0..3 ; tous dans la partie 1. */
  async function fourPlayerSession(decks?: CardId[][]) {
    ctx = createGameApiTestApp(sql, {
      ...(decks && { random: decksRandom(...decks) }),
      decisionWindowMs: 60_000,
      turnDurationMs: 60_000,
    });
    const [J1, J2, J3, J4] = [
      await newPlayer(),
      await newPlayer(),
      await newPlayer(),
      await newPlayer(),
    ];
    const created = await expectStatus(J1.api.post('/api/sessions', { maxPlayers: 4 }), 201);
    const sessionId = created.body.session.sessionId as string;
    const gameId = created.body.game.gameId as string;
    for (const p of [J2, J3, J4]) {
      await expectStatus(p.api.post(`/api/sessions/${sessionId}/join`), 200);
    }
    const before = await sessionSeats(J1, sessionId);
    // Arrivées dans la PARTIE volontairement dans un autre ordre (J4, J2, J3) : le rang
    // d'arrivée dans la partie ne doit pas devenir le siège.
    for (const p of [J4, J2, J3]) {
      await expectStatus(p.api.post(`/api/games/${gameId}/join`), 200);
    }
    return { J1, J2, J3, J4, players: [J1, J2, J3, J4], sessionId, gameId, before };
  }

  it('TEST A — siège de partie = siège de session, identique avant et après le démarrage', async () => {
    const { J1, J2, J3, J4, sessionId, gameId, before } = await fourPlayerSession();

    // Valeurs capturées AVANT la partie : J1 → 0, J2 → 1, J3 → 2, J4 → 3.
    expect(before).toEqual({ [J1.id]: 0, [J2.id]: 1, [J3.id]: 2, [J4.id]: 3 });

    const started = await expectStatus(J1.api.post(`/api/games/${gameId}/start`), 200);
    expect(started.body.game.status).toBe('in_progress');

    // APRÈS : chaque joueur garde exactement son siège, en session comme en partie.
    const sessionAfter = await sessionSeats(J1, sessionId);
    const gameAfter = await gameSeats(J2, gameId);
    const storedAfter = await storedGameSeats(gameId);
    for (const [playerId, seat] of Object.entries(before)) {
      expect({ playerId, seat: sessionAfter[playerId] }).toEqual({ playerId, seat });
      expect({ playerId, seat: gameAfter[playerId] }).toEqual({ playerId, seat });
      expect({ playerId, seat: storedAfter[playerId] }).toEqual({ playerId, seat });
    }
    expect(sessionAfter).toEqual(before);
    expect(gameAfter).toEqual(before);
    expect(storedAfter).toEqual(before);
    // Ordre de distribution = sièges croissants à partir de J1 (et non l'ordre d'arrivée).
    expect(started.body.game.play.dealOrder).toEqual([J1.id, J2.id, J3.id, J4.id]);
  });

  // Paquets imposés à 4 joueurs : J1 et J3 ont chacun « trois + deux » (rang 5), J2 et J4
  // aucune combinaison → égalité de priorité, reprise immédiate ; puis une donne normale.
  const RANK_5_A: CardId[] = ['COEUR-9', 'PIQUE-9', 'TREFLE-9', 'COEUR-10', 'TREFLE-10'];
  const RANK_5_B: CardId[] = ['COEUR-8', 'PIQUE-8', 'TREFLE-8', 'COEUR-6', 'PIQUE-6'];
  const NONE_1: CardId[] = ['COEUR-7', 'PIQUE-7', 'ETOILE-10', 'ETOILE-4', 'TREFLE-6'];
  const NONE_2: CardId[] = ['ETOILE-9', 'PIQUE-5', 'TREFLE-7', 'ETOILE-8', 'COEUR-5'];
  const TIE_4 = deckForHands([RANK_5_A, NONE_1, RANK_5_B, NONE_2]);
  // Donne de la reprise : aucune main gagnante (sommes 34, 34, 32, 29 ; pas de combinaison).
  const NORMAL_4 = deckForHands([
    ['COEUR-7', 'PIQUE-7', 'ETOILE-10', 'ETOILE-4', 'TREFLE-6'],
    ['ETOILE-9', 'PIQUE-5', 'TREFLE-7', 'ETOILE-8', 'COEUR-5'],
    ['COEUR-9', 'PIQUE-9', 'ETOILE-3', 'ETOILE-5', 'ETOILE-6'],
    ['COEUR-3', 'PIQUE-4', 'TREFLE-5', 'ETOILE-7', 'COEUR-10'],
  ] as CardId[][]);

  it('TEST B — reprise immédiate après égalité : playerId → siège identique avant / après', async () => {
    const { J1, J2, J3, J4, sessionId, gameId, before } = await fourPlayerSession([
      TIE_4,
      NORMAL_4,
    ]);

    // Démarrage : la donne est une égalité de priorité ; la reprise est immédiate.
    await expectStatus(J1.api.post(`/api/games/${gameId}/start`), 200);
    await ctx.sessions.idle();

    const tied = (await expectStatus(J1.api.get(`/api/games/${gameId}`), 200)).body.game;
    expect(tied).toMatchObject({ status: 'finished', endReason: 'INSTANT_WIN_TIE' });
    // Valeurs AVANT la reprise : celles de la partie annulée (= sièges de session capturés).
    const beforeReplay = await storedGameSeats(gameId);
    expect(beforeReplay).toEqual(before);

    const session = (await expectStatus(J1.api.get(`/api/sessions/${sessionId}`), 200)).body
      .session;
    const replayId = session.currentGame.gameId as string;
    expect(replayId).not.toBe(gameId);
    const replay = (await expectStatus(J3.api.get(`/api/games/${replayId}`), 200)).body.game;
    expect(replay.replayOfGameId).toBe(gameId);
    expect(replay.firstPlayerId).toBe(J1.id); // même J1 (décision 23)

    // APRÈS la reprise : comparaison joueur par joueur.
    const replaySeats = await gameSeats(J4, replayId);
    const replayStored = await storedGameSeats(replayId);
    const sessionAfter = await sessionSeats(J2, sessionId);
    for (const [playerId, seat] of Object.entries(beforeReplay)) {
      expect({ playerId, seat: replaySeats[playerId] }).toEqual({ playerId, seat });
      expect({ playerId, seat: replayStored[playerId] }).toEqual({ playerId, seat });
      expect({ playerId, seat: sessionAfter[playerId] }).toEqual({ playerId, seat });
    }
    expect(replaySeats).toEqual(beforeReplay);
    expect(sessionAfter).toEqual(before);
    expect(replay.play.dealOrder).toEqual([J1.id, J2.id, J3.id, J4.id]);
  });
});
