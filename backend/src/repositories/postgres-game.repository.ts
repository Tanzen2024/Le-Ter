import {
  expectedPlayerOf,
  isForwardTransition,
  type Game,
  type GameEndReason,
  type GameResult,
  type GameStatus,
  type GameType,
  type PlayerInGame,
  type TerPlay,
} from '../domain/game/game';
import {
  GameNotFoundError,
  GameVersionConflictError,
  InvalidStatusTransitionError,
  ParticipationRefusedError,
} from '../domain/game/game-errors';
import { isGaramVariant } from '../domain/garam/garam-rules';
import { newGameId, type GameId, type PlayerId } from '../domain/game/game-id';
import {
  PG_UNIQUE_VIOLATION,
  isPgError,
  type SqlClient,
  type SqlExecutor,
} from '../database/sql-client';
import {
  NotASessionMemberError,
  SessionGameInProgressError,
  type SessionId,
} from '../domain/sessions/session';
import {
  DuplicateCreationKeyError,
  type GameRepository,
  type DealDeadline,
  type StartDeadline,
  type TurnDeadline,
} from './game.repository';
import type { GameStakeLedger } from './game-stake-ledger';

/** Index de la migration 0004. */
const ONE_ACTIVE_GAME_INDEX = 'game_players_one_active_game_per_player';
const CREATION_KEY_INDEX = 'games_creator_creation_key_idx';
/** Index de la migration 0005 : une seule partie active par session. */
const ONE_ACTIVE_GAME_PER_SESSION_INDEX = 'games_one_active_per_session';
/** Index de la migration 0007 : une partie annulée n'est rejouée qu'une fois. */
const ONE_REPLAY_PER_GAME_INDEX = 'games_one_replay_per_game';

/**
 * Partie de l'agrégat stockée en JSONB (`games.state`) : l'état de jeu interne,
 * toujours lu et écrit d'un bloc. Les autres champs sont des colonnes (requêtes,
 * index, contraintes) ; les joueurs sont dans `game_players`.
 */
interface GameStateDocument {
  play?: TerPlay;
  /** GARAM TIA (D-119) : état de la manche, manche nulle, proposition de doubler la mise. */
  garam?: Game['garam'];
  garamTie?: Game['garamTie'];
  /** GARAM TIA : mise de création de la table (D-138). */
  garamBaseStake?: number;
  garamStakeVote?: Omit<NonNullable<Game['garamStakeVote']>, 'deadlineAt'> & { deadlineAt: string };
  result?: GameResult;
  instantWinTie?: Game['instantWinTie'];
  recentCommandIds: string[];
}

interface GameRow {
  id: string;
  version: number;
  status: GameStatus;
  game_type: GameType;
  garam_variant: number | null;
  creator_id: string;
  max_players: number;
  stake_amount: string | number | null;
  state: GameStateDocument;
  created_at: Date;
  updated_at: Date;
  started_at: Date | null;
  finished_at: Date | null;
  turn_deadline_at: Date | null;
  turn_started_at: Date | null;
  turn_timed_out_at: Date | null;
  end_reason: GameEndReason | null;
  replay_of_game_id: string | null;
  auto_start_delay_ms: number | null;
  tournament_id: string | null;
  start_deadline_at: Date | null;
  deal_ends_at: Date | null;
  creation_key: string | null;
  session_id: string | null;
  first_player_id: string;
  players: PlayerJson[] | null;
}

/** Ligne de `game_players` agrégée par json_agg : les dates arrivent en texte. */
interface PlayerJson {
  player_id: string;
  seat: number;
  table_position: number;
  joined_at: string;
  fled_at: string | null;
  /** Pseudo du compte (`users.username`), lu à chaque chargement, jamais écrit ici. */
  username: string | null;
}

const SELECT_GAME = `
  SELECT g.*,
    (SELECT json_agg(json_build_object(
        'player_id', p.player_id, 'seat', p.seat, 'table_position', p.table_position,
        'joined_at', p.joined_at, 'fled_at', p.fled_at, 'username', u.username)
        ORDER BY p.seat)
     FROM game_players p LEFT JOIN users u ON u.id = p.player_id
     WHERE p.game_id = g.id) AS players
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
  /**
   * `stakeLedger` (D-074) : séquestre et règlement des mises dans la transaction de chaque
   * écriture. Absent (tests du moteur, outils) : aucun mouvement de jetons.
   */
  constructor(
    private readonly db: SqlClient,
    private readonly options: { stakeLedger?: GameStakeLedger } = {},
  ) {}

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
      await this.db.transaction((tx) => insertGameRows(tx, game, this.options.stakeLedger));
    } catch (err) {
      throw translateGameInsertError(err, game);
    }
  }

  async save(game: Game, expectedVersion: number): Promise<void> {
    try {
      await this.saveInTransaction(game, expectedVersion);
    } catch (err) {
      if (isPgError(err, PG_UNIQUE_VIOLATION) && constraintOf(err) === ONE_ACTIVE_GAME_INDEX) {
        // R-18 : un joueur ajouté est déjà membre d'une autre partie active.
        const newcomer = game.players[game.players.length - 1]?.playerId;
        throw new ParticipationRefusedError(game.id, playerOf(err) ?? newcomer ?? game.creatorId);
      }
      throw err;
    }
  }

  private async saveInTransaction(game: Game, expectedVersion: number): Promise<void> {
    await this.db.transaction((tx) =>
      updateGameRows(tx, game, expectedVersion, this.options.stakeLedger),
    );
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

  async findByCreationKey(creatorId: PlayerId, creationKey: string): Promise<Game | null> {
    const { rows } = await this.db.query<GameRow>(
      `${SELECT_GAME} WHERE g.creator_id = $1 AND g.creation_key = $2`,
      [creatorId, creationKey],
    );
    const row = rows[0];
    return row ? toGame(row) : null;
  }

  async findTurnDeadlines(): Promise<TurnDeadline[]> {
    const { rows } = await this.db.query<{
      id: GameId;
      turn_deadline_at: Date;
      turn_timed_out_at: Date | null;
    }>(
      `SELECT id, turn_deadline_at, turn_timed_out_at FROM games
       WHERE status = 'in_progress' AND turn_deadline_at IS NOT NULL
       ORDER BY turn_deadline_at`,
    );
    return rows.map((r) => ({
      gameId: r.id,
      deadlineAt: r.turn_deadline_at,
      timedOut: r.turn_timed_out_at !== null,
    }));
  }

  async findDealDeadlines(): Promise<DealDeadline[]> {
    const { rows } = await this.db.query<{ id: GameId; deal_ends_at: Date }>(
      `SELECT id, deal_ends_at FROM games
       WHERE status = 'in_progress' AND deal_ends_at IS NOT NULL
       ORDER BY deal_ends_at`,
    );
    return rows.map((r) => ({ gameId: r.id, deadlineAt: r.deal_ends_at }));
  }

  async findStartDeadlines(): Promise<StartDeadline[]> {
    const { rows } = await this.db.query<{ id: GameId; start_deadline_at: Date }>(
      `SELECT id, start_deadline_at FROM games
       WHERE status = 'waiting' AND start_deadline_at IS NOT NULL
       ORDER BY start_deadline_at`,
    );
    return rows.map((r) => ({ gameId: r.id, deadlineAt: r.start_deadline_at }));
  }
}

/**
 * Écrit une NOUVELLE partie (ligne `games` + sièges) dans la transaction `tx`. Exportée
 * pour que la création d'une session et de sa première partie, ou d'une partie dans une
 * session verrouillée, soit une seule transaction (D-033). Erreurs brutes de PostgreSQL :
 * voir `translateGameInsertError`.
 */
export async function insertGameRows(
  tx: SqlExecutor,
  game: Game,
  stakeLedger?: GameStakeLedger,
): Promise<void> {
  await tx.query(
    `INSERT INTO games (id, version, status, creator_id, max_players, stake_amount, state,
       created_at, updated_at, started_at, finished_at, turn_deadline_at, creation_key,
       session_id, first_player_id, winner_id, turn_started_at, active_player_id,
       turn_timed_out_at, end_reason, replay_of_game_id, auto_start_delay_ms, start_deadline_at,
       deal_ends_at, tournament_id, game_type, garam_variant)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18,
       $19, $20, $21, $22, $23, $24, $25, $26, $27)`,
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
      game.creationKey ?? null,
      game.sessionId ?? null,
      game.firstPlayerId,
      game.result?.winnerId ?? null,
      timestamp(game.turnStartedAt),
      activePlayerOf(game),
      timestamp(game.turnTimedOutAt),
      game.endReason ?? null,
      game.replayOfGameId ?? null,
      game.autoStartDelayMs ?? null,
      timestamp(game.startDeadlineAt),
      timestamp(game.dealEndsAt),
      game.tournamentId ?? null,
      game.gameType ?? 'TER',
      game.garamVariant ?? null,
    ],
  );
  await writePlayers(tx, game);
  // D-074 : une partie insérée déjà démarrée (partie suivante, reprise) ouvre son séquestre.
  await stakeLedger?.afterGameWrite(tx, game, null);
}

/**
 * Enregistre une partie EXISTANTE dans la transaction `tx`, si sa version est encore
 * `expectedVersion` (sinon GameVersionConflictError). Exportée pour qu'un départ de session
 * modifie sa partie en attente dans la même transaction que la session (R-19, D-037).
 */
export async function updateGameRows(
  tx: SqlExecutor,
  game: Game,
  expectedVersion: number,
  stakeLedger?: GameStakeLedger,
): Promise<void> {
  // D-074 : statut enregistré AVANT l'écriture (démarrage, fin). Lu sous le verrou de la
  // ligne : la version conditionne l'UPDATE, une écriture concurrente serait un conflit.
  const previousStatus =
    stakeLedger && game.status !== 'waiting'
      ? ((
          await tx.query<{ status: GameStatus }>(
            'SELECT status FROM games WHERE id = $1 FOR UPDATE',
            [game.id],
          )
        ).rows[0]?.status ?? null)
      : null;
  // La ligne n'est modifiée que si la version est celle lue ET si le statut ne
  // recule pas (waiting → in_progress → finished) : garde-fou en base du cycle de vie.
  const { rowCount } = await tx.query(
    `UPDATE games SET version = $3, status = $4, creator_id = $5, max_players = $6,
         stake_amount = $7, state = $8, updated_at = $9, started_at = $10,
         finished_at = $11, turn_deadline_at = $12, first_player_id = $13, winner_id = $14,
         turn_started_at = $15, active_player_id = $16, turn_timed_out_at = $17,
         end_reason = $18, start_deadline_at = $19, deal_ends_at = $20
       WHERE id = $1 AND version = $2
         AND array_position(ARRAY['waiting', 'in_progress', 'finished'], status)
             <= array_position(ARRAY['waiting', 'in_progress', 'finished'], $4::text)`,
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
      game.firstPlayerId,
      game.result?.winnerId ?? null,
      timestamp(game.turnStartedAt),
      activePlayerOf(game),
      timestamp(game.turnTimedOutAt),
      game.endReason ?? null,
      timestamp(game.startDeadlineAt),
      timestamp(game.dealEndsAt),
    ],
  );
  if (rowCount === 0) {
    const { rows } = await tx.query<{ version: number; status: GameStatus }>(
      'SELECT version, status FROM games WHERE id = $1',
      [game.id],
    );
    const stored = rows[0];
    if (!stored) {
      throw new GameNotFoundError(game.id);
    }
    if (stored.version === expectedVersion && !isForwardTransition(stored.status, game.status)) {
      throw new InvalidStatusTransitionError(game.id, stored.status, game.status);
    }
    throw new GameVersionConflictError(game.id, expectedVersion, stored.version);
  }
  await writePlayers(tx, game);
  if (stakeLedger && previousStatus !== null) {
    await stakeLedger.afterGameWrite(tx, game, previousStatus);
  }
}

/** Partie lue et VERROUILLÉE (`FOR UPDATE`) dans la transaction `tx`, ou null. */
export async function lockGame(tx: SqlExecutor, gameId: GameId): Promise<Game | null> {
  await tx.query('SELECT 1 FROM games WHERE id = $1 FOR UPDATE', [gameId]);
  const { rows } = await tx.query<GameRow>(`${SELECT_GAME} WHERE g.id = $1`, [gameId]);
  const row = rows[0];
  return row ? toGame(row) : null;
}

/**
 * Supprime une partie EN ATTENTE (R-19, D-037 : plus aucun joueur). Ses sièges partent avec
 * elle (`ON DELETE CASCADE`). Une partie démarrée ou terminée n'est jamais supprimée.
 */
export async function deleteWaitingGame(tx: SqlExecutor, gameId: GameId): Promise<void> {
  const { rowCount } = await tx.query("DELETE FROM games WHERE id = $1 AND status = 'waiting'", [
    gameId,
  ]);
  if (rowCount === 0) {
    throw new GameNotFoundError(gameId);
  }
}

/** Joueur attendu d'une partie en cours (colonne `active_player_id`, D-034). */
function activePlayerOf(game: Game): PlayerId | null {
  return game.status === 'in_progress' ? (expectedPlayerOf(game) ?? null) : null;
}

/** Violations d'unicité à l'insertion d'une partie → erreurs du domaine. */
export function translateGameInsertError(err: unknown, game: Game): unknown {
  if (!isPgError(err, PG_UNIQUE_VIOLATION)) {
    return err;
  }
  const constraint = constraintOf(err);
  if (constraint === CREATION_KEY_INDEX && game.creationKey) {
    return new DuplicateCreationKeyError(game.creatorId, game.creationKey);
  }
  if (constraint === ONE_ACTIVE_GAME_INDEX) {
    return new ParticipationRefusedError(game.id, playerOf(err) ?? game.creatorId);
  }
  if (
    (constraint === ONE_ACTIVE_GAME_PER_SESSION_INDEX ||
      constraint === ONE_REPLAY_PER_GAME_INDEX) &&
    game.sessionId
  ) {
    return new SessionGameInProgressError(game.sessionId);
  }
  return new Error(`Partie déjà existante : ${game.id}`, { cause: err });
}

function constraintOf(err: unknown): string | undefined {
  const constraint = (err as { constraint?: unknown }).constraint;
  return typeof constraint === 'string' ? constraint : undefined;
}

/** `Key (player_id)=(…) already exists.` → identifiant du joueur en conflit. */
function playerOf(err: unknown): PlayerId | undefined {
  const detail = (err as { detail?: unknown }).detail;
  const match = typeof detail === 'string' ? /\(player_id\)=\(([^)]+)\)/.exec(detail) : null;
  return match?.[1] as PlayerId | undefined;
}

/**
 * Aligne `game_players` sur `game.players`, dans la transaction de l'écriture
 * de la partie (la ligne `games` est déjà verrouillée par l'INSERT ou l'UPDATE).
 */
async function writePlayers(tx: SqlExecutor, game: Game): Promise<void> {
  // `active` suit le statut de la partie : c'est lui que l'index R-18 contraint.
  const active = game.status !== 'finished';
  const ids = game.players.map((p) => p.playerId);
  if (game.sessionId) {
    await assertNewPlayersInSession(tx, game.sessionId, game, ids);
  }
  await tx.query('DELETE FROM game_players WHERE game_id = $1 AND NOT (player_id = ANY($2))', [
    game.id,
    ids,
  ]);
  for (const p of game.players) {
    await tx.query(
      `INSERT INTO game_players (game_id, player_id, seat, joined_at, fled_at, active,
         table_position)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (game_id, player_id)
       DO UPDATE SET seat = EXCLUDED.seat, joined_at = EXCLUDED.joined_at,
         fled_at = EXCLUDED.fled_at, active = EXCLUDED.active,
         table_position = EXCLUDED.table_position`,
      [
        game.id,
        p.playerId,
        p.seat,
        timestamp(p.joinedAt),
        timestamp(p.fledAt),
        active,
        p.tablePosition ?? p.seat,
      ],
    );
  }
}

/**
 * Un joueur n'entre dans une partie que s'il est membre ACTIF de sa session (D-033).
 * Vérifié dans la transaction d'écriture, avec un verrou partagé sur sa ligne
 * `session_players` : un départ de session concurrent (qui verrouille cette ligne en
 * écriture) passe soit avant (adhésion refusée), soit après (départ refusé, car le joueur
 * est alors dans une partie active).
 */
async function assertNewPlayersInSession(
  tx: SqlExecutor,
  sessionId: SessionId,
  game: Game,
  ids: readonly PlayerId[],
): Promise<void> {
  const existing = await tx.query<{ player_id: PlayerId }>(
    'SELECT player_id FROM game_players WHERE game_id = $1',
    [game.id],
  );
  const known = new Set(existing.rows.map((r) => r.player_id));
  const newcomers = ids.filter((id) => !known.has(id));
  if (newcomers.length === 0) {
    return;
  }
  const { rows } = await tx.query<{ player_id: PlayerId }>(
    `SELECT player_id FROM session_players
     WHERE session_id = $1 AND player_id = ANY($2) AND active
     FOR SHARE`,
    [sessionId, newcomers],
  );
  const members = new Set(rows.map((r) => r.player_id));
  const outsider = newcomers.find((id) => !members.has(id));
  if (outsider) {
    throw new NotASessionMemberError(sessionId, outsider);
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
    ...(game.instantWinTie && { instantWinTie: game.instantWinTie }),
    ...(game.garam && { garam: game.garam }),
    ...(game.garamTie && { garamTie: game.garamTie }),
    ...(game.garamBaseStake !== undefined && { garamBaseStake: game.garamBaseStake }),
    ...(game.garamStakeVote && {
      garamStakeVote: {
        ...game.garamStakeVote,
        deadlineAt: game.garamStakeVote.deadlineAt.toISOString(),
      },
    }),
    recentCommandIds: game.recentCommandIds,
  };
  return JSON.stringify(doc);
}

/**
 * Résultats GARAM enregistrés avant les variantes (D-127) : `belowFifteenIds` (seuil 15, la
 * seule règle d'alors) relu comme `belowThresholdIds` + `penaltyThreshold: 15`. Rien n'est
 * réécrit en base.
 */
function withGaramThreshold(result: GameResult & { belowFifteenIds?: PlayerId[] }): GameResult {
  const { belowFifteenIds, ...rest } = result;
  if (!belowFifteenIds || rest.belowThresholdIds) return rest;
  return { ...rest, belowThresholdIds: belowFifteenIds, penaltyThreshold: 15 };
}

function toGame(row: GameRow): Game {
  const players: PlayerInGame[] = (row.players ?? []).map((p) => ({
    playerId: p.player_id as PlayerId,
    seat: p.seat,
    tablePosition: p.table_position,
    joinedAt: new Date(p.joined_at),
    ...(p.fled_at !== null && { fledAt: new Date(p.fled_at) }),
    ...(p.username && { username: p.username }),
  }));
  const {
    play,
    result,
    instantWinTie,
    garam,
    garamTie,
    garamBaseStake,
    garamStakeVote,
    recentCommandIds,
  } = row.state;

  return {
    id: row.id as GameId,
    ...(row.game_type === 'GARAM' && { gameType: 'GARAM' as const }),
    ...(isGaramVariant(row.garam_variant) && { garamVariant: row.garam_variant }),
    ...(row.session_id !== null && { sessionId: row.session_id as SessionId }),
    firstPlayerId: row.first_player_id as PlayerId,
    version: row.version,
    status: row.status,
    creatorId: row.creator_id as PlayerId,
    maxPlayers: row.max_players,
    ...(row.stake_amount !== null && { stakeAmount: toSafeInteger(row.stake_amount) }),
    players,
    ...(play && { play }),
    ...(result && { result: withGaramThreshold(result) }),
    ...(instantWinTie && { instantWinTie }),
    ...(garam && { garam }),
    ...(garamTie && { garamTie }),
    ...(garamBaseStake !== undefined && { garamBaseStake }),
    ...(garamStakeVote && {
      garamStakeVote: { ...garamStakeVote, deadlineAt: new Date(garamStakeVote.deadlineAt) },
    }),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    ...(row.started_at && { startedAt: row.started_at }),
    ...(row.finished_at && { finishedAt: row.finished_at }),
    ...(row.turn_started_at && { turnStartedAt: row.turn_started_at }),
    ...(row.turn_deadline_at && { turnDeadlineAt: row.turn_deadline_at }),
    ...(row.turn_timed_out_at && { turnTimedOutAt: row.turn_timed_out_at }),
    ...(row.end_reason !== null && { endReason: row.end_reason }),
    ...(row.replay_of_game_id !== null && { replayOfGameId: row.replay_of_game_id as GameId }),
    ...(row.auto_start_delay_ms !== null && { autoStartDelayMs: row.auto_start_delay_ms }),
    ...(row.tournament_id && { tournamentId: row.tournament_id }),
    ...(row.start_deadline_at && { startDeadlineAt: row.start_deadline_at }),
    ...(row.deal_ends_at && { dealEndsAt: row.deal_ends_at }),
    recentCommandIds,
    ...(row.creation_key !== null && { creationKey: row.creation_key }),
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
