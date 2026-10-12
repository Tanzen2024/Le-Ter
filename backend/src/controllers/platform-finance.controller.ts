import type { Request, Response } from 'express';

import { getAuth } from '../middleware/require-auth';
import type { PlatformPayoutService } from '../services/platform-finance/platform-payout.service';
import type { TreasuryReconciliationService } from '../services/platform-finance/treasury-reconciliation.service';
import { parseIdempotencyKey, parseUuid } from '../validators/admin.validators';
import {
  parseBeneficiaryInput,
  parseDecisionNote,
  parsePayoutInput,
  parsePlatformPayoutQuery,
  parseVerificationNote,
} from '../validators/platform-finance.validators';

/**
 * Finances de la plateforme (D-078), sous /api/admin/platform-finance. L'acteur est TOUJOURS
 * l'administrateur authentifié ; aucun statut, montant réservé, frais ou approbateur n'est lu
 * dans la requête.
 */
export function createPlatformFinanceController(deps: {
  payouts: PlatformPayoutService;
  treasury: TreasuryReconciliationService;
}) {
  const { payouts, treasury } = deps;
  const actor = (res: Response) => getAuth(res).userId;
  const id = (req: Request) => parseUuid(req.params.payoutId, 'payoutId');
  const beneficiaryId = (req: Request) => parseUuid(req.params.beneficiaryId, 'beneficiaryId');
  return {
    async overview(_req: Request, res: Response) {
      res.json(await payouts.overview());
    },
    async treasuryHistory(_req: Request, res: Response) {
      res.json({ observations: await treasury.history(20) });
    },
    async observeTreasury(_req: Request, res: Response) {
      res.status(201).json({ observation: await payouts.observeTreasury(actor(res)) });
    },
    async reconcile(_req: Request, res: Response) {
      res.json(await payouts.reconcile(actor(res)));
    },
    async listBeneficiaries(_req: Request, res: Response) {
      res.json({ beneficiaries: await payouts.listBeneficiaries() });
    },
    async createBeneficiary(req: Request, res: Response) {
      res
        .status(201)
        .json(await payouts.createBeneficiary(actor(res), parseBeneficiaryInput(req.body)));
    },
    async verifyBeneficiary(req: Request, res: Response) {
      const { note } = parseVerificationNote(req.body);
      res.json(await payouts.verifyBeneficiary(actor(res), beneficiaryId(req), note));
    },
    async disableBeneficiary(req: Request, res: Response) {
      res.json(await payouts.disableBeneficiary(actor(res), beneficiaryId(req)));
    },
    async list(req: Request, res: Response) {
      res.json(await payouts.list(parsePlatformPayoutQuery(req.query as Record<string, unknown>)));
    },
    async get(req: Request, res: Response) {
      res.json({ payout: await payouts.get(id(req), actor(res)) });
    },
    async create(req: Request, res: Response) {
      const key = parseIdempotencyKey(req.get('idempotency-key'));
      const result = await payouts.create(actor(res), parsePayoutInput(req.body), key);
      res.status(result.replayed ? 200 : 201).json(result);
    },
    async approve(req: Request, res: Response) {
      const { note } = parseDecisionNote(req.body, false);
      res.json(await payouts.approve(actor(res), id(req), note));
    },
    async reject(req: Request, res: Response) {
      const { note } = parseDecisionNote(req.body, true);
      res.json(await payouts.reject(actor(res), id(req), note!));
    },
    async cancel(req: Request, res: Response) {
      const { note } = parseDecisionNote(req.body, true);
      res.json(await payouts.cancel(actor(res), id(req), note!));
    },
    async release(req: Request, res: Response) {
      res.json(await payouts.release(actor(res), id(req)));
    },
    async check(req: Request, res: Response) {
      res.json(await payouts.check(id(req)));
    },
  };
}

/** Notification CinetPay d'un transfert de la plateforme : jamais crue sur parole (statut relu). */
export function createPlatformPayoutNotifyController(payouts: PlatformPayoutService) {
  return {
    async notifyCinetPay(req: Request, res: Response) {
      const result = await payouts.handleNotification(req.body);
      res.json({ received: true, status: result.status });
    },
  };
}
