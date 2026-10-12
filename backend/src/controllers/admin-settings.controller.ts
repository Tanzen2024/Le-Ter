import type { Request, Response } from 'express';

import { getAuth } from '../middleware/require-auth';
import type { DetectionSettingsService } from '../services/detection/detection-settings.service';
import type { GameCommissionSettingsService } from '../services/game/game-commission-settings.service';
import type { WithdrawalService } from '../services/withdrawals/withdrawal.service';
import {
  parseDetectionSettingChange,
  parseGameCommissionChange,
} from '../validators/detection-admin.validators';
import { parseWithdrawalLimitChange } from '../validators/withdrawal.validators';
import {
  WITHDRAWAL_LIMIT_MAX_COUNT,
  WITHDRAWAL_LIMIT_MAX_PERIOD_MINUTES,
} from '../domain/wallet/withdrawal';

/**
 * Paramètres système (D-053, D-074) : valider, appeler le service. L'administrateur est
 * TOUJOURS l'appelant authentifié ; aucun identifiant d'acteur n'est lu dans la requête.
 */
export function createAdminSettingsController(services: {
  detection?: DetectionSettingsService;
  gameCommission?: GameCommissionSettingsService;
  withdrawals?: WithdrawalService;
}) {
  const { detection, gameCommission, withdrawals } = services;
  /** Quota de retraits (D-075) : `null` = illimité (∞), jamais `Infinity`. */
  const limitView = (setting: {
    count: number | null;
    periodMinutes: number | null;
    updatedAt: Date | null;
  }) => ({
    count: setting.count,
    periodMinutes: setting.periodMinutes,
    updatedAt: setting.updatedAt?.toISOString() ?? null,
    bounds: { maxCount: WITHDRAWAL_LIMIT_MAX_COUNT, maxPeriodMinutes: WITHDRAWAL_LIMIT_MAX_PERIOD_MINUTES },
    /** Statuts comptés : tout retrait enregistré non échoué (en attente compris). */
    countedStatuses: ['CREATED', 'PROCESSING', 'SUCCEEDED'],
  });
  return {
    async getDetection(_req: Request, res: Response): Promise<void> {
      if (!detection) return unavailable(res);
      res.json(await detection.getDetectionSetting());
    },

    async setDetection(req: Request, res: Response): Promise<void> {
      if (!detection) return unavailable(res);
      const { enabled } = parseDetectionSettingChange(req.body);
      res.json(await detection.setDetectionEnabled(enabled, getAuth(res).userId));
    },

    async getGameCommission(_req: Request, res: Response): Promise<void> {
      if (!gameCommission) return unavailable(res);
      res.json(await gameCommission.get());
    },

    async setGameCommission(req: Request, res: Response): Promise<void> {
      if (!gameCommission) return unavailable(res);
      const { tiers } = parseGameCommissionChange(req.body);
      res.json(await gameCommission.set(tiers, getAuth(res).userId));
    },

    async getWithdrawalLimit(_req: Request, res: Response): Promise<void> {
      if (!withdrawals) return unavailable(res);
      res.json(limitView(await withdrawals.getLimit()));
    },

    async setWithdrawalLimit(req: Request, res: Response): Promise<void> {
      if (!withdrawals) return unavailable(res);
      const limit = parseWithdrawalLimitChange(req.body);
      const result = await withdrawals.setLimit(limit, getAuth(res).userId);
      res.json({ ...limitView({ ...result.limit, updatedAt: result.updatedAt }), changed: result.changed });
    },
  };
}

function unavailable(res: Response): void {
  res.status(503).json({
    code: 'ADMIN_UNAVAILABLE',
    message: "L'administration n'est pas disponible : base ou authentification non configurée.",
  });
}
