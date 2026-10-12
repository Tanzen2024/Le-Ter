import type { Request, Response } from 'express';

import type { UserId } from '../domain/users/user';
import { getAuth } from '../middleware/require-auth';
import type { AdminQueryService } from '../services/admin/admin-query.service';
import type { PlayerModerationService } from '../services/admin/player-moderation.service';
import { parseIdempotencyKey, parsePage, parseUuid } from '../validators/admin.validators';
import {
  parseNoteInput,
  parseReasonBody,
  parseRestrictionInput,
  parseWarningInput,
} from '../validators/moderation.validators';
import { ValidationError } from '../validators/validation-error';

type Query = Record<string, unknown>;

/**
 * Gestion des comptes et modération des joueurs (D-079). L'administrateur responsable est
 * TOUJOURS l'appelant authentifié (JWT + session admin) ; le joueur ciblé est l'UUID de
 * l'URL ; aucun identifiant d'auteur, rôle ou `gameId` n'est lu dans le corps.
 */
export function createPlayerModerationController(deps: {
  moderation: PlayerModerationService;
  queries: AdminQueryService;
}) {
  const { moderation, queries } = deps;
  const actor = (res: Response) => getAuth(res).userId;
  const target = (req: Request) => parseUuid(req.params.userId, 'userId') as UserId;

  return {
    async overview(req: Request, res: Response): Promise<void> {
      res.json(await moderation.overview(target(req), actor(res)));
    },

    async sanctions(req: Request, res: Response): Promise<void> {
      res.json(await moderation.sanctions(target(req), parsePage(req.query as Query)));
    },

    async notes(req: Request, res: Response): Promise<void> {
      res.json(await moderation.notes(target(req), parsePage(req.query as Query)));
    },

    /** Journal de modération : `admin_audit_log` de ce joueur (source unique, aucun doublon). */
    async log(req: Request, res: Response): Promise<void> {
      const { includeViews, ...rest } = req.query as Query;
      if (includeViews !== undefined && includeViews !== 'true' && includeViews !== 'false') {
        throw new ValidationError({ includeViews: 'Valeur non autorisée.' });
      }
      const userId = target(req);
      await moderation.requireUser(userId);
      res.json(
        await queries.auditLog({
          ...parsePage(rest),
          targetType: 'USER',
          targetId: userId,
          ...(includeViews !== 'true' && { excludeActions: ['USER_VIEWED'] }),
        }),
      );
    },

    async disable(req: Request, res: Response): Promise<void> {
      const { reason } = parseReasonBody(req.body);
      res.json(await moderation.setAccountEnabled(target(req), false, reason!, actor(res)));
    },

    async enable(req: Request, res: Response): Promise<void> {
      const { reason } = parseReasonBody(req.body);
      res.json(await moderation.setAccountEnabled(target(req), true, reason!, actor(res)));
    },

    async suspend(req: Request, res: Response): Promise<void> {
      const input = parseRestrictionInput(req.body);
      res.status(201).json(await moderation.suspend(target(req), input, actor(res)));
    },

    async liftSuspension(req: Request, res: Response): Promise<void> {
      const { reason } = parseReasonBody(req.body);
      res.json(await moderation.liftSuspension(target(req), reason!, actor(res)));
    },

    async revokeSessions(req: Request, res: Response): Promise<void> {
      const { reason } = parseReasonBody(req.body, false);
      res.json(await moderation.revokeSessions(target(req), reason, actor(res)));
    },

    async restrictChat(req: Request, res: Response): Promise<void> {
      const input = parseRestrictionInput(req.body);
      res.status(201).json(await moderation.restrictChat(target(req), input, actor(res)));
    },

    async liftChatRestriction(req: Request, res: Response): Promise<void> {
      const { reason } = parseReasonBody(req.body);
      res.json(await moderation.liftChatRestriction(target(req), reason!, actor(res)));
    },

    async warn(req: Request, res: Response): Promise<void> {
      const userId = target(req);
      const key = parseIdempotencyKey(req.get('idempotency-key'));
      const input = parseWarningInput(req.body);
      const result = await moderation.warn(userId, input, key, actor(res));
      res.status(result.replayed ? 200 : 201).json(result);
    },

    async addNote(req: Request, res: Response): Promise<void> {
      const userId = target(req);
      const key = parseIdempotencyKey(req.get('idempotency-key'));
      const { body } = parseNoteInput(req.body);
      const result = await moderation.addNote(userId, body, key, actor(res));
      res.status(result.replayed ? 200 : 201).json(result);
    },

    async deleteNote(req: Request, res: Response): Promise<void> {
      const userId = target(req);
      const noteId = parseUuid(req.params.noteId, 'noteId');
      const { reason } = parseReasonBody(req.body);
      res.json(await moderation.deleteNote(userId, noteId, reason!, actor(res)));
    },
  };
}
