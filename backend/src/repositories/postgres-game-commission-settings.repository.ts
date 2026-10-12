import type { SqlClient } from '../database/sql-client';
import {
  DEFAULT_GAME_COMMISSION_SCHEDULE,
  isValidCommissionSchedule,
  normalizeCommissionSchedule,
  type GameCommissionTier,
} from '../domain/rules/game-settlement';
import type { UserId } from '../domain/users/user';
import { GAME_COMMISSION_SETTING_KEY } from './game-stake-ledger';

/** Barème enregistré ; `updatedAt` nul tant qu'aucun administrateur ne l'a réglé (valeur initiale). */
export interface GameCommissionSetting {
  tiers: GameCommissionTier[];
  updatedAt: Date | null;
}

interface SettingRow {
  value: unknown;
  updated_at: Date;
}

/** Ligne absente ou valeur invalide : barème initial, jamais une valeur inventée. */
const toSetting = (row: SettingRow | undefined): GameCommissionSetting =>
  row && isValidCommissionSchedule(row.value)
    ? { tiers: normalizeCommissionSchedule(row.value), updatedAt: row.updated_at }
    : { tiers: normalizeCommissionSchedule(DEFAULT_GAME_COMMISSION_SCHEDULE), updatedAt: null };

/**
 * Barème de commission des parties (D-074) dans `system_settings` (PostgreSQL, source de
 * vérité, relue à chaque démarrage de partie). Le réglage et son audit sont écrits dans UNE
 * transaction, sous verrou de la ligne ; un barème identique n'écrit rien.
 */
export class PostgresGameCommissionSettingsRepository {
  constructor(private readonly db: SqlClient) {}

  async get(): Promise<GameCommissionSetting> {
    const { rows } = await this.db.query<SettingRow>(
      'SELECT value, updated_at FROM system_settings WHERE key = $1',
      [GAME_COMMISSION_SETTING_KEY],
    );
    return toSetting(rows[0]);
  }

  async set(command: {
    tiers: readonly GameCommissionTier[];
    actorId: UserId;
    auditId: string;
    now: Date;
  }): Promise<{
    setting: GameCommissionSetting;
    changed: boolean;
    previous: GameCommissionTier[];
  }> {
    return this.db.transaction(async (tx) => {
      // La ligne existe avant le verrou : deux premiers réglages simultanés se sérialisent.
      await tx.query(
        `INSERT INTO system_settings (key, value, updated_at) VALUES ($1, $2::jsonb, $3)
         ON CONFLICT (key) DO NOTHING`,
        [
          GAME_COMMISSION_SETTING_KEY,
          JSON.stringify(DEFAULT_GAME_COMMISSION_SCHEDULE),
          command.now.toISOString(),
        ],
      );
      const { rows } = await tx.query<SettingRow>(
        'SELECT value, updated_at FROM system_settings WHERE key = $1 FOR UPDATE',
        [GAME_COMMISSION_SETTING_KEY],
      );
      const current = toSetting(rows[0]);
      // Comparaison normalisée (points de base) : 5 et 5.00 sont la même valeur.
      const tiers = normalizeCommissionSchedule(command.tiers);
      if (JSON.stringify(current.tiers) === JSON.stringify(tiers)) {
        return { setting: current, changed: false, previous: current.tiers };
      }
      const updated = await tx.query<SettingRow>(
        `UPDATE system_settings SET value = $2::jsonb, updated_at = $3, updated_by = $4
         WHERE key = $1 RETURNING value, updated_at`,
        [GAME_COMMISSION_SETTING_KEY, JSON.stringify(tiers), command.now.toISOString(), command.actorId],
      );
      await tx.query(
        `INSERT INTO admin_audit_log (id, actor_id, action, target_type, target_id, details,
           created_at)
         VALUES ($1, $2, 'GAME_COMMISSION_UPDATED', 'SYSTEM_SETTING', NULL, $3, $4)`,
        [
          command.auditId,
          command.actorId,
          JSON.stringify({ key: GAME_COMMISSION_SETTING_KEY, from: current.tiers, to: tiers }),
          command.now.toISOString(),
        ],
      );
      return { setting: toSetting(updated.rows[0]), changed: true, previous: current.tiers };
    });
  }
}
