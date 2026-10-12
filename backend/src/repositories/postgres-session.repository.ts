import {
  PG_UNIQUE_VIOLATION,
  isPgError,
  type SqlClient,
  type SqlExecutor,
} from '../database/sql-client';
import type { GameStakeLedger } from './game-stake-ledger';
import type { Game } from '../domain/game/game';
import {
  TournamentTableAvailableError,
  TournamentTableRefusedError,
} from '../domain/tournaments/tournament';
import { AUTOMATIC_TRICK_NUMBER } from '../domain/rules/rule-set';
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
import {
  deleteWaitingGame,
  insertGameRows,
  lockGame,
  translateGameInsertError,
  updateGameRows,
} from './postgres-game.repository';
import type {
  LeaveContext,
  LeaveWrite,
  OpenTableSummary,
  PendingDecisionDeadline,
  SessionContext,
  SessionRepository,
  TournamentTableClaim,
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
  name: string | null;
  password_hash: string | null;
  suspicion_detection_enabled: boolean;
  created_at: Date;
  updated_at: Date;
  closed_at: Date | null;
}

interface SessionPlayerRow {
  player_id: string;
  seat: number;
  arrival: number;
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
  /** `stakeLedger` (D-074) : même rôle que pour PostgresGameRepository. */
  constructor(
    private readonly db: SqlClient,
    private readonly options: { stakeLedger?: GameStakeLedger } = {},
  ) {}

  async createWithFirstGame(
    session: Session,
    game: Game,
    tournament?: TournamentTableClaim,
  ): Promise<void> {
    try {
      await this.db.transaction(async (tx) => {
        if (tournament) {
          await claimTournamentTable(tx, tournament);
        }
        await tx.query(
          `INSERT INTO sessions (id, version, status, creator_id, max_players, created_at,
             updated_at, closed_at, name, password_hash, suspicion_detection_enabled)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
          [
            session.id,
            session.version,
            session.status,
            session.creatorId,
            session.maxPlayers,
            session.createdAt.toISOString(),
            session.updatedAt.toISOString(),
            session.closedAt?.toISOString() ?? null,
            session.name ?? null,
            session.passwordHash ?? null,
            session.suspicionDetectionEnabled,
          ],
        );
        await writePlayers(tx, session);
        await insertGameRows(tx, game, this.options.stakeLedger);
        if (tournament) {
          await tx.query(
            `INSERT INTO tournament_sessions (id, tournament_id, session_id, created_at)
             VALUES ($1, $2, $3, $4)`,
            [
              tournament.linkId,
              tournament.tournamentId,
              session.id,
              session.createdAt.toISOString(),
            ],
          );
        }
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

  async findOpenTables(viewerId: PlayerId, limit: number): Promise<OpenTableSummary[]> {
    const { rows } = await this.db.query<{
      session_id: SessionId;
      game_id: string;
      name: string | null;
      creator_name: string;
      stake_amount: string | number | null;
      has_password: boolean;
      suspicion_detection_enabled: boolean;
      mine: boolean;
      max_players: number;
      player_count: number;
      created_at: Date;
    }>(
      `SELECT s.id AS session_id, g.id AS game_id, s.name, u.username AS creator_name,
         g.stake_amount, s.password_hash IS NOT NULL AS has_password,
         s.suspicion_detection_enabled, s.max_players,
         EXISTS (SELECT 1 FROM session_players sp
           WHERE sp.session_id = s.id AND sp.player_id = $1 AND sp.active) AS mine,
         (SELECT count(*)::int FROM game_players gp WHERE gp.game_id = g.id) AS player_count,
         g.created_at
       FROM sessions s
       JOIN games g ON g.session_id = s.id AND g.status = 'waiting'
       JOIN users u ON u.id = g.creator_id
       WHERE s.status = 'open'
         AND (SELECT count(*) FROM session_players sp
              WHERE sp.session_id = s.id AND sp.active) < s.max_players
         -- Les tables de tournoi ne se rejoignent que par le tournoi (D-051).
         AND NOT EXISTS (SELECT 1 FROM tournament_sessions ts WHERE ts.session_id = s.id)
       ORDER BY g.created_at DESC, g.id
       LIMIT $2`,
      [viewerId, limit],
    );
    return rows.map((r) => ({
      sessionId: r.session_id,
      gameId: r.game_id,
      ...(r.name !== null && { name: r.name }),
      creatorName: r.creator_name,
      ...(r.stake_amount !== null && { stakeAmount: Number(r.stake_amount) }),
      hasPassword: r.has_password,
      suspicionDetectionEnabled: r.suspicion_detection_enabled,
      mine: r.mine,
      maxPlayers: Number(r.max_players),
      playerCount: Number(r.player_count),
      createdAt: r.created_at,
    }));
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
        await insertGameRows(tx, result.game, this.options.stakeLedger);
        return result;
      });
    } catch (err) {
      throw game ? translateGameInsertError(err, game) : err;
    }
  }

  async leave<R extends LeaveWrite>(
    sessionId: SessionId,
    change: (context: LeaveContext) => R,
  ): Promise<R> {
    try {
      return await this.db.transaction(async (tx) => {
        // 1. La partie active d'abord : une écriture de partie verrouille sa ligne `games`
        //    puis les joueurs de la session ; le départ prend les verrous dans le même ordre.
        const active = await tx.query<{ id: GameId }>(
          "SELECT id FROM games WHERE session_id = $1 AND status <> 'finished'",
          [sessionId],
        );
        const activeId = active.rows[0]?.id;
        let locked = activeId ? await lockGame(tx, activeId) : null;
        // 2. Puis la session et ses joueurs.
        const context = await lockContext(tx, sessionId);
        const last = context.lastGame;
        if (last?.status === 'waiting' && last.gameId !== locked?.id) {
          // Partie créée entre les deux lectures (rare) : verrouillée à son tour.
          locked = await lockGame(tx, last.gameId);
        }
        const history = await tx.query<{ n: number }>(
          "SELECT count(*)::int AS n FROM games WHERE session_id = $1 AND status = 'finished'",
          [sessionId],
        );
        const result = change({
          ...context,
          waitingGame: last?.status === 'waiting' ? locked : null,
          hasFinishedGames: (history.rows[0]?.n ?? 0) > 0,
        });
        if (result.events.length === 0) {
          return result;
        }
        if (result.savedGame) {
          await updateGameRows(
            tx,
            result.savedGame.game,
            result.savedGame.expectedVersion,
            this.options.stakeLedger,
          );
        } else if (result.waitingGame?.kind === 'delete') {
          await deleteWaitingGame(tx, result.waitingGame.gameId);
        }
        if (result.deleteSession) {
          // Q1 : joueurs, rondes et décisions partent avec la session (ON DELETE CASCADE).
          // Une partie restante (historique) ferait échouer la suppression : rien n'est perdu.
          await tx.query('DELETE FROM sessions WHERE id = $1', [sessionId]);
        } else {
          await saveSession(tx, result.session);
        }
        return result;
      });
    } catch (err) {
      throw translateSessionError(err, err);
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
/**
 * Table de tournoi (D-054), DANS la transaction de création : verrou de la ligne du tournoi
 * (`FOR NO KEY UPDATE`, compatible avec le contrôle de clé étrangère du rattachement), puis
 * contrôles. Deux créations simultanées pour un même tournoi (plusieurs instances) passent
 * l'une après l'autre ; la seconde voit la table de la première et rejoint celle-ci.
 */
async function claimTournamentTable(tx: SqlExecutor, claim: TournamentTableClaim): Promise<void> {
  const { rows } = await tx.query<{ status: string; ends_at: Date }>(
    'SELECT status, ends_at FROM tournaments WHERE id = $1 FOR NO KEY UPDATE',
    [claim.tournamentId],
  );
  const tournament = rows[0];
  if (
    !tournament ||
    tournament.status !== 'IN_PROGRESS' ||
    new Date(tournament.ends_at).getTime() <= Date.now()
  ) {
    throw new TournamentTableRefusedError(claim.tournamentId);
  }
  const joinable = await tx.query<{ session_id: string }>(
    `SELECT ts.session_id FROM tournament_sessions ts
     JOIN sessions s ON s.id = ts.session_id AND s.status = 'open'
     WHERE ts.tournament_id = $1
       AND EXISTS (SELECT 1 FROM games g WHERE g.session_id = s.id AND g.status = 'waiting')
       AND (SELECT count(*) FROM session_players sp
            WHERE sp.session_id = s.id AND sp.active) < s.max_players
     LIMIT 1`,
    [claim.tournamentId],
  );
  if (joinable.rows[0]) {
    throw new TournamentTableAvailableError(claim.tournamentId);
  }
}

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
    creator_id: PlayerId;
    winner_id: PlayerId | null;
    winner_seat: number | null;
    player_ids: PlayerId[] | null;
    last_trick_cards: number | null;
  }>(
    `SELECT g.id, g.status, g.finished_at, g.end_reason, g.first_player_id, g.creator_id,
       g.winner_id,
       (SELECT jsonb_array_length(t -> 'plays')
        FROM jsonb_array_elements(COALESCE(g.state -> 'play' -> 'completedTricks', '[]'::jsonb)) t
        WHERE (t ->> 'number')::int = $2) AS last_trick_cards,
       (SELECT p.table_position FROM game_players p
        WHERE p.game_id = g.id AND p.player_id = g.winner_id) AS winner_seat,
       (SELECT array_agg(p.player_id ORDER BY p.seat) FROM game_players p
        WHERE p.game_id = g.id) AS player_ids
     FROM games g WHERE g.session_id = $1
     ORDER BY g.created_at DESC, g.id DESC LIMIT 1`,
    [sessionId, AUTOMATIC_TRICK_NUMBER],
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
    creatorId: row.creator_id,
    ...(row.winner_id !== null && { winnerId: row.winner_id }),
    ...(row.winner_seat !== null && { winnerSeat: row.winner_seat }),
    playerIds: row.player_ids ?? [],
    ...(row.last_trick_cards !== null && { lastTrickCards: Number(row.last_trick_cards) }),
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
    `SELECT player_id, seat, arrival, active, joined_at, left_at FROM session_players
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
    ...(row.name !== null && { name: row.name }),
    ...(row.password_hash !== null && { passwordHash: row.password_hash }),
    suspicionDetectionEnabled: row.suspicion_detection_enabled,
    players: players.rows.map((p): SessionPlayer => ({
      playerId: p.player_id as PlayerId,
      seat: p.seat,
      arrival: p.arrival,
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
 * transaction ne viole pas l'unicité des sièges présents. Un retour reçoit un nouveau rang
 * d'arrivée, le plus grand de la session : jamais celui d'une autre ligne.
 */
async function writePlayers(tx: SqlExecutor, session: Session): Promise<void> {
  const ordered = [...session.players].sort((a, b) => Number(a.active) - Number(b.active));
  for (const p of ordered) {
    await tx.query(
      `INSERT INTO session_players (session_id, player_id, seat, arrival, active, joined_at,
         left_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (session_id, player_id) DO UPDATE SET seat = EXCLUDED.seat,
         arrival = EXCLUDED.arrival, active = EXCLUDED.active, joined_at = EXCLUDED.joined_at,
         left_at = EXCLUDED.left_at
       WHERE (session_players.seat, session_players.arrival, session_players.active,
              session_players.joined_at, session_players.left_at)
         IS DISTINCT FROM (EXCLUDED.seat, EXCLUDED.arrival, EXCLUDED.active, EXCLUDED.joined_at,
              EXCLUDED.left_at)`,
      [
        session.id,
        p.playerId,
        p.seat,
        p.arrival,
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
