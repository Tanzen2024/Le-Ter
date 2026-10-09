import type { CoplayStats, GameOutcome, SharedTable } from '../domain/detection/behavior-analysis';
import type { GameId, PlayerId } from '../domain/game/game-id';

/** Période d'analyse longitudinale : [since, until]. */
export interface AnalysisPeriod {
  since: Date;
  until: Date;
}

/**
 * Historique comportemental de la détection (R-36, étape 3, D-047). LECTURE SEULE, et
 * uniquement sur les tables SURVEILLÉES (`sessions.suspicion_detection_enabled`) : une
 * partie non surveillée n'alimente jamais une analyse. Rien n'est copié : tout est relu
 * depuis les tables du jeu (`games`, `game_players`, `session_players`) et les débuts de
 * session d'authentification (`refresh_tokens.created_at`). Aucune IP n'existe.
 */
export interface BehaviorHistoryRepository {
  /** Parties surveillées terminées (hors arrêt administratif) d'une paire et de chacun. */
  coplayStats(pair: readonly [PlayerId, PlayerId], period: AnalysisPeriod): Promise<CoplayStats>;

  /** Parties surveillées terminées avec un gagnant où figure au moins un de ces joueurs. */
  outcomes(playerIds: readonly PlayerId[], period: AnalysisPeriod): Promise<GameOutcome[]>;

  /** Parties surveillées jouées jusqu'au 5e tour par ce joueur, les plus récentes d'abord. */
  playedToTheEndGameIds(
    playerId: PlayerId,
    period: AnalysisPeriod,
    limit: number,
  ): Promise<GameId[]>;

  /** Tables surveillées communes à la paire : arrivées et dernière connexion de chacun. */
  sharedTables(pair: readonly [PlayerId, PlayerId], period: AnalysisPeriod): Promise<SharedTable[]>;
}
