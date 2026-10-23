import type { SqlClient } from '../database/sql-client';
import type {
  DetectionSetting,
  DetectionSettingsRepository,
} from './detection-settings.repository';

const KEY = 'detection_enabled';

interface SettingRow {
  value: unknown;
  updated_at: Date;
}

/**
 * Ligne absente (aucun admin ne l'a encore réglée) : ACTIVÉE par défaut (D-147, remplace le
 * défaut de D-053). Valeur non booléenne : désactivée.
 */
const DEFAULT_ENABLED = true;

const toSetting = (row: SettingRow | undefined): DetectionSetting =>
  row
    ? { enabled: row.value === true, updatedAt: row.updated_at }
    : { enabled: DEFAULT_ENABLED, updatedAt: null };

export class PostgresDetectionSettingsRepository implements DetectionSettingsRepository {
  constructor(private readonly db: SqlClient) {}

  async getDetectionSetting(): Promise<DetectionSetting> {
    const { rows } = await this.db.query<SettingRow>(
      'SELECT value, updated_at FROM system_settings WHERE key = $1',
      [KEY],
    );
    return toSetting(rows[0]);
  }

  async setDetectionEnabled(command: {
    enabled: boolean;
    actorId: string;
    auditId: string;
    now: Date;
  }): Promise<{ setting: DetectionSetting; changed: boolean }> {
    return this.db.transaction(async (tx) => {
      // La ligne existe avant le verrou : deux premiers réglages simultanés se sérialisent.
      // Elle est créée avec la valeur par défaut, pour que le « from » de l'audit soit juste.
      await tx.query(
        `INSERT INTO system_settings (key, value, updated_at) VALUES ($1, $3::jsonb, $2)
         ON CONFLICT (key) DO NOTHING`,
        [KEY, command.now.toISOString(), JSON.stringify(DEFAULT_ENABLED)],
      );
      const { rows } = await tx.query<SettingRow>(
        'SELECT value, updated_at FROM system_settings WHERE key = $1 FOR UPDATE',
        [KEY],
      );
      const current = toSetting(rows[0]);
      if (current.enabled === command.enabled) return { setting: current, changed: false };

      const updated = await tx.query<SettingRow>(
        `UPDATE system_settings SET value = $2::jsonb, updated_at = $3, updated_by = $4
         WHERE key = $1 RETURNING value, updated_at`,
        [KEY, JSON.stringify(command.enabled), command.now.toISOString(), command.actorId],
      );
      await tx.query(
        `INSERT INTO admin_audit_log (id, actor_id, action, target_type, target_id, details,
           created_at)
         VALUES ($1, $2, $3, 'SYSTEM_SETTING', NULL, $4, $5)`,
        [
          command.auditId,
          command.actorId,
          command.enabled ? 'DETECTION_ENABLED' : 'DETECTION_DISABLED',
          JSON.stringify({ key: KEY, from: current.enabled, to: command.enabled }),
          command.now.toISOString(),
        ],
      );
      return { setting: toSetting(updated.rows[0]), changed: true };
    });
  }
}
