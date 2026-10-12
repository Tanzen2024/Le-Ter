import type { Request, Response } from 'express';

import { MobileMoneyUnavailableError } from '../domain/wallet/wallet';
import { getAuth } from '../middleware/require-auth';
import type { WithdrawalAdminService } from '../services/withdrawals/withdrawal-admin.service';
import type { WithdrawalService } from '../services/withdrawals/withdrawal.service';
import {
  parseIdempotencyKey as parseAdminIdempotencyKey,
  parseUuid,
  parseWithdrawalQuery,
} from '../validators/admin.validators';
import { parseIdempotencyKey } from '../validators/game.validators';
import {
  parseEscalation,
  parseRefundDecision,
  parseRefundProposal,
  parseWithdrawalInput,
} from '../validators/withdrawal.validators';

/**
 * Retraits du joueur (D-075), sous /api/wallet : identité issue du JWT uniquement, montant
 * et opérateur validés, Idempotency-Key obligatoire. Sans service : 503 (rien n'est écrit).
 */
export function createPlayerWithdrawalController(withdrawals: WithdrawalService | undefined) {
  const service = () => {
    if (!withdrawals) throw new MobileMoneyUnavailableError();
    return withdrawals;
  };
  return {
    /** 202 tant que le retrait n'est pas final (cas normal) ; 200 s'il l'est déjà. */
    async create(req: Request, res: Response): Promise<void> {
      const key = parseIdempotencyKey(req.get('idempotency-key'));
      const input = parseWithdrawalInput(req.body);
      const result = await service().request(getAuth(res).userId, input, key);
      const final = result.withdrawal.status === 'SUCCEEDED' || result.withdrawal.status === 'FAILED';
      res.status(final ? 200 : 202).json(result);
    },

    async list(_req: Request, res: Response): Promise<void> {
      const userId = getAuth(res).userId;
      const [items, policy] = await Promise.all([
        service().listForUser(userId),
        service().policy(userId),
      ]);
      res.json({ withdrawals: items, policy });
    },

    async get(req: Request, res: Response): Promise<void> {
      res.json({
        withdrawal: await service().getForUser(getAuth(res).userId, String(req.params.id)),
      });
    },
  };
}

/** Notification de transfert CinetPay : publique, jamais crue sur parole (statut relu). */
export function createWithdrawalNotifyController(withdrawals: WithdrawalService) {
  return {
    async notifyCinetPay(req: Request, res: Response): Promise<void> {
      const result = await withdrawals.handleNotification(req.body);
      res.json({ received: true, status: result.status });
    },
  };
}

/** Administration des retraits : l'acteur est TOUJOURS l'administrateur authentifié. */
export function createWithdrawalAdminController(admin: WithdrawalAdminService) {
  const q = (req: Request) => req.query as Record<string, unknown>;
  return {
    async list(req: Request, res: Response): Promise<void> {
      res.json(await admin.list(parseWithdrawalQuery(q(req))));
    },

    async get(req: Request, res: Response): Promise<void> {
      const id = parseUuid(req.params.withdrawalId, 'withdrawalId');
      res.json({ withdrawal: await admin.get(id, getAuth(res).userId) });
    },

    async verify(req: Request, res: Response): Promise<void> {
      const id = parseUuid(req.params.withdrawalId, 'withdrawalId');
      const key = parseAdminIdempotencyKey(req.get('idempotency-key'));
      res.json(await admin.verify(id, key, getAuth(res).userId));
    },

    async escalate(req: Request, res: Response): Promise<void> {
      const id = parseUuid(req.params.withdrawalId, 'withdrawalId');
      res
        .status(201)
        .json(await admin.escalate(id, getAuth(res).userId, parseEscalation(req.body)));
    },

    async proposeRefund(req: Request, res: Response): Promise<void> {
      const id = parseUuid(req.params.withdrawalId, 'withdrawalId');
      const input = parseRefundProposal(req.body);
      const result = await admin.proposeRefund(id, getAuth(res).userId, input);
      res.status(result.outcome === 'proposed' ? 201 : 200).json(result);
    },

    async approveRefund(req: Request, res: Response): Promise<void> {
      const id = parseUuid(req.params.withdrawalId, 'withdrawalId');
      const requestId = parseUuid(req.params.requestId, 'requestId');
      const { note } = parseRefundDecision(req.body, true);
      res.json(
        await admin.decideRefund(id, requestId, getAuth(res).userId, {
          approve: true,
          ...(note && { note }),
        }),
      );
    },

    async rejectRefund(req: Request, res: Response): Promise<void> {
      const id = parseUuid(req.params.withdrawalId, 'withdrawalId');
      const requestId = parseUuid(req.params.requestId, 'requestId');
      const { note } = parseRefundDecision(req.body, false);
      res.json(
        await admin.decideRefund(id, requestId, getAuth(res).userId, {
          approve: false,
          ...(note && { note }),
        }),
      );
    },
  };
}
