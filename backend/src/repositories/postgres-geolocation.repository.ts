import { isPgError, type SqlClient } from '../database/sql-client';
import { GeolocationDisabledError, type PositionSample } from '../domain/detection/geo';
import type { GameStatus } from '../domain/game/game';
import type { GameId, PlayerId } from '../domain/game/game-id';
import type {
  ConsentGate,
  GeolocationAccess,
  GeolocationRepository,
} from './geolocation.repository';

const PG_CHECK_VIOLATION = '23514';

interface PositionRow {
  game_id: GameId;
  player_id: PlayerId;
  latitude: string | number;
  longitude: string | number;
  accuracy_m: number;
  captured_at: Date;
}

const toSample = (r: PositionRow): PositionSample => ({
  gameId: r.game_id,
  playerId: r.player_id,
  latitude: Number(r.latitude),
  longitude: Number(r.longitude),
  accuracyMeters: Number(r.accuracy_m),
  capturedAt: r.captured_at,
});

const COLUMNS = 'game_id, player_id, latitude, longitude, accuracy_m, captured_at';

export class PostgresGeolocationRepository implements GeolocationRepository {
  constructor(private readonly db: SqlClient) {}

  async findAccess(gameId: GameId, playerId: PlayerId): Promise<GeolocationAccess | null> {
    const { rows } = await this.db.query<{
      status: GameStatus;
      enabled: boolean | null;
      player_ids: PlayerId[] | null;
      consented: boolean;
    }>(
      `SELECT g.status, s.suspicion_detection_enabled AS enabled,
              (SELECT array_agg(gp.player_id ORDER BY gp.seat)
               FROM game_players gp WHERE gp.game_id = g.id) AS player_ids,
              EXISTS (SELECT 1 FROM session_players sp
                      JOIN detection_consents c
                        ON c.session_id = sp.session_id AND c.player_id = sp.player_id
                       AND c.joined_at = sp.joined_at
                      WHERE sp.session_id = g.session_id AND sp.player_id = $2
                        AND sp.active) AS consented
       FROM games g LEFT JOIN sessions s ON s.id = g.session_id
       WHERE g.id = $1`,
      [gameId, playerId],
    );
    const row = rows[0];
    if (!row) return null;
    const playerIds = row.player_ids ?? [];
    return {
      status: row.status,
      enabled: row.enabled === true,
      isPlayer: playerIds.includes(playerId),
      playerIds,
      consented: row.consented === true,
    };
  }

  async recordConsent(gameId: GameId, playerId: PlayerId, at: Date): Promise<boolean> {
    // Participation actuelle lue dans la même instruction : un départ concurrent ne laisse
    // jamais un consentement rattaché à une place quittée (`sp.active`).
    const { rows } = await this.db.query<{ joined_at: Date }>(
      `WITH seat AS (
         SELECT sp.session_id, sp.player_id, sp.joined_at
         FROM games g
         JOIN session_players sp ON sp.session_id = g.session_id AND sp.player_id = $2
         WHERE g.id = $1 AND sp.active
       ), saved AS (
         INSERT INTO detection_consents (session_id, player_id, joined_at, game_id, consented_at)
         SELECT session_id, player_id, joined_at, $1, $3 FROM seat
         ON CONFLICT (session_id, player_id, joined_at) DO NOTHING
       )
       SELECT joined_at FROM seat`,
      [gameId, playerId, at.toISOString()],
    );
    return rows.length > 0;
  }

  async consentGate(sessionId: string, playerIds: readonly PlayerId[]): Promise<ConsentGate> {
    const { rows } = await this.db.query<{ enabled: boolean; missing: PlayerId[] | null }>(
      `SELECT s.suspicion_detection_enabled AS enabled,
              (SELECT array_agg(p.id ORDER BY p.id)
               FROM unnest($2::uuid[]) AS p(id)
               WHERE NOT EXISTS (
                 SELECT 1 FROM session_players sp
                 JOIN detection_consents c
                   ON c.session_id = sp.session_id AND c.player_id = sp.player_id
                  AND c.joined_at = sp.joined_at
                 WHERE sp.session_id = s.id AND sp.player_id = p.id AND sp.active
               )) AS missing
       FROM sessions s WHERE s.id = $1`,
      [sessionId, [...playerIds]],
    );
    const row = rows[0];
    return { enabled: row?.enabled === true, missing: row?.missing ?? [] };
  }

  async insertPosition(sample: PositionSample & { id: string; receivedAt: Date }): Promise<void> {
    try {
      await this.db.query(
        `INSERT INTO detection_positions
           (id, game_id, player_id, latitude, longitude, accuracy_m, captured_at, received_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [
          sample.id,
          sample.gameId,
          sample.playerId,
          sample.latitude,
          sample.longitude,
          sample.accuracyMeters,
          sample.capturedAt.toISOString(),
          sample.receivedAt.toISOString(),
        ],
      );
    } catch (err) {
      if (
        isPgError(err, PG_CHECK_VIOLATION) &&
        (err as { constraint?: unknown }).constraint === 'detection_enabled_for_game'
      ) {
        throw new GeolocationDisabledError(sample.gameId);
      }
      throw err;
    }
  }

  async latestPositions(gameId: GameId): Promise<PositionSample[]> {
    const { rows } = await this.db.query<PositionRow>(
      `SELECT DISTINCT ON (player_id) ${COLUMNS}
       FROM detection_positions WHERE game_id = $1
       ORDER BY player_id, captured_at DESC`,
      [gameId],
    );
    return rows.map(toSample);
  }

  async listPositions(gameId: GameId): Promise<PositionSample[]> {
    const { rows } = await this.db.query<PositionRow>(
      `SELECT ${COLUMNS} FROM detection_positions WHERE game_id = $1
       ORDER BY captured_at, player_id`,
      [gameId],
    );
    return rows.map(toSample);
  }

  async countOtherProximityGames(
    gameId: GameId,
    pair: readonly [PlayerId, PlayerId],
    since: Date,
  ): Promise<number> {
    const { rows } = await this.db.query<{ n: string | number }>(
      `SELECT count(DISTINCT d.game_id) AS n
       FROM detection_signals d
       JOIN games g ON g.id = d.game_id
       JOIN sessions s ON s.id = g.session_id AND s.suspicion_detection_enabled
       WHERE d.type = 'PROXIMITY' AND d.game_id <> $1 AND d.created_at >= $2
         AND cardinality(d.player_ids) = 2 AND d.player_ids @> $3::uuid[]`,
      [gameId, since.toISOString(), [...pair]],
    );
    return Number(rows[0]?.n ?? 0);
  }

  async purgeExpired(cutoff: Date): Promise<number> {
    const { rowCount } = await this.db.query(
      `DELETE FROM detection_positions p
       USING games g
       WHERE g.id = p.game_id
         AND ((g.status = 'finished' AND COALESCE(g.finished_at, g.updated_at) <= $1)
              OR p.captured_at <= $1)`,
      [cutoff.toISOString()],
    );
    return rowCount;
  }
}
