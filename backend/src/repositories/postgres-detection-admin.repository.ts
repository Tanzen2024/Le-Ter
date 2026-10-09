import type { SqlClient } from '../database/sql-client';
import {
  AlertNotFoundError,
  AlertStatusConflictError,
  AlertTransitionNotAllowedError,
  canTransition,
  type AlertListQuery,
  type AlertSort,
} from '../domain/detection/alert-admin';
import type { AlertStatus, SuspicionScore } from '../domain/detection/detection';
import type { AdminAlert, DetectionAdminRepository, Page } from './detection-admin.repository';
import {
  SCORE_COLUMNS,
  SIGNAL_COLUMNS,
  toAlert,
  toScore,
  toSignal,
  type AlertRow,
  type ScoreRow,
  type SignalRow,
} from './postgres-detection.repository';

const ALERT_COLUMNS = `id, game_id, type, subject_key, player_ids, scope, level, priority, score,
  score_algorithm_version, signal_types, period_start, dedupe_key, status, created_at, updated_at`;

/** Tri : la clé validée choisit un fragment SQL CONSTANT (jamais une valeur reçue). */
const ORDER_BY: Readonly<Record<AlertSort, string>> = {
  created_at_desc: 'created_at DESC, id',
  created_at_asc: 'created_at ASC, id',
  score_desc: 'score DESC, created_at DESC, id',
  score_asc: 'score ASC, created_at DESC, id',
  priority: "(priority = 'PRIORITY') DESC, created_at DESC, id",
  level: "(level = 'very_high') DESC, score DESC, created_at DESC, id",
};

/** Filtres facultatifs, tous paramétrés ($1 à $8). */
const ALERT_FILTERS = `
  WHERE ($1::text IS NULL OR status = $1)
    AND ($2::text IS NULL OR level = $2)
    AND ($3::text IS NULL OR priority = $3)
    AND ($4::text IS NULL OR type = $4)
    AND ($5::text IS NULL OR subject_key = $5)
    AND ($6::uuid IS NULL OR player_ids @> ARRAY[$6::uuid])
    AND ($7::timestamptz IS NULL OR created_at >= $7)
    AND ($8::timestamptz IS NULL OR created_at < $8)`;

type AdminAlertRow = AlertRow & { updated_at: Date };
const toAdminAlert = (r: AdminAlertRow): AdminAlert => ({ ...toAlert(r), updatedAt: r.updated_at });

export class PostgresDetectionAdminRepository implements DetectionAdminRepository {
  constructor(private readonly db: SqlClient) {}

  async listAlerts(query: AlertListQuery): Promise<Page<AdminAlert>> {
    const filters = [
      query.status ?? null,
      query.level ?? null,
      query.priority ?? null,
      query.type ?? null,
      query.subjectKey ?? null,
      query.playerId ?? null,
      query.from?.toISOString() ?? null,
      query.to?.toISOString() ?? null,
    ];
    const [count, page] = await Promise.all([
      this.db.query<{ total: string }>(
        `SELECT count(*) AS total FROM detection_alerts ${ALERT_FILTERS}`,
        filters,
      ),
      this.db.query<AdminAlertRow>(
        `SELECT ${ALERT_COLUMNS} FROM detection_alerts ${ALERT_FILTERS}
         ORDER BY ${ORDER_BY[query.sort]} LIMIT $9 OFFSET $10`,
        [...filters, query.limit, (query.page - 1) * query.limit],
      ),
    ]);
    return { total: Number(count.rows[0]?.total ?? 0), items: page.rows.map(toAdminAlert) };
  }

  async findAlert(alertId: string): Promise<AdminAlert | null> {
    const { rows } = await this.db.query<AdminAlertRow>(
      `SELECT ${ALERT_COLUMNS} FROM detection_alerts WHERE id = $1`,
      [alertId],
    );
    return rows[0] ? toAdminAlert(rows[0]) : null;
  }

  async scoreSnapshot(gameId: string, subjectKey: string): Promise<SuspicionScore | null> {
    const { rows } = await this.db.query<ScoreRow>(
      `SELECT ${SCORE_COLUMNS} FROM detection_scores WHERE game_id = $1 AND subject_key = $2`,
      [gameId, subjectKey],
    );
    return rows[0] ? toScore(rows[0]) : null;
  }

  async subjectSignals(subjectKey: string, since: Date, until: Date) {
    const { rows } = await this.db.query<SignalRow>(
      `SELECT ${SIGNAL_COLUMNS} FROM detection_signals
       WHERE subject_key = $1 AND created_at >= $2 AND created_at <= $3
       ORDER BY created_at DESC, id`,
      [subjectKey, since.toISOString(), until.toISOString()],
    );
    return rows.map(toSignal);
  }

  async scoreHistory(
    subjectKey: string,
    page: number,
    limit: number,
  ): Promise<Page<SuspicionScore>> {
    const [count, rows] = await Promise.all([
      this.db.query<{ total: string }>(
        'SELECT count(*) AS total FROM detection_scores WHERE subject_key = $1',
        [subjectKey],
      ),
      this.db.query<ScoreRow>(
        `SELECT ${SCORE_COLUMNS} FROM detection_scores WHERE subject_key = $1
         ORDER BY computed_at DESC, game_id LIMIT $2 OFFSET $3`,
        [subjectKey, limit, (page - 1) * limit],
      ),
    ]);
    return { total: Number(count.rows[0]?.total ?? 0), items: rows.rows.map(toScore) };
  }

  async changeAlertStatus(command: {
    alertId: string;
    to: AlertStatus;
    expectedStatus?: AlertStatus;
    actorId: string;
    auditId: string;
    now: Date;
  }): Promise<{ alert: AdminAlert; changed: boolean }> {
    return this.db.transaction(async (tx) => {
      const { rows } = await tx.query<AdminAlertRow>(
        `SELECT ${ALERT_COLUMNS} FROM detection_alerts WHERE id = $1 FOR UPDATE`,
        [command.alertId],
      );
      const current = rows[0];
      if (!current) throw new AlertNotFoundError(command.alertId);
      // Même changement déjà appliqué (requête répétée) : idempotent, aucun audit.
      if (current.status === command.to) {
        return { alert: toAdminAlert(current), changed: false };
      }
      if (command.expectedStatus && command.expectedStatus !== current.status) {
        throw new AlertStatusConflictError(command.expectedStatus, current.status);
      }
      if (!canTransition(current.status, command.to)) {
        throw new AlertTransitionNotAllowedError(current.status, command.to);
      }
      const updated = await tx.query<AdminAlertRow>(
        `UPDATE detection_alerts SET status = $2, updated_at = $3 WHERE id = $1
         RETURNING ${ALERT_COLUMNS}`,
        [command.alertId, command.to, command.now.toISOString()],
      );
      await tx.query(
        `INSERT INTO admin_audit_log (id, actor_id, action, target_type, target_id, details,
           created_at)
         VALUES ($1, $2, 'ALERT_STATUS_CHANGED', 'DETECTION_ALERT', $3, $4, $5)`,
        [
          command.auditId,
          command.actorId,
          command.alertId,
          JSON.stringify({ from: current.status, to: command.to }),
          command.now.toISOString(),
        ],
      );
      return { alert: toAdminAlert(updated.rows[0]!), changed: true };
    });
  }
}
