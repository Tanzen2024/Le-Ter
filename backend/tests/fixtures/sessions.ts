import { PG_UNIQUE_VIOLATION, isPgError, type SqlExecutor } from '../../src/database/sql-client';
import type { Game } from '../../src/domain/game/game';
import type { GameRepository } from '../../src/repositories/game.repository';

/**
 * Depuis D-033, une partie stockée dans PostgreSQL appartient à une session existante, et
 * ses joueurs en sont des membres actifs. Les tests du DÉPÔT des parties construisent
 * leurs parties à la main : cette fixture crée la session et ses membres correspondants
 * (sans passer par SessionService, qui est testé à part).
 */
export async function seedSessionFor(sql: SqlExecutor, game: Game): Promise<void> {
  // Deux écritures concurrentes peuvent viser le même siège libre : on réessaie.
  for (let attempt = 0; ; attempt++) {
    try {
      return await seedOnce(sql, game);
    } catch (err) {
      if (attempt >= 5 || !isPgError(err, PG_UNIQUE_VIOLATION)) {
        throw err;
      }
    }
  }
}

async function seedOnce(sql: SqlExecutor, game: Game): Promise<void> {
  if (!game.sessionId) {
    throw new Error('seedSessionFor : partie sans sessionId');
  }
  await sql.query(
    `INSERT INTO sessions (id, version, status, creator_id, max_players, created_at, updated_at)
     VALUES ($1, 1, 'open', $2, $3, now(), now()) ON CONFLICT DO NOTHING`,
    // Capacité de session valide (2 à 4) même pour une partie de test construite à la main.
    [game.sessionId, game.creatorId, Math.min(4, Math.max(2, game.maxPlayers))],
  );
  for (const p of game.players) {
    // Un joueur n'est présent que dans une session à la fois (D-034) : il est déplacé.
    await sql.query(
      `UPDATE session_players SET active = false, left_at = now()
       WHERE player_id = $1 AND active AND session_id <> $2`,
      [p.playerId, game.sessionId],
    );
    // Siège de session : celui de la partie s'il est libre, sinon le premier libre (les
    // tests du dépôt écrivent parfois deux joueurs concurrents au même rang).
    const taken = await sql.query<{ player_id: string; seat: number }>(
      'SELECT player_id, seat FROM session_players WHERE session_id = $1 AND active',
      [game.sessionId],
    );
    if (taken.rows.some((r) => r.player_id === p.playerId)) {
      continue;
    }
    const used = new Set(taken.rows.map((r) => r.seat));
    const preferred = p.tablePosition ?? p.seat;
    const seat = used.has(preferred) ? [0, 1, 2, 3].find((s) => !used.has(s)) : preferred;
    await sql.query(
      `INSERT INTO session_players (session_id, player_id, seat, active, joined_at)
       VALUES ($1, $2, $3, true, now())
       ON CONFLICT (session_id, player_id) DO UPDATE SET active = true, left_at = NULL,
         seat = EXCLUDED.seat`,
      [game.sessionId, p.playerId, seat],
    );
  }
}

/** Dépôt de parties dont chaque écriture crée d'abord la session et ses membres. */
export function withSeededSessions(repository: GameRepository, sql: SqlExecutor): GameRepository {
  return {
    nextId: () => repository.nextId(),
    findById: (id) => repository.findById(id),
    findActiveByPlayer: (id) => repository.findActiveByPlayer(id),
    findByCreationKey: (creatorId, key) => repository.findByCreationKey(creatorId, key),
    findTurnDeadlines: () => repository.findTurnDeadlines(),
    insert: async (game) => {
      await seedSessionFor(sql, game);
      return repository.insert(game);
    },
    save: async (game, expectedVersion) => {
      await seedSessionFor(sql, game);
      return repository.save(game, expectedVersion);
    },
  };
}
