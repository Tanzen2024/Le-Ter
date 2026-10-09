import type { Request, Response } from 'express';

import { getAuth } from '../middleware/require-auth';
import type { DetectionAdminService } from '../services/detection/detection-admin.service';
import {
  parseAlertId,
  parseAlertListQuery,
  parsePagination,
  parseStatusChange,
  parseSubjectKey,
} from '../validators/detection-admin.validators';

/**
 * Contrôleurs minces de l'administration de la détection (D-049) : valider, appeler
 * DetectionAdminService. L'administrateur est TOUJOURS l'appelant authentifié (JWT +
 * session) ; aucun identifiant d'acteur n'est lu dans la requête.
 */
export function createDetectionAdminController(admin: DetectionAdminService) {
  return {
    async listAlerts(req: Request, res: Response): Promise<void> {
      res.json(await admin.listAlerts(parseAlertListQuery(req.query as Record<string, unknown>)));
    },

    async getAlert(req: Request, res: Response): Promise<void> {
      res.json({ alert: await admin.getAlert(parseAlertId(req.params.alertId)) });
    },

    async getAlertSignals(req: Request, res: Response): Promise<void> {
      res.json(await admin.getAlertSignals(parseAlertId(req.params.alertId)));
    },

    async scoreHistory(req: Request, res: Response): Promise<void> {
      const { page, limit } = parsePagination(req.query as Record<string, unknown>);
      res.json(await admin.scoreHistory(parseSubjectKey(req.params.subjectKey), page, limit));
    },

    async changeStatus(req: Request, res: Response): Promise<void> {
      const alertId = parseAlertId(req.params.alertId);
      const command = parseStatusChange(req.body);
      res.json(await admin.changeStatus(alertId, command, getAuth(res).userId));
    },
  };
}
