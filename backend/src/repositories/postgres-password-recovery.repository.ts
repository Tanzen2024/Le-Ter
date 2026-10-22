import type { SqlClient, SqlExecutor } from '../database/sql-client';
import type { UserId, UserRole, UserStatus } from '../domain/users/user';
import type {
  CompletedReset,
  NewResetGrant,
  PasswordRecoveryRepository,
  RecoveryLockPolicy,
  RecoveryTarget,
} from './password-recovery.repository';

/** Récupération par code dans PostgreSQL (D-135, migration 0054). */
export class PostgresPasswordRecoveryRepository implements PasswordRecoveryRepository {
  constructor(private readonly db: SqlClient) {}

  findTargetByPhone(phone: string): Promise<RecoveryTarget | null> {
    return this.findTarget('phone', phone);
  }

  findTargetByEmail(email: string): Promise<RecoveryTarget | null> {
    return this.findTarget('email', email);
  }

  private async findTarget(
    column: 'phone' | 'email',
    value: string,
  ): Promise<RecoveryTarget | null> {
    const { rows } = await this.db.query<{
      id: UserId;
      role: UserRole;
      status: UserStatus;
      recovery_code_hash: string | null;
      recovery_locked_until: Date | null;
    }>(
      `SELECT id, role, status, recovery_code_hash, recovery_locked_until
       FROM users WHERE ${column} = $1`,
      [value],
    );
    const row = rows[0];
    return row
      ? {
          userId: row.id,
          role: row.role,
          status: row.status,
          recoveryCodeHash: row.recovery_code_hash,
          lockedUntil: row.recovery_locked_until,
        }
      : null;
  }

  async recordFailure(
    userId: UserId,
    now: Date,
    policy: RecoveryLockPolicy,
  ): Promise<Date | null> {
    // Un seul UPDATE atomique : des essais simultanés sur plusieurs serveurs se cumulent.
    const lockUntil = new Date(now.getTime() + policy.lockMs);
    const { rows } = await this.db.query<{ recovery_locked_until: Date | null; locked: boolean }>(
      `UPDATE users SET
         recovery_locked_until = CASE WHEN recovery_failed_attempts + 1 >= $2
                                      THEN $3::timestamptz ELSE recovery_locked_until END,
         recovery_failed_attempts = CASE WHEN recovery_failed_attempts + 1 >= $2
                                         THEN 0 ELSE recovery_failed_attempts + 1 END
       WHERE id = $1
       RETURNING recovery_locked_until, recovery_locked_until = $3::timestamptz AS locked`,
      [userId, policy.maxFailures, lockUntil.toISOString()],
    );
    return rows[0]?.locked ? lockUntil : null;
  }

  async issueResetGrant(
    userId: UserId,
    expectedHash: string,
    grant: NewResetGrant,
  ): Promise<boolean> {
    return this.db.transaction(async (tx) => {
      const { rows } = await tx.query<{ recovery_code_hash: string | null; status: UserStatus }>(
        'SELECT recovery_code_hash, status FROM users WHERE id = $1 FOR UPDATE',
        [userId],
      );
      const user = rows[0];
      if (!user || user.status !== 'active' || user.recovery_code_hash !== expectedHash) {
        return false;
      }
      await tx.query(
        `UPDATE users SET recovery_failed_attempts = 0, recovery_locked_until = NULL
         WHERE id = $1`,
        [userId],
      );
      // Une seule autorisation ouverte par compte : les précédentes ne servent plus.
      await tx.query(
        `UPDATE password_reset_grants SET used_at = $2
         WHERE user_id = $1 AND used_at IS NULL`,
        [userId, grant.createdAt.toISOString()],
      );
      await tx.query(
        `INSERT INTO password_reset_grants (id, user_id, token_hash, created_at, expires_at)
         VALUES ($1, $2, $3, $4, $5)`,
        [
          grant.id,
          userId,
          grant.tokenHash,
          grant.createdAt.toISOString(),
          grant.expiresAt.toISOString(),
        ],
      );
      return true;
    });
  }

  async completeReset(
    tokenHash: string,
    passwordHash: string,
    newCodeHash: string,
    now: Date,
  ): Promise<CompletedReset | null> {
    return this.db.transaction(async (tx) => {
      const owner = await tx.query<{ user_id: UserId }>(
        'SELECT user_id FROM password_reset_grants WHERE token_hash = $1',
        [tokenHash],
      );
      const userId = owner.rows[0]?.user_id;
      if (!userId) return null;
      // Verrou du compte d'abord (ordre commun à toutes les écritures du compte), puis
      // l'autorisation relue sous verrou : deux envois simultanés n'en consomment qu'un.
      const user = await tx.query<{ status: UserStatus }>(
        'SELECT status FROM users WHERE id = $1 FOR UPDATE',
        [userId],
      );
      if (user.rows[0]?.status !== 'active') return null;
      const grant = await tx.query<{ id: string }>(
        `SELECT id FROM password_reset_grants
         WHERE token_hash = $1 AND used_at IS NULL AND expires_at > $2`,
        [tokenHash, now.toISOString()],
      );
      const grantId = grant.rows[0]?.id;
      if (!grantId) return null;
      await tx.query('UPDATE password_reset_grants SET used_at = $2 WHERE id = $1', [
        grantId,
        now.toISOString(),
      ]);
      await tx.query(
        `UPDATE users SET password_hash = $2, updated_at = $3,
           recovery_code_hash = $4, recovery_code_created_at = $3, recovery_code_used_at = $3,
           recovery_failed_attempts = 0, recovery_locked_until = NULL
         WHERE id = $1`,
        [userId, passwordHash, now.toISOString(), newCodeHash],
      );
      const revoked = await revokeForReset(tx, userId, now);
      return { userId, revokedSessions: revoked };
    });
  }

  async replaceCode(userId: UserId, codeHash: string, now: Date): Promise<boolean> {
    return replaceRecoveryCode(this.db, userId, codeHash, now);
  }
}

/**
 * Remplace le code d'un compte actif (ancien invalidé, blocage levé, autorisations ouvertes
 * annulées). Partagé avec la récupération par l'assistance (transaction de modération).
 */
export async function replaceRecoveryCode(
  db: SqlExecutor,
  userId: UserId,
  codeHash: string,
  now: Date,
): Promise<boolean> {
  const { rowCount } = await db.query(
    `UPDATE users SET recovery_code_hash = $2, recovery_code_created_at = $3,
       recovery_failed_attempts = 0, recovery_locked_until = NULL, updated_at = $3
     WHERE id = $1 AND status = 'active'`,
    [userId, codeHash, now.toISOString()],
  );
  if (rowCount !== 1) return false;
  await db.query(
    `UPDATE password_reset_grants SET used_at = $2 WHERE user_id = $1 AND used_at IS NULL`,
    [userId, now.toISOString()],
  );
  return true;
}

async function revokeForReset(tx: SqlExecutor, userId: UserId, now: Date): Promise<number> {
  const { rowCount } = await tx.query(
    `UPDATE refresh_tokens SET revoked_at = $2, revoked_reason = 'password_reset'
     WHERE user_id = $1 AND revoked_at IS NULL`,
    [userId, now.toISOString()],
  );
  return rowCount;
}
