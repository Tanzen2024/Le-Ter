import type { SqlClient } from '../../database/sql-client';
import { PostgresAuthSessionRepository } from '../../repositories/postgres-auth-session.repository';
import { PostgresPasswordRecoveryRepository } from '../../repositories/postgres-password-recovery.repository';
import { PostgresReferralRepository } from '../../repositories/postgres-referral.repository';
import { PostgresUserRepository } from '../../repositories/postgres-user.repository';
import type { Logger } from '../../utils/logger';
import { AccessTokenService } from './access-token.service';
import { AuthService } from './auth.service';
import { DEFAULT_BCRYPT_COST, PasswordService } from './password.service';

export interface AuthServiceConfig {
  jwtSecret: string;
  accessTokenTtlSeconds: number;
  refreshTokenTtlSeconds: number;
  /** Coût bcrypt ; les tests le réduisent pour rester rapides. */
  bcryptCost?: number;
  clock?: () => Date;
}

/** Assemble AuthService sur PostgreSQL (source de vérité ; Redis n'est pas utilisé). */
export function createAuthService(sql: SqlClient, config: AuthServiceConfig, logger: Logger) {
  return new AuthService({
    users: new PostgresUserRepository(sql),
    sessions: new PostgresAuthSessionRepository(sql),
    recovery: new PostgresPasswordRecoveryRepository(sql),
    // Parrainage (D-161) : attribution écrite avec le compte, dans la même transaction.
    referrals: new PostgresReferralRepository(sql),
    passwords: new PasswordService(config.bcryptCost ?? DEFAULT_BCRYPT_COST),
    accessTokens: new AccessTokenService(config.jwtSecret, config.accessTokenTtlSeconds),
    refreshTokenTtlSeconds: config.refreshTokenTtlSeconds,
    logger,
    clock: config.clock,
  });
}
