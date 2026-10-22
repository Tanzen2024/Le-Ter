import { PG_UNIQUE_VIOLATION, isPgError, type SqlExecutor } from '../database/sql-client';
import type { NewUser, User, UserId, UserRole, UserStatus } from '../domain/users/user';
import { DuplicateUserError, type UniqueUserField, type UserRepository } from './user.repository';

interface UserRow {
  id: string;
  /** `bigint` : renvoyé en texte par `pg`. */
  player_number: string;
  first_name: string;
  last_name: string;
  email: string | null;
  username: string;
  phone: string;
  phone_verified: boolean;
  password_hash: string;
  recovery_code_hash: string | null;
  role: UserRole;
  status: UserStatus;
  created_at: Date;
  updated_at: Date;
}

/** Index uniques de la migration 0002 → champ concerné. */
const UNIQUE_INDEX_FIELDS: Record<string, UniqueUserField> = {
  users_email_key: 'email',
  users_username_key: 'username',
  users_phone_key: 'phone',
};

export class PostgresUserRepository implements UserRepository {
  constructor(private readonly db: SqlExecutor) {}

  async insert(user: NewUser): Promise<User> {
    try {
      // `player_number` : valeur par défaut de la séquence (D-133), jamais fournie ici.
      const { rows } = await this.db.query<UserRow>(
        `INSERT INTO users (id, first_name, last_name, email, username, phone, phone_verified,
           password_hash, role, status, created_at, updated_at, recovery_code_hash,
           recovery_code_created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13,
           CASE WHEN $13::text IS NULL THEN NULL ELSE $11::timestamptz END)
         RETURNING *`,
        [
          user.id,
          user.firstName,
          user.lastName,
          user.email,
          user.username,
          user.phone,
          user.phoneVerified,
          user.passwordHash,
          user.role,
          user.status,
          user.createdAt.toISOString(),
          user.updatedAt.toISOString(),
          user.recoveryCodeHash,
        ],
      );
      return toUser(rows[0]!);
    } catch (err) {
      if (isPgError(err, PG_UNIQUE_VIOLATION)) {
        const constraint = (err as { constraint?: unknown }).constraint;
        const field = typeof constraint === 'string' ? UNIQUE_INDEX_FIELDS[constraint] : undefined;
        throw new DuplicateUserError(field ? [field] : []);
      }
      throw err;
    }
  }

  async findById(id: UserId): Promise<User | null> {
    const { rows } = await this.db.query<UserRow>('SELECT * FROM users WHERE id = $1', [id]);
    return rows[0] ? toUser(rows[0]) : null;
  }

  async findByEmail(email: string): Promise<User | null> {
    const { rows } = await this.db.query<UserRow>('SELECT * FROM users WHERE email = $1', [email]);
    return rows[0] ? toUser(rows[0]) : null;
  }

  async findByPhone(phone: string): Promise<User | null> {
    const { rows } = await this.db.query<UserRow>('SELECT * FROM users WHERE phone = $1', [phone]);
    return rows[0] ? toUser(rows[0]) : null;
  }

  async findTakenFields(candidate: Pick<User, UniqueUserField>): Promise<UniqueUserField[]> {
    // `email = NULL` n'est jamais vrai : un joueur sans email n'entre jamais en conflit.
    const { rows } = await this.db.query<{ email: boolean; username: boolean; phone: boolean }>(
      `SELECT
         EXISTS (SELECT 1 FROM users WHERE email = $1) AS email,
         EXISTS (SELECT 1 FROM users WHERE lower(username) = lower($2)) AS username,
         EXISTS (SELECT 1 FROM users WHERE phone = $3) AS phone`,
      [candidate.email, candidate.username, candidate.phone],
    );
    const taken = rows[0];
    return (['email', 'username', 'phone'] as const).filter((field) => taken?.[field]);
  }

  async updatePasswordHash(
    id: UserId,
    expectedHash: string,
    newHash: string,
    now: Date,
  ): Promise<boolean> {
    const { rowCount } = await this.db.query(
      `UPDATE users SET password_hash = $3, updated_at = $4
       WHERE id = $1 AND password_hash = $2 AND status = 'active'`,
      [id, expectedHash, newHash, now.toISOString()],
    );
    return rowCount === 1;
  }
}

function toUser(row: UserRow): User {
  return {
    id: row.id as UserId,
    playerNumber: Number(row.player_number),
    firstName: row.first_name,
    lastName: row.last_name,
    email: row.email,
    username: row.username,
    phone: row.phone,
    phoneVerified: row.phone_verified,
    passwordHash: row.password_hash,
    hasRecoveryCode: row.recovery_code_hash !== null,
    role: row.role,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
