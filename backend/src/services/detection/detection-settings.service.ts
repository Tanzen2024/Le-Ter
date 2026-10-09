import { randomUUID } from 'node:crypto';

import type { UserId } from '../../domain/users/user';
import type {
  DetectionSetting,
  DetectionSettingsRepository,
} from '../../repositories/detection-settings.repository';
import type { Logger } from '../../utils/logger';

/**
 * Interrupteur GLOBAL de la détection (D-053), consulté par DetectionService et
 * GeolocationService avant tout autre travail. La détection d'une partie exige l'interrupteur
 * global ET `suspicionDetectionEnabled` de sa table.
 */
export interface DetectionGlobalSwitch {
  isGloballyEnabled(): Promise<boolean>;
}

const view = (setting: DetectionSetting) => ({
  enabled: setting.enabled,
  updatedAt: setting.updatedAt?.toISOString() ?? null,
});

/**
 * Paramètre global de la détection : PostgreSQL est la source de vérité, relu à CHAQUE
 * consultation (aucun cache) ; un redémarrage ou une autre instance voient donc toujours la
 * valeur en base. Réglage réservé au rôle `admin` (contrôlé par la route) et audité.
 * Désactiver n'arrête aucune partie et ne supprime aucune donnée : cela empêche seulement
 * toute nouvelle activité de détection.
 */
export class DetectionSettingsService implements DetectionGlobalSwitch {
  private readonly clock: () => Date;

  constructor(
    private readonly deps: {
      repository: DetectionSettingsRepository;
      logger: Logger;
      clock?: () => Date;
    },
  ) {
    this.clock = deps.clock ?? (() => new Date());
  }

  async isGloballyEnabled(): Promise<boolean> {
    return (await this.deps.repository.getDetectionSetting()).enabled;
  }

  async getDetectionSetting() {
    return view(await this.deps.repository.getDetectionSetting());
  }

  /** Requête répétée vers la valeur déjà en place : `changed: false`, aucun audit. */
  async setDetectionEnabled(enabled: boolean, actorId: UserId) {
    const { setting, changed } = await this.deps.repository.setDetectionEnabled({
      enabled,
      actorId,
      auditId: randomUUID(),
      now: this.clock(),
    });
    if (changed) {
      // Journal technique : identifiant de l'acteur et nouvelle valeur seulement.
      this.deps.logger.info('detection global switch changed', { actorId, enabled });
    }
    return { ...view(setting), changed };
  }
}
