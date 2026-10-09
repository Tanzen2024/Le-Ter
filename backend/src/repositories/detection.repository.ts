import type {
  DetectionAlert,
  DetectionSignal,
  SuspicionScore,
} from '../domain/detection/detection';
import type { GameId, PlayerId } from '../domain/game/game-id';

/** Alerte prête à être enregistrée (statut NEW, date fixée par l'enregistrement). */
export type AlertDraft = Omit<DetectionAlert, 'status' | 'createdAt'>;

/**
 * Persistance du système de détection (R-36, D-044, D-048). Les écritures prennent un
 * `gameId` explicite ; la base refuse toute ligne pour une partie dont la détection est
 * désactivée, ou citant un joueur étranger à la partie (migrations 0012, 0016). Les
 * lectures par sujet sont longitudinales : uniquement des signaux de parties SURVEILLÉES
 * (les seules qui peuvent en avoir).
 */
export interface DetectionRepository {
  /**
   * Réglage `suspicionDetectionEnabled` de la table de la partie (D-043), ou `null` si la
   * partie n'existe pas.
   */
  isEnabledForGame(gameId: GameId): Promise<boolean | null>;

  /** Joueurs de la partie (pour rejeter tout signal citant un joueur étranger). */
  playersOfGame(gameId: GameId): Promise<PlayerId[]>;

  /**
   * Enregistre des signaux de la partie, en UNE transaction. Un signal déjà présent (même
   * partie, type, joueurs, version) est ignoré (idempotence, migration 0015). Renvoie le
   * nombre de signaux réellement ajoutés. Lève DetectionDisabledError si la détection n'est
   * pas activée.
   */
  saveSignals(gameId: GameId, signals: readonly DetectionSignal[]): Promise<number>;

  /** Signaux de la partie, du plus ancien au plus récent. */
  listSignals(gameId: GameId): Promise<DetectionSignal[]>;

  /** Signaux de ces sujets créés depuis `since`, toutes parties surveillées : UNE requête. */
  listSubjectSignals(subjectKeys: readonly string[], since: Date): Promise<DetectionSignal[]>;

  /** Dernier score de chaque sujet calculé lors d'une AUTRE partie que `gameId`. */
  previousScores(subjectKeys: readonly string[], gameId: GameId): Promise<Map<string, number>>;

  /**
   * Enregistre, en UNE transaction, les instantanés de score de la partie (un par sujet,
   * mis à jour seulement s'il change) et les alertes (ignorées si leur clé de
   * déduplication existe, ou si une alerte de niveau supérieur existe pour la même
   * période). Renvoie le nombre d'alertes créées.
   */
  saveScoring(
    gameId: GameId,
    scores: readonly SuspicionScore[],
    alerts: readonly AlertDraft[],
    now: Date,
  ): Promise<number>;

  /** Scores calculés lors de l'analyse de la partie, du plus élevé au plus faible. */
  listScores(gameId: GameId): Promise<SuspicionScore[]>;

  /** Historique des scores d'un sujet, du plus récent au plus ancien. */
  listSubjectScores(subjectKey: string): Promise<SuspicionScore[]>;

  /** Alertes internes (toutes, ou celles d'un sujet), les plus récentes d'abord. */
  listAlerts(filter?: { subjectKey?: string; gameId?: GameId }): Promise<DetectionAlert[]>;
}

/** Écriture refusée : la détection est désactivée pour cette partie. */
export class DetectionDisabledError extends Error {
  constructor(readonly gameId: GameId) {
    super(`Détection désactivée pour la partie ${gameId}`);
    this.name = 'DetectionDisabledError';
  }
}
