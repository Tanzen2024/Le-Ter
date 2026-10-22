import { randomUUID } from 'node:crypto';

import {
  newUserId,
  toPublicUser,
  type NewUser,
  type PublicUser,
  type User,
  type UserId,
  type UserRole,
} from '../../domain/users/user';
import type { AuthSessionRepository } from '../../repositories/auth-session.repository';
import type {
  PasswordRecoveryRepository,
  RecoveryLockPolicy,
} from '../../repositories/password-recovery.repository';
import { DuplicateUserError, type UserRepository } from '../../repositories/user.repository';
import type { Logger } from '../../utils/logger';
import type {
  ChangePasswordInput,
  LoginInput,
  RecoveryResetInput,
  RecoveryVerifyInput,
  RegisterInput,
} from '../../validators/auth.validators';
import { AccessTokenService, InvalidAccessTokenError } from './access-token.service';
import {
  AccountDisabledError,
  AccountSuspendedError,
  AuthenticationRequiredError,
  CurrentPasswordIncorrectError,
  InvalidCredentialsError,
  InvalidRefreshTokenError,
  RecoveryFailedError,
  RegistrationConflictError,
  ResetGrantInvalidError,
} from './auth-errors';
import type { PasswordService } from './password.service';
import {
  generateRecoveryCode,
  generateResetToken,
  hashResetToken,
  isWellFormedResetToken,
  normalizeRecoveryCode,
  recoveryCodeSecret,
} from './recovery-code';
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
      reason: 'unknown_account' | 'invalid_credentials' | 'account_disabled' | 'account_suspended';
      userId?: UserId;
      /** Fin de la suspension (`account_suspended`) ; null : indéterminée. */
      suspendedUntil?: Date | null;
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
  /** Récupération par code (D-135). */
  recovery: PasswordRecoveryRepository;
  passwords: PasswordService;
  accessTokens: AccessTokenService;
  refreshTokenTtlSeconds: number;
  logger: Logger;
  clock?: () => Date;
  /** Blocage du compte après des codes refusés (défaut : 5 échecs → 15 min). */
  recoveryLock?: RecoveryLockPolicy;
  /** Durée de l'autorisation de réinitialisation (défaut : 10 min). */
  resetGrantTtlMs?: number;
}

export const DEFAULT_RECOVERY_LOCK: RecoveryLockPolicy = { maxFailures: 5, lockMs: 15 * 60_000 };
export const DEFAULT_RESET_GRANT_TTL_MS = 10 * 60_000;

/** Inscription réussie : le code de récupération en clair n'existe QUE dans cette réponse. */
export interface Registration {
  user: PublicUser;
  recoveryCode: string;
}

export interface ResetGrant {
  resetToken: string;
  expiresAt: string;
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

  /**
   * Inscription d'un joueur : téléphone obligatoire, email facultatif (D-135). Un code de
   * récupération est créé avec le compte : seule son empreinte est enregistrée, le code en
   * clair n'est renvoyé qu'ici, une fois.
   */
  async register(input: RegisterInput, meta: CallMeta = {}): Promise<Registration> {
    const log = this.deps.logger.child({ requestId: meta.requestId, action: 'REGISTER' });
    const taken = await this.deps.users.findTakenFields(input);
    if (taken.length > 0) {
      log.warn('register rejected', { reason: 'conflict', fields: taken });
      throw new RegistrationConflictError(taken);
    }

    const now = this.clock();
    const recoveryCode = generateRecoveryCode();
    const [passwordHash, recoveryCodeHash] = await Promise.all([
      this.deps.passwords.hashPassword(input.password),
      this.deps.passwords.hashPassword(recoveryCodeSecret(recoveryCode)),
    ]);
    const user: NewUser = {
      id: newUserId(),
      firstName: input.firstName,
      lastName: input.lastName,
      email: input.email,
      username: input.username,
      phone: input.phone,
      phoneVerified: false,
      passwordHash,
      recoveryCodeHash,
      role: 'user',
      status: 'active',
      createdAt: now,
      updatedAt: now,
    };
    let created: User;
    try {
      created = await this.deps.users.insert(user);
    } catch (err) {
      // Inscription concurrente avec les mêmes informations.
      if (err instanceof DuplicateUserError) {
        log.warn('register rejected', { reason: 'conflict', fields: err.fields });
        throw new RegistrationConflictError(err.fields);
      }
      throw err;
    }
    log.info('register succeeded', { userId: created.id, withEmail: created.email !== null });
    return { user: toPublicUser(created), recoveryCode };
  }

  async login(input: LoginInput, meta: CallMeta = {}): Promise<TokenPair & { user: PublicUser }> {
    const log = this.deps.logger.child({ requestId: meta.requestId, action: 'LOGIN' });
    const check = await this.verifyCredentials(input);
    if (!check.ok) {
      // Compte inconnu et mauvais mot de passe : même raison journalisée qu'avant.
      const reason = check.reason === 'unknown_account' ? 'invalid_credentials' : check.reason;
      log.warn('login failed', { reason, userId: check.userId });
      if (check.reason === 'account_suspended') {
        throw new AccountSuspendedError(check.suspendedUntil ?? null);
      }
      throw check.reason === 'account_disabled'
        ? new AccountDisabledError()
        : new InvalidCredentialsError(input.phone !== undefined ? 'phone' : 'email');
    }
    const { user, accessToken, refreshToken } = await this.openSession(check.user, log);
    return { user, accessToken, refreshToken };
  }

  /**
   * Vérifie l'identifiant (email ou téléphone, D-135) et le mot de passe SANS ouvrir de
   * session (temps constant si le compte est inconnu). Utilisé par `login` et par la connexion
   * d'administration, qui contrôle le rôle AVANT d'ouvrir une session (une connexion refusée
   * ne révoque pas la session existante).
   */
  async verifyCredentials(input: LoginInput): Promise<CredentialCheck> {
    const user =
      input.phone !== undefined
        ? await this.deps.users.findByPhone(input.phone)
        : await this.deps.users.findByEmail(input.email);
    const valid = user
      ? await this.deps.passwords.verifyPassword(input.password, user.passwordHash)
      : await this.deps.passwords.verifyAgainstDummy(input.password);
    if (!user) return { ok: false, reason: 'unknown_account' };
    if (!valid) return { ok: false, reason: 'invalid_credentials', userId: user.id };
    if (user.status !== 'active') return { ok: false, reason: 'account_disabled', userId: user.id };
    const suspension = await this.deps.sessions.findActiveSuspension(user.id, this.clock());
    if (suspension) {
      return {
        ok: false,
        reason: 'account_suspended',
        userId: user.id,
        suspendedUntil: suspension.endsAt,
      };
    }
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
   * Identité d'un access token : signature et expiration, puis session encore active,
   * compte actif et non suspendu (D-079). Une nouvelle connexion (R-32) ou un logout invalide donc tout de
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
    if (session.suspended) {
      throw new AuthenticationRequiredError('account_suspended');
    }
    return { userId: claims.userId, role: session.role, sessionId: claims.sessionId };
  }

  /**
   * Changement du mot de passe de l'utilisateur AUTHENTIFIÉ (identité du JWT). Le mot de
   * passe actuel est vérifié avec bcrypt ; le nouveau est haché au coût du projet puis
   * écrit dans PostgreSQL seulement si le hash n'a pas changé entre-temps.
   *
   * Sessions : R-32 n'autorise qu'UNE session active, celle de cette requête. Elle est
   * conservée (l'utilisateur n'est pas déconnecté) ; aucune autre session ne peut exister.
   */
  async changePassword(
    userId: UserId,
    input: ChangePasswordInput,
    meta: CallMeta = {},
  ): Promise<void> {
    const log = this.deps.logger.child({ requestId: meta.requestId, action: 'CHANGE_PASSWORD' });
    const user = await this.deps.users.findById(userId);
    if (!user || user.status !== 'active') {
      throw new AuthenticationRequiredError('user_unavailable');
    }
    if (!(await this.deps.passwords.verifyPassword(input.currentPassword, user.passwordHash))) {
      log.warn('password change rejected', { reason: 'invalid_current_password', userId });
      throw new CurrentPasswordIncorrectError();
    }
    const newHash = await this.deps.passwords.hashPassword(input.newPassword);
    const updated = await this.deps.users.updatePasswordHash(
      userId,
      user.passwordHash,
      newHash,
      this.clock(),
    );
    if (!updated) {
      // Changé ou compte désactivé entre la lecture et l'écriture : rien n'est écrit.
      log.warn('password change rejected', { reason: 'concurrent_change', userId });
      throw new CurrentPasswordIncorrectError();
    }
    log.info('password changed', { userId });
  }

  // --- Récupération par code (D-135) ---------------------------------------------------------

  /**
   * Étape « code » de « Mot de passe oublié ? ». Le numéro seul ne prouve rien : le code
   * est comparé (bcrypt) à l'empreinte du compte. Numéro inconnu, compte sans code, inactif
   * ou administrateur, code faux, compte bloqué : MÊME erreur, et une comparaison factice
   * garde la même durée. Chaque code faux est compté en base ; au seuil, blocage temporaire.
   * Succès : autorisation temporaire, à usage unique (seule son empreinte est stockée).
   */
  async verifyRecoveryCode(input: RecoveryVerifyInput, meta: CallMeta = {}): Promise<ResetGrant> {
    const log = this.deps.logger.child({ requestId: meta.requestId, action: 'RECOVERY_VERIFY' });
    const now = this.clock();
    const target =
      input.email !== undefined
        ? await this.deps.recovery.findTargetByEmail(input.email)
        : await this.deps.recovery.findTargetByPhone(input.phone);
    const canonical = normalizeRecoveryCode(input.code);
    const usable =
      target &&
      target.role === 'user' &&
      target.status === 'active' &&
      target.recoveryCodeHash !== null &&
      !(target.lockedUntil && target.lockedUntil > now);
    const valid =
      usable && canonical
        ? await this.deps.passwords.verifyPassword(canonical, target.recoveryCodeHash as string)
        : await this.deps.passwords.verifyAgainstDummy(canonical ?? input.code);
    if (!target) {
      log.warn('recovery rejected', { reason: 'unknown_account' });
      throw new RecoveryFailedError('unknown_account');
    }
    if (!usable) {
      const reason =
        target.lockedUntil && target.lockedUntil > now
          ? 'locked'
          : target.recoveryCodeHash === null
            ? 'no_code'
            : 'not_allowed';
      log.warn('recovery rejected', { reason, userId: target.userId });
      throw new RecoveryFailedError(reason);
    }
    if (!valid) {
      const lockedUntil = await this.deps.recovery.recordFailure(
        target.userId,
        now,
        this.deps.recoveryLock ?? DEFAULT_RECOVERY_LOCK,
      );
      log.warn('recovery rejected', {
        reason: 'invalid_code',
        userId: target.userId,
        ...(lockedUntil && { lockedUntil: lockedUntil.toISOString() }),
      });
      throw new RecoveryFailedError('invalid_code');
    }
    const grant = generateResetToken();
    const expiresAt = new Date(
      now.getTime() + (this.deps.resetGrantTtlMs ?? DEFAULT_RESET_GRANT_TTL_MS),
    );
    const issued = await this.deps.recovery.issueResetGrant(
      target.userId,
      target.recoveryCodeHash as string,
      { id: randomUUID(), tokenHash: grant.hash, createdAt: now, expiresAt },
    );
    if (!issued) {
      // Code remplacé, utilisé ou compte désactivé entre la lecture et l'écriture.
      log.warn('recovery rejected', { reason: 'concurrent_change', userId: target.userId });
      throw new RecoveryFailedError('concurrent_change');
    }
    log.info('recovery code accepted', { userId: target.userId });
    return { resetToken: grant.token, expiresAt: expiresAt.toISOString() };
  }

  /**
   * Étape « nouveau mot de passe » : l'autorisation est consommée, le mot de passe remplacé,
   * l'ancien code invalidé et remplacé par un NOUVEAU code (renvoyé une seule fois), et toutes
   * les sessions du compte sont fermées. Une autorisation absente, expirée ou déjà utilisée
   * est refusée.
   */
  async resetPassword(
    input: RecoveryResetInput,
    meta: CallMeta = {},
  ): Promise<{ recoveryCode: string }> {
    const log = this.deps.logger.child({ requestId: meta.requestId, action: 'RECOVERY_RESET' });
    if (!isWellFormedResetToken(input.resetToken)) {
      log.warn('password reset rejected', { reason: 'malformed' });
      throw new ResetGrantInvalidError();
    }
    const recoveryCode = generateRecoveryCode();
    const [passwordHash, codeHash] = await Promise.all([
      this.deps.passwords.hashPassword(input.newPassword),
      this.deps.passwords.hashPassword(recoveryCodeSecret(recoveryCode)),
    ]);
    const done = await this.deps.recovery.completeReset(
      hashResetToken(input.resetToken),
      passwordHash,
      codeHash,
      this.clock(),
    );
    if (!done) {
      log.warn('password reset rejected', { reason: 'invalid_grant' });
      throw new ResetGrantInvalidError();
    }
    log.info('password reset', { userId: done.userId, revokedSessions: done.revokedSessions });
    return { recoveryCode };
  }

  /**
   * Nouveau code de récupération pour le joueur CONNECTÉ (Profil, D-135), après vérification
   * de son mot de passe actuel. L'ancien code est invalidé ; le nouveau n'est renvoyé qu'ici.
   */
  async regenerateRecoveryCode(
    userId: UserId,
    currentPassword: string,
    meta: CallMeta = {},
  ): Promise<{ recoveryCode: string }> {
    const log = this.deps.logger.child({ requestId: meta.requestId, action: 'RECOVERY_CODE' });
    const user = await this.deps.users.findById(userId);
    if (!user || user.status !== 'active') {
      throw new AuthenticationRequiredError('user_unavailable');
    }
    if (!(await this.deps.passwords.verifyPassword(currentPassword, user.passwordHash))) {
      log.warn('recovery code rejected', { reason: 'invalid_current_password', userId });
      throw new CurrentPasswordIncorrectError();
    }
    const recoveryCode = generateRecoveryCode();
    const codeHash = await this.deps.passwords.hashPassword(recoveryCodeSecret(recoveryCode));
    if (!(await this.deps.recovery.replaceCode(userId, codeHash, this.clock()))) {
      throw new AuthenticationRequiredError('user_unavailable');
    }
    log.info('recovery code regenerated', { userId });
    return { recoveryCode };
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
