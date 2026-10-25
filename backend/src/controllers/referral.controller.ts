import type { Request, Response } from 'express';

import { getAuth } from '../middleware/require-auth';
import type { ReferralService } from '../services/referrals/referral.service';
import { parseUuid } from '../validators/admin.validators';
import {
  parseReferralReview,
  parseReferralRulesChange,
  parseReferralStatusChange,
  parseReferrerListQuery,
} from '../validators/referral.validators';
import type { UserId } from '../domain/users/user';

/**
 * Parrainage (D-161). Le joueur et l'administrateur sont TOUJOURS l'appelant authentifié
 * (JWT) ; aucun identifiant d'acteur, montant ou palier n'est lu dans la requête.
 */
export function createReferralController(referrals: ReferralService) {
  return {
    async me(_req: Request, res: Response): Promise<void> {
      res.json(await referrals.myProgram(getAuth(res).userId));
    },
  };
}

export function createReferralAdminController(referrals: ReferralService) {
  const actor = (res: Response) => getAuth(res).userId;
  return {
    async overview(_req: Request, res: Response): Promise<void> {
      res.json(await referrals.adminOverview());
    },

    async referrers(req: Request, res: Response): Promise<void> {
      // Pagination de l'administration : `{ page, limit, total, items }`.
      const query = parseReferrerListQuery(req.query);
      res.json({ page: query.page, limit: query.limit, ...(await referrals.listReferrers(query)) });
    },

    async referrer(req: Request, res: Response): Promise<void> {
      const id = parseUuid(req.params.userId, 'userId') as UserId;
      res.json(await referrals.referrerDetail(id, actor(res)));
    },

    async reevaluate(req: Request, res: Response): Promise<void> {
      const id = parseUuid(req.params.userId, 'userId') as UserId;
      res.status(202).json(await referrals.requestReevaluation(actor(res), id));
    },

    async campaign(_req: Request, res: Response): Promise<void> {
      res.json(await referrals.campaignSettings());
    },

    async updateRules(req: Request, res: Response): Promise<void> {
      res.json(await referrals.updateRules(actor(res), parseReferralRulesChange(req.body)));
    },

    async setStatus(req: Request, res: Response): Promise<void> {
      res.json(await referrals.setStatus(actor(res), parseReferralStatusChange(req.body)));
    },

    async review(req: Request, res: Response): Promise<void> {
      const id = parseUuid(req.params.attributionId, 'attributionId');
      res.json(await referrals.reviewAttribution(actor(res), id, parseReferralReview(req.body)));
    },
  };
}
