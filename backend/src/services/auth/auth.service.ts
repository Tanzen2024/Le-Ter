import { randomUUID } from 'node:crypto';

import {
  newUserId,
  toPublicUser,
  type PublicUser,
  type User,
  type UserId,
  type UserRole,
} from '../../domain/users/user';
import type { AuthSessionRepository } from '../../repositories/auth-session.repository';
import { DuplicateUserError, type UserRepository } from '../../repositories/user.repository';
import type { Logger } from '../../utils/logger';
import type { LoginInput, RegisterInput } from '../../validators/auth.validators';
import { AccessTokenService, InvalidAccessTokenError } from './access-token.service';
import {
  AccountDisabledError,
  AuthenticationRequiredError,
  InvalidCredentialsError,
  InvalidRefreshTokenError,
  RegistrationConflictError,
} from './auth-errors';
import type { PasswordService } from './password.service';
import { generateRefreshToken, hashRefreshToken, isWellFormedRefreshToken } from './refresh-token';

/** Identité authentifiée d'une requête : issue du JWT vérifié, jamais du client. */
export interface AuthContext {
  userId: UserId;
  role: UserRole;
  sessionId: string;
}

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
}

/** Résultat d'une vérification d'identifiants ; `reason` ne sort jamais vers le client. */
export type CredentialCheck =
  | { ok: true; user: User }
  | {
      ok: false;
      reason: 'unknown_account' | 'invalid_credentials' | 'account_disabled';
      userId?: UserId;
    };

export interface OpenedSession extends TokenPair {
  user: PublicUser;
  sessionId: string;
  startedAt: Date;
}

/** Contexte de journalisation d'un appel (requête HTTP d'origine). */
export interface CallMeta {
  requestId?: string;
}

export interface AuthServiceDependencies {
  users: UserRepository;
  sessions: AuthSessionRepository;
  passwords: PasswordService;
  accessTokens: AccessTokenService;
  refreshTokenTtlSeconds: number;
  logger: Logger;
  clock?: () => Date;
}

/**
 * Authentification (D-029). Ne connaît ni Express ni HTTP ; le moteur de jeu et
 * GameService ne connaissent pas ce service.
 *
 * R-32 : `login` révoque toute session précédente ; une seule session est active.
 * Les logs ne contiennent jamais mot de passe, hash, jeton ni en-tête Authorization.
 */
export class AuthService {
  private readonly clock: () => Date;

  constructor(private readonly deps: AuthServiceDependencies) {
    this.clock = deps.clock ?? (() => new Date());
  }

  async register(input: RegisterInput, meta: CallMeta = {}): Promise<PublicUser> {
    const log = this.deps.logger.child({ requestId: meta.requestId, action: 'REGISTER' });
    const taken = await this.deps.users.findTakenFields(input);
    if (taken.length > 0) {
      log.warn('register rejected', { reason: 'conflict', fields: taken });
      throw new RegistrationConflictError(taken);
    }

    const now = this.clock();
    const user: User = {
      id: newUserId(),
      firstName: input.firstName,
      lastName: input.lastName,
      email: input.email,
      username: input.username,
      phone: input.phone,
      phoneVerified: false,
      passwordHash: await this.deps.passwords.hashPassword(input.password),
      role: 'user',
      status: 'active',
      createdAt: now,
      updatedAt: now,
    };
    try {
      await this.deps.users.insert(user);
    } catch (err) {
      // Inscription concurrente avec les mêmes informations.
      if (err instanceof DuplicateUserError) {
        log.warn('register rejected', { reason: 'conflict', fields: err.fields });
        throw new RegistrationConflictError(err.fields);
      }
      throw err;
    }
    log.info('register succeeded', { userId: user.id });
    return toPublicUser(user);
  }

  async login(input: LoginInput, meta: CallMeta = {}): Promise<TokenPair & { user: PublicUser }> {
    const log = this.deps.logger.child({ requestId: meta.requestId, action: 'LOGIN' });
    const check = await this.verifyCredentials(input);
    if (!check.ok) {
      // Compte inconnu et mauvais mot de passe : même raison journalisée qu'avant.
      const reason = check.reason === 'unknown_account' ? 'invalid_credentials' : check.reason;
      log.warn('login failed', { reason, userId: check.userId });
      throw check.reason === 'account_disabled'
        ? new AccountDisabledError()
        : new InvalidCredentialsError();
    }
    const { user, accessToken, refreshToken } = await this.openSession(check.user, log);
    return { user, accessToken, refreshToken };
  }

  /**
   * Vérifie email et mot de passe SANS ouvrir de session (temps constant si le compte est
   * inconnu). Utilisé par `login` et par la connexion d'administration, qui contrôle le rôle
   * AVANT d'ouvrir une session (une connexion refusée ne révoque pas la session existante).
   */
  async verifyCredentials(input: LoginInput): Promise<CredentialCheck> {
    const user = await this.deps.users.findByEmail(input.email);
    const valid = user
      ? await this.deps.passwords.verifyPassword(input.password, user.passwordHash)
      : await this.deps.passwords.verifyAgainstDummy(input.password);
    if (!user) return { ok: false, reason: 'unknown_account' };
    if (!valid) return { ok: false, reason: 'invalid_credentials', userId: user.id };
    if (user.status !== 'active') return { ok: false, reason: 'account_disabled', userId: user.id };
    return { ok: true, user };
  }

  /**
   * Ouvre la session d'un compte déjà vérifié (R-32 : révoque la précédente). Avec
   * `absoluteLifetimeSeconds`, la session ne peut pas durer au-delà (administration).
   */
  async openSession(
    user: User,
    log = this.deps.logger.child({ action: 'LOGIN' }),
    options: { absoluteLifetimeSeconds?: number } = {},
  ): Promise<OpenedSession> {
    const now = this.clock();
    const sessionId = randomUUID();
    const refresh = generateRefreshToken();
    const sessionExpiresAt =
      options.absoluteLifetimeSeconds === undefined
        ? undefined
        : new Date(now.getTime() + options.absoluteLifetimeSeconds * 1000);
    const refreshExpiry = this.refreshExpiry(now);
    const revoked = await this.deps.sessions.startSession(user.id, {
      id: randomUUID(),
      sessionId,
      tokenHash: refresh.hash,
      createdAt: now,
      expiresAt:
        sessionExpiresAt && sessionExpiresAt < refreshExpiry ? sessionExpiresAt : refreshExpiry,
      ...(sessionExpiresAt && { sessionExpiresAt }),
    });
    if (revoked > 0) {
      log.info('previous session revoked', { userId: user.id, reason: 'new_login', revoked });
    }
    log.info('login succeeded', { userId: user.id, sessionId });
    return {
      user: toPublicUser(user),
      sessionId,
      startedAt: now,
      accessToken: this.deps.accessTokens.sign(
        { userId: user.id, role: user.role, sessionId },
        now,
      ),
      refreshToken: refresh.token,
    };
  }

  async refresh(refreshToken: string, meta: CallMeta = {}): Promise<TokenPair> {
    const log = this.deps.logger.child({ requestId: meta.requestId, action: 'REFRESH' });
    if (!isWellFormedRefreshToken(refreshToken)) {
      log.warn('refresh rejected', { reason: 'malformed' });
      throw new InvalidRefreshTokenError('malformed');
    }
    const now = this.clock();
    const next = generateRefreshToken();
    const result = await this.deps.sessions.rotate(hashRefreshToken(refreshToken), {
      id: randomUUID(),
      tokenHash: next.hash,
      createdAt: now,
      expiresAt: this.refreshExpiry(now),
    });
    if (!result.ok) {
      log.warn('refresh rejected', { reason: result.reason, userId: result.userId });
      throw new InvalidRefreshTokenError(result.reason);
    }
    log.info('refresh succeeded', { userId: result.userId, sessionId: result.sessionId });
    return {
      accessToken: this.deps.accessTokens.sign(
        { userId: result.userId, role: result.role, sessionId: result.sessionId },
        now,
      ),
      refreshToken: next.token,
    };
  }

  /** Révoque la session du jeton. Idempotent : un jeton inconnu ou déjà révoqué est ignoré. */
  async logout(refreshToken: string, meta: CallMeta = {}): Promise<void> {
    const log = this.deps.logger.child({ requestId: meta.requestId, action: 'LOGOUT' });
    if (!isWellFormedRefreshToken(refreshToken)) {
      log.warn('logout ignored', { reason: 'malformed' });
      return;
    }
    const revoked = await this.deps.sessions.revoke(hashRefreshToken(refreshToken), this.clock());
    if (revoked) {
      log.info('logout succeeded', { userId: revoked.userId, sessionId: revoked.sessionId });
    } else {
      log.info('logout ignored', { reason: 'not_active' });
    }
  }

  /**
   * Identité d'un access token : signature et expiration, puis session encore active
   * et compte actif. Une nouvelle connexion (R-32) ou un logout invalide donc tout de
   * suite les access tokens de l'ancienne session, sans attendre leur expiration.
   */
  async authenticate(accessToken: string): Promise<AuthContext> {
    const now = this.clock();
    let claims;
    try {
      claims = this.deps.accessTokens.verify(accessToken, now);
    } catch (err) {
      throw new AuthenticationRequiredError(
        err instanceof InvalidAccessTokenError ? `token_${err.reason}` : 'token_invalid',
      );
    }
    const session = await this.deps.sessions.findActiveSession(
      claims.userId,
      claims.sessionId,
      now,
    );
    if (!session) {
      throw new AuthenticationRequiredError('session_inactive');
    }
    if (session.status !== 'active') {
      throw new AuthenticationRequiredError('account_disabled');
    }
    return { userId: claims.userId, role: session.role, sessionId: claims.sessionId };
  }

  async getCurrentUser(userId: UserId): Promise<PublicUser> {
    const user = await this.deps.users.findById(userId);
    if (!user || user.status !== 'active') {
      throw new AuthenticationRequiredError('user_unavailable');
    }
    return toPublicUser(user);
  }

  private refreshExpiry(now: Date): Date {
    return new Date(now.getTime() + this.deps.refreshTokenTtlSeconds * 1000);
  }
}
