import type { Request, Response } from 'express';

import { getAuth } from '../middleware/require-auth';
import { getRequestId } from '../middleware/request-id';
import type { AuthService } from '../services/auth/auth.service';
import {
  parseChangePasswordInput,
  parseLoginInput,
  parseRefreshTokenInput,
  parseRegisterInput,
} from '../validators/auth.validators';

/**
 * Contrôleurs minces : valider l'entrée, appeler AuthService, mettre en forme.
 * Les erreurs remontent au gestionnaire d'erreurs (statuts dans error-handler.ts).
 */
export function createAuthController(auth: AuthService) {
  return {
    async register(req: Request, res: Response): Promise<void> {
      const user = await auth.register(parseRegisterInput(req.body), meta(res));
      res.status(201).json({ user });
    },

    async login(req: Request, res: Response): Promise<void> {
      res.json(await auth.login(parseLoginInput(req.body), meta(res)));
    },

    async refresh(req: Request, res: Response): Promise<void> {
      res.json(await auth.refresh(parseRefreshTokenInput(req.body), meta(res)));
    },

    async logout(req: Request, res: Response): Promise<void> {
      await auth.logout(parseRefreshTokenInput(req.body), meta(res));
      res.status(204).end();
    },

    /** L'utilisateur est celui du JWT : aucun identifiant n'est lu dans la requête. */
    async me(_req: Request, res: Response): Promise<void> {
      res.json({ user: await auth.getCurrentUser(getAuth(res).userId) });
    },

    /** Compte du JWT uniquement ; 204 sans corps (rien de sensible n'est renvoyé). */
    async changePassword(req: Request, res: Response): Promise<void> {
      const input = parseChangePasswordInput(req.body);
      await auth.changePassword(getAuth(res).userId, input, meta(res));
      res.status(204).end();
    },
  };
}

function meta(res: Response) {
  return { requestId: getRequestId(res) };
}
