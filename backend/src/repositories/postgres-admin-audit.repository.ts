import type { SqlClient } from '../database/sql-client';
import type { AuditEntry } from '../domain/admin/admin';
import {
  auditEntryOf,
  insertAuditRow,
  type AdminAuditRepository,
  type AuditListItem,
  type AuditListQuery,
  type AuditRow,
} from './admin-audit.repository';

/** Journal d'audit dans PostgreSQL. Aucune méthode de modification ni de suppression. */
export class PostgresAdminAuditRepository implements AdminAuditRepository {
  constructor(private readonly db: SqlClient) {}

  insert(entry: AuditEntry): Promise<void> {
    return insertAuditRow(this.db, entry);
  }

  async list(query: AuditListQuery): Promise<{ total: number; items: AuditListItem[] }> {
    const where: string[] = [];
    const params: unknown[] = [];
    const add = (sql: string, value: unknown) => {
      params.push(value);
      where.push(sql.replace('?', `$${params.length}`));
    };
    if (query.action) add('a.action = ?', query.action);
    if (query.outcome) add('a.outcome = ?', query.outcome);
    if (query.actorId) add('a.actor_id = ?', query.actorId);
    if (query.targetType) add('a.target_type = ?', query.targetType);
    if (query.targetId) add('a.target_id = ?', query.targetId);
    if (query.from) add('a.created_at >= ?', query.from.toISOString());
    if (query.to) add('a.created_at < ?', query.to.toISOString());
    const clause = where.length > 0 ? `WHERE ${where.join(' AND ')}` : '';

    const count = await this.db.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM admin_audit_log a ${clause}`,
      params,
    );
    params.push(query.limit, (query.page - 1) * query.limit);
    const { rows } = await this.db.query<AuditRow & { actor_username: string | null }>(
      `SELECT a.id, a.actor_id, a.action, a.target_type, a.target_id, a.outcome, a.details,
              a.created_at, u.username AS actor_username
       FROM admin_audit_log a LEFT JOIN users u ON u.id = a.actor_id
       ${clause}
       ORDER BY a.created_at DESC, a.id DESC
       LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params,
    );
    return {
      total: count.rows[0]?.n ?? 0,
      items: rows.map((row) => ({ ...auditEntryOf(row), actorUsername: row.actor_username })),
    };
  }

  async findVerification(idempotencyKey: string): Promise<AuditEntry | null> {
    const { rows } = await this.db.query<AuditRow>(
      `SELECT id, actor_id, action, target_type, target_id, outcome, details, created_at
       FROM admin_audit_log
       WHERE action = 'PAYMENT_VERIFICATION_REQUESTED' AND details ->> 'idempotencyKey' = $1
       ORDER BY created_at DESC LIMIT 1`,
      [idempotencyKey],
    );
    return rows[0] ? auditEntryOf(rows[0]) : null;
  }
}
