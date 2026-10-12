import { Router } from 'express';

import { createWalletController } from '../controllers/wallet.controller';
import { createPlayerWithdrawalController } from '../controllers/withdrawal.controller';
import { createRateLimiter } from '../middleware/rate-limit';
import { createRequireAuth, getAuth } from '../middleware/require-auth';
import type { AuthService } from '../services/auth/auth.service';
import type { WalletService } from '../services/wallet/wallet.service';
import type { WithdrawalService } from '../services/withdrawals/withdrawal.service';
import type { Logger } from '../utils/logger';

/** Opérations financières : peu fréquentes par nature, limitées par joueur. */
export const DEFAULT_WALLET_WRITE_LIMIT = { windowMs: 60_000, max: 10 };

/**
 * Routes /api/wallet (D-040), toutes authentifiées :
 *
 *   GET  /              solde du compte de jeu, numéro Mobile Money masqué, disponibilité
 *   POST /deposits      acheter des jetons ({ tokens }, Idempotency-Key)
 *   POST /withdrawals       retirer vers Mobile Money ({ tokens, operator }, Idempotency-Key, D-075)
 *   GET  /withdrawals       historique des retraits et règles applicables (minimum, quota…)
 *   GET  /withdrawals/:id   statut d'un retrait du joueur (relu chez le fournisseur si ouvert)
 */
export function createWalletRouter(
  wallet: WalletService,
  auth: AuthService,
  logger: Logger,
  writeLimit = DEFAULT_WALLET_WRITE_LIMIT,
  withdrawals?: WithdrawalService,
): Router {
  const router = Router();
  const controller = createWalletController(wallet);
  const withdrawalController = createPlayerWithdrawalController(withdrawals);
  const writes = createRateLimiter({
    name: 'wallet-writes',
    ...writeLimit,
    keyOf: (_req, res) => getAuth(res).userId,
  });
  router.use(createRequireAuth(auth, logger));
  router.get('/', controller.get);
  router.post('/deposits', writes, controller.deposit);
  router.post('/withdrawals', writes, withdrawalController.create);
  router.get('/withdrawals', withdrawalController.list);
  router.get('/withdrawals/:id', withdrawalController.get);
  return router;
}
