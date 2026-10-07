import type { Game, GameResult, GameStatus, PlayerInGame, TerPlay } from '../domain/game/game';
import { GameNotFoundError, GameVersionConflictError } from '../domain/game/game-errors';
import { newGameId, type GameId, type PlayerId } from '../domain/game/game-id';
import {
  PG_UNIQUE_VIOLATION,
  isPgError,
  type SqlClient,
  type SqlExecutor,
} from '../database/sql-client';
import type { GameRepository } from './game.repository';

/**
 * Partie de l'agrégat stockée en JSONB (`games.state`) : l'état de jeu interne,
 * toujours lu et écrit d'un bloc. Les autres champs sont des colonnes (requêtes,
 * index, contraintes) ; les joueurs sont dans `game_players`.
 */
interface GameStateDocument {
  play?: TerPlay;
  result?: GameResult;
  recentCommandIds: string[];
}

interface GameRow {
  id: string;
  version: number;
  status: GameStatus;
  creator_id: string;
  max_players: number;
  stake_amount: string | number | null;
  state: GameStateDocument;
  created_at: Date;
  updated_at: Date;
  started_at: Date | null;
  finished_at: Date | null;
  turn_deadline_at: Date | null;
  players: PlayerJson[] | null;
}

/** Ligne de `game_players` agrégée par json_agg : les dates arrivent en texte. */
interface PlayerJson {
  player_id: string;
  seat: number;
  joined_at: string;
  fled_at: string | null;
}

const SELECT_GAME = `
  SELECT g.*,
    (SELECT json_agg(json_build_object(
        'player_id', p.player_id, 'seat', p.seat,
        'joined_at', p.joined_at, 'fled_at', p.fled_at) ORDER BY p.seat)
     FROM game_players p WHERE p.game_id = g.id) AS players
  FROM games g`;

/**
 * Dépôt PostgreSQL des parties (D-022).
 *
 * Contrat d'isolation identique à InMemoryGameRepository : chaque lecture
 * construit un objet neuf à partir des lignes, rien n'est mis en cache, aucune
 * référence n'est partagée entre parties ni avec l'appelant.
 *
 * Concurrence (D-013) : `save` est un UPDATE conditionné à la version lue. Sous
 * READ COMMITTED, deux écritures concurrentes de la même version se sérialisent
 * sur le verrou de la ligne et la seconde ne modifie aucune ligne : c'est un
 * conflit, y compris entre plusieurs instances du backend.
 */
export class PostgresGameRepository implements GameRepository {
  constructor(private readonly db: SqlClient) {}

  nextId(): GameId {
    return newGameId();
  }

  async findById(gameId: GameId): Promise<Game | null> {
    const { rows } = await this.db.query<GameRow>(`${SELECT_GAME} WHERE g.id = $1`, [gameId]);
    const row = rows[0];
    return row ? toGame(row) : null;
  }

  async insert(game: Game): Promise<void> {
    try {
      await this.db.transaction(async (tx) => {
        await tx.query(
          `INSERT INTO games (id, version, status, creator_id, max_players, stake_amount, state,
             created_at, updated_at, started_at, finished_at, turn_deadline_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
          [
            game.id,
            game.version,
            game.status,
            game.creatorId,
            game.maxPlayers,
            game.stakeAmount ?? null,
            stateDocument(game),
            timestamp(game.createdAt),
            timestamp(game.updatedAt),
            timestamp(game.startedAt),
            timestamp(game.finishedAt),
            timestamp(game.turnDeadlineAt),
          ],
        );
        await writePlayers(tx, game);
      });
    } catch (err) {
      if (isPgError(err, PG_UNIQUE_VIOLATION)) {
        throw new Error(`Partie déjà existante : ${game.id}`, { cause: err });
      }
      throw err;
    }
  }

  async save(game: Game, expectedVersion: number): Promise<void> {
    await this.db.transaction(async (tx) => {
      const { rowCount } = await tx.query(
        `UPDATE games SET version = $3, status = $4, creator_id = $5, max_players = $6,
           stake_amount = $7, state = $8, updated_at = $9, started_at = $10,
           finished_at = $11, turn_deadline_at = $12
         WHERE id = $1 AND version = $2`,
        [
          game.id,
          expectedVersion,
          game.version,
          game.status,
          game.creatorId,
          game.maxPlayers,
          game.stakeAmount ?? null,
          stateDocument(game),
          timestamp(game.updatedAt),
          timestamp(game.startedAt),
          timestamp(game.finishedAt),
          timestamp(game.turnDeadlineAt),
        ],
      );
      if (rowCount === 0) {
        const { rows } = await tx.query<{ version: number }>(
          'SELECT version FROM games WHERE id = $1',
          [game.id],
        );
        const stored = rows[0];
        if (!stored) {
          throw new GameNotFoundError(game.id);
        }
        throw new GameVersionConflictError(game.id, expectedVersion, stored.version);
      }
      await writePlayers(tx, game);
    });
  }

  async findActiveByPlayer(playerId: PlayerId): Promise<Game[]> {
    const { rows } = await this.db.query<GameRow>(
      `${SELECT_GAME}
       WHERE g.status <> 'finished'
         AND EXISTS (SELECT 1 FROM game_players p WHERE p.game_id = g.id AND p.player_id = $1)
       ORDER BY g.created_at, g.id`,
      [playerId],
    );
    return rows.map(toGame);
  }
}

/**
 * Aligne `game_players` sur `game.players`, dans la transaction de l'écriture
 * de la partie (la ligne `games` est déjà verrouillée par l'INSERT ou l'UPDATE).
 */
async function writePlayers(tx: SqlExecutor, game: Game): Promise<void> {
  const ids = game.players.map((p) => p.playerId);
  await tx.query('DELETE FROM game_players WHERE game_id = $1 AND NOT (player_id = ANY($2))', [
    game.id,
    ids,
  ]);
  for (const p of game.players) {
    await tx.query(
      `INSERT INTO game_players (game_id, player_id, seat, joined_at, fled_at)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (game_id, player_id)
       DO UPDATE SET seat = EXCLUDED.seat, joined_at = EXCLUDED.joined_at, fled_at = EXCLUDED.fled_at`,
      [game.id, p.playerId, p.seat, timestamp(p.joinedAt), timestamp(p.fledAt)],
    );
  }
}

/**
 * Dates passées en ISO 8601 (UTC, ms) plutôt qu'en objets Date : PostgreSQL les
 * lit sans ambiguïté, quel que soit le pilote ou le fuseau du processus.
 */
function timestamp(date: Date): string;
function timestamp(date: Date | undefined): string | null;
function timestamp(date: Date | undefined): string | null {
  return date ? date.toISOString() : null;
}

function stateDocument(game: Game): string {
  const doc: GameStateDocument = {
    ...(game.play && { play: game.play }),
    ...(game.result && { result: game.result }),
    recentCommandIds: game.recentCommandIds,
  };
  return JSON.stringify(doc);
}

function toGame(row: GameRow): Game {
  const players: PlayerInGame[] = (row.players ?? []).map((p) => ({
    playerId: p.player_id as PlayerId,
    seat: p.seat,
    joinedAt: new Date(p.joined_at),
    ...(p.fled_at !== null && { fledAt: new Date(p.fled_at) }),
  }));
  const { play, result, recentCommandIds } = row.state;

  return {
    id: row.id as GameId,
    version: row.version,
    status: row.status,
    creatorId: row.creator_id as PlayerId,
    maxPlayers: row.max_players,
    ...(row.stake_amount !== null && { stakeAmount: toSafeInteger(row.stake_amount) }),
    players,
    ...(play && { play }),
    ...(result && { result }),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    ...(row.started_at && { startedAt: row.started_at }),
    ...(row.finished_at && { finishedAt: row.finished_at }),
    ...(row.turn_deadline_at && { turnDeadlineAt: row.turn_deadline_at }),
    recentCommandIds,
  };
}

/** `bigint` arrive en texte avec `pg` : refuser toute perte de précision. */
function toSafeInteger(value: string | number): number {
  const n = Number(value);
  if (!Number.isSafeInteger(n)) {
    throw new RangeError(`Montant hors de la plage des entiers sûrs : ${value}`);
  }
  return n;
}
