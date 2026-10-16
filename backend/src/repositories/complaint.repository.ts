import type { AuditEntry } from '../domain/admin/admin';
import type {
  AttachmentType,
  Complaint,
  ComplaintAttachmentMeta,
  ComplaintCategory,
  ComplaintCheck,
  ComplaintEvent,
  ComplaintMessage,
  ComplaintPriority,
  ComplaintStatus,
} from '../domain/complaints/complaint';
import type { UserId } from '../domain/users/user';

export interface NewComplaint extends Complaint {
  idempotencyKey: string;
}

export type ComplaintPatch = Partial<
  Pick<
    Complaint,
    | 'status'
    | 'priority'
    | 'assignedAdminId'
    | 'aiSummary'
    | 'aiAnalysisStatus'
    | 'suggestedCategory'
    | 'decision'
    | 'decidedBy'
    | 'decidedAt'
    | 'reopenCount'
    | 'closedAt'
  >
>;

export interface NewComplaintMessage extends ComplaintMessage {
  idempotencyKey: string | null;
}

export interface NewAttachment extends ComplaintAttachmentMeta {
  uploaderId: UserId;
  sha256: string;
  data: Uint8Array;
}

/** Notification « réclamation mise à jour » : contenu générique, jamais financier. */
export interface ComplaintNotification {
  id: string;
  userId: UserId;
  complaintId: string;
  reference: string;
  /** Nature de l'événement (CREATED, INFO_REQUESTED, REPLY, STATUS_CHANGED, DECISION…). */
  event: string;
  status: ComplaintStatus;
  /** Unicité (joueur, clé) : rejouer le même événement ne notifie pas deux fois. */
  dedupeKey: string;
  createdAt: Date;
}

export interface AdminComplaintFilters {
  page: number;
  limit: number;
  status?: ComplaintStatus;
  category?: ComplaintCategory;
  priority?: ComplaintPriority;
  /** Identifiant exact ou début de pseudo du joueur. */
  player?: string;
  assignee?: UserId | 'none';
  /** Référence exacte (RCL-…). */
  reference?: string;
  from?: Date;
  to?: Date;
}

export interface AdminComplaintRow extends Complaint {
  username: string;
  assignedAdminUsername: string | null;
}

/**
 * Opérations d'UNE transaction sur un dossier. Le dossier est verrouillé (`lockComplaint`)
 * avant toute écriture : deux traitements concurrents s'exécutent l'un après l'autre, et le
 * second relit l'état laissé par le premier.
 */
export interface ComplaintTx {
  lockComplaint(id: string): Promise<Complaint | null>;
  /**
   * Prend le bail de l'analyse automatique (UPDATE conditionnel atomique) : false si une autre
   * instance détient un bail encore valide, ou si l'analyse n'est plus attendue.
   */
  claimAnalysis(id: string, now: Date, leaseMs: number): Promise<boolean>;
  /** Verrouille le compte du joueur : création sérialisée (limite de dossiers actifs). */
  lockUser(userId: UserId): Promise<boolean>;
  findByIdempotencyKey(userId: UserId, key: string): Promise<Complaint | null>;
  countActive(userId: UserId): Promise<number>;
  insertComplaint(complaint: NewComplaint): Promise<void>;
  /** Applique le changement et incrémente `version`. */
  updateComplaint(id: string, patch: ComplaintPatch, now: Date): Promise<void>;
  /** false : même clé d'idempotence déjà enregistrée (rien de plus n'est écrit). */
  insertMessage(message: NewComplaintMessage): Promise<boolean>;
  findMessageByKey(
    complaintId: string,
    authorId: UserId,
    key: string,
  ): Promise<ComplaintMessage | null>;
  insertEvent(event: ComplaintEvent): Promise<void>;
  insertCheck(check: ComplaintCheck): Promise<void>;
  countAttachments(complaintId: string): Promise<number>;
  /** false : pièce identique déjà jointe au dossier. */
  insertAttachment(attachment: NewAttachment): Promise<boolean>;
  /** false : déjà notifié (clé de déduplication). */
  notify(notification: ComplaintNotification): Promise<boolean>;
  isActiveAdmin(userId: UserId): Promise<boolean>;
  audit(entry: AuditEntry): Promise<void>;
}

export interface ComplaintRepository {
  transaction<T>(work: (tx: ComplaintTx) => Promise<T>): Promise<T>;
  findById(id: string): Promise<Complaint | null>;
  /** Dossier du joueur par identifiant ou référence ; null s'il appartient à un autre. */
  findForUser(userId: UserId, idOrReference: string): Promise<Complaint | null>;
  listForUser(userId: UserId, limit: number): Promise<Complaint[]>;
  listForAdmin(
    filters: AdminComplaintFilters,
  ): Promise<{ total: number; items: AdminComplaintRow[] }>;
  messages(complaintId: string, includeInternal: boolean): Promise<ComplaintMessage[]>;
  events(complaintId: string): Promise<ComplaintEvent[]>;
  checks(complaintId: string): Promise<ComplaintCheck[]>;
  attachments(complaintId: string): Promise<ComplaintAttachmentMeta[]>;
  attachmentData(
    complaintId: string,
    attachmentId: string,
  ): Promise<{ contentType: AttachmentType; data: Uint8Array } | null>;
  /** Administrateurs actifs (assignation). */
  listAdmins(): Promise<{ id: UserId; username: string }[]>;
  usernames(ids: UserId[]): Promise<Map<string, string>>;
  /**
   * Dossiers dont l'analyse automatique n'a pas abouti avant `before` et dont le bail est libre
   * ou expiré à `leaseExpiredBefore` (reprise après arrêt d'une instance).
   */
  pendingAnalysis(before: Date, leaseExpiredBefore: Date, limit: number): Promise<Complaint[]>;
}

// --- Conversations avec l'assistant -----------------------------------------------------------

export interface SupportConversation {
  id: string;
  userId: UserId;
  status: 'ACTIVE' | 'CLOSED';
  language: 'fr' | 'en';
  playerTurns: number;
  lastAnalysis: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
}

export interface SupportMessage {
  id: string;
  conversationId: string;
  role: 'PLAYER' | 'ASSISTANT';
  content: string;
  metadata: Record<string, unknown>;
  createdAt: Date;
}

export interface SupportConversationRepository {
  findActive(userId: UserId): Promise<SupportConversation | null>;
  /** Conversation du joueur (null si elle appartient à un autre). */
  findConversation(userId: UserId, conversationId: string): Promise<SupportConversation | null>;
  /** Crée la conversation active, ou renvoie celle qui existe déjà (concurrence). */
  openActive(conversation: SupportConversation): Promise<SupportConversation>;
  close(conversationId: string, now: Date): Promise<void>;
  /** false : message déjà enregistré avec cette clé. */
  insertMessage(message: SupportMessage & { idempotencyKey: string | null }): Promise<boolean>;
  findMessageByKey(conversationId: string, key: string): Promise<SupportMessage | null>;
  /** Réponse de l'assistant qui suit un message du joueur (rejeu idempotent). */
  findReplyTo(conversationId: string, playerMessageId: string): Promise<SupportMessage | null>;
  messages(conversationId: string, limit: number): Promise<SupportMessage[]>;
  recordTurn(
    conversationId: string,
    analysis: Record<string, unknown>,
    language: 'fr' | 'en',
    now: Date,
  ): Promise<void>;
}
