import type { Request, Response } from 'express';

import { getAuth } from '../middleware/require-auth';
import type { DetectionSettingsService } from '../services/detection/detection-settings.service';
import { parseDetectionSettingChange } from '../validators/detection-admin.validators';

/**
 * Paramètres système (D-053) : valider, appeler DetectionSettingsService. L'administrateur
 * est TOUJOURS l'appelant authentifié ; aucun identifiant d'acteur n'est lu dans la requête.
 */
export function createAdminSettingsController(settings: DetectionSettingsService) {
  return {
    async getDetection(_req: Request, res: Response): Promise<void> {
      res.json(await settings.getDetectionSetting());
    },

    async setDetection(req: Request, res: Response): Promise<void> {
      const { enabled } = parseDetectionSettingChange(req.body);
      res.json(await settings.setDetectionEnabled(enabled, getAuth(res).userId));
    },
  };
}
