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
    if (row) {
      return row.status === 'RESERVED' ? null : { delta: Number(row.delta), account: 'WALLET' };
    }
    // Partie de tournoi : règlement des comptes FICTIFS (D-111), une ligne par partie. Un
    // joueur non réglé (fuyard d'une partie à 3 ou 4, règlement VOID) : variation 0.
    const tournament = await this.sql.query<{ delta: string | number | null }>(
      `SELECT (tg.transfers ->> $2::text) AS delta
         FROM tournament_games tg
         JOIN games g ON g.id = tg.game_id AND g.tournament_id = tg.tournament_id
        WHERE tg.game_id = $1`,
      [gameId, playerId],
    );
    const settled = tournament.rows[0];
    if (!settled) return null;
    return { delta: Number(settled.delta ?? 0), account: 'TOURNAMENT' };
  }
}
