import {
  isPgError,
  PG_UNIQUE_VIOLATION,
  type SqlClient,
  type SqlExecutor,
} from '../database/sql-client';
import type { AuditEntry } from '../domain/admin/admin';
import type {
  AttachmentType,
  Complaint,
  ComplaintAttachmentMeta,
  ComplaintCheck,
  ComplaintEvent,
  ComplaintMessage,
} from '../domain/complaints/complaint';
import type { UserId } from '../domain/users/user';
import { insertAuditRow } from './admin-audit.repository';
import type {
  AdminComplaintFilters,
  AdminComplaintRow,
  ComplaintNotification,
  ComplaintPatch,
  ComplaintRepository,
  ComplaintTx,
  NewAttachment,
  NewComplaint,
  NewComplaintMessage,
  SupportConversation,
  SupportConversationRepository,
  SupportMessage,
} from './complaint.repository';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const date = (value: Date | string) => new Date(value);
const dateOrNull = (value: Date | string | null) => (value === null ? null : new Date(value));
const json = (value: unknown): Record<string, unknown> =>
  (typeof value === 'string' ? JSON.parse(value) : (value ?? {})) as Record<string, unknown>;

interface ComplaintRow {
  id: string;
  reference: string;
  user_id: string;
  category: Complaint['category'];
  suggested_category: Complaint['category'] | null;
  title: string;
  description: string;
  status: Complaint['status'];
  priority: Complaint['priority'];
  game_id: string | null;
  tournament_id: string | null;
  wallet_transaction_id: string | null;
  payment_id: string | null;
  withdrawal_id: string | null;
  conversation_id: string | null;
  incident_at: Date | null;
  assigned_admin_id: string | null;
  ai_summary: string | null;
  ai_analysis_status: Complaint['aiAnalysisStatus'];
  decision: string | null;
  decided_by: string | null;
  decided_at: Date | null;
  reopen_count: number;
  version: number;
  created_at: Date;
  updated_at: Date;
  closed_at: Date | null;
}

const COMPLAINT_COLUMNS = `
  c.id, c.reference, c.user_id, c.category, c.suggested_category, c.title, c.description,
  c.status, c.priority, c.game_id, c.tournament_id, c.wallet_transaction_id, c.payment_id,
  c.withdrawal_id, c.conversation_id, c.incident_at, c.assigned_admin_id, c.ai_summary,
  c.ai_analysis_status, c.decision, c.decided_by, c.decided_at, c.reopen_count, c.version,
  c.created_at, c.updated_at, c.closed_at`;

function complaintOf(row: ComplaintRow): Complaint {
  const links: Complaint['links'] = {};
  if (row.game_id) links.gameId = row.game_id;
  if (row.tournament_id) links.tournamentId = row.tournament_id;
  if (row.wallet_transaction_id) links.walletTransactionId = row.wallet_transaction_id;
  if (row.payment_id) links.paymentId = row.payment_id;
  if (row.withdrawal_id) links.withdrawalId = row.withdrawal_id;
  return {
    id: row.id,
    reference: row.reference,
    userId: row.user_id as UserId,
    category: row.category,
    suggestedCategory: row.suggested_category,
    title: row.title,
    description: row.description,
    status: row.status,
    priority: row.priority,
    links,
    conversationId: row.conversation_id,
    incidentAt: dateOrNull(row.incident_at),
    assignedAdminId: row.assigned_admin_id as UserId | null,
    aiSummary: row.ai_summary,
    aiAnalysisStatus: row.ai_analysis_status,
    decision: row.decision,
    decidedBy: row.decided_by as UserId | null,
    decidedAt: dateOrNull(row.decided_at),
    reopenCount: Number(row.reopen_count),
    version: Number(row.version),
    createdAt: date(row.created_at),
    updatedAt: date(row.updated_at),
    closedAt: dateOrNull(row.closed_at),
  };
}

interface MessageRow {
  id: string;
  complaint_id: string;
  author_type: ComplaintMessage['authorType'];
  author_id: string | null;
  body: string;
  visibility: ComplaintMessage['visibility'];
  created_at: Date;
}

function messageOf(row: MessageRow): ComplaintMessage {
  return {
    id: row.id,
    complaintId: row.complaint_id,
    authorType: row.author_type,
    authorId: row.author_id as UserId | null,
    body: row.body,
    visibility: row.visibility,
    createdAt: date(row.created_at),
  };
}

/** Colonnes modifiables : nom de colonne SQL fixe (aucune valeur concaténée). */
const PATCH_COLUMNS: Record<keyof ComplaintPatch, string> = {
  status: 'status',
  priority: 'priority',
  assignedAdminId: 'assigned_admin_id',
  aiSummary: 'ai_summary',
  aiAnalysisStatus: 'ai_analysis_status',
  suggestedCategory: 'suggested_category',
  decision: 'decision',
  decidedBy: 'decided_by',
  decidedAt: 'decided_at',
  reopenCount: 'reopen_count',
  closedAt: 'closed_at',
};

function sqlValue(value: unknown): unknown {
  return value instanceof Date ? value.toISOString() : value;
}

class PostgresComplaintTx implements ComplaintTx {
  constructor(private readonly tx: SqlExecutor) {}

  async lockComplaint(id: string): Promise<Complaint | null> {
    if (!UUID.test(id)) return null;
    const { rows } = await this.tx.query<ComplaintRow>(
      `SELECT ${COMPLAINT_COLUMNS} FROM complaints c WHERE c.id = $1 FOR UPDATE`,
      [id],
    );
    return rows[0] ? complaintOf(rows[0]) : null;
  }

  async claimAnalysis(id: string, now: Date, leaseMs: number): Promise<boolean> {
    if (!UUID.test(id)) return false;
    const { rowCount } = await this.tx.query(
      `UPDATE complaints SET analysis_claimed_at = $2
       WHERE id = $1 AND ai_analysis_status = 'PENDING' AND status <> 'CLOSED'
         AND (analysis_claimed_at IS NULL OR analysis_claimed_at < $3)`,
      [id, now.toISOString(), new Date(now.getTime() - leaseMs).toISOString()],
    );
    return rowCount > 0;
  }

  async lockUser(userId: UserId): Promise<boolean> {
    const { rows } = await this.tx.query('SELECT id FROM users WHERE id = $1 FOR UPDATE', [userId]);
    return rows.length > 0;
  }

  async findByIdempotencyKey(userId: UserId, key: string): Promise<Complaint | null> {
    const { rows } = await this.tx.query<ComplaintRow>(
      `SELECT ${COMPLAINT_COLUMNS} FROM complaints c WHERE c.user_id = $1 AND c.idempotency_key = $2`,
      [userId, key],
    );
    return rows[0] ? complaintOf(rows[0]) : null;
  }

  async countActive(userId: UserId): Promise<number> {
    const { rows } = await this.tx.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM complaints
       WHERE user_id = $1 AND status IN ('OPEN', 'AI_ANALYSIS', 'WAITING_FOR_PLAYER', 'IN_REVIEW')`,
      [userId],
    );
    return rows[0]?.n ?? 0;
  }

  async insertComplaint(c: NewComplaint): Promise<void> {
    await this.tx.query(
      `INSERT INTO complaints (id, reference, user_id, category, suggested_category, title,
         description, status, priority, game_id, tournament_id, wallet_transaction_id, payment_id,
         withdrawal_id, conversation_id, incident_at, assigned_admin_id, ai_summary,
         ai_analysis_status, idempotency_key, version, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, NULL, NULL,
         $17, $18, 1, $19, $19)`,
      [
        c.id,
        c.reference,
        c.userId,
        c.category,
        c.suggestedCategory,
        c.title,
        c.description,
        c.status,
        c.priority,
        c.links.gameId ?? null,
        c.links.tournamentId ?? null,
        c.links.walletTransactionId ?? null,
        c.links.paymentId ?? null,
        c.links.withdrawalId ?? null,
        c.conversationId,
        c.incidentAt?.toISOString() ?? null,
        c.aiAnalysisStatus,
        c.idempotencyKey,
        c.createdAt.toISOString(),
      ],
    );
  }

  async updateComplaint(id: string, patch: ComplaintPatch, now: Date): Promise<void> {
    const sets: string[] = [];
    const params: unknown[] = [id, now.toISOString()];
    for (const [key, value] of Object.entries(patch) as [keyof ComplaintPatch, unknown][]) {
      if (value === undefined) continue;
      params.push(sqlValue(value));
      sets.push(`${PATCH_COLUMNS[key]} = $${params.length}`);
    }
    await this.tx.query(
      `UPDATE complaints SET ${[...sets, 'updated_at = $2', 'version = version + 1'].join(', ')}
       WHERE id = $1`,
      params,
    );
  }

  async insertMessage(m: NewComplaintMessage): Promise<boolean> {
    const { rowCount } = await this.tx.query(
      `INSERT INTO complaint_messages (id, complaint_id, author_type, author_id, body, visibility,
         idempotency_key, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       ON CONFLICT (complaint_id, author_id, idempotency_key) DO NOTHING`,
      [
        m.id,
        m.complaintId,
        m.authorType,
        m.authorId,
        m.body,
        m.visibility,
        m.idempotencyKey,
        m.createdAt.toISOString(),
      ],
    );
    return rowCount > 0;
  }

  async findMessageByKey(complaintId: string, authorId: UserId, key: string) {
    const { rows } = await this.tx.query<MessageRow>(
      `SELECT id, complaint_id, author_type, author_id, body, visibility, created_at
       FROM complaint_messages WHERE complaint_id = $1 AND author_id = $2 AND idempotency_key = $3`,
      [complaintId, authorId, key],
    );
    return rows[0] ? messageOf(rows[0]) : null;
  }

  async insertEvent(e: ComplaintEvent): Promise<void> {
    await this.tx.query(
      `INSERT INTO complaint_events (id, complaint_id, type, actor_type, actor_id, from_status,
         to_status, details, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9)`,
      [
        e.id,
        e.complaintId,
        e.type,
        e.actorType,
        e.actorId,
        e.fromStatus,
        e.toStatus,
        JSON.stringify(e.details),
        e.createdAt.toISOString(),
      ],
    );
  }

  async insertCheck(c: ComplaintCheck): Promise<void> {
    await this.tx.query(
      `INSERT INTO complaint_checks (id, complaint_id, tool, outcome, facts, source, created_at)
       VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7)`,
      [
        c.id,
        c.complaintId,
        c.tool,
        c.outcome,
        JSON.stringify(c.facts),
        c.source,
        c.createdAt.toISOString(),
      ],
    );
  }

  async countAttachments(complaintId: string): Promise<number> {
    const { rows } = await this.tx.query<{ n: number }>(
      'SELECT count(*)::int AS n FROM complaint_attachments WHERE complaint_id = $1',
      [complaintId],
    );
    return rows[0]?.n ?? 0;
  }

  async insertAttachment(a: NewAttachment): Promise<boolean> {
    const { rowCount } = await this.tx.query(
      `INSERT INTO complaint_attachments (id, complaint_id, uploader_type, uploader_id,
         content_type, size_bytes, sha256, data, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       ON CONFLICT (complaint_id, sha256) DO NOTHING`,
      [
        a.id,
        a.complaintId,
        a.uploaderType,
        a.uploaderId,
        a.contentType,
        a.sizeBytes,
        a.sha256,
        a.data,
        a.createdAt.toISOString(),
      ],
    );
    return rowCount > 0;
  }

  async notify(n: ComplaintNotification): Promise<boolean> {
    const { rowCount } = await this.tx.query(
      `INSERT INTO notifications (id, user_id, type, payload, dedupe_key, created_at)
       VALUES ($1, $2, 'COMPLAINT_UPDATE', $3::jsonb, $4, $5)
       ON CONFLICT (user_id, dedupe_key) DO NOTHING`,
      [
        n.id,
        n.userId,
        JSON.stringify({
          complaintId: n.complaintId,
          reference: n.reference,
          event: n.event,
          status: n.status,
        }),
        n.dedupeKey,
        n.createdAt.toISOString(),
      ],
    );
    return rowCount > 0;
  }

  async isActiveAdmin(userId: UserId): Promise<boolean> {
    const { rows } = await this.tx.query(
      `SELECT 1 FROM users WHERE id = $1 AND role = 'admin' AND status = 'active'`,
      [userId],
    );
    return rows.length > 0;
  }

  audit(entry: AuditEntry): Promise<void> {
    return insertAuditRow(this.tx, entry);
  }
}

/** Dossiers de réclamation dans PostgreSQL (D-114). */
export class PostgresComplaintRepository implements ComplaintRepository {
  constructor(private readonly sql: SqlClient) {}

  transaction<T>(work: (tx: ComplaintTx) => Promise<T>): Promise<T> {
    return this.sql.transaction((tx) => work(new PostgresComplaintTx(tx)));
  }

  async findById(id: string): Promise<Complaint | null> {
    if (!UUID.test(id)) return null;
    const { rows } = await this.sql.query<ComplaintRow>(
      `SELECT ${COMPLAINT_COLUMNS} FROM complaints c WHERE c.id = $1`,
      [id],
    );
    return rows[0] ? complaintOf(rows[0]) : null;
  }

  async findForUser(userId: UserId, idOrReference: string): Promise<Complaint | null> {
    const byId = UUID.test(idOrReference);
    const { rows } = await this.sql.query<ComplaintRow>(
      `SELECT ${COMPLAINT_COLUMNS} FROM complaints c
       WHERE c.user_id = $1 AND ${byId ? 'c.id = $2::uuid' : 'c.reference = $2'}`,
      [userId, byId ? idOrReference : idOrReference.toUpperCase()],
    );
    return rows[0] ? complaintOf(rows[0]) : null;
  }

  async listForUser(userId: UserId, limit: number): Promise<Complaint[]> {
    const { rows } = await this.sql.query<ComplaintRow>(
      `SELECT ${COMPLAINT_COLUMNS} FROM complaints c WHERE c.user_id = $1
       ORDER BY c.updated_at DESC, c.id LIMIT $2`,
      [userId, limit],
    );
    return rows.map(complaintOf);
  }

  async listForAdmin(f: AdminComplaintFilters) {
    const where: string[] = [];
    const params: unknown[] = [];
    const add = (clause: (p: string) => string, value: unknown) => {
      params.push(value);
      where.push(clause(`$${params.length}`));
    };
    if (f.status) add((p) => `c.status = ${p}`, f.status);
    if (f.category) add((p) => `c.category = ${p}`, f.category);
    if (f.priority) add((p) => `c.priority = ${p}`, f.priority);
    if (f.reference) add((p) => `c.reference = ${p}`, f.reference.toUpperCase());
    if (f.assignee === 'none') where.push('c.assigned_admin_id IS NULL');
    else if (f.assignee) add((p) => `c.assigned_admin_id = ${p}`, f.assignee);
    if (f.player) {
      if (UUID.test(f.player)) add((p) => `c.user_id = ${p}::uuid`, f.player);
      else
        add(
          (p) => `lower(u.username) LIKE ${p}`,
          `${f.player.toLowerCase().replace(/[%_\\]/g, '\\$&')}%`,
        );
    }
    if (f.from) add((p) => `c.created_at >= ${p}`, f.from.toISOString());
    if (f.to) add((p) => `c.created_at < ${p}`, f.to.toISOString());
    const whereSql = where.length > 0 ? `WHERE ${where.join(' AND ')}` : '';
    const from = `FROM complaints c JOIN users u ON u.id = c.user_id
                  LEFT JOIN users a ON a.id = c.assigned_admin_id ${whereSql}`;
    const total = await this.sql.query<{ n: number }>(`SELECT count(*)::int AS n ${from}`, params);
    const page = await this.sql.query<
      ComplaintRow & { username: string; admin_username: string | null }
    >(
      `SELECT ${COMPLAINT_COLUMNS}, u.username, a.username AS admin_username ${from}
       ORDER BY CASE c.priority WHEN 'URGENT' THEN 0 WHEN 'HIGH' THEN 1 WHEN 'NORMAL' THEN 2 ELSE 3 END,
                c.created_at DESC, c.id
       LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      [...params, f.limit, (f.page - 1) * f.limit],
    );
    return {
      total: total.rows[0]?.n ?? 0,
      items: page.rows.map((row): AdminComplaintRow => ({
        ...complaintOf(row),
        username: row.username,
        assignedAdminUsername: row.admin_username,
      })),
    };
  }

  async messages(complaintId: string, includeInternal: boolean): Promise<ComplaintMessage[]> {
    const { rows } = await this.sql.query<MessageRow>(
      `SELECT id, complaint_id, author_type, author_id, body, visibility, created_at
       FROM complaint_messages WHERE complaint_id = $1 ${includeInternal ? '' : "AND visibility = 'PUBLIC'"}
       ORDER BY seq`,
      [complaintId],
    );
    return rows.map(messageOf);
  }

  async events(complaintId: string): Promise<ComplaintEvent[]> {
    const { rows } = await this.sql.query<{
      id: string;
      complaint_id: string;
      type: ComplaintEvent['type'];
      actor_type: ComplaintEvent['actorType'];
      actor_id: string | null;
      from_status: ComplaintEvent['fromStatus'];
      to_status: ComplaintEvent['toStatus'];
      details: unknown;
      created_at: Date;
    }>(
      `SELECT id, complaint_id, type, actor_type, actor_id, from_status, to_status, details, created_at
       FROM complaint_events WHERE complaint_id = $1 ORDER BY seq`,
      [complaintId],
    );
    return rows.map((row) => ({
      id: row.id,
      complaintId: row.complaint_id,
      type: row.type,
      actorType: row.actor_type,
      actorId: row.actor_id as UserId | null,
      fromStatus: row.from_status,
      toStatus: row.to_status,
      details: json(row.details),
      createdAt: date(row.created_at),
    }));
  }

  async checks(complaintId: string): Promise<ComplaintCheck[]> {
    const { rows } = await this.sql.query<{
      id: string;
      complaint_id: string;
      tool: string;
      outcome: ComplaintCheck['outcome'];
      facts: unknown;
      source: ComplaintCheck['source'];
      created_at: Date;
    }>(
      `SELECT id, complaint_id, tool, outcome, facts, source, created_at
       FROM complaint_checks WHERE complaint_id = $1 ORDER BY created_at, id`,
      [complaintId],
    );
    return rows.map((row) => ({
      id: row.id,
      complaintId: row.complaint_id,
      tool: row.tool,
      outcome: row.outcome,
      facts: json(row.facts),
      source: row.source,
      createdAt: date(row.created_at),
    }));
  }

  async attachments(complaintId: string): Promise<ComplaintAttachmentMeta[]> {
    const { rows } = await this.sql.query<{
      id: string;
      complaint_id: string;
      uploader_type: 'PLAYER' | 'ADMIN';
      content_type: AttachmentType;
      size_bytes: number;
      created_at: Date;
    }>(
      `SELECT id, complaint_id, uploader_type, content_type, size_bytes, created_at
       FROM complaint_attachments WHERE complaint_id = $1 ORDER BY created_at, id`,
      [complaintId],
    );
    return rows.map((row) => ({
      id: row.id,
      complaintId: row.complaint_id,
      uploaderType: row.uploader_type,
      contentType: row.content_type,
      sizeBytes: Number(row.size_bytes),
      createdAt: date(row.created_at),
    }));
  }

  async attachmentData(complaintId: string, attachmentId: string) {
    if (!UUID.test(attachmentId)) return null;
    const { rows } = await this.sql.query<{ content_type: AttachmentType; data: Uint8Array }>(
      `SELECT content_type, data FROM complaint_attachments WHERE complaint_id = $1 AND id = $2`,
      [complaintId, attachmentId],
    );
    const row = rows[0];
    return row ? { contentType: row.content_type, data: new Uint8Array(row.data) } : null;
  }

  async listAdmins() {
    const { rows } = await this.sql.query<{ id: string; username: string }>(
      `SELECT id, username FROM users WHERE role = 'admin' AND status = 'active' ORDER BY username`,
    );
    return rows.map((row) => ({ id: row.id as UserId, username: row.username }));
  }

  async usernames(ids: UserId[]): Promise<Map<string, string>> {
    const unique = [...new Set(ids)];
    if (unique.length === 0) return new Map();
    const { rows } = await this.sql.query<{ id: string; username: string }>(
      'SELECT id, username FROM users WHERE id = ANY($1::uuid[])',
      [unique],
    );
    return new Map(rows.map((row) => [row.id, row.username]));
  }

  async pendingAnalysis(
    before: Date,
    leaseExpiredBefore: Date,
    limit: number,
  ): Promise<Complaint[]> {
    const { rows } = await this.sql.query<ComplaintRow>(
      `SELECT ${COMPLAINT_COLUMNS} FROM complaints c
       WHERE c.ai_analysis_status = 'PENDING' AND c.status <> 'CLOSED' AND c.updated_at < $1
         AND (c.analysis_claimed_at IS NULL OR c.analysis_claimed_at < $2)
       ORDER BY c.updated_at, c.id LIMIT $3`,
      [before.toISOString(), leaseExpiredBefore.toISOString(), limit],
    );
    return rows.map(complaintOf);
  }
}

/** Conversations avec l'assistant automatisé (D-114). */
export class PostgresSupportConversationRepository implements SupportConversationRepository {
  constructor(private readonly sql: SqlClient) {}

  private conversationOf(row: {
    id: string;
    user_id: string;
    status: 'ACTIVE' | 'CLOSED';
    language: 'fr' | 'en';
    player_turns: number;
    last_analysis: unknown;
    created_at: Date;
    updated_at: Date;
  }): SupportConversation {
    return {
      id: row.id,
      userId: row.user_id as UserId,
      status: row.status,
      language: row.language,
      playerTurns: Number(row.player_turns),
      lastAnalysis: json(row.last_analysis),
      createdAt: date(row.created_at),
      updatedAt: date(row.updated_at),
    };
  }

  private readonly conversationColumns =
    'id, user_id, status, language, player_turns, last_analysis, created_at, updated_at';

  async findActive(userId: UserId): Promise<SupportConversation | null> {
    const { rows } = await this.sql.query<
      Parameters<PostgresSupportConversationRepository['conversationOf']>[0]
    >(
      `SELECT ${this.conversationColumns} FROM support_conversations
       WHERE user_id = $1 AND status = 'ACTIVE'`,
      [userId],
    );
    return rows[0] ? this.conversationOf(rows[0]) : null;
  }

  async findConversation(userId: UserId, conversationId: string) {
    if (!UUID.test(conversationId)) return null;
    const { rows } = await this.sql.query<
      Parameters<PostgresSupportConversationRepository['conversationOf']>[0]
    >(
      `SELECT ${this.conversationColumns} FROM support_conversations WHERE id = $1 AND user_id = $2`,
      [conversationId, userId],
    );
    return rows[0] ? this.conversationOf(rows[0]) : null;
  }

  async openActive(conversation: SupportConversation): Promise<SupportConversation> {
    try {
      await this.sql.query(
        `INSERT INTO support_conversations (id, user_id, status, language, player_turns,
           last_analysis, created_at, updated_at)
         VALUES ($1, $2, 'ACTIVE', $3, 0, '{}'::jsonb, $4, $4)`,
        [
          conversation.id,
          conversation.userId,
          conversation.language,
          conversation.createdAt.toISOString(),
        ],
      );
      return conversation;
    } catch (err) {
      // Une autre requête l'a ouverte entre-temps : c'est la conversation active.
      if (!isPgError(err, PG_UNIQUE_VIOLATION)) throw err;
      const existing = await this.findActive(conversation.userId);
      if (!existing) throw err;
      return existing;
    }
  }

  async close(conversationId: string, now: Date): Promise<void> {
    await this.sql.query(
      `UPDATE support_conversations SET status = 'CLOSED', closed_at = $2, updated_at = $2
       WHERE id = $1 AND status = 'ACTIVE'`,
      [conversationId, now.toISOString()],
    );
  }

  async insertMessage(m: SupportMessage & { idempotencyKey: string | null }): Promise<boolean> {
    const { rowCount } = await this.sql.query(
      `INSERT INTO support_messages (id, conversation_id, role, content, metadata, idempotency_key, created_at)
       VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7)
       ON CONFLICT (conversation_id, idempotency_key) DO NOTHING`,
      [
        m.id,
        m.conversationId,
        m.role,
        m.content,
        JSON.stringify(m.metadata),
        m.idempotencyKey,
        m.createdAt.toISOString(),
      ],
    );
    return rowCount > 0;
  }

  private supportMessageOf(row: {
    id: string;
    conversation_id: string;
    role: 'PLAYER' | 'ASSISTANT';
    content: string;
    metadata: unknown;
    created_at: Date;
  }): SupportMessage {
    return {
      id: row.id,
      conversationId: row.conversation_id,
      role: row.role,
      content: row.content,
      metadata: json(row.metadata),
      createdAt: date(row.created_at),
    };
  }

  async findMessageByKey(conversationId: string, key: string): Promise<SupportMessage | null> {
    const { rows } = await this.sql.query<
      Parameters<PostgresSupportConversationRepository['supportMessageOf']>[0]
    >(
      `SELECT id, conversation_id, role, content, metadata, created_at FROM support_messages
       WHERE conversation_id = $1 AND idempotency_key = $2`,
      [conversationId, key],
    );
    return rows[0] ? this.supportMessageOf(rows[0]) : null;
  }

  async findReplyTo(
    conversationId: string,
    playerMessageId: string,
  ): Promise<SupportMessage | null> {
    const { rows } = await this.sql.query<
      Parameters<PostgresSupportConversationRepository['supportMessageOf']>[0]
    >(
      `SELECT id, conversation_id, role, content, metadata, created_at FROM support_messages
       WHERE conversation_id = $1 AND role = 'ASSISTANT' AND metadata->>'replyTo' = $2`,
      [conversationId, playerMessageId],
    );
    return rows[0] ? this.supportMessageOf(rows[0]) : null;
  }

  async messages(conversationId: string, limit: number): Promise<SupportMessage[]> {
    const { rows } = await this.sql.query<
      Parameters<PostgresSupportConversationRepository['supportMessageOf']>[0]
    >(
      `SELECT * FROM (
         SELECT id, conversation_id, role, content, metadata, created_at, seq FROM support_messages
         WHERE conversation_id = $1 ORDER BY seq DESC LIMIT $2
       ) recent ORDER BY seq`,
      [conversationId, limit],
    );
    return rows.map((row) => this.supportMessageOf(row));
  }

  async recordTurn(
    conversationId: string,
    analysis: Record<string, unknown>,
    language: 'fr' | 'en',
    now: Date,
  ): Promise<void> {
    await this.sql.query(
      `UPDATE support_conversations
       SET player_turns = player_turns + 1, last_analysis = $2::jsonb, language = $3, updated_at = $4
       WHERE id = $1`,
      [conversationId, JSON.stringify(analysis), language, now.toISOString()],
    );
  }
}
