import type { Request, Response } from 'express';

import type { WalletTransaction } from '../domain/wallet/wallet';
import { getAuth } from '../middleware/require-auth';
import type { WalletOperationResult, WalletService } from '../services/wallet/wallet.service';
import { parseIdempotencyKey } from '../validators/game.validators';
import { parseDepositInput, parseTokenAmountInput } from '../validators/wallet.validators';

/**
 * Contrôleurs minces du compte de jeu (D-040) : identité issue du JWT, montant validé,
 * Idempotency-Key obligatoire, appel de WalletService. Aucune donnée de paiement n'est
 * renvoyée (numéro masqué, jamais de référence interne du fournisseur).
 */
export function createWalletController(wallet: WalletService) {
  return {
    async get(_req: Request, res: Response): Promise<void> {
      res.json({ wallet: await wallet.getWallet(getAuth(res).userId) });
    },

    /**
     * Achat : 202, l'opération attend la confirmation du paiement par le fournisseur. Avec
     * CinetPay (D-050), la réponse porte `payment` (identifiant, URL de paiement à ouvrir).
     */
    async deposit(req: Request, res: Response): Promise<void> {
      const key = parseIdempotencyKey(req.get('idempotency-key'));
      const { tokens } = parseDepositInput(req.body);
      const result = await wallet.requestDeposit(getAuth(res).userId, tokens, key);
      res.status(statusOf(result.transaction)).json(toView(result));
    },

    /** Retrait : jetons débités dès l'acceptation, remboursés si le transfert échoue. */
    async withdraw(req: Request, res: Response): Promise<void> {
      const key = parseIdempotencyKey(req.get('idempotency-key'));
      const { tokens } = parseTokenAmountInput(req.body);
      const result = await wallet.requestWithdrawal(getAuth(res).userId, tokens, key);
      res.status(statusOf(result.transaction)).json(toView(result));
    },
  };
}

const statusOf = (t: WalletTransaction) => (t.status === 'pending' ? 202 : 200);

function toView({ transaction, balance, payment }: WalletOperationResult) {
  return {
    transaction: {
      id: transaction.id,
      kind: transaction.kind,
      status: transaction.status,
      tokens: transaction.tokens,
      createdAt: transaction.createdAt,
      ...(transaction.completedAt && { completedAt: transaction.completedAt }),
      ...(transaction.failureCode && { failureCode: transaction.failureCode }),
    },
    balance,
    ...(payment && { payment }),
  };
}
