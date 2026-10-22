import type { SqlExecutor } from '../database/sql-client';
import type { CoplayStats, GameOutcome, SharedTable } from '../domain/detection/behavior-analysis';
import type { GameType } from '../domain/game/game';
import type { GameId, PlayerId } from '../domain/game/game-id';
import type { AnalysisPeriod, BehaviorHistoryRepository } from './behavior-history.repository';

/**
 * Parties surveillées terminées sur la période (hors arrêt administratif), d'UN jeu
 * (`gameType` en paramètre `gameTypeParam`, D-125).
 */
const MONITORED_FINISHED = (gameTypeParam: string) => `
  SELECT g.id, g.session_id, g.winner_id, g.end_reason, g.finished_at
  FROM games g
  JOIN sessions s ON s.id = g.session_id AND s.suspicion_detection_enabled
  WHERE g.status = 'finished' AND g.end_reason <> 'ADMIN_STOP'
    AND g.finished_at >= $1 AND g.finished_at <= $2 AND g.game_type = ${gameTypeParam}`;

const inGame = (param: string) =>
  `EXISTS (SELECT 1 FROM game_players gp WHERE gp.game_id = m.id AND gp.player_id = ${param})`;

/** Début de la dernière session d'authentification d'un joueur avant `at`. */
const LAST_LOGIN_BEFORE = (player: string, at: string) => `
  (SELECT max(l.started_at) FROM (
     SELECT min(rt.created_at) AS started_at FROM refresh_tokens rt
     WHERE rt.user_id = ${player} GROUP BY rt.session_id
   ) l WHERE l.started_at <= ${at})`;

export class PostgresBehaviorHistoryRepository implements BehaviorHistoryRepository {
  constructor(private readonly db: SqlExecutor) {}

  async coplayStats(
    [a, b]: readonly [PlayerId, PlayerId],
    { since, until }: AnalysisPeriod,
    gameType: GameType,
  ): Promise<CoplayStats> {
    const { rows } = await this.db.query<{
      together: string;
      sessions: string;
      games_a: string;
      games_b: string;
    }>(
      `WITH m AS (${MONITORED_FINISHED('$5')})
       SELECT count(*) FILTER (WHERE ${inGame('$3')} AND ${inGame('$4')}) AS together,
              count(DISTINCT session_id) FILTER (WHERE ${inGame('$3')} AND ${inGame('$4')})
                AS sessions,
              count(*) FILTER (WHERE ${inGame('$3')}) AS games_a,
              count(*) FILTER (WHERE ${inGame('$4')}) AS games_b
       FROM m`,
      [since.toISOString(), until.toISOString(), a, b, gameType],
    );
    const row = rows[0];
    return {
      gamesTogether: Number(row?.together ?? 0),
      sessionsTogether: Number(row?.sessions ?? 0),
      gamesOfFirst: Number(row?.games_a ?? 0),
      gamesOfSecond: Number(row?.games_b ?? 0),
    };
  }

  async outcomes(
    playerIds: readonly PlayerId[],
    { since, until }: AnalysisPeriod,
    gameType: GameType,
  ): Promise<GameOutcome[]> {
    const { rows } = await this.db.query<{
      id: GameId;
      winner_id: PlayerId;
      player_ids: PlayerId[];
    }>(
      `WITH m AS (${MONITORED_FINISHED('$4')})
       SELECT m.id, m.winner_id,
              (SELECT array_agg(gp.player_id ORDER BY gp.seat) FROM game_players gp
               WHERE gp.game_id = m.id) AS player_ids
       FROM m
       WHERE m.winner_id IS NOT NULL
         AND EXISTS (SELECT 1 FROM game_players gp
                     WHERE gp.game_id = m.id AND gp.player_id = ANY($3::uuid[]))
       ORDER BY m.finished_at, m.id`,
      [since.toISOString(), until.toISOString(), [...playerIds], gameType],
    );
    return rows.map((r) => ({ gameId: r.id, winnerId: r.winner_id, playerIds: r.player_ids }));
  }

  async playedToTheEndGameIds(
    playerId: PlayerId,
    { since, until }: AnalysisPeriod,
    limit: number,
    gameType: GameType,
  ): Promise<GameId[]> {
    const { rows } = await this.db.query<{ id: GameId }>(
      `WITH m AS (${MONITORED_FINISHED('$5')})
       SELECT m.id FROM m
       WHERE m.end_reason = 'CONTROL_AFTER_LAST_TRICK' AND ${inGame('$3')}
       ORDER BY m.finished_at DESC, m.id
       LIMIT $4`,
      [since.toISOString(), until.toISOString(), playerId, limit, gameType],
    );
    return rows.map((r) => r.id);
  }

  async sharedTables(
    [a, b]: readonly [PlayerId, PlayerId],
    { since, until }: AnalysisPeriod,
    gameType: GameType,
  ): Promise<SharedTable[]> {
    const { rows } = await this.db.query<{
      joined_first: Date;
      joined_second: Date;
      login_first: Date | null;
      login_second: Date | null;
    }>(
      `SELECT pa.joined_at AS joined_first, pb.joined_at AS joined_second,
              ${LAST_LOGIN_BEFORE('$1', 'pa.joined_at')} AS login_first,
              ${LAST_LOGIN_BEFORE('$2', 'pb.joined_at')} AS login_second
       FROM sessions s
       JOIN session_players pa ON pa.session_id = s.id AND pa.player_id = $1
       JOIN session_players pb ON pb.session_id = s.id AND pb.player_id = $2
       WHERE s.suspicion_detection_enabled AND s.game_type = $5
         AND greatest(pa.joined_at, pb.joined_at) >= $3
         AND greatest(pa.joined_at, pb.joined_at) <= $4
       ORDER BY greatest(pa.joined_at, pb.joined_at), s.id`,
      [a, b, since.toISOString(), until.toISOString(), gameType],
    );
    return rows.map((r) => ({
      joinedFirst: r.joined_first,
      joinedSecond: r.joined_second,
      loginFirst: r.login_first,
      loginSecond: r.login_second,
    }));
  }
}
