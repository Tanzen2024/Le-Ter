import type { SqlClient } from '../database/sql-client';
import type { GameId, PlayerId } from '../domain/game/game-id';
import type { GameSettlementReader, PlayerSettlement } from './game-settlement.repository';

/**
 * Bilan d'un joueur lu dans les écritures du règlement (D-074) : `game_stake` (mise consommée,
 * débit) et `game_winnings` (gain net, crédit) de ce joueur pour cette partie. La ligne
 * `game_settlements` dit seulement si la partie est réglée (SETTLED ou VOID).
 */
export class PostgresGameSettlementReader implements GameSettlementReader {
  constructor(private readonly sql: SqlClient) {}

  async findPlayerSettlement(
    gameId: GameId,
    playerId: PlayerId,
  ): Promise<PlayerSettlement | null> {
    const { rows } = await this.sql.query<{ status: string; delta: string | number }>(
      `SELECT s.status,
              COALESCE((
                SELECT SUM(CASE t.kind WHEN 'game_winnings' THEN t.tokens ELSE -t.tokens END)
                FROM wallet_transactions t
                WHERE t.game_id = s.game_id AND t.user_id = $2
                  AND t.kind IN ('game_stake', 'game_winnings') AND t.status = 'succeeded'
              ), 0) AS delta
       FROM game_settlements s
       WHERE s.game_id = $1`,
      [gameId, playerId],
    );
    const row = rows[0];
    if (!row || row.status === 'RESERVED') return null;
    return { delta: Number(row.delta) };
  }
}
