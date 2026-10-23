import type { UserId } from '../domain/users/user';

/** État de l'interrupteur global ; `updatedAt` nul tant qu'aucun admin ne l'a réglé. */
export interface DetectionSetting {
  enabled: boolean;
  updatedAt: Date | null;
}

/**
 * Interrupteur GLOBAL de la détection (D-053), dans `system_settings` (PostgreSQL, source de
 * vérité). Ligne absente : activée par défaut (D-147).
 */
export interface DetectionSettingsRepository {
  getDetectionSetting(): Promise<DetectionSetting>;

  /**
   * Règle l'interrupteur et journalise le changement, dans UNE transaction, sous verrou de
   * la ligne. Valeur déjà égale : rien n'est écrit (`changed: false`), aucun audit.
   */
  setDetectionEnabled(command: {
    enabled: boolean;
    actorId: UserId;
    auditId: string;
    now: Date;
  }): Promise<{ setting: DetectionSetting; changed: boolean }>;
}
