import type { SqlClient, SqlExecutor } from '../database/sql-client';
import type { AdminSession, AdminSessionEndReason, AuditEntry } from '../domain/admin/admin';
import type { UserId } from '../domain/users/user';
import { insertAuditRow } from './admin-audit.repository';
import type { AdminSessionRepository } from './admin-session.repository';

interface Row {
  session_id: string;
  user_id: UserId;
  started_at: Date;
  last_activity_at: Date;
  expires_at: Date;
  ended_at: Date | null;
  end_reason: AdminSessionEndReason | null;
}

const sessionOf = (row: Row): AdminSession => ({
  sessionId: row.session_id,
  userId: row.user_id,
  startedAt: new Date(row.started_at),
  lastActivityAt: new Date(row.last_activity_at),
  expiresAt: new Date(row.expires_at),
  endedAt: row.ended_at ? new Date(row.ended_at) : null,
  endReason: row.end_reason,
});

/**
 * Sessions d'administration dans PostgreSQL. Ordre des verrous identique aux sessions
 * d'authentification (D-029, R-32) : la ligne `users` d'abord, puis les sessions.
 */
export class PostgresAdminSessionRepository implements AdminSessionRepository {
  constructor(private readonly db: SqlClient) {}

  async open(session: AdminSession, audit: AuditEntry): Promise<void> {
    await this.db.transaction(async (tx) => {
      await lockUser(tx, session.userId);
      await tx.query(
        `UPDATE admin_sessions SET ended_at = $2, end_reason = 'REPLACED'
         WHERE user_id = $1 AND ended_at IS NULL`,
        [session.userId, session.startedAt.toISOString()],
      );
      await tx.query(
        `INSERT INTO admin_sessions
           (session_id, user_id, started_at, last_activity_at, expires_at)
         VALUES ($1, $2, $3, $4, $5)`,
        [
          session.sessionId,
          session.userId,
          session.startedAt.toISOString(),
          session.lastActivityAt.toISOString(),
          session.expiresAt.toISOString(),
        ],
      );
      await insertAuditRow(tx, audit);
    });
  }

  async find(sessionId: string): Promise<AdminSession | null> {
    const { rows } = await this.db.query<Row>(
      `SELECT session_id, user_id, started_at, last_activity_at, expires_at, ended_at, end_reason
       FROM admin_sessions WHERE session_id = $1`,
      [sessionId],
    );
    return rows[0] ? sessionOf(rows[0]) : null;
  }

  async touch(sessionId: string, now: Date, minIntervalSeconds: number): Promise<void> {
    await this.db.query(
      `UPDATE admin_sessions SET last_activity_at = $2
       WHERE session_id = $1 AND ended_at IS NULL
         AND last_activity_at <= $2::timestamptz - make_interval(secs => $3)`,
      [sessionId, now.toISOString(), minIntervalSeconds],
    );
  }

  async end(
    session: { sessionId: string; userId: UserId },
    reason: AdminSessionEndReason,
    now: Date,
    audit: AuditEntry,
  ): Promise<boolean> {
    return this.db.transaction(async (tx) => {
      await lockUser(tx, session.userId);
      const { rowCount } = await tx.query(
        `UPDATE admin_sessions SET ended_at = $2, end_reason = $3
         WHERE session_id = $1 AND ended_at IS NULL`,
        [session.sessionId, now.toISOString(), reason],
      );
      if (rowCount === 0) return false;
      // Déconnexion effective : plus aucun jeton de cette session n'est utilisable.
      await tx.query(
        `UPDATE refresh_tokens SET revoked_at = $2, revoked_reason = 'logout'
         WHERE session_id = $1 AND revoked_at IS NULL`,
        [session.sessionId, now.toISOString()],
      );
      await insertAuditRow(tx, audit);
      return true;
    });
  }
}

async function lockUser(tx: SqlExecutor, userId: UserId): Promise<void> {
  await tx.query('SELECT id FROM users WHERE id = $1 FOR UPDATE', [userId]);
}
