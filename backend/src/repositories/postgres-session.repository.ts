import {
  PG_UNIQUE_VIOLATION,
  isPgError,
  type SqlClient,
  type SqlExecutor,
} from '../database/sql-client';
import type { Game } from '../domain/game/game';
import type { GameId, PlayerId } from '../domain/game/game-id';
import {
  PlayerAlreadyInSessionError,
  SessionFullError,
  SessionNotFoundError,
  type DecisionChoice,
  type DecisionRound,
  type LastGameInfo,
  type Session,
  type SessionGameSummary,
  type SessionId,
  type SessionPlayer,
  type SessionStatus,
  type SessionTransition,
} from '../domain/sessions/session';
import { insertGameRows, translateGameInsertError } from './postgres-game.repository';
import type {
  PendingDecisionDeadline,
  SessionContext,
  SessionRepository,
} from './session.repository';

/** Index de la migration 0006 : un joueur présent dans une seule session. */
const ONE_ACTIVE_SESSION_INDEX = 'session_players_one_active_session_per_player';
/** Trigger de la migration 0006 : siège hors de la table (capacité dépassée). */
const SEAT_IN_TABLE = 'session_players_seat_in_table';
const PG_CHECK_VIOLATION = '23514';

interface SessionRow {
  id: string;
  version: number;
  status: SessionStatus;
  creator_id: string;
  max_players: number;
  created_at: Date;
  updated_at: Date;
  closed_at: Date | null;
}

interface SessionPlayerRow {
  player_id: string;
  seat: number;
  active: boolean;
  joined_at: Date;
  left_at: Date | null;
}

/**
 * Sessions de jeu dans PostgreSQL (D-033, D-034).
 *
 * Concurrence : chaque mutation commence par verrouiller la ligne `sessions` puis les
 * lignes `session_players` de la session (`FOR UPDATE`). Arrivées, départs, décisions,
 * fermeture et créations de partie d'une même session sont donc sérialisés, y compris
 * entre instances ; ceux de sessions différentes ne s'attendent pas. Les invariants en
 * base complètent ce verrou : un siège présent unique et dans la table (capacité), une
 * seule session active par joueur, une seule partie active par session, une seule ronde
 * de décision ouverte par session, joueurs d'une partie = membres actifs de la session.
 */
export class PostgresSessionRepository implements SessionRepository {
  constructor(private readonly db: SqlClient) {}

  async createWithFirstGame(session: Session, game: Game): Promise<void> {
    try {
      await this.db.transaction(async (tx) => {
        await tx.query(
          `INSERT INTO sessions (id, version, status, creator_id, max_players, created_at,
             updated_at, closed_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
          [
            session.id,
            session.version,
            session.status,
            session.creatorId,
            session.maxPlayers,
            session.createdAt.toISOString(),
            session.updatedAt.toISOString(),
            session.closedAt?.toISOString() ?? null,
          ],
        );
        await writePlayers(tx, session);
        await insertGameRows(tx, game);
      });
    } catch (err) {
      throw translateSessionError(err, translateGameInsertError(err, game));
    }
  }

  findById(sessionId: SessionId): Promise<Session | null> {
    return loadSession(this.db, sessionId, false);
  }

  findLastGame(sessionId: SessionId): Promise<LastGameInfo | null> {
    return loadLastGame(this.db, sessionId);
  }

  async findActiveByPlayer(playerId: PlayerId): Promise<Session[]> {
    const { rows } = await this.db.query<{ session_id: SessionId }>(
      `SELECT sp.session_id FROM session_players sp JOIN sessions s ON s.id = sp.session_id
       WHERE sp.player_id = $1 AND sp.active AND s.status = 'open'
       ORDER BY s.created_at, s.id`,
      [playerId],
    );
    const sessions = await Promise.all(rows.map((r) => loadSession(this.db, r.session_id, false)));
    return sessions.filter((s): s is Session => s !== null);
  }

  async update<R extends SessionTransition>(
    sessionId: SessionId,
    change: (context: SessionContext) => R,
  ): Promise<R> {
    try {
      return await this.db.transaction(async (tx) => {
        const result = change(await lockContext(tx, sessionId));
        if (result.events.length > 0) {
          await saveSession(tx, result.session);
        }
        return result;
      });
    } catch (err) {
      throw translateSessionError(err, err);
    }
  }

  async createNextGame<R extends SessionTransition & { game: Game }>(
    sessionId: SessionId,
    build: (context: SessionContext) => R,
  ): Promise<R> {
    let game: Game | undefined;
    try {
      return await this.db.transaction(async (tx) => {
        const result = build(await lockContext(tx, sessionId));
        game = result.game;
        if (result.events.length > 0) {
          await saveSession(tx, result.session);
        }
        await insertGameRows(tx, result.game);
        return result;
      });
    } catch (err) {
      throw game ? translateGameInsertError(err, game) : err;
    }
  }

  async activeSeat(sessionId: SessionId, playerId: PlayerId): Promise<number | null> {
    const { rows } = await this.db.query<{ seat: number }>(
      'SELECT seat FROM session_players WHERE session_id = $1 AND player_id = $2 AND active',
      [sessionId, playerId],
    );
    return rows[0]?.seat ?? null;
  }

  async listGames(sessionId: SessionId): Promise<SessionGameSummary[]> {
    const { rows } = await this.db.query<{
      id: string;
      status: SessionGameSummary['status'];
      creator_id: PlayerId;
      first_player_id: PlayerId;
      winner_id: PlayerId | null;
      end_reason: SessionGameSummary['endReason'] | null;
      replay_of_game_id: string | null;
      max_players: number;
      player_ids: PlayerId[] | null;
      created_at: Date;
      started_at: Date | null;
      finished_at: Date | null;
    }>(
      `SELECT g.id, g.status, g.creator_id, g.first_player_id, g.winner_id, g.end_reason,
         g.replay_of_game_id, g.max_players,
         g.created_at, g.started_at, g.finished_at,
         (SELECT array_agg(p.player_id ORDER BY p.seat) FROM game_players p
          WHERE p.game_id = g.id) AS player_ids
       FROM games g WHERE g.session_id = $1
       ORDER BY g.created_at, g.id`,
      [sessionId],
    );
    return rows.map((r) => ({
      gameId: r.id,
      status: r.status,
      creatorId: r.creator_id,
      firstPlayerId: r.first_player_id,
      ...(r.winner_id !== null && { winnerId: r.winner_id }),
      ...(r.end_reason !== null && { endReason: r.end_reason }),
      ...(r.replay_of_game_id !== null && { replayOfGameId: r.replay_of_game_id }),
      maxPlayers: r.max_players,
      playerIds: r.player_ids ?? [],
      createdAt: r.created_at,
      ...(r.started_at && { startedAt: r.started_at }),
      ...(r.finished_at && { finishedAt: r.finished_at }),
    }));
  }

  async findPendingDecisionDeadlines(): Promise<PendingDecisionDeadline[]> {
    const { rows } = await this.db.query<{ session_id: SessionId; deadline_at: Date }>(
      `SELECT session_id, deadline_at FROM session_decision_rounds
       WHERE resolved_at IS NULL ORDER BY deadline_at`,
    );
    return rows.map((r) => ({ sessionId: r.session_id, deadlineAt: r.deadline_at }));
  }

  async findSessionsAwaitingDecisionRound(): Promise<SessionId[]> {
    const { rows } = await this.db.query<{ id: SessionId }>(
      `SELECT s.id FROM sessions s
       CROSS JOIN LATERAL (
         SELECT g.id, g.status, g.end_reason FROM games g WHERE g.session_id = s.id
         ORDER BY g.created_at DESC, g.id DESC LIMIT 1
       ) last
       WHERE s.status = 'open' AND last.status = 'finished'
         AND last.end_reason <> 'INSTANT_WIN_TIE'
         AND NOT EXISTS (SELECT 1 FROM session_decision_rounds r WHERE r.game_id = last.id)`,
    );
    return rows.map((r) => r.id);
  }

  async findSessionsAwaitingReplay(): Promise<SessionId[]> {
    const { rows } = await this.db.query<{ id: SessionId }>(
      `SELECT s.id FROM sessions s
       CROSS JOIN LATERAL (
         SELECT g.end_reason FROM games g WHERE g.session_id = s.id
         ORDER BY g.created_at DESC, g.id DESC LIMIT 1
       ) last
       WHERE s.status = 'open' AND last.end_reason = 'INSTANT_WIN_TIE'`,
    );
    return rows.map((r) => r.id);
  }
}

/** Erreurs de la base propres aux sessions → erreurs du domaine. */
function translateSessionError(err: unknown, fallback: unknown): unknown {
  if (isPgError(err, PG_UNIQUE_VIOLATION) && constraintOf(err) === ONE_ACTIVE_SESSION_INDEX) {
    const detail = (err as { detail?: unknown }).detail;
    const match = typeof detail === 'string' ? /\(player_id\)=\(([^)]+)\)/.exec(detail) : null;
    return new PlayerAlreadyInSessionError((match?.[1] ?? 'inconnu') as PlayerId);
  }
  if (isPgError(err, PG_CHECK_VIOLATION) && constraintOf(err) === SEAT_IN_TABLE) {
    const sessionId = /session ([0-9a-f-]{36})/.exec(String((err as Error).message))?.[1];
    return new SessionFullError((sessionId ?? 'inconnue') as SessionId);
  }
  return fallback;
}

function constraintOf(err: unknown): string | undefined {
  const constraint = (err as { constraint?: unknown }).constraint;
  return typeof constraint === 'string' ? constraint : undefined;
}

/** Verrouille la session et ses joueurs, puis lit le contexte complet de la mutation. */
async function lockContext(tx: SqlExecutor, sessionId: SessionId): Promise<SessionContext> {
  const session = await loadSession(tx, sessionId, true);
  if (!session) {
    throw new SessionNotFoundError(sessionId);
  }
  // Verrou exclusif sur les joueurs : une adhésion concurrente à une partie (qui verrouille
  // la ligne du joueur en partage) est soit visible ici, soit refusée ensuite.
  await tx.query('SELECT 1 FROM session_players WHERE session_id = $1 FOR UPDATE', [sessionId]);
  return { session, lastGame: await loadLastGame(tx, sessionId) };
}

async function loadLastGame(db: SqlExecutor, sessionId: SessionId): Promise<LastGameInfo | null> {
  const { rows } = await db.query<{
    id: GameId;
    status: LastGameInfo['status'];
    finished_at: Date | null;
    end_reason: LastGameInfo['endReason'] | null;
    first_player_id: PlayerId;
    winner_id: PlayerId | null;
    winner_seat: number | null;
    player_ids: PlayerId[] | null;
  }>(
    `SELECT g.id, g.status, g.finished_at, g.end_reason, g.first_player_id, g.winner_id,
       (SELECT p.table_position FROM game_players p
        WHERE p.game_id = g.id AND p.player_id = g.winner_id) AS winner_seat,
       (SELECT array_agg(p.player_id ORDER BY p.seat) FROM game_players p
        WHERE p.game_id = g.id) AS player_ids
     FROM games g WHERE g.session_id = $1
     ORDER BY g.created_at DESC, g.id DESC LIMIT 1`,
    [sessionId],
  );
  const row = rows[0];
  if (!row) {
    return null;
  }
  return {
    gameId: row.id,
    status: row.status,
    ...(row.finished_at && { finishedAt: row.finished_at }),
    ...(row.end_reason && { endReason: row.end_reason }),
    firstPlayerId: row.first_player_id,
    ...(row.winner_id !== null && { winnerId: row.winner_id }),
    ...(row.winner_seat !== null && { winnerSeat: row.winner_seat }),
    playerIds: row.player_ids ?? [],
  };
}

async function loadSession(
  db: SqlExecutor,
  sessionId: SessionId,
  lock: boolean,
): Promise<Session | null> {
  const { rows } = await db.query<SessionRow>(
    `SELECT * FROM sessions WHERE id = $1${lock ? ' FOR UPDATE' : ''}`,
    [sessionId],
  );
  const row = rows[0];
  if (!row) {
    return null;
  }
  const players = await db.query<SessionPlayerRow>(
    `SELECT player_id, seat, active, joined_at, left_at FROM session_players
     WHERE session_id = $1 ORDER BY active DESC, seat, joined_at`,
    [sessionId],
  );
  const round = await loadRound(db, sessionId);
  return {
    id: row.id as SessionId,
    version: row.version,
    status: row.status,
    creatorId: row.creator_id as PlayerId,
    maxPlayers: row.max_players,
    players: players.rows.map((p): SessionPlayer => ({
      playerId: p.player_id as PlayerId,
      seat: p.seat,
      active: p.active,
      joinedAt: p.joined_at,
      ...(p.left_at && { leftAt: p.left_at }),
    })),
    ...(round && { round }),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    ...(row.closed_at && { closedAt: row.closed_at }),
  };
}

/** Ronde la plus récente de la session, avec ses décisions. */
async function loadRound(db: SqlExecutor, sessionId: SessionId): Promise<DecisionRound | null> {
  const { rows } = await db.query<{
    game_id: GameId;
    opened_at: Date;
    deadline_at: Date;
    resolved_at: Date | null;
  }>(
    `SELECT game_id, opened_at, deadline_at, resolved_at FROM session_decision_rounds
     WHERE session_id = $1 ORDER BY opened_at DESC, game_id DESC LIMIT 1`,
    [sessionId],
  );
  const row = rows[0];
  if (!row) {
    return null;
  }
  const decisions = await db.query<{
    player_id: PlayerId;
    choice: DecisionChoice;
    decided_at: Date;
  }>('SELECT player_id, choice, decided_at FROM session_decisions WHERE game_id = $1', [
    row.game_id,
  ]);
  return {
    gameId: row.game_id,
    openedAt: row.opened_at,
    deadlineAt: row.deadline_at,
    ...(row.resolved_at && { resolvedAt: row.resolved_at }),
    decisions: Object.fromEntries(
      decisions.rows.map((d) => [d.player_id, { choice: d.choice, decidedAt: d.decided_at }]),
    ),
  };
}

async function saveSession(tx: SqlExecutor, session: Session): Promise<void> {
  await tx.query(
    `UPDATE sessions SET version = $2, status = $3, updated_at = $4, closed_at = $5 WHERE id = $1`,
    [
      session.id,
      session.version,
      session.status,
      session.updatedAt.toISOString(),
      session.closedAt?.toISOString() ?? null,
    ],
  );
  await writePlayers(tx, session);
  if (session.round) {
    await writeRound(tx, session.id, session.round);
  }
}

/**
 * Les départs sont écrits AVANT les arrivées : un siège libéré et repris dans la même
 * transaction ne viole pas l'unicité des sièges présents.
 */
async function writePlayers(tx: SqlExecutor, session: Session): Promise<void> {
  const ordered = [...session.players].sort((a, b) => Number(a.active) - Number(b.active));
  for (const p of ordered) {
    await tx.query(
      `INSERT INTO session_players (session_id, player_id, seat, active, joined_at, left_at)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (session_id, player_id) DO UPDATE SET seat = EXCLUDED.seat,
         active = EXCLUDED.active, joined_at = EXCLUDED.joined_at, left_at = EXCLUDED.left_at
       WHERE (session_players.seat, session_players.active, session_players.joined_at,
              session_players.left_at)
         IS DISTINCT FROM (EXCLUDED.seat, EXCLUDED.active, EXCLUDED.joined_at, EXCLUDED.left_at)`,
      [
        session.id,
        p.playerId,
        p.seat,
        p.active,
        p.joinedAt.toISOString(),
        p.leftAt?.toISOString() ?? null,
      ],
    );
  }
}

async function writeRound(
  tx: SqlExecutor,
  sessionId: SessionId,
  round: DecisionRound,
): Promise<void> {
  await tx.query(
    `INSERT INTO session_decision_rounds (game_id, session_id, opened_at, deadline_at, resolved_at)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (game_id) DO UPDATE SET resolved_at = EXCLUDED.resolved_at`,
    [
      round.gameId,
      sessionId,
      round.openedAt.toISOString(),
      round.deadlineAt.toISOString(),
      round.resolvedAt?.toISOString() ?? null,
    ],
  );
  for (const [playerId, decision] of Object.entries(round.decisions)) {
    await tx.query(
      `INSERT INTO session_decisions (game_id, player_id, choice, decided_at)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (game_id, player_id) DO UPDATE SET choice = EXCLUDED.choice,
         decided_at = EXCLUDED.decided_at`,
      [round.gameId, playerId, decision.choice, decision.decidedAt.toISOString()],
    );
  }
}
