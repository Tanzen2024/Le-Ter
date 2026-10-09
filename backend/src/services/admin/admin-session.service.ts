import { randomUUID } from 'node:crypto';

import {
  ADMIN_SESSION_POLICY,
  AdminSessionExpiredError,
  AdminSessionRequiredError,
  type AdminSession,
  type AuditEntry,
} from '../../domain/admin/admin';
import type { PublicUser, UserId } from '../../domain/users/user';
import type { AdminAuditRepository } from '../../repositories/admin-audit.repository';
import type { AdminSessionRepository } from '../../repositories/admin-session.repository';
import type { Logger } from '../../utils/logger';
import type { LoginInput } from '../../validators/auth.validators';
import { InvalidCredentialsError } from '../auth/auth-errors';
import type { AuthContext, AuthService, CallMeta } from '../auth/auth.service';

export interface AdminSessionView {
  startedAt: string;
  expiresAt: string;
  lastActivityAt: string;
  idleExpiresAt: string;
  absoluteLifetimeSeconds: number;
  idleTimeoutSeconds: number;
}

export interface AdminLoginResult {
  user: PublicUser;
  accessToken: string;
  refreshToken: string;
  session: AdminSessionView;
}

/**
 * Sessions d'administration (D-061, docs/admin/SECURITY.md).
 *
 * - Connexion : identifiants vérifiés, puis rôle `admin` exigé AVANT d'ouvrir une session
 *   (un compte joueur n'en obtient jamais et sa session mobile n'est pas révoquée). Même
 *   message pour tout refus ; la raison précise n'est que dans le journal d'audit.
 * - Chaque requête /api/admin/* : session ouverte, durée absolue (8 h) et inactivité
 *   (30 min) contrôlées ici, côté serveur. À l'expiration : session terminée, jetons
 *   révoqués (déconnexion effective), audit ADMIN_SESSION_EXPIRED.
 */
export class AdminSessionService {
  private readonly clock: () => Date;

  constructor(
    private readonly deps: {
      auth: AuthService;
      sessions: AdminSessionRepository;
      audit: AdminAuditRepository;
      logger: Logger;
      clock?: () => Date;
    },
  ) {
    this.clock = deps.clock ?? (() => new Date());
  }

  async login(input: LoginInput, meta: CallMeta = {}): Promise<AdminLoginResult> {
    const log = this.deps.logger.child({ requestId: meta.requestId, action: 'ADMIN_LOGIN' });
    const check = await this.deps.auth.verifyCredentials(input);
    const refusal = !check.ok
      ? { reason: check.reason, userId: check.userId }
      : check.user.role !== 'admin'
        ? { reason: 'not_admin', userId: check.user.id }
        : undefined;
    if (refusal || !check.ok) {
      await this.deps.audit.insert(
        this.entry({
          actorId: null,
          action: 'ADMIN_LOGIN_FAILED',
          targetType: 'ADMIN_ACCOUNT',
          targetId: refusal?.userId ?? null,
          outcome: 'FAILURE',
          details: { reason: refusal?.reason ?? 'unknown' },
        }),
      );
      log.warn('admin login refused', { reason: refusal?.reason, userId: refusal?.userId });
      throw new InvalidCredentialsError();
    }

    const opened = await this.deps.auth.openSession(check.user, log, {
      absoluteLifetimeSeconds: ADMIN_SESSION_POLICY.absoluteLifetimeSeconds,
    });
    const session: AdminSession = {
      sessionId: opened.sessionId,
      userId: check.user.id,
      startedAt: opened.startedAt,
      lastActivityAt: opened.startedAt,
      expiresAt: new Date(
        opened.startedAt.getTime() + ADMIN_SESSION_POLICY.absoluteLifetimeSeconds * 1000,
      ),
      endedAt: null,
      endReason: null,
    };
    try {
      await this.deps.sessions.open(
        session,
        this.entry({
          actorId: check.user.id,
          action: 'ADMIN_LOGIN_SUCCEEDED',
          targetType: 'ADMIN_SESSION',
          targetId: session.sessionId,
          details: { expiresAt: session.expiresAt.toISOString() },
          at: session.startedAt,
        }),
      );
    } catch (err) {
      // Jamais de session d'authentification admin sans sa session d'administration.
      await this.deps.auth.logout(opened.refreshToken, meta).catch(() => undefined);
      throw err;
    }
    log.info('admin login succeeded', { userId: check.user.id, sessionId: session.sessionId });
    return {
      user: opened.user,
      accessToken: opened.accessToken,
      refreshToken: opened.refreshToken,
      session: viewOf(session),
    };
  }

  /**
   * Garde de toute requête /api/admin/* (après requireAuth et requireRole) : session
   * d'administration ouverte, non expirée ; l'activité est enregistrée.
   */
  async assertActive(auth: AuthContext): Promise<AdminSession> {
    const session = await this.deps.sessions.find(auth.sessionId);
    if (!session || session.userId !== auth.userId) {
      throw new AdminSessionRequiredError('no_admin_session');
    }
    if (session.endedAt) throw new AdminSessionRequiredError('ended');
    const now = this.clock();
    const expiry = expiryOf(session, now);
    if (expiry) {
      await this.deps.sessions.end(
        session,
        expiry,
        now,
        this.entry({
          actorId: session.userId,
          action: 'ADMIN_SESSION_EXPIRED',
          targetType: 'ADMIN_SESSION',
          targetId: session.sessionId,
          details: { reason: expiry },
          at: now,
        }),
      );
      this.deps.logger.info('admin session expired', {
        userId: session.userId,
        sessionId: session.sessionId,
        reason: expiry,
      });
      throw new AdminSessionExpiredError(expiry);
    }
    await this.deps.sessions.touch(
      session.sessionId,
      now,
      ADMIN_SESSION_POLICY.activityWriteIntervalSeconds,
    );
    return { ...session, lastActivityAt: now };
  }

  /** Déconnexion effective : session terminée, jetons révoqués, audit. Idempotente. */
  async logout(auth: AuthContext): Promise<void> {
    const now = this.clock();
    const ended = await this.deps.sessions.end(
      { sessionId: auth.sessionId, userId: auth.userId },
      'LOGOUT',
      now,
      this.entry({
        actorId: auth.userId,
        action: 'ADMIN_LOGOUT',
        targetType: 'ADMIN_SESSION',
        targetId: auth.sessionId,
        at: now,
      }),
    );
    this.deps.logger.info('admin logout', { userId: auth.userId, ended });
  }

  /** État de la session courante (profil), après `assertActive`. */
  view(session: AdminSession): AdminSessionView {
    return viewOf(session);
  }

  private entry(e: {
    actorId: UserId | null;
    action: AuditEntry['action'];
    targetType: AuditEntry['targetType'];
    targetId: string | null;
    outcome?: AuditEntry['outcome'];
    details?: Record<string, unknown>;
    at?: Date;
  }): AuditEntry {
    return {
      id: randomUUID(),
      actorId: e.actorId,
      action: e.action,
      targetType: e.targetType,
      targetId: e.targetId,
      outcome: e.outcome ?? 'SUCCESS',
      details: e.details ?? {},
      createdAt: e.at ?? this.clock(),
    };
  }
}

function expiryOf(session: AdminSession, now: Date): 'ABSOLUTE_TIMEOUT' | 'IDLE_TIMEOUT' | null {
  if (now.getTime() >= session.expiresAt.getTime()) return 'ABSOLUTE_TIMEOUT';
  const idleMs = ADMIN_SESSION_POLICY.idleTimeoutSeconds * 1000;
  if (now.getTime() - session.lastActivityAt.getTime() >= idleMs) return 'IDLE_TIMEOUT';
  return null;
}

function viewOf(session: AdminSession): AdminSessionView {
  const idleExpires = Math.min(
    session.lastActivityAt.getTime() + ADMIN_SESSION_POLICY.idleTimeoutSeconds * 1000,
    session.expiresAt.getTime(),
  );
  return {
    startedAt: session.startedAt.toISOString(),
    expiresAt: session.expiresAt.toISOString(),
    lastActivityAt: session.lastActivityAt.toISOString(),
    idleExpiresAt: new Date(idleExpires).toISOString(),
    absoluteLifetimeSeconds: ADMIN_SESSION_POLICY.absoluteLifetimeSeconds,
    idleTimeoutSeconds: ADMIN_SESSION_POLICY.idleTimeoutSeconds,
  };
}
