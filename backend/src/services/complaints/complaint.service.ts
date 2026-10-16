import { createHash, randomUUID } from 'node:crypto';

import { isPgError, PG_UNIQUE_VIOLATION } from '../../database/sql-client';
import type { AuditAction } from '../../domain/admin/admin';
import {
  AttachmentRejectedError,
  canTransition,
  COMPLAINT_LIMITS,
  ComplaintConflictError,
  ComplaintLimitError,
  ComplaintLinkError,
  ComplaintNotFoundError,
  initialPriority,
  InvalidComplaintTransitionError,
  newComplaintReference,
  NotAnAdministratorError,
  PLAYER_WRITABLE,
  sniffAttachmentType,
  type Complaint,
  type ComplaintActor,
  type ComplaintCategory,
  type ComplaintCheck,
  type ComplaintEvent,
  type ComplaintEventType,
  type ComplaintLinks,
  type ComplaintMessage,
  type ComplaintPriority,
  type ComplaintStatus,
} from '../../domain/complaints/complaint';
import type { UserId } from '../../domain/users/user';
import type { ComplaintEvidenceRepository } from '../../repositories/complaint-evidence.repository';
import type {
  AdminComplaintFilters,
  ComplaintPatch,
  ComplaintRepository,
  ComplaintTx,
  SupportConversationRepository,
} from '../../repositories/complaint.repository';
import type { Logger } from '../../utils/logger';

export interface CreateComplaintInput {
  category: ComplaintCategory;
  title: string;
  description: string;
  links: ComplaintLinks;
  incidentAt?: Date;
  /** Conversation avec l'assistant dont la réclamation est issue (brouillon, vérifications). */
  conversationId?: string;
}

/** Signal « une notification t'attend » (temps réel, facultatif, jamais le contenu). */
export interface ComplaintSignalPublisher {
  publish(event: { type: 'notification'; userId: UserId; notificationType: string }): void;
}

export interface ComplaintAnalysisScheduler {
  schedule(complaintId: string): void;
}

export interface ComplaintServiceDependencies {
  repository: ComplaintRepository;
  evidence: ComplaintEvidenceRepository;
  conversations?: SupportConversationRepository;
  signals?: ComplaintSignalPublisher;
  logger: Logger;
  clock?: () => Date;
}

/** Notification visible du joueur : nature de l'événement seulement, jamais un montant. */
type NotifiedEvent =
  'CREATED' | 'INFO_REQUESTED' | 'REPLY' | 'STATUS_CHANGED' | 'DECISION' | 'CLOSED';

/** Étape suivante affichée au joueur, selon le statut. */
export function nextStepOf(status: ComplaintStatus): string {
  switch (status) {
    case 'OPEN':
    case 'AI_ANALYSIS':
      return 'ANALYSIS';
    case 'IN_REVIEW':
      return 'SUPPORT_REVIEW';
    case 'WAITING_FOR_PLAYER':
      return 'PLAYER_REPLY_EXPECTED';
    case 'RESOLVED':
    case 'REJECTED':
      return 'DECISION_RENDERED';
    case 'CLOSED':
      return 'NONE';
  }
}

const iso = (value: Date | null) => (value ? value.toISOString() : null);

/**
 * Bail d'une analyse automatique : supérieur au pire cas d'un appel au modèle (délai maximal
 * `AI_TIMEOUT_MS` ≤ 180 s). Au-delà, l'instance est réputée arrêtée et le dossier est repris.
 */
export const ANALYSIS_LEASE_MS = 5 * 60_000;

/** Vue d'un dossier pour le joueur : ni note interne, ni administrateur nommé. */
export function playerComplaintView(c: Complaint) {
  return {
    id: c.id,
    reference: c.reference,
    category: c.category,
    title: c.title,
    description: c.description,
    status: c.status,
    priority: c.priority,
    links: c.links,
    incidentAt: iso(c.incidentAt),
    decision: c.decision,
    decidedAt: iso(c.decidedAt),
    reopenCount: c.reopenCount,
    canReopen:
      (c.status === 'RESOLVED' || c.status === 'REJECTED') &&
      c.reopenCount < COMPLAINT_LIMITS.maxReopens,
    canReply: PLAYER_WRITABLE.has(c.status),
    nextStep: nextStepOf(c.status),
    createdAt: c.createdAt.toISOString(),
    updatedAt: c.updatedAt.toISOString(),
    closedAt: iso(c.closedAt),
  };
}

export function messageView(m: ComplaintMessage) {
  return {
    id: m.id,
    authorType: m.authorType,
    body: m.body,
    visibility: m.visibility,
    createdAt: m.createdAt.toISOString(),
  };
}

/** Événements montrés au joueur (l'assignation interne et les notes restent côté support). */
const PLAYER_EVENTS: ReadonlySet<ComplaintEventType> = new Set([
  'CREATED',
  'STATUS_CHANGED',
  'INFO_REQUESTED',
  'ATTACHMENT_ADDED',
  'DECISION_RECORDED',
  'REOPENED',
]);

export function eventView(e: ComplaintEvent, forAdmin: boolean) {
  return {
    id: e.id,
    type: e.type,
    actorType: e.actorType,
    ...(forAdmin && { actorId: e.actorId }),
    fromStatus: e.fromStatus,
    toStatus: e.toStatus,
    ...(forAdmin && { details: e.details }),
    createdAt: e.createdAt.toISOString(),
  };
}

/**
 * Réclamations (D-114). Unique point d'écriture des dossiers : chaque commande verrouille le
 * dossier, applique les transitions autorisées (`COMPLAINT_TRANSITIONS`), puis écrit dans LA
 * MÊME transaction l'événement d'historique, la notification du joueur (dédupliquée) et, pour
 * une action administrative, la ligne du journal d'audit.
 *
 * Aucune commande ne crédite, débite, ne modifie une partie, un classement ou une récompense :
 * une correction passe par le service métier concerné, et la décision du dossier le consigne.
 */
export class ComplaintService {
  private readonly clock: () => Date;
  private scheduler?: ComplaintAnalysisScheduler;

  constructor(private readonly deps: ComplaintServiceDependencies) {
    this.clock = deps.clock ?? (() => new Date());
  }

  /** Branché après construction (l'analyseur dépend du service). */
  setAnalysisScheduler(scheduler: ComplaintAnalysisScheduler): void {
    this.scheduler = scheduler;
  }

  // --- Joueur ---------------------------------------------------------------------------------

  async create(
    userId: UserId,
    input: CreateComplaintInput,
    idempotencyKey: string,
  ): Promise<{ complaint: Complaint; created: boolean }> {
    await this.checkLinks(userId, input.links);
    let suggestedCategory: ComplaintCategory | null = null;
    let assistantChecks: {
      tool: string;
      outcome: ComplaintCheck['outcome'];
      facts: Record<string, unknown>;
    }[] = [];
    if (input.conversationId) {
      const conversation = await this.deps.conversations?.findConversation(
        userId,
        input.conversationId,
      );
      if (!conversation) throw new ComplaintLinkError('conversationId');
      const analysis = conversation.lastAnalysis as {
        category?: ComplaintCategory;
        checks?: typeof assistantChecks;
      };
      suggestedCategory = analysis.category ?? null;
      assistantChecks = Array.isArray(analysis.checks) ? analysis.checks.slice(0, 5) : [];
    }

    for (let attempt = 0; ; attempt += 1) {
      try {
        const result = await this.run(async (tx, notified) => {
          await tx.lockUser(userId);
          const existing = await tx.findByIdempotencyKey(userId, idempotencyKey);
          if (existing) return { complaint: existing, created: false };
          if ((await tx.countActive(userId)) >= COMPLAINT_LIMITS.maxActivePerPlayer) {
            throw new ComplaintLimitError('ACTIVE_COMPLAINTS');
          }
          const now = this.clock();
          const complaint: Complaint = {
            id: randomUUID(),
            reference: newComplaintReference(now),
            userId,
            category: input.category,
            suggestedCategory,
            title: input.title,
            description: input.description,
            status: 'OPEN',
            priority: initialPriority(input.category),
            links: input.links,
            conversationId: input.conversationId ?? null,
            incidentAt: input.incidentAt ?? null,
            assignedAdminId: null,
            aiSummary: null,
            aiAnalysisStatus: 'PENDING',
            decision: null,
            decidedBy: null,
            decidedAt: null,
            reopenCount: 0,
            version: 1,
            createdAt: now,
            updatedAt: now,
            closedAt: null,
          };
          await tx.insertComplaint({ ...complaint, idempotencyKey });
          const event = await this.event(tx, complaint, 'CREATED', 'PLAYER', userId, null, 'OPEN', {
            category: complaint.category,
            ...(suggestedCategory && { suggestedCategory }),
            fromConversation: complaint.conversationId !== null,
          });
          for (const check of assistantChecks) {
            await tx.insertCheck({
              id: randomUUID(),
              complaintId: complaint.id,
              tool: String(check.tool).slice(0, 64),
              outcome:
                check.outcome === 'FOUND' || check.outcome === 'NOT_FOUND'
                  ? check.outcome
                  : 'ERROR',
              facts: check.facts ?? {},
              source: 'ASSISTANT',
              createdAt: now,
            });
          }
          await this.notify(tx, notified, complaint, 'CREATED', event.id, 'OPEN');
          return { complaint, created: true };
        });
        if (result.created) {
          this.scheduler?.schedule(result.complaint.id);
          this.deps.logger.info('complaint created', {
            complaintId: result.complaint.id,
            category: result.complaint.category,
          });
        }
        return result;
      } catch (err) {
        // Collision de référence (1 chance sur 10⁹ par jour) ou course sur la clé d'idempotence :
        // la transaction est rejouée ; la clé retrouve alors le dossier déjà créé.
        if (isPgError(err, PG_UNIQUE_VIOLATION) && attempt < 2) continue;
        throw err;
      }
    }
  }

  private async checkLinks(userId: UserId, links: ComplaintLinks): Promise<void> {
    const e = this.deps.evidence;
    const checks: [keyof ComplaintLinks, () => Promise<boolean>][] = [];
    if (links.gameId) checks.push(['gameId', () => e.playedGame(userId, links.gameId!)]);
    if (links.tournamentId)
      checks.push(['tournamentId', () => e.joinedTournament(userId, links.tournamentId!)]);
    if (links.walletTransactionId) {
      checks.push([
        'walletTransactionId',
        () => e.ownsWalletTransaction(userId, links.walletTransactionId!),
      ]);
    }
    if (links.paymentId) checks.push(['paymentId', () => e.ownsPayment(userId, links.paymentId!)]);
    if (links.withdrawalId)
      checks.push(['withdrawalId', () => e.ownsWithdrawal(userId, links.withdrawalId!)]);
    for (const [field, owns] of checks) {
      if (!(await owns())) throw new ComplaintLinkError(field);
    }
  }

  async listForPlayer(userId: UserId) {
    const complaints = await this.deps.repository.listForUser(userId, 50);
    return complaints.map(playerComplaintView);
  }

  private async ownComplaint(userId: UserId, idOrReference: string): Promise<Complaint> {
    const complaint = await this.deps.repository.findForUser(userId, idOrReference);
    if (!complaint) throw new ComplaintNotFoundError();
    return complaint;
  }

  async getForPlayer(userId: UserId, idOrReference: string) {
    const complaint = await this.ownComplaint(userId, idOrReference);
    const r = this.deps.repository;
    const [messages, events, attachments, checks] = await Promise.all([
      r.messages(complaint.id, false),
      r.events(complaint.id),
      r.attachments(complaint.id),
      r.checks(complaint.id),
    ]);
    return {
      complaint: playerComplaintView(complaint),
      messages: messages.map(messageView),
      events: events.filter((e) => PLAYER_EVENTS.has(e.type)).map((e) => eventView(e, false)),
      attachments: attachments.map((a) => ({
        id: a.id,
        contentType: a.contentType,
        sizeBytes: a.sizeBytes,
        uploaderType: a.uploaderType,
        createdAt: a.createdAt.toISOString(),
      })),
      checks: checks.map((c) => ({
        tool: c.tool,
        outcome: c.outcome,
        createdAt: c.createdAt.toISOString(),
      })),
    };
  }

  /** Réponse du joueur ; une réponse attendue (WAITING_FOR_PLAYER) relance l'examen. */
  async replyAsPlayer(userId: UserId, idOrReference: string, body: string, idempotencyKey: string) {
    const owned = await this.ownComplaint(userId, idOrReference);
    return this.run(async (tx) => {
      const complaint = await this.lock(tx, owned.id);
      const replay = await tx.findMessageByKey(complaint.id, userId, idempotencyKey);
      if (replay) return { message: messageView(replay), status: complaint.status };
      if (!PLAYER_WRITABLE.has(complaint.status)) {
        throw new InvalidComplaintTransitionError(complaint.status, complaint.status);
      }
      const now = this.clock();
      const message: ComplaintMessage = {
        id: randomUUID(),
        complaintId: complaint.id,
        authorType: 'PLAYER',
        authorId: userId,
        body,
        visibility: 'PUBLIC',
        createdAt: now,
      };
      await tx.insertMessage({ ...message, idempotencyKey });
      await this.event(tx, complaint, 'MESSAGE_ADDED', 'PLAYER', userId, null, null, {
        messageId: message.id,
      });
      let status = complaint.status;
      if (complaint.status === 'WAITING_FOR_PLAYER') {
        status = (await this.transition(tx, complaint, 'IN_REVIEW', 'PLAYER', userId, {})).status;
      } else {
        await tx.updateComplaint(complaint.id, {}, now);
      }
      return { message: messageView(message), status };
    });
  }

  async addAttachment(
    userId: UserId,
    idOrReference: string,
    data: Uint8Array,
  ): Promise<{ id: string; contentType: string; sizeBytes: number; created: boolean }> {
    const owned = await this.ownComplaint(userId, idOrReference);
    if (data.length === 0) throw new AttachmentRejectedError('EMPTY');
    if (data.length > COMPLAINT_LIMITS.attachmentMaxBytes)
      throw new AttachmentRejectedError('SIZE');
    // Type reconnu sur le CONTENU : un fichier renommé ou un en-tête mensonger est refusé.
    const contentType = sniffAttachmentType(data);
    if (!contentType) throw new AttachmentRejectedError('TYPE');
    const sha256 = createHash('sha256').update(data).digest('hex');
    return this.run(async (tx) => {
      const complaint = await this.lock(tx, owned.id);
      if (complaint.status === 'CLOSED') {
        throw new InvalidComplaintTransitionError(complaint.status, complaint.status);
      }
      if ((await tx.countAttachments(complaint.id)) >= COMPLAINT_LIMITS.attachmentsPerComplaint) {
        throw new ComplaintLimitError('ATTACHMENTS');
      }
      const now = this.clock();
      const id = randomUUID();
      const inserted = await tx.insertAttachment({
        id,
        complaintId: complaint.id,
        uploaderType: 'PLAYER',
        uploaderId: userId,
        contentType,
        sizeBytes: data.length,
        sha256,
        data,
        createdAt: now,
      });
      if (!inserted) throw new AttachmentRejectedError('DUPLICATE');
      await this.event(tx, complaint, 'ATTACHMENT_ADDED', 'PLAYER', userId, null, null, {
        attachmentId: id,
        contentType,
        sizeBytes: data.length,
      });
      await tx.updateComplaint(complaint.id, {}, now);
      return { id, contentType, sizeBytes: data.length, created: true };
    });
  }

  async attachmentForPlayer(userId: UserId, idOrReference: string, attachmentId: string) {
    const complaint = await this.ownComplaint(userId, idOrReference);
    const file = await this.deps.repository.attachmentData(complaint.id, attachmentId);
    if (!file) throw new ComplaintNotFoundError();
    return file;
  }

  /** Contestation d'une décision : au plus 2 fois, dans les 30 jours suivant la décision. */
  async reopen(userId: UserId, idOrReference: string, reason: string) {
    const owned = await this.ownComplaint(userId, idOrReference);
    return this.run(async (tx) => {
      const complaint = await this.lock(tx, owned.id);
      if (complaint.status !== 'RESOLVED' && complaint.status !== 'REJECTED') {
        throw new InvalidComplaintTransitionError(complaint.status, 'IN_REVIEW');
      }
      if (complaint.reopenCount >= COMPLAINT_LIMITS.maxReopens)
        throw new ComplaintLimitError('REOPENS');
      const now = this.clock();
      if (
        complaint.decidedAt &&
        now.getTime() - complaint.decidedAt.getTime() > COMPLAINT_LIMITS.reopenWindowMs
      ) {
        throw new ComplaintLimitError('REOPEN_WINDOW');
      }
      await tx.insertMessage({
        id: randomUUID(),
        complaintId: complaint.id,
        authorType: 'PLAYER',
        authorId: userId,
        body: reason,
        visibility: 'PUBLIC',
        createdAt: now,
        idempotencyKey: null,
      });
      await this.event(tx, complaint, 'REOPENED', 'PLAYER', userId, complaint.status, 'IN_REVIEW', {
        reopenCount: complaint.reopenCount + 1,
      });
      const { status } = await this.transition(
        tx,
        complaint,
        'IN_REVIEW',
        'PLAYER',
        userId,
        {},
        {
          reopenCount: complaint.reopenCount + 1,
        },
      );
      return { status };
    });
  }

  /** Retrait du dossier par le joueur, ou acceptation de la décision : clôture. */
  async closeAsPlayer(userId: UserId, idOrReference: string) {
    const owned = await this.ownComplaint(userId, idOrReference);
    return this.run(async (tx) => {
      const complaint = await this.lock(tx, owned.id);
      const { status } = await this.transition(
        tx,
        complaint,
        'CLOSED',
        'PLAYER',
        userId,
        {},
        {
          closedAt: this.clock(),
        },
      );
      return { status };
    });
  }

  // --- Administration -----------------------------------------------------------------------

  async adminList(filters: AdminComplaintFilters) {
    const { total, items } = await this.deps.repository.listForAdmin(filters);
    return {
      page: filters.page,
      limit: filters.limit,
      total,
      items: items.map((c) => ({
        id: c.id,
        reference: c.reference,
        category: c.category,
        suggestedCategory: c.suggestedCategory,
        title: c.title,
        status: c.status,
        priority: c.priority,
        player: { id: c.userId, username: c.username },
        assignee: c.assignedAdminId
          ? { id: c.assignedAdminId, username: c.assignedAdminUsername }
          : null,
        aiAnalysisStatus: c.aiAnalysisStatus,
        createdAt: c.createdAt.toISOString(),
        updatedAt: c.updatedAt.toISOString(),
      })),
    };
  }

  /** Détail complet ; la consultation est inscrite au journal d'audit. */
  async adminGet(adminId: UserId, complaintId: string) {
    const complaint = await this.deps.repository.findById(complaintId);
    if (!complaint) throw new ComplaintNotFoundError();
    const r = this.deps.repository;
    const [messages, events, attachments, checks, evidence] = await Promise.all([
      r.messages(complaint.id, true),
      r.events(complaint.id),
      r.attachments(complaint.id),
      r.checks(complaint.id),
      this.linkedEvidence(complaint),
    ]);
    const names = await r.usernames(
      [
        complaint.userId,
        complaint.assignedAdminId,
        complaint.decidedBy,
        ...messages.map((m) => m.authorId),
        ...events.map((e) => e.actorId),
      ].filter((id): id is UserId => id !== null),
    );
    await this.auditOnly(adminId, 'COMPLAINT_VIEWED', complaint.id, {
      reference: complaint.reference,
    });
    const who = (id: UserId | null) => (id ? { id, username: names.get(id) ?? null } : null);
    return {
      complaint: {
        ...playerComplaintView(complaint),
        suggestedCategory: complaint.suggestedCategory,
        conversationId: complaint.conversationId,
        player: who(complaint.userId),
        assignee: who(complaint.assignedAdminId),
        decidedBy: who(complaint.decidedBy),
        version: complaint.version,
      },
      // Analyse AUTOMATISÉE : à présenter séparément des faits vérifiés.
      aiAnalysis: { status: complaint.aiAnalysisStatus, summary: complaint.aiSummary },
      // Faits lus À L'INSTANT dans les sources qui font autorité (jamais une déclaration).
      verified: evidence,
      checks: checks.map((c) => ({
        id: c.id,
        tool: c.tool,
        outcome: c.outcome,
        source: c.source,
        facts: c.facts,
        createdAt: c.createdAt.toISOString(),
      })),
      messages: messages.map((m) => ({ ...messageView(m), author: who(m.authorId) })),
      events: events.map((e) => ({ ...eventView(e, true), actor: who(e.actorId) })),
      attachments: attachments.map((a) => ({
        id: a.id,
        contentType: a.contentType,
        sizeBytes: a.sizeBytes,
        uploaderType: a.uploaderType,
        createdAt: a.createdAt.toISOString(),
      })),
    };
  }

  /** Éléments liés relus dans les sources, bornés au joueur du dossier. */
  private async linkedEvidence(c: Complaint) {
    const e = this.deps.evidence;
    const owner = c.userId;
    const [game, wallet, transaction, payment, withdrawal, tournament] = await Promise.all([
      c.links.gameId ? e.game(owner, c.links.gameId) : null,
      e.wallet(owner, 10),
      c.links.walletTransactionId ? e.walletTransaction(owner, c.links.walletTransactionId) : null,
      c.links.paymentId ? e.payment(owner, c.links.paymentId) : null,
      c.links.withdrawalId ? e.withdrawal(owner, c.links.withdrawalId) : null,
      c.links.tournamentId ? e.tournament(owner, c.links.tournamentId) : null,
    ]);
    return {
      readAt: this.clock().toISOString(),
      game,
      wallet,
      transaction,
      payment,
      withdrawal,
      tournament,
    };
  }

  async adminAttachment(adminId: UserId, complaintId: string, attachmentId: string) {
    const complaint = await this.deps.repository.findById(complaintId);
    if (!complaint) throw new ComplaintNotFoundError();
    const file = await this.deps.repository.attachmentData(complaint.id, attachmentId);
    if (!file) throw new ComplaintNotFoundError();
    await this.auditOnly(adminId, 'COMPLAINT_ATTACHMENT_VIEWED', complaint.id, { attachmentId });
    return file;
  }

  async adminReply(
    adminId: UserId,
    complaintId: string,
    input: { body: string; internal: boolean },
    idempotencyKey: string,
  ) {
    return this.run(async (tx, notified) => {
      const complaint = await this.lock(tx, complaintId);
      const replay = await tx.findMessageByKey(complaint.id, adminId, idempotencyKey);
      if (replay) return { message: messageView(replay) };
      if (complaint.status === 'CLOSED') {
        throw new InvalidComplaintTransitionError(complaint.status, complaint.status);
      }
      const now = this.clock();
      const message: ComplaintMessage = {
        id: randomUUID(),
        complaintId: complaint.id,
        authorType: 'ADMIN',
        authorId: adminId,
        body: input.body,
        visibility: input.internal ? 'INTERNAL' : 'PUBLIC',
        createdAt: now,
      };
      await tx.insertMessage({ ...message, idempotencyKey });
      const event = await this.event(tx, complaint, 'MESSAGE_ADDED', 'ADMIN', adminId, null, null, {
        messageId: message.id,
        visibility: message.visibility,
      });
      await tx.updateComplaint(complaint.id, {}, now);
      if (!input.internal)
        await this.notify(tx, notified, complaint, 'REPLY', event.id, complaint.status);
      await this.audit(
        tx,
        adminId,
        input.internal ? 'COMPLAINT_NOTE_ADDED' : 'COMPLAINT_REPLIED',
        complaint,
        {
          messageId: message.id,
        },
      );
      return { message: messageView(message) };
    });
  }

  /** Demande d'informations : message au joueur + attente de sa réponse. */
  async adminRequestInfo(
    adminId: UserId,
    complaintId: string,
    body: string,
    expectedStatus?: ComplaintStatus,
  ) {
    return this.run(async (tx, notified) => {
      const complaint = await this.lock(tx, complaintId);
      this.expect(complaint, expectedStatus);
      const now = this.clock();
      const message: ComplaintMessage = {
        id: randomUUID(),
        complaintId: complaint.id,
        authorType: 'ADMIN',
        authorId: adminId,
        body,
        visibility: 'PUBLIC',
        createdAt: now,
      };
      if (!canTransition(complaint.status, 'WAITING_FOR_PLAYER', 'ADMIN')) {
        throw new InvalidComplaintTransitionError(complaint.status, 'WAITING_FOR_PLAYER');
      }
      await tx.insertMessage({ ...message, idempotencyKey: null });
      const event = await this.event(
        tx,
        complaint,
        'INFO_REQUESTED',
        'ADMIN',
        adminId,
        null,
        null,
        {
          messageId: message.id,
        },
      );
      const { status } = await this.transition(
        tx,
        complaint,
        'WAITING_FOR_PLAYER',
        'ADMIN',
        adminId,
        {},
      );
      await this.notify(tx, notified, complaint, 'INFO_REQUESTED', event.id, status);
      await this.audit(tx, adminId, 'COMPLAINT_INFO_REQUESTED', complaint, {
        messageId: message.id,
      });
      return { status };
    });
  }

  /** Assignation (ou retrait) ; prendre en charge un dossier neuf le passe en examen. */
  async adminAssign(adminId: UserId, complaintId: string, assigneeId: UserId | null) {
    return this.run(async (tx) => {
      const complaint = await this.lock(tx, complaintId);
      if (assigneeId && !(await tx.isActiveAdmin(assigneeId))) throw new NotAnAdministratorError();
      // Rejeu ou double clic : même responsable, rien de plus n'est écrit ni audité.
      if (complaint.assignedAdminId === assigneeId) {
        return { status: complaint.status, assigneeId, changed: false };
      }
      const now = this.clock();
      await tx.updateComplaint(complaint.id, { assignedAdminId: assigneeId }, now);
      await this.event(tx, complaint, 'ASSIGNED', 'ADMIN', adminId, null, null, {
        from: complaint.assignedAdminId,
        to: assigneeId,
      });
      let status = complaint.status;
      if (assigneeId && (status === 'OPEN' || status === 'AI_ANALYSIS')) {
        status = (
          await this.transition(tx, complaint, 'IN_REVIEW', 'ADMIN', adminId, { takenOver: true })
        ).status;
      }
      await this.audit(tx, adminId, 'COMPLAINT_ASSIGNED', complaint, {
        from: complaint.assignedAdminId,
        to: assigneeId,
      });
      return { status, assigneeId, changed: true };
    });
  }

  async adminChangePriority(adminId: UserId, complaintId: string, priority: ComplaintPriority) {
    return this.run(async (tx) => {
      const complaint = await this.lock(tx, complaintId);
      if (complaint.priority === priority) return { priority, changed: false };
      await tx.updateComplaint(complaint.id, { priority }, this.clock());
      await this.event(tx, complaint, 'PRIORITY_CHANGED', 'ADMIN', adminId, null, null, {
        from: complaint.priority,
        to: priority,
      });
      await this.audit(tx, adminId, 'COMPLAINT_PRIORITY_CHANGED', complaint, {
        from: complaint.priority,
        to: priority,
      });
      return { priority, changed: true };
    });
  }

  /**
   * Changement de statut administratif. RESOLVED / REJECTED exigent une décision motivée ;
   * `expectedStatus` protège d'un traitement concurrent (409 si le dossier a changé).
   */
  async adminChangeStatus(
    adminId: UserId,
    complaintId: string,
    input: {
      status: ComplaintStatus;
      expectedStatus?: ComplaintStatus;
      decision?: string;
      reason?: string;
    },
  ) {
    return this.run(async (tx, notified) => {
      const complaint = await this.lock(tx, complaintId);
      this.expect(complaint, input.expectedStatus);
      const now = this.clock();
      const patch: ComplaintPatch = {};
      const deciding = input.status === 'RESOLVED' || input.status === 'REJECTED';
      if (deciding) {
        if (!input.decision)
          throw new InvalidComplaintTransitionError(complaint.status, input.status);
        patch.decision = input.decision;
        patch.decidedBy = adminId;
        patch.decidedAt = now;
      }
      if (input.status === 'CLOSED') patch.closedAt = now;
      const transition = await this.transition(
        tx,
        complaint,
        input.status,
        'ADMIN',
        adminId,
        input.reason ? { reason: input.reason } : {},
        patch,
      );
      const { status } = transition;
      const eventId = deciding
        ? (
            await this.event(
              tx,
              complaint,
              'DECISION_RECORDED',
              'ADMIN',
              adminId,
              complaint.status,
              status,
              {
                outcome: status,
              },
            )
          ).id
        : transition.eventId;
      const kind: NotifiedEvent = deciding
        ? 'DECISION'
        : status === 'CLOSED'
          ? 'CLOSED'
          : 'STATUS_CHANGED';
      await this.notify(tx, notified, complaint, kind, eventId, status);
      await this.audit(tx, adminId, 'COMPLAINT_STATUS_CHANGED', complaint, {
        from: complaint.status,
        to: status,
        ...(input.reason && { reason: input.reason }),
      });
      return { status };
    });
  }

  listAssignees() {
    return this.deps.repository.listAdmins();
  }

  // --- Analyse automatique (système) --------------------------------------------------------

  /**
   * Prend le bail de l'analyse puis OPEN → AI_ANALYSIS. null si le dossier n'attend plus
   * d'analyse ou si une autre instance l'analyse déjà (bail valide) : jamais deux analyses
   * simultanées d'un même dossier, même avec plusieurs instances du backend.
   */
  async beginAnalysis(complaintId: string): Promise<Complaint | null> {
    return this.run(async (tx) => {
      if (!(await tx.claimAnalysis(complaintId, this.clock(), ANALYSIS_LEASE_MS))) return null;
      const complaint = await tx.lockComplaint(complaintId);
      if (!complaint || complaint.aiAnalysisStatus !== 'PENDING') return null;
      if (complaint.status === 'OPEN') {
        await this.transition(tx, complaint, 'AI_ANALYSIS', 'SYSTEM', null, {});
        return { ...complaint, status: 'AI_ANALYSIS' };
      }
      return complaint;
    });
  }

  /**
   * Fin de l'analyse : résumé AUTOMATISÉ (ou indisponibilité), vérifications du serveur, puis
   * passage en examen par le support. Jamais de résolution ni de clôture automatique.
   */
  async completeAnalysis(
    complaintId: string,
    result: {
      summary: string | null;
      suggestedCategory: ComplaintCategory | null;
      checks: {
        tool: string;
        outcome: ComplaintCheck['outcome'];
        facts: Record<string, unknown>;
      }[];
      reason?: string;
    },
  ): Promise<void> {
    await this.run(async (tx) => {
      const complaint = await tx.lockComplaint(complaintId);
      if (!complaint || complaint.aiAnalysisStatus !== 'PENDING') return;
      const now = this.clock();
      for (const check of result.checks) {
        await tx.insertCheck({
          id: randomUUID(),
          complaintId,
          ...check,
          source: 'SYSTEM',
          createdAt: now,
        });
      }
      const available = result.summary !== null;
      await tx.updateComplaint(
        complaintId,
        {
          aiAnalysisStatus: available ? 'COMPLETED' : 'UNAVAILABLE',
          aiSummary: result.summary,
          ...(result.suggestedCategory &&
            !complaint.suggestedCategory && { suggestedCategory: result.suggestedCategory }),
        },
        now,
      );
      await this.event(
        tx,
        complaint,
        available ? 'AI_ANALYSIS_COMPLETED' : 'AI_ANALYSIS_UNAVAILABLE',
        'SYSTEM',
        null,
        null,
        null,
        { checks: result.checks.length, ...(result.reason && { reason: result.reason }) },
      );
      if (complaint.status === 'OPEN' || complaint.status === 'AI_ANALYSIS') {
        await this.transition(tx, complaint, 'IN_REVIEW', 'SYSTEM', null, {});
      }
    });
  }

  pendingAnalysis(before: Date, limit: number) {
    return this.deps.repository.pendingAnalysis(
      before,
      new Date(this.clock().getTime() - ANALYSIS_LEASE_MS),
      limit,
    );
  }

  // --- Outils internes ----------------------------------------------------------------------

  /**
   * Transaction d'une commande. Les joueurs notifiés y sont collectés LOCALEMENT, puis signalés
   * en temps réel après le COMMIT seulement (jamais pour une écriture annulée).
   */
  private async run<T>(work: (tx: ComplaintTx, notified: Set<UserId>) => Promise<T>): Promise<T> {
    const notified = new Set<UserId>();
    const result = await this.deps.repository.transaction((tx) => {
      notified.clear();
      return work(tx, notified);
    });
    for (const userId of notified) this.signal(userId);
    return result;
  }

  private async lock(tx: ComplaintTx, complaintId: string): Promise<Complaint> {
    const complaint = await tx.lockComplaint(complaintId);
    if (!complaint) throw new ComplaintNotFoundError();
    return complaint;
  }

  private expect(complaint: Complaint, expected: ComplaintStatus | undefined): void {
    if (expected && complaint.status !== expected)
      throw new ComplaintConflictError(complaint.status);
  }

  private async transition(
    tx: ComplaintTx,
    complaint: Complaint,
    to: ComplaintStatus,
    actor: ComplaintActor,
    actorId: UserId | null,
    details: Record<string, unknown>,
    patch: ComplaintPatch = {},
  ): Promise<{ status: ComplaintStatus; eventId: string }> {
    if (!canTransition(complaint.status, to, actor)) {
      throw new InvalidComplaintTransitionError(complaint.status, to);
    }
    await tx.updateComplaint(complaint.id, { ...patch, status: to }, this.clock());
    const event = await this.event(
      tx,
      complaint,
      'STATUS_CHANGED',
      actor,
      actorId,
      complaint.status,
      to,
      details,
    );
    return { status: to, eventId: event.id };
  }

  private async event(
    tx: ComplaintTx,
    complaint: Complaint,
    type: ComplaintEventType,
    actorType: ComplaintEvent['actorType'],
    actorId: UserId | null,
    fromStatus: ComplaintStatus | null,
    toStatus: ComplaintStatus | null,
    details: Record<string, unknown>,
  ): Promise<ComplaintEvent> {
    const event: ComplaintEvent = {
      id: randomUUID(),
      complaintId: complaint.id,
      type,
      actorType,
      actorId: actorType === 'PLAYER' || actorType === 'ADMIN' ? actorId : null,
      fromStatus,
      toStatus,
      details,
      createdAt: this.clock(),
    };
    await tx.insertEvent(event);
    return event;
  }

  private async notify(
    tx: ComplaintTx,
    notified: Set<UserId>,
    complaint: Complaint,
    event: NotifiedEvent,
    eventId: string,
    status: ComplaintStatus,
  ): Promise<void> {
    const inserted = await tx.notify({
      id: randomUUID(),
      userId: complaint.userId,
      complaintId: complaint.id,
      reference: complaint.reference,
      event,
      status,
      dedupeKey: `complaint:${complaint.id}:${eventId}`,
      createdAt: this.clock(),
    });
    if (inserted) notified.add(complaint.userId);
  }

  private signal(userId: UserId): void {
    try {
      this.deps.signals?.publish({
        type: 'notification',
        userId,
        notificationType: 'COMPLAINT_UPDATE',
      });
    } catch {
      // Signal temps réel perdu : la notification reste lisible dans PostgreSQL.
    }
  }

  private async audit(
    tx: ComplaintTx,
    adminId: UserId,
    action: AuditAction,
    complaint: Complaint,
    details: Record<string, unknown>,
  ): Promise<void> {
    await tx.audit({
      id: randomUUID(),
      actorId: adminId,
      action,
      targetType: 'COMPLAINT',
      targetId: complaint.id,
      outcome: 'SUCCESS',
      details: { reference: complaint.reference, ...details },
      createdAt: this.clock(),
    });
  }

  private async auditOnly(
    adminId: UserId,
    action: AuditAction,
    complaintId: string,
    details: Record<string, unknown>,
  ) {
    await this.deps.repository.transaction((tx) =>
      tx.audit({
        id: randomUUID(),
        actorId: adminId,
        action,
        targetType: 'COMPLAINT',
        targetId: complaintId,
        outcome: 'SUCCESS',
        details,
        createdAt: this.clock(),
      }),
    );
  }
}
