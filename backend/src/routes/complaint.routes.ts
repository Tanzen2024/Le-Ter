import express, { Router, type Request, type Response } from 'express';

import { COMPLAINT_LIMITS } from '../domain/complaints/complaint';
import { complaintErrorHandler } from '../middleware/complaint-errors';
import { createRequireAuth, getAuth } from '../middleware/require-auth';
import { createRequireRole } from '../middleware/require-role';
import {
  createSharedRateLimiter,
  hashKey,
  MemoryRateLimitStore,
  type RateLimitStore,
} from '../middleware/shared-rate-limit';
import type { AuthService } from '../services/auth/auth.service';
import type { ComplaintService } from '../services/complaints/complaint.service';
import type { SupportAssistantService } from '../services/complaints/support-assistant.service';
import type { Logger } from '../utils/logger';
import {
  parseAdminComplaintQuery,
  parseAdminReply,
  parseAssignee,
  parseAssistantMessage,
  parseCreateComplaint,
  parseLanguage,
  parseMessageBody,
  parsePriority,
  parseReason,
  parseRequestInfo,
  parseStatusChange,
} from '../validators/complaint.validators';
import { parseIdempotencyKey } from '../validators/game.validators';
import { ValidationError } from '../validators/validation-error';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ID_OR_REFERENCE =
  /^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|RCL-[0-9]{8}-[0-9A-Za-z]{6})$/i;
const HOUR = 3_600_000;

export interface ComplaintRouterDependencies {
  complaints: ComplaintService;
  assistant: SupportAssistantService;
  /** Compteurs partagés (Redis) si disponibles ; sinon en mémoire. */
  rateLimitStore?: RateLimitStore;
  limits?: { assistantMessagesPerHour: number };
}

function complaintRef(req: Request): string {
  const value = String(req.params.complaintId ?? '');
  if (!ID_OR_REFERENCE.test(value))
    throw new ValidationError({ complaintId: 'Identifiant invalide.' });
  return value;
}

function uuidParam(req: Request, name: string): string {
  const value = String(req.params[name] ?? '');
  if (!UUID.test(value)) throw new ValidationError({ [name]: 'Identifiant invalide.' });
  return value.toLowerCase();
}

function sendAttachment(res: Response, file: { contentType: string; data: Uint8Array }): void {
  res.setHeader('Content-Type', file.contentType);
  // Affichée, jamais exécutée : pas de devinette de type, pas de mise en cache partagée.
  res.setHeader('Content-Disposition', 'inline');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Cache-Control', 'private, no-store');
  res.send(Buffer.from(file.data));
}

function perUser(store: RateLimitStore, name: string, windowMs: number, max: number) {
  return createSharedRateLimiter({
    name,
    windowMs,
    max,
    store,
    keyOf: (req) => hashKey(req.res ? getAuth(req.res).userId : (req.ip ?? 'unknown')),
  });
}

/**
 * Réclamations du joueur (D-114), sous /api/complaints. Authentifiées ; l'auteur est TOUJOURS
 * le titulaire du jeton ; un dossier d'un autre joueur répond 404 (comme un dossier inconnu).
 *
 *   GET  /                                   mes réclamations
 *   POST /                    Idempotency-Key création { category, title, description, links?, incidentAt?, conversationId? }
 *   GET  /:complaintId                       détail (identifiant ou référence RCL-…)
 *   POST /:complaintId/messages Idempotency-Key  réponse au support { body }
 *   POST /:complaintId/attachments           pièce (corps binaire : image/jpeg, png, webp, pdf ; 3 Mo)
 *   GET  /:complaintId/attachments/:attachmentId
 *   POST /:complaintId/reopen                contestation d'une décision { reason }
 *   POST /:complaintId/close                 retrait du dossier ou acceptation de la décision
 */
export function createComplaintRouter(
  deps: ComplaintRouterDependencies,
  auth: AuthService,
  logger: Logger,
): Router {
  const { complaints } = deps;
  const store = deps.rateLimitStore ?? new MemoryRateLimitStore();
  const router = Router();
  router.use(createRequireAuth(auth, logger));

  router.get('/', async (_req, res) => {
    res.json({ complaints: await complaints.listForPlayer(getAuth(res).userId) });
  });

  router.post('/', perUser(store, 'complaint-create', HOUR, 10), async (req, res) => {
    const input = parseCreateComplaint(req.body);
    const key = parseIdempotencyKey(req.get('Idempotency-Key'));
    const { complaint, created } = await complaints.create(getAuth(res).userId, input, key);
    const detail = await complaints.getForPlayer(getAuth(res).userId, complaint.id);
    res.status(created ? 201 : 200).json(detail);
  });

  router.get('/:complaintId', async (req, res) => {
    res.json(await complaints.getForPlayer(getAuth(res).userId, complaintRef(req)));
  });

  router.post(
    '/:complaintId/messages',
    perUser(store, 'complaint-message', HOUR, 30),
    async (req, res) => {
      const body = parseMessageBody(req.body);
      const key = parseIdempotencyKey(req.get('Idempotency-Key'));
      res
        .status(201)
        .json(await complaints.replyAsPlayer(getAuth(res).userId, complaintRef(req), body, key));
    },
  );

  router.post(
    '/:complaintId/attachments',
    perUser(store, 'complaint-attachment', HOUR, 20),
    express.raw({ type: () => true, limit: COMPLAINT_LIMITS.attachmentMaxBytes }),
    async (req, res) => {
      if (!Buffer.isBuffer(req.body)) {
        throw new ValidationError({
          file: 'Corps binaire attendu (image JPEG, PNG, WebP ou PDF).',
        });
      }
      const data = new Uint8Array(req.body.buffer, req.body.byteOffset, req.body.byteLength);
      res.status(201).json({
        attachment: await complaints.addAttachment(getAuth(res).userId, complaintRef(req), data),
      });
    },
  );

  router.get('/:complaintId/attachments/:attachmentId', async (req, res) => {
    sendAttachment(
      res,
      await complaints.attachmentForPlayer(
        getAuth(res).userId,
        complaintRef(req),
        uuidParam(req, 'attachmentId'),
      ),
    );
  });

  router.post('/:complaintId/reopen', async (req, res) => {
    res.json(
      await complaints.reopen(getAuth(res).userId, complaintRef(req), parseReason(req.body)),
    );
  });

  router.post('/:complaintId/close', async (req, res) => {
    res.json(await complaints.closeAsPlayer(getAuth(res).userId, complaintRef(req)));
  });

  router.use(complaintErrorHandler);
  return router;
}

/**
 * Assistant automatisé (D-114), sous /api/support. Jamais d'URL ni de fournisseur interne
 * dans les réponses : seulement le mode (AI ou DEGRADED).
 *
 *   GET  /assistant                          { mode }
 *   GET  /conversations/current              conversation active et messages (ou null)
 *   POST /conversations                      ouvre (ou reprend) la conversation { language }
 *   POST /conversations/reset                nouvelle conversation { language }
 *   POST /conversations/:conversationId/messages Idempotency-Key  { content, language }
 */
export function createSupportRouter(
  deps: ComplaintRouterDependencies,
  auth: AuthService,
  logger: Logger,
): Router {
  const { assistant } = deps;
  const store = deps.rateLimitStore ?? new MemoryRateLimitStore();
  const router = Router();
  router.use(createRequireAuth(auth, logger));

  router.get('/assistant', (_req, res) => {
    res.json(assistant.status());
  });
  router.get('/conversations/current', async (_req, res) => {
    res.json(await assistant.current(getAuth(res).userId));
  });
  router.post('/conversations', async (req, res) => {
    const language = parseLanguage((req.body as { language?: unknown } | undefined)?.language);
    res.status(201).json(await assistant.start(getAuth(res).userId, language));
  });
  router.post('/conversations/reset', async (req, res) => {
    const language = parseLanguage((req.body as { language?: unknown } | undefined)?.language);
    res.status(201).json(await assistant.reset(getAuth(res).userId, language));
  });
  router.post(
    '/conversations/:conversationId/messages',
    // Coût : rafale bornée, puis quota horaire par joueur (le modèle tourne sur nos machines).
    perUser(store, 'assistant-burst', 60_000, 6),
    perUser(store, 'assistant-hour', HOUR, deps.limits?.assistantMessagesPerHour ?? 20),
    async (req, res) => {
      const { content, language } = parseAssistantMessage(req.body);
      const key = parseIdempotencyKey(req.get('Idempotency-Key'));
      res
        .status(201)
        .json(
          await assistant.send(
            getAuth(res).userId,
            uuidParam(req, 'conversationId'),
            content,
            language,
            key,
          ),
        );
    },
  );
  router.use(complaintErrorHandler);
  return router;
}

/**
 * Administration des réclamations (D-114), sous /api/admin/complaints. Garde commune de
 * /api/admin (session d'administration, D-061), plus authentification et rôle `admin` ici.
 * Toute action est auditée ; aucune ne modifie un solde, une partie ou une récompense.
 *
 *   GET  /                                   liste filtrée (status, category, priority, player, assignee, reference, from, to)
 *   GET  /assignees                          administrateurs actifs
 *   GET  /:complaintId                       détail complet (consultation auditée)
 *   GET  /:complaintId/attachments/:attachmentId   (consultation auditée)
 *   POST /:complaintId/messages Idempotency-Key  { body, internal? }
 *   POST /:complaintId/request-info          { message, expectedStatus? }
 *   POST /:complaintId/assign                { assigneeId | null }
 *   POST /:complaintId/priority              { priority }
 *   POST /:complaintId/status                { status, expectedStatus?, decision?, reason? }
 */
export function createComplaintAdminRouter(
  complaints: ComplaintService,
  auth: AuthService,
  logger: Logger,
): Router {
  const router = Router();
  router.use(createRequireAuth(auth, logger), createRequireRole('admin', logger));
  const admin = (res: Response) => getAuth(res).userId;
  const id = (req: Request) => uuidParam(req, 'complaintId');

  router.get('/', async (req, res) => {
    res.json(await complaints.adminList(parseAdminComplaintQuery(req.query)));
  });
  router.get('/assignees', async (_req, res) => {
    res.json({ assignees: await complaints.listAssignees() });
  });
  router.get('/:complaintId', async (req, res) => {
    res.json(await complaints.adminGet(admin(res), id(req)));
  });
  router.get('/:complaintId/attachments/:attachmentId', async (req, res) => {
    sendAttachment(
      res,
      await complaints.adminAttachment(admin(res), id(req), uuidParam(req, 'attachmentId')),
    );
  });
  router.post('/:complaintId/messages', async (req, res) => {
    const input = parseAdminReply(req.body);
    const key = parseIdempotencyKey(req.get('Idempotency-Key'));
    res.status(201).json(await complaints.adminReply(admin(res), id(req), input, key));
  });
  router.post('/:complaintId/request-info', async (req, res) => {
    const { message, expectedStatus } = parseRequestInfo(req.body);
    res.json(await complaints.adminRequestInfo(admin(res), id(req), message, expectedStatus));
  });
  router.post('/:complaintId/assign', async (req, res) => {
    res.json(await complaints.adminAssign(admin(res), id(req), parseAssignee(req.body)));
  });
  router.post('/:complaintId/priority', async (req, res) => {
    res.json(await complaints.adminChangePriority(admin(res), id(req), parsePriority(req.body)));
  });
  router.post('/:complaintId/status', async (req, res) => {
    res.json(await complaints.adminChangeStatus(admin(res), id(req), parseStatusChange(req.body)));
  });
  router.use(complaintErrorHandler);
  return router;
}
