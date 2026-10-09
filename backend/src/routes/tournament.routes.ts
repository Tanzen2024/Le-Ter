import { Router, type RequestHandler } from 'express';

import { createTournamentAdminController } from '../controllers/tournament-admin.controller';
import { createTournamentController } from '../controllers/tournament.controller';
import { parseTournamentId, type TournamentId } from '../domain/tournaments/tournament';
import { createRateLimiter } from '../middleware/rate-limit';
import { createRequireAuth, getAuth } from '../middleware/require-auth';
import { createRequireRole } from '../middleware/require-role';
import type { AuthService } from '../services/auth/auth.service';
import type { TournamentService } from '../services/tournaments/tournament.service';
import type { Logger } from '../utils/logger';
import { ValidationError } from '../validators/validation-error';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Locals {
      /** `:tournamentId` de l'URL, validé (UUID). */
      tournamentId?: TournamentId;
    }
  }
}

/** Inscriptions, propositions et attributions de table : rares, limitées par joueur. */
export const DEFAULT_TOURNAMENT_WRITE_LIMIT = { windowMs: 60_000, max: 30 };

function tournamentParam(router: Router): void {
  router.param('tournamentId', (_req, res, next, value: unknown) => {
    try {
      res.locals.tournamentId = parseTournamentId(value);
      next();
    } catch {
      next(new ValidationError({ tournamentId: 'Identifiant de tournoi invalide.' }));
    }
  });
}

function writesLimiter(limit: typeof DEFAULT_TOURNAMENT_WRITE_LIMIT): RequestHandler {
  return createRateLimiter({
    name: 'tournament-writes',
    ...limit,
    keyOf: (_req, res) => getAuth(res).userId,
  });
}

/**
 * Routes /api/tournaments (D-054), toutes authentifiées :
 *
 *   GET   /active                    tournoi à afficher (ou null) et `serverNow`
 *   GET   /mine                      mes propositions
 *   GET   /next                      mon prochain tournoi inscrit à venir (ou null)
 *   POST  /                          proposer un tournoi (brouillon)
 *   GET   /:tournamentId             détail : inscription, réservation, compte, podium
 *   PATCH /:tournamentId             modifier ma proposition (brouillon / en attente)
 *   POST  /:tournamentId/submit      soumettre à l'approbation
 *   POST  /:tournamentId/withdraw    retirer ma proposition
 *   POST  /:tournamentId/register    inscription + réservation du prix d'entrée
 *   POST  /:tournamentId/unregister  désinscription (réservation libérée)
 *   POST  /:tournamentId/join        table attribuée (tournoi en cours, participant)
 *   GET   /:tournamentId/standings   classement en direct ou final
 *   GET   /:tournamentId/results     résultats officiels + résumé partageable
 */
export function createTournamentRouter(
  tournaments: TournamentService,
  auth: AuthService,
  logger: Logger,
  writeLimit = DEFAULT_TOURNAMENT_WRITE_LIMIT,
): Router {
  const router = Router();
  const controller = createTournamentController(tournaments);
  const writes = writesLimiter(writeLimit);
  router.use(createRequireAuth(auth, logger));
  tournamentParam(router);

  router.get('/', controller.list);
  router.get('/active', controller.active);
  router.get('/mine', controller.mine);
  router.get('/next', controller.next);
  router.post('/', writes, controller.create);
  router.get('/:tournamentId', controller.get);
  router.patch('/:tournamentId', writes, controller.update);
  router.post('/:tournamentId/submit', writes, controller.submit);
  router.post('/:tournamentId/withdraw', writes, controller.withdraw);
  router.post('/:tournamentId/register', writes, controller.register);
  router.post('/:tournamentId/unregister', writes, controller.unregister);
  router.post('/:tournamentId/join', writes, controller.join);
  router.get('/:tournamentId/standings', controller.standings);
  router.get('/:tournamentId/results', controller.results);
  return router;
}

/**
 * Routes /api/admin/tournaments (D-054) : authentification (401), puis rôle `admin` relu dans
 * la session serveur (403). Toute action de gestion est auditée (admin_audit_log).
 *
 *   GET   /settings                    paramètres plateforme
 *   PATCH /settings                    modifier (commission, jetons, mise, limites, transition)
 *   GET   /                            liste (?status=A,B)
 *   POST  /                            créer un tournoi publié
 *   GET   /:tournamentId               détail
 *   PATCH /:tournamentId               modifier avant verrouillage
 *   POST  /:tournamentId/approve       approuver une proposition de joueur
 *   POST  /:tournamentId/reject        refuser une proposition
 *   POST  /:tournamentId/cancel        annuler avant démarrage (réservations libérées)
 *   GET   /:tournamentId/registrations inscriptions et réservations
 *   GET   /:tournamentId/results       résultats
 *   GET   /:tournamentId/results.csv   export du classement
 */
export function createTournamentAdminRouter(
  tournaments: TournamentService,
  auth: AuthService,
  logger: Logger,
): Router {
  const router = Router();
  const controller = createTournamentAdminController(tournaments);
  router.use(createRequireAuth(auth, logger), createRequireRole('admin', logger));
  tournamentParam(router);

  router.get('/settings', controller.getSettings);
  router.patch('/settings', controller.updateSettings);
  router.get('/', controller.list);
  router.post('/', controller.create);
  router.get('/:tournamentId', controller.get);
  router.patch('/:tournamentId', controller.update);
  router.post('/:tournamentId/approve', controller.approve);
  router.post('/:tournamentId/reject', controller.reject);
  router.post('/:tournamentId/cancel', controller.cancel);
  router.get('/:tournamentId/registrations', controller.registrations);
  router.get('/:tournamentId/results', controller.results);
  router.get('/:tournamentId/results.csv', controller.exportResults);
  return router;
}
