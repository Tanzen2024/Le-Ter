import { isPgError, type SqlClient } from '../database/sql-client';
import {
  SignalOutsideGameError,
  type AlertPriority,
  type AlertStatus,
  type DetectionAlert,
  type DetectionSignal,
  type ScoreComponent,
  type SubjectScope,
  type SuspicionScore,
} from '../domain/detection/detection';
import type { RiskLevel, SignalSeverity, SignalType } from '../domain/detection/detection-config';
import type { GameType } from '../domain/game/game';
import type { GameId, PlayerId } from '../domain/game/game-id';
import {
  DetectionDisabledError,
  type AlertDraft,
  type DetectionRepository,
} from './detection.repository';

const PG_CHECK_VIOLATION = '23514';

export interface SignalRow {
  id: string;
  game_id: GameId;
  type: SignalType;
  severity: SignalSeverity;
  contribution: string | number;
  player_ids: PlayerId[];
  evidence: Record<string, unknown>;
  algorithm_version: number;
  created_at: Date;
}

export interface ScoreRow {
  game_id: GameId;
  subject_key: string;
  player_ids: PlayerId[];
  scope: SubjectScope;
  score: number;
  level: RiskLevel;
  previous_score: number | null;
  signal_count: number;
  components: ScoreComponent[];
  signals_since: Date | null;
  algorithm_version: number;
  computed_at: Date;
}

export interface AlertRow {
  id: string;
  game_id: GameId;
  type: DetectionAlert['type'];
  subject_key: string;
  player_ids: PlayerId[];
  scope: SubjectScope;
  level: RiskLevel;
  priority: AlertPriority;
  score: number;
  score_algorithm_version: number;
  signal_types: SignalType[];
  period_start: Date;
  dedupe_key: string;
  status: AlertStatus;
  created_at: Date;
}

export const SIGNAL_COLUMNS = `id, game_id, type, severity, contribution, player_ids, evidence,
  algorithm_version, created_at`;
export const SCORE_COLUMNS = `game_id, subject_key, player_ids, scope, score, level, previous_score,
  signal_count, components, signals_since, algorithm_version, computed_at`;

export const toSignal = (r: SignalRow): DetectionSignal => ({
  id: r.id,
  gameId: r.game_id,
  type: r.type,
  severity: r.severity,
  contribution: Number(r.contribution),
  playerIds: [...r.player_ids],
  evidence: r.evidence,
  algorithmVersion: r.algorithm_version,
  createdAt: r.created_at,
});

export const toScore = (r: ScoreRow): SuspicionScore => ({
  gameId: r.game_id,
  subjectKey: r.subject_key,
  playerIds: [...r.player_ids],
  scope: r.scope,
  score: r.score,
  level: r.level,
  previousScore: r.previous_score,
  signalCount: r.signal_count,
  components: r.components,
  signalsSince: r.signals_since,
  algorithmVersion: r.algorithm_version,
  computedAt: r.computed_at,
});

export const toAlert = (r: AlertRow): DetectionAlert => ({
  id: r.id,
  gameId: r.game_id,
  type: r.type,
  subjectKey: r.subject_key,
  playerIds: [...r.player_ids],
  scope: r.scope,
  level: r.level,
  priority: r.priority,
  score: r.score,
  scoreAlgorithmVersion: r.score_algorithm_version,
  signalTypes: [...r.signal_types],
  periodStart: r.period_start,
  dedupeKey: r.dedupe_key,
  status: r.status,
  createdAt: r.created_at,
});

/** Gardes des migrations 0012 / 0016 → erreurs du domaine. */
function translate(err: unknown, gameId: GameId): unknown {
  if (isPgError(err, PG_CHECK_VIOLATION)) {
    const constraint = (err as { constraint?: unknown }).constraint;
    if (constraint === 'detection_enabled_for_game') return new DetectionDisabledError(gameId);
    if (constraint === 'detection_players_in_game') return new SignalOutsideGameError(gameId);
  }
  return err;
}

export class PostgresDetectionRepository implements DetectionRepository {
  constructor(private readonly db: SqlClient) {}

  async isEnabledForGame(gameId: GameId): Promise<boolean | null> {
    // GARAM TIA : jamais surveillée (D-144), même une table créée avant avec l'option.
    const { rows } = await this.db.query<{ enabled: boolean }>(
      `SELECT s.suspicion_detection_enabled AND s.game_type <> 'GARAM' AS enabled
       FROM games g JOIN sessions s ON s.id = g.session_id WHERE g.id = $1`,
      [gameId],
    );
    return rows[0] ? rows[0].enabled : null;
  }

  async playersOfGame(gameId: GameId): Promise<PlayerId[]> {
    const { rows } = await this.db.query<{ player_id: PlayerId }>(
      'SELECT player_id FROM game_players WHERE game_id = $1 ORDER BY seat',
      [gameId],
    );
    return rows.map((r) => r.player_id);
  }

  async saveSignals(gameId: GameId, signals: readonly DetectionSignal[]): Promise<number> {
    if (signals.length === 0) return 0;
    try {
      return await this.db.transaction(async (tx) => {
        let inserted = 0;
        for (const s of signals) {
          const { rowCount } = await tx.query(
            `INSERT INTO detection_signals (id, game_id, type, severity, contribution, player_ids,
               evidence, algorithm_version, created_at)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
             ON CONFLICT (game_id, type, player_ids, algorithm_version) DO NOTHING`,
            [
              s.id,
              gameId,
              s.type,
              s.severity,
              s.contribution,
              s.playerIds,
              JSON.stringify(s.evidence ?? {}),
              s.algorithmVersion,
              s.createdAt.toISOString(),
            ],
          );
          inserted += rowCount;
        }
        return inserted;
      });
    } catch (err) {
      throw translate(err, gameId);
    }
  }

  async listSignals(gameId: GameId): Promise<DetectionSignal[]> {
    const { rows } = await this.db.query<SignalRow>(
      `SELECT ${SIGNAL_COLUMNS} FROM detection_signals WHERE game_id = $1 ORDER BY created_at, id`,
      [gameId],
    );
    return rows.map(toSignal);
  }

  async gameTypeOfGame(gameId: GameId): Promise<GameType> {
    const { rows } = await this.db.query<{ game_type: GameType }>(
      'SELECT game_type FROM games WHERE id = $1',
      [gameId],
    );
    return rows[0]?.game_type ?? 'TER';
  }

  async listSubjectSignals(
    subjectKeys: readonly string[],
    since: Date,
    gameType: GameType,
  ): Promise<DetectionSignal[]> {
    if (subjectKeys.length === 0) return [];
    const { rows } = await this.db.query<SignalRow>(
      `SELECT ${SIGNAL_COLUMNS} FROM detection_signals
       WHERE subject_key = ANY($1::text[]) AND created_at >= $2
         AND game_id IN (SELECT g.id FROM games g WHERE g.game_type = $3)
       ORDER BY created_at, id`,
      [[...subjectKeys], since.toISOString(), gameType],
    );
    return rows.map(toSignal);
  }

  async previousScores(
    subjectKeys: readonly string[],
    gameId: GameId,
  ): Promise<Map<string, number>> {
    if (subjectKeys.length === 0) return new Map();
    const { rows } = await this.db.query<{ subject_key: string; score: number }>(
      `SELECT DISTINCT ON (subject_key) subject_key, score FROM detection_scores
       WHERE subject_key = ANY($1::text[]) AND game_id <> $2
         AND game_id IN (SELECT g.id FROM games g
                         WHERE g.game_type = (SELECT o.game_type FROM games o WHERE o.id = $2))
       ORDER BY subject_key, computed_at DESC, game_id`,
      [[...subjectKeys], gameId],
    );
    return new Map(rows.map((r) => [r.subject_key, r.score]));
  }

  async saveScoring(
    gameId: GameId,
    scores: readonly SuspicionScore[],
    alerts: readonly AlertDraft[],
    now: Date,
  ): Promise<number> {
    try {
      return await this.db.transaction(async (tx) => {
        for (const sc of scores) {
          // Un instantané par (partie, sujet) : mis à jour seulement s'il change (rejeu).
          await tx.query(
            `INSERT INTO detection_scores (game_id, subject_key, player_ids, score, level,
               previous_score, signal_count, components, signals_since, algorithm_version,
               computed_at)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
             ON CONFLICT (game_id, subject_key) DO UPDATE SET
               player_ids = EXCLUDED.player_ids, score = EXCLUDED.score, level = EXCLUDED.level,
               previous_score = EXCLUDED.previous_score, signal_count = EXCLUDED.signal_count,
               components = EXCLUDED.components, signals_since = EXCLUDED.signals_since,
               algorithm_version = EXCLUDED.algorithm_version, computed_at = EXCLUDED.computed_at
             WHERE (detection_scores.score, detection_scores.signal_count,
                    detection_scores.components, detection_scores.algorithm_version)
                   IS DISTINCT FROM
                   (EXCLUDED.score, EXCLUDED.signal_count, EXCLUDED.components,
                    EXCLUDED.algorithm_version)`,
            [
              gameId,
              sc.subjectKey,
              sc.playerIds,
              sc.score,
              sc.level,
              sc.previousScore,
              sc.signalCount,
              JSON.stringify(sc.components),
              sc.signalsSince?.toISOString() ?? null,
              sc.algorithmVersion,
              sc.computedAt.toISOString(),
            ],
          );
        }
        let created = 0;
        for (const a of alerts) {
          // Doublon (même clé) ou alerte de niveau supérieur sur la même période : rien.
          const { rowCount } = await tx.query(
            `INSERT INTO detection_alerts (id, game_id, type, subject_key, player_ids, level,
               priority, score, score_algorithm_version, signal_types, period_start, dedupe_key,
               created_at, updated_at)
             SELECT $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $13
             WHERE NOT ($6 = 'high' AND EXISTS (
               SELECT 1 FROM detection_alerts x
               WHERE x.subject_key = $4 AND x.type = $3 AND x.score_algorithm_version = $9
                 AND x.period_start = $11 AND x.level = 'very_high'
                 AND (SELECT g.game_type FROM games g WHERE g.id = x.game_id)
                     = (SELECT o.game_type FROM games o WHERE o.id = $2)))
             ON CONFLICT (dedupe_key) DO NOTHING`,
            [
              a.id,
              gameId,
              a.type,
              a.subjectKey,
              a.playerIds,
              a.level,
              a.priority,
              a.score,
              a.scoreAlgorithmVersion,
              a.signalTypes,
              a.periodStart.toISOString(),
              a.dedupeKey,
              now.toISOString(),
            ],
          );
          created += rowCount;
        }
        return created;
      });
    } catch (err) {
      throw translate(err, gameId);
    }
  }

  async listScores(gameId: GameId): Promise<SuspicionScore[]> {
    const { rows } = await this.db.query<ScoreRow>(
      `SELECT ${SCORE_COLUMNS} FROM detection_scores WHERE game_id = $1
       ORDER BY score DESC, subject_key`,
      [gameId],
    );
    return rows.map(toScore);
  }

  async listSubjectScores(subjectKey: string): Promise<SuspicionScore[]> {
    const { rows } = await this.db.query<ScoreRow>(
      `SELECT ${SCORE_COLUMNS} FROM detection_scores WHERE subject_key = $1
       ORDER BY computed_at DESC, game_id`,
      [subjectKey],
    );
    return rows.map(toScore);
  }

  async listAlerts(
    filter: { subjectKey?: string; gameId?: GameId } = {},
  ): Promise<DetectionAlert[]> {
    const { rows } = await this.db.query<AlertRow>(
      `SELECT id, game_id, type, subject_key, player_ids, scope, level, priority, score,
              score_algorithm_version, signal_types, period_start, dedupe_key, status, created_at
       FROM detection_alerts
       WHERE ($1::text IS NULL OR subject_key = $1) AND ($2::uuid IS NULL OR game_id = $2)
       ORDER BY created_at DESC, (priority = 'PRIORITY') DESC, id`,
      [filter.subjectKey ?? null, filter.gameId ?? null],
    );
    return rows.map(toAlert);
  }
}
