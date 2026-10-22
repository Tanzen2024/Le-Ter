import type { SqlClient, SqlExecutor } from '../database/sql-client';
import type { AuditEntry } from '../domain/admin/admin';
import type {
  AdminNote,
  RestrictionKind,
  Sanction,
  SanctionKind,
} from '../domain/admin/moderation';
import type { UserId, UserRole, UserStatus } from '../domain/users/user';
import { insertAuditRow } from './admin-audit.repository';
import type { AdminRevocationReason } from './auth-session.repository';
import type {
  AccountSecurity,
  ModerationPage,
  ModerationRepository,
  ModerationTx,
  NewAdminNote,
  NewSanction,
} from './moderation.repository';
import { revokeUserSessions } from './postgres-auth-session.repository';
import { replaceRecoveryCode } from './postgres-password-recovery.repository';
import { activeSanctionSql } from './user-sanctions.sql';

interface SanctionRow {
  id: string;
  user_id: string;
  kind: SanctionKind;
  reason: string;
  comment: string | null;
  player_message: string | null;
  notification_id: string | null;
  starts_at: Date;
  ends_at: Date | null;
  created_by: string;
  created_by_username: string | null;
  created_at: Date;
  lifted_at: Date | null;
  lifted_by: string | null;
  lifted_by_username: string | null;
  lift_reason: string | null;
}

const SANCTION_SELECT = `
  SELECT s.id, s.user_id, s.kind, s.reason, s.comment, s.player_message, s.notification_id,
         s.starts_at, s.ends_at, s.created_by, c.username AS created_by_username, s.created_at,
         s.lifted_at, s.lifted_by, l.username AS lifted_by_username, s.lift_reason
  FROM user_sanctions s
  JOIN users c ON c.id = s.created_by
  LEFT JOIN users l ON l.id = s.lifted_by`;

const date = (value: Date | string | null) => (value === null ? null : new Date(value));

function sanctionOf(row: SanctionRow): Sanction {
  return {
    id: row.id,
    userId: row.user_id as UserId,
    kind: row.kind,
    reason: row.reason,
    comment: row.comment,
    playerMessage: row.player_message,
    notificationId: row.notification_id,
    startsAt: new Date(row.starts_at),
    endsAt: date(row.ends_at),
    createdBy: row.created_by as UserId,
    createdByUsername: row.created_by_username,
    createdAt: new Date(row.created_at),
    liftedAt: date(row.lifted_at),
    liftedBy: row.lifted_by as UserId | null,
    liftedByUsername: row.lifted_by_username,
    liftReason: row.lift_reason,
  };
}

interface NoteRow {
  id: string;
  user_id: string;
  author_id: string;
  author_username: string | null;
  body: string;
  created_at: Date;
  deleted_at: Date | null;
  deleted_by: string | null;
  deleted_by_username: string | null;
  delete_reason: string | null;
}

const NOTE_SELECT = `
  SELECT n.id, n.user_id, n.author_id, a.username AS author_username, n.body, n.created_at,
         n.deleted_at, n.deleted_by, d.username AS deleted_by_username, n.delete_reason
  FROM user_admin_notes n
  JOIN users a ON a.id = n.author_id
  LEFT JOIN users d ON d.id = n.deleted_by`;

function noteOf(row: NoteRow): AdminNote {
  return {
    id: row.id,
    userId: row.user_id as UserId,
    authorId: row.author_id as UserId,
    authorUsername: row.author_username,
    body: row.body,
    createdAt: new Date(row.created_at),
    deletedAt: date(row.deleted_at),
    deletedBy: row.deleted_by as UserId | null,
    deletedByUsername: row.deleted_by_username,
    deleteReason: row.delete_reason,
  };
}

async function findActive(
  db: SqlExecutor,
  userId: UserId,
  kind: RestrictionKind,
  now: Date,
): Promise<Sanction | null> {
  const { rows } = await db.query<SanctionRow>(
    `${SANCTION_SELECT}
     WHERE s.user_id = $1 AND s.kind = $2 AND s.lifted_at IS NULL
       AND (s.ends_at IS NULL OR s.ends_at > $3)
     ORDER BY s.created_at DESC, s.id DESC LIMIT 1`,
    [userId, kind, now.toISOString()],
  );
  return rows[0] ? sanctionOf(rows[0]) : null;
}

class PostgresModerationTx implements ModerationTx {
  constructor(private readonly tx: SqlExecutor) {}

  async lockAccessibleAdmins(now: Date): Promise<UserId[]> {
    // Verrou de TOUS les comptes admin dans un ordre fixe (pas d'interblocage), puis filtre.
    const { rows } = await this.tx.query<{ id: string; accessible: boolean }>(
      `SELECT u.id,
         (u.status = 'active' AND NOT ${activeSanctionSql('u.id', 'SUSPENSION', '$1')})
           AS accessible
       FROM users u WHERE u.role = 'admin' ORDER BY u.id FOR UPDATE`,
      [now.toISOString()],
    );
    return rows.filter((r) => r.accessible).map((r) => r.id as UserId);
  }

  async lockUser(userId: UserId) {
    const { rows } = await this.tx.query<{ role: UserRole; status: UserStatus }>(
      'SELECT role, status FROM users WHERE id = $1 FOR UPDATE',
      [userId],
    );
    return rows[0] ?? null;
  }

  async setStatus(userId: UserId, status: UserStatus, now: Date): Promise<void> {
    await this.tx.query('UPDATE users SET status = $2, updated_at = $3 WHERE id = $1', [
      userId,
      status,
      now.toISOString(),
    ]);
  }

  replaceRecoveryCode(userId: UserId, codeHash: string, now: Date): Promise<boolean> {
    return replaceRecoveryCode(this.tx, userId, codeHash, now);
  }

  revokeSessions(userId: UserId, now: Date, reason: AdminRevocationReason): Promise<number> {
    return revokeUserSessions(this.tx, userId, now, reason);
  }

  findActive(userId: UserId, kind: RestrictionKind, now: Date): Promise<Sanction | null> {
    return findActive(this.tx, userId, kind, now);
  }

  async insertSanction(s: NewSanction): Promise<void> {
    await this.tx.query(
      `INSERT INTO user_sanctions
         (id, user_id, kind, reason, comment, player_message, notification_id, starts_at,
          ends_at, created_by, created_at, idempotency_key)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
      [
        s.id,
        s.userId,
        s.kind,
        s.reason,
        s.comment,
        s.playerMessage,
        s.notificationId,
        s.startsAt.toISOString(),
        s.endsAt?.toISOString() ?? null,
        s.createdBy,
        s.createdAt.toISOString(),
        s.idempotencyKey,
      ],
    );
  }

  async liftSanction(id: string, liftedBy: UserId, reason: string, now: Date): Promise<void> {
    await this.tx.query(
      `UPDATE user_sanctions SET lifted_at = $2, lifted_by = $3, lift_reason = $4
       WHERE id = $1 AND lifted_at IS NULL`,
      [id, now.toISOString(), liftedBy, reason],
    );
  }

  async insertWarningNotification(input: {
    id: string;
    userId: UserId;
    warningId: string;
    message: string;
    createdAt: Date;
  }): Promise<void> {
    await this.tx.query(
      `INSERT INTO notifications (id, user_id, type, payload, dedupe_key, created_at)
       VALUES ($1, $2, 'MODERATION_WARNING', $3::jsonb, $4, $5)`,
      [
        input.id,
        input.userId,
        JSON.stringify({ message: input.message, warningId: input.warningId }),
        `moderation-warning:${input.warningId}`,
        input.createdAt.toISOString(),
      ],
    );
  }

  async insertNote(note: NewAdminNote): Promise<void> {
    await this.tx.query(
      `INSERT INTO user_admin_notes (id, user_id, author_id, body, created_at, idempotency_key)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        note.id,
        note.userId,
        note.authorId,
        note.body,
        note.createdAt.toISOString(),
        note.idempotencyKey,
      ],
    );
  }

  async findNote(userId: UserId, noteId: string): Promise<AdminNote | null> {
    const { rows } = await this.tx.query<NoteRow>(
      `${NOTE_SELECT} WHERE n.id = $1 AND n.user_id = $2 FOR UPDATE OF n`,
      [noteId, userId],
    );
    return rows[0] ? noteOf(rows[0]) : null;
  }

  async deleteNote(noteId: string, deletedBy: UserId, reason: string, now: Date): Promise<void> {
    await this.tx.query(
      `UPDATE user_admin_notes SET deleted_at = $2, deleted_by = $3, delete_reason = $4
       WHERE id = $1 AND deleted_at IS NULL`,
      [noteId, now.toISOString(), deletedBy, reason],
    );
  }

  audit(entry: AuditEntry): Promise<void> {
    return insertAuditRow(this.tx, entry);
  }
}

/** Modération des joueurs (D-079) sur PostgreSQL, requêtes paramétrées uniquement. */
export class PostgresModerationRepository implements ModerationRepository {
  constructor(private readonly db: SqlClient) {}

  transaction<T>(work: (tx: ModerationTx) => Promise<T>): Promise<T> {
    return this.db.transaction((tx) => work(new PostgresModerationTx(tx)));
  }

  async userExists(userId: UserId): Promise<boolean> {
    const { rows } = await this.db.query('SELECT 1 FROM users WHERE id = $1', [userId]);
    return rows.length > 0;
  }

  findActive(userId: UserId, kind: RestrictionKind, now: Date): Promise<Sanction | null> {
    return findActive(this.db, userId, kind, now);
  }

  async findSanctionByKey(idempotencyKey: string): Promise<Sanction | null> {
    const { rows } = await this.db.query<SanctionRow>(
      `${SANCTION_SELECT} WHERE s.idempotency_key = $1`,
      [idempotencyKey],
    );
    return rows[0] ? sanctionOf(rows[0]) : null;
  }

  async findNoteByKey(idempotencyKey: string): Promise<AdminNote | null> {
    const { rows } = await this.db.query<NoteRow>(`${NOTE_SELECT} WHERE n.idempotency_key = $1`, [
      idempotencyKey,
    ]);
    return rows[0] ? noteOf(rows[0]) : null;
  }

  async security(userId: UserId, now: Date): Promise<AccountSecurity> {
    // Dates et compte seulement : aucun jeton, aucune empreinte ne sort de cette requête.
    const { rows } = await this.db.query<{
      last_login_at: Date | null;
      last_activity_at: Date | null;
      active_sessions: number;
    }>(
      `SELECT
         (SELECT max(started) FROM (SELECT min(t.created_at) AS started FROM refresh_tokens t
            WHERE t.user_id = $1 GROUP BY t.session_id) s) AS last_login_at,
         (SELECT max(t.created_at) FROM refresh_tokens t WHERE t.user_id = $1)
           AS last_activity_at,
         (SELECT count(*) FROM refresh_tokens t
           WHERE t.user_id = $1 AND t.revoked_at IS NULL AND t.expires_at > $2)::int
           AS active_sessions`,
      [userId, now.toISOString()],
    );
    const row = rows[0];
    return {
      lastLoginAt: date(row?.last_login_at ?? null),
      lastSessionActivityAt: date(row?.last_activity_at ?? null),
      activeSessions: Number(row?.active_sessions ?? 0),
    };
  }

  async listSanctions(userId: UserId, page: ModerationPage) {
    const count = await this.db.query<{ n: number }>(
      'SELECT count(*)::int AS n FROM user_sanctions WHERE user_id = $1',
      [userId],
    );
    const { rows } = await this.db.query<SanctionRow>(
      `${SANCTION_SELECT} WHERE s.user_id = $1
       ORDER BY s.created_at DESC, s.id DESC LIMIT $2 OFFSET $3`,
      [userId, page.limit, (page.page - 1) * page.limit],
    );
    return { total: count.rows[0]?.n ?? 0, items: rows.map(sanctionOf) };
  }

  async listNotes(userId: UserId, page: ModerationPage) {
    const count = await this.db.query<{ n: number }>(
      'SELECT count(*)::int AS n FROM user_admin_notes WHERE user_id = $1',
      [userId],
    );
    const { rows } = await this.db.query<NoteRow>(
      `${NOTE_SELECT} WHERE n.user_id = $1
       ORDER BY n.created_at DESC, n.id DESC LIMIT $2 OFFSET $3`,
      [userId, page.limit, (page.page - 1) * page.limit],
    );
    return { total: count.rows[0]?.n ?? 0, items: rows.map(noteOf) };
  }
}
