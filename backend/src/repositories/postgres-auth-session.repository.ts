import type { SqlClient, SqlExecutor } from '../database/sql-client';
import type { UserId, UserRole, UserStatus } from '../domain/users/user';
import type {
  ActiveAuthSession,
  NewRefreshToken,
  RotationResult,
  AuthSessionRepository,
} from './auth-session.repository';

/**
 * Sessions dans PostgreSQL (D-029). Concurrence :
 *
 * - chaque opération qui crée ou révoque un jeton commence par verrouiller la ligne
 *   `users` de l'utilisateur (`SELECT … FOR UPDATE`) : connexions, rotations et
 *   déconnexions d'un même utilisateur sont exécutées l'une après l'autre, quel que
 *   soit le nombre d'instances du backend ; celles d'utilisateurs différents ne
 *   s'attendent pas ;
 * - sous READ COMMITTED, le jeton est relu APRÈS le verrou : une rotation concurrente
 *   voit le jeton déjà révoqué et échoue ;
 * - l'index unique partiel `refresh_tokens_one_active_per_user` garantit en dernier
 *   recours qu'il n'existe jamais deux jetons actifs pour un utilisateur.
 */
export class PostgresAuthSessionRepository implements AuthSessionRepository {
  constructor(private readonly db: SqlClient) {}

  async startSession(userId: UserId, token: NewRefreshToken): Promise<number> {
    return this.db.transaction(async (tx) => {
      await lockUser(tx, userId);
      const { rowCount } = await tx.query(
        `UPDATE refresh_tokens SET revoked_at = $2, revoked_reason = 'new_login'
         WHERE user_id = $1 AND revoked_at IS NULL`,
        [userId, token.createdAt.toISOString()],
      );
      await insertToken(tx, userId, token);
      return rowCount;
    });
  }

  async rotate(
    tokenHash: string,
    next: Omit<NewRefreshToken, 'sessionId' | 'sessionExpiresAt'>,
  ): Promise<RotationResult> {
    return this.db.transaction(async (tx) => {
      const owner = await tx.query<{ user_id: UserId }>(
        'SELECT user_id FROM refresh_tokens WHERE token_hash = $1',
        [tokenHash],
      );
      const userId = owner.rows[0]?.user_id;
      if (!userId) {
        return { ok: false, reason: 'unknown' };
      }
      const user = await lockUser(tx, userId);

      // Relu sous verrou : reflète une rotation ou une connexion concurrente.
      const { rows } = await tx.query<{
        id: string;
        session_id: string;
        expires_at: Date;
        revoked_at: Date | null;
        session_expires_at: Date | null;
      }>(
        `SELECT id, session_id, expires_at, revoked_at, session_expires_at
         FROM refresh_tokens WHERE token_hash = $1`,
        [tokenHash],
      );
      const current = rows[0];
      if (!current || current.revoked_at) {
        return { ok: false, reason: 'revoked', userId };
      }
      if (current.expires_at.getTime() <= next.createdAt.getTime()) {
        return { ok: false, reason: 'expired', userId };
      }
      if (!user || user.status !== 'active') {
        return { ok: false, reason: 'account_disabled', userId };
      }

      await tx.query(
        `UPDATE refresh_tokens SET revoked_at = $2, revoked_reason = 'rotated' WHERE id = $1`,
        [current.id, next.createdAt.toISOString()],
      );
      // Session bornée (administration) : le nouveau jeton n'expire jamais après la borne.
      const sessionExpiresAt = current.session_expires_at ?? undefined;
      const expiresAt =
        sessionExpiresAt && sessionExpiresAt < next.expiresAt ? sessionExpiresAt : next.expiresAt;
      await insertToken(tx, userId, {
        ...next,
        expiresAt,
        sessionId: current.session_id,
        ...(sessionExpiresAt && { sessionExpiresAt }),
      });
      return { ok: true, userId, role: user.role, sessionId: current.session_id };
    });
  }

  async revoke(
    tokenHash: string,
    now: Date,
  ): Promise<{ userId: UserId; sessionId: string } | null> {
    return this.db.transaction(async (tx) => {
      const owner = await tx.query<{ user_id: UserId }>(
        'SELECT user_id FROM refresh_tokens WHERE token_hash = $1',
        [tokenHash],
      );
      const userId = owner.rows[0]?.user_id;
      if (!userId) {
        return null;
      }
      await lockUser(tx, userId);
      const { rows } = await tx.query<{ session_id: string }>(
        `UPDATE refresh_tokens SET revoked_at = $2, revoked_reason = 'logout'
         WHERE token_hash = $1 AND revoked_at IS NULL
         RETURNING session_id`,
        [tokenHash, now.toISOString()],
      );
      const revoked = rows[0];
      return revoked ? { userId, sessionId: revoked.session_id } : null;
    });
  }

  async findActiveSession(
    userId: UserId,
    sessionId: string,
    now: Date,
  ): Promise<ActiveAuthSession | null> {
    const { rows } = await this.db.query<{ role: UserRole; status: UserStatus }>(
      `SELECT u.role, u.status
       FROM refresh_tokens t JOIN users u ON u.id = t.user_id
       WHERE t.user_id = $1 AND t.session_id = $2
         AND t.revoked_at IS NULL AND t.expires_at > $3`,
      [userId, sessionId, now.toISOString()],
    );
    return rows[0] ?? null;
  }
}

/** Verrou par utilisateur : sérialise toutes les opérations de session de ce compte. */
async function lockUser(
  tx: SqlExecutor,
  userId: UserId,
): Promise<{ role: UserRole; status: UserStatus } | undefined> {
  const { rows } = await tx.query<{ role: UserRole; status: UserStatus }>(
    'SELECT role, status FROM users WHERE id = $1 FOR UPDATE',
    [userId],
  );
  return rows[0];
}

async function insertToken(tx: SqlExecutor, userId: UserId, token: NewRefreshToken): Promise<void> {
  await tx.query(
    `INSERT INTO refresh_tokens (id, user_id, session_id, token_hash, created_at, expires_at,
                                 session_expires_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [
      token.id,
      userId,
      token.sessionId,
      token.tokenHash,
      token.createdAt.toISOString(),
      token.expiresAt.toISOString(),
      token.sessionExpiresAt?.toISOString() ?? null,
    ],
  );
}
