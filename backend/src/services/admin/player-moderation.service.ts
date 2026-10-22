import { randomUUID } from 'node:crypto';

import {
  AdminIdempotencyConflictError,
  AdminResourceNotFoundError,
  type AuditAction,
  type AuditEntry,
} from '../../domain/admin/admin';
import {
  AdminNoteNotFoundError,
  MODERATION_LIMITS,
  ModerationConflictError,
  ModerationForbiddenError,
  sanctionState,
  type AdminNote,
  type RestrictionKind,
  type Sanction,
} from '../../domain/admin/moderation';
import type { UserId } from '../../domain/users/user';
import { isPgError, PG_UNIQUE_VIOLATION } from '../../database/sql-client';
import type { AdminAuditRepository } from '../../repositories/admin-audit.repository';
import type {
  ModerationPage,
  ModerationRepository,
  ModerationTx,
} from '../../repositories/moderation.repository';
import type { Logger } from '../../utils/logger';
import { ValidationError } from '../../validators/validation-error';
import type { PasswordService } from '../auth/password.service';
import { generateRecoveryCode, recoveryCodeSecret } from '../auth/recovery-code';

export interface RestrictionInput {
  reason: string;
  comment?: string;
  /** Fin de la mesure ; absente : durée indéterminée (toujours levable). */
  endsAt?: Date;
}

export interface WarningInput {
  reason: string;
  /** Message visible par le joueur ; absent : avertissement enregistré seulement. */
  playerMessage?: string;
  comment?: string;
}

const iso = (value: Date | null) => (value ? value.toISOString() : null);

/** Vue administrative d'une mesure ; `state` est calculé à l'heure du serveur. */
export function sanctionView(s: Sanction, now: Date) {
  return {
    id: s.id,
    kind: s.kind,
    state: sanctionState(s, now),
    reason: s.reason,
    comment: s.comment,
    playerMessage: s.playerMessage,
    /** Avertissement : notification enregistrée dans l'application du joueur. */
    delivered: s.kind === 'WARNING' ? s.notificationId !== null : null,
    startsAt: iso(s.startsAt),
    endsAt: iso(s.endsAt),
    createdBy: { id: s.createdBy, username: s.createdByUsername },
    createdAt: iso(s.createdAt),
    lifted: s.liftedAt
      ? {
          at: iso(s.liftedAt),
          by: { id: s.liftedBy, username: s.liftedByUsername },
          reason: s.liftReason,
        }
      : null,
  };
}

export function noteView(n: AdminNote) {
  return {
    id: n.id,
    // Note supprimée : le texte n'est plus renvoyé ; la trace (qui, quand, pourquoi) reste.
    body: n.deletedAt ? null : n.body,
    author: { id: n.authorId, username: n.authorUsername },
    createdAt: iso(n.createdAt),
    deleted: n.deletedAt
      ? {
          at: iso(n.deletedAt),
          by: { id: n.deletedBy, username: n.deletedByUsername },
          reason: n.deleteReason,
        }
      : null,
  };
}

/**
 * Gestion des comptes et modération des joueurs (D-079). L'administrateur est TOUJOURS
 * l'appelant authentifié (`actorId`, issu du JWT) : aucun identifiant d'auteur n'est lu dans
 * la requête. Chaque action réussie écrit sa ligne `admin_audit_log` dans SA transaction ;
 * un refus par une règle de protection est audité en échec.
 *
 * Aucune méthode ne touche une partie, un solde, une transaction ni `platform_ledger`. Une
 * partie en cours d'un joueur suspendu ou désactivé continue comme après une déconnexion
 * (tours joués à l'échéance de 20 s, règlement inchangé, départ automatique ensuite).
 */
export class PlayerModerationService {
  private readonly clock: () => Date;

  constructor(
    private readonly deps: {
      repository: ModerationRepository;
      audit: AdminAuditRepository;
      logger: Logger;
      /** Hachage du code de récupération (bcrypt, PasswordService), comme à l'inscription. */
      passwords: PasswordService;
      clock?: () => Date;
    },
  ) {
    this.clock = deps.clock ?? (() => new Date());
  }

  // --- Lecture --------------------------------------------------------------------------------

  /** 404 USER_NOT_FOUND pour un identifiant inconnu, avant toute lecture. */
  async requireUser(userId: UserId): Promise<void> {
    if (!(await this.deps.repository.userExists(userId))) {
      throw new AdminResourceNotFoundError('USER');
    }
  }

  async overview(userId: UserId, actorId: UserId) {
    await this.requireUser(userId);
    const now = this.clock();
    const [suspension, chat, security] = await Promise.all([
      this.deps.repository.findActive(userId, 'SUSPENSION', now),
      this.deps.repository.findActive(userId, 'CHAT_RESTRICTION', now),
      this.deps.repository.security(userId, now),
    ]);
    return {
      serverTime: iso(now),
      suspension: suspension ? sanctionView(suspension, now) : null,
      chatRestriction: chat ? sanctionView(chat, now) : null,
      security: {
        lastLoginAt: iso(security.lastLoginAt),
        lastSessionActivityAt: iso(security.lastSessionActivityAt),
        activeSessions: security.activeSessions,
      },
      isSelf: userId === actorId,
      limits: MODERATION_LIMITS,
    };
  }

  async sanctions(userId: UserId, page: ModerationPage) {
    await this.requireUser(userId);
    const now = this.clock();
    const { total, items } = await this.deps.repository.listSanctions(userId, page);
    return { ...page, total, items: items.map((s) => sanctionView(s, now)) };
  }

  async notes(userId: UserId, page: ModerationPage) {
    await this.requireUser(userId);
    const { total, items } = await this.deps.repository.listNotes(userId, page);
    return { ...page, total, items: items.map(noteView) };
  }

  // --- Compte ---------------------------------------------------------------------------------

  /**
   * Active ou désactive le compte (`users.status`). Idempotent : un compte déjà dans l'état
   * demandé n'est pas réécrit (`changed: false`, aucun audit). La désactivation révoque les
   * sessions ; la réactivation n'en restaure aucune (nouvelle connexion normale).
   */
  async setAccountEnabled(userId: UserId, enabled: boolean, reason: string, actorId: UserId) {
    const action: AuditAction = enabled ? 'USER_ENABLED' : 'USER_DISABLED';
    return this.guarded(action, userId, actorId, (tx, now) =>
      this.withLocks(tx, userId, actorId, now, !enabled, async (target) => {
        const status = enabled ? 'active' : 'disabled';
        if (target.status === status) return { status, changed: false, revokedSessions: 0 };
        await tx.setStatus(userId, status, now);
        const revoked = enabled ? 0 : await tx.revokeSessions(userId, now, 'account_disabled');
        await tx.audit(
          this.entry(action, userId, actorId, now, { reason, revokedSessions: revoked }),
        );
        return { status, changed: true, revokedSessions: revoked };
      }),
    );
  }

  /** Suspension temporaire ou indéterminée : sessions révoquées, accès refusé partout. */
  async suspend(userId: UserId, input: RestrictionInput, actorId: UserId) {
    return this.guarded('USER_SUSPENDED', userId, actorId, (tx, now) =>
      this.withLocks(tx, userId, actorId, now, true, async () => {
        this.checkEnd(input.endsAt, now);
        if (await tx.findActive(userId, 'SUSPENSION', now)) {
          throw new ModerationConflictError('ALREADY_SUSPENDED');
        }
        const id = randomUUID();
        await tx.insertSanction(this.newRestriction(id, userId, 'SUSPENSION', input, actorId, now));
        const revoked = await tx.revokeSessions(userId, now, 'account_suspended');
        await tx.audit(
          this.entry('USER_SUSPENDED', userId, actorId, now, {
            sanctionId: id,
            reason: input.reason,
            endsAt: iso(input.endsAt ?? null),
            revokedSessions: revoked,
          }),
        );
        return { sanctionId: id, revokedSessions: revoked };
      }),
    );
  }

  /** Levée anticipée ; ne touche jamais `users.status` (un compte désactivé le reste). */
  liftSuspension(userId: UserId, reason: string, actorId: UserId) {
    return this.lift(userId, 'SUSPENSION', reason, actorId);
  }

  /**
   * Révoque toutes les sessions du joueur : jetons de renouvellement révoqués, access tokens
   * refusés dès la requête suivante (HTTP et WebSocket). Jamais sur son propre compte.
   */
  async revokeSessions(userId: UserId, reason: string | undefined, actorId: UserId) {
    return this.guarded('USER_SESSIONS_REVOKED', userId, actorId, async (tx, now) => {
      if (userId === actorId) throw new ModerationForbiddenError('SELF_ACTION');
      if (!(await tx.lockUser(userId))) throw new AdminResourceNotFoundError('USER');
      const revoked = await tx.revokeSessions(userId, now, 'admin_revoked');
      await tx.audit(
        this.entry('USER_SESSIONS_REVOKED', userId, actorId, now, {
          revokedSessions: revoked,
          ...(reason && { reason }),
        }),
      );
      return { revokedSessions: revoked };
    });
  }

  /**
   * Récupération du compte par l'assistance (D-135), pour un joueur qui a perdu son code :
   * motif obligatoire, ancien code et autorisations ouvertes invalidés, NOUVEAU code renvoyé
   * une seule fois à l'administrateur, qui le transmet au joueur ; celui-ci choisit ensuite son
   * mot de passe par « Mot de passe oublié ? ». Aucun mot de passe n'est vu ni fixé ici. Audité
   * (PLAYER_ACCOUNT_RECOVERY, sans le code) dans la même transaction. Jamais sur son propre
   * compte, ni sur un administrateur (accès par email), ni sur un compte inactif.
   */
  async recoverAccount(userId: UserId, reason: string, actorId: UserId) {
    const recoveryCode = generateRecoveryCode();
    const codeHash = await this.deps.passwords.hashPassword(recoveryCodeSecret(recoveryCode));
    return this.guarded('PLAYER_ACCOUNT_RECOVERY', userId, actorId, async (tx, now) => {
      if (userId === actorId) throw new ModerationForbiddenError('SELF_ACTION');
      const target = await tx.lockUser(userId);
      if (!target) throw new AdminResourceNotFoundError('USER');
      if (target.role !== 'user') throw new ModerationConflictError('RECOVERY_PLAYERS_ONLY');
      if (!(await tx.replaceRecoveryCode(userId, codeHash, now))) {
        throw new ModerationConflictError('ACCOUNT_NOT_ACTIVE');
      }
      await tx.audit(this.entry('PLAYER_ACCOUNT_RECOVERY', userId, actorId, now, { reason }));
      return { recoveryCode };
    });
  }

  // --- Chat et avertissements -----------------------------------------------------------------

  async restrictChat(userId: UserId, input: RestrictionInput, actorId: UserId) {
    const now = this.clock();
    this.checkEnd(input.endsAt, now);
    return this.deps.repository.transaction(async (tx) => {
      if (!(await tx.lockUser(userId))) throw new AdminResourceNotFoundError('USER');
      if (await tx.findActive(userId, 'CHAT_RESTRICTION', now)) {
        throw new ModerationConflictError('ALREADY_CHAT_RESTRICTED');
      }
      const id = randomUUID();
      await tx.insertSanction(
        this.newRestriction(id, userId, 'CHAT_RESTRICTION', input, actorId, now),
      );
      await tx.audit(
        this.entry('USER_CHAT_RESTRICTED', userId, actorId, now, {
          sanctionId: id,
          reason: input.reason,
          endsAt: iso(input.endsAt ?? null),
        }),
      );
      return { sanctionId: id };
    });
  }

  liftChatRestriction(userId: UserId, reason: string, actorId: UserId) {
    return this.lift(userId, 'CHAT_RESTRICTION', reason, actorId);
  }

  /**
   * Avertissement. Avec `playerMessage`, une notification est écrite dans la MÊME transaction
   * (`delivered: true` = enregistrée dans l'application du joueur, pas « lue »). Sans message,
   * l'avertissement est seulement enregistré (`delivered: false`). Rejouer la même
   * `Idempotency-Key` renvoie l'avertissement déjà créé.
   */
  async warn(userId: UserId, input: WarningInput, idempotencyKey: string, actorId: UserId) {
    const replay = await this.deps.repository.findSanctionByKey(idempotencyKey);
    if (replay) return this.replayWarning(replay, userId);
    const now = this.clock();
    try {
      return await this.deps.repository.transaction(async (tx) => {
        if (!(await tx.lockUser(userId))) throw new AdminResourceNotFoundError('USER');
        const id = randomUUID();
        const notificationId = input.playerMessage ? randomUUID() : null;
        if (notificationId && input.playerMessage) {
          await tx.insertWarningNotification({
            id: notificationId,
            userId,
            warningId: id,
            message: input.playerMessage,
            createdAt: now,
          });
        }
        await tx.insertSanction({
          id,
          userId,
          kind: 'WARNING',
          reason: input.reason,
          comment: input.comment ?? null,
          playerMessage: input.playerMessage ?? null,
          notificationId,
          startsAt: now,
          endsAt: null,
          createdBy: actorId,
          createdAt: now,
          idempotencyKey,
        });
        await tx.audit(
          this.entry('USER_WARNED', userId, actorId, now, {
            sanctionId: id,
            reason: input.reason,
            delivered: notificationId !== null,
            idempotencyKey,
          }),
        );
        return { sanctionId: id, delivered: notificationId !== null, replayed: false };
      });
    } catch (err) {
      // Même clé envoyée deux fois en même temps : la seconde relit la première.
      if (!isPgError(err, PG_UNIQUE_VIOLATION)) throw err;
      const concurrent = await this.deps.repository.findSanctionByKey(idempotencyKey);
      if (!concurrent) throw err;
      return this.replayWarning(concurrent, userId);
    }
  }

  // --- Notes internes -------------------------------------------------------------------------

  async addNote(userId: UserId, body: string, idempotencyKey: string, actorId: UserId) {
    const replay = await this.deps.repository.findNoteByKey(idempotencyKey);
    if (replay) return this.replayNote(replay, userId);
    const now = this.clock();
    try {
      return await this.deps.repository.transaction(async (tx) => {
        if (!(await tx.lockUser(userId))) throw new AdminResourceNotFoundError('USER');
        const id = randomUUID();
        await tx.insertNote({
          id,
          userId,
          authorId: actorId,
          body,
          createdAt: now,
          idempotencyKey,
        });
        // Le texte de la note n'est pas copié dans le journal : il reste dans user_admin_notes.
        await tx.audit(this.entry('USER_NOTE_ADDED', userId, actorId, now, { noteId: id }));
        return { noteId: id, replayed: false };
      });
    } catch (err) {
      if (!isPgError(err, PG_UNIQUE_VIOLATION)) throw err;
      const concurrent = await this.deps.repository.findNoteByKey(idempotencyKey);
      if (!concurrent) throw err;
      return this.replayNote(concurrent, userId);
    }
  }

  /** Suppression LOGIQUE et tracée : la ligne, l'auteur et la date restent en base. */
  async deleteNote(userId: UserId, noteId: string, reason: string, actorId: UserId) {
    const now = this.clock();
    return this.deps.repository.transaction(async (tx) => {
      const note = await tx.findNote(userId, noteId);
      if (!note) throw new AdminNoteNotFoundError();
      if (note.deletedAt) throw new ModerationConflictError('NOTE_ALREADY_DELETED');
      await tx.deleteNote(noteId, actorId, reason, now);
      await tx.audit(this.entry('USER_NOTE_DELETED', userId, actorId, now, { noteId, reason }));
      return { noteId };
    });
  }

  // --- Interne --------------------------------------------------------------------------------

  /**
   * Verrouille les administrateurs puis le compte ciblé (ordre fixe), et applique les règles
   * de protection d'une action qui retire l'accès (`removesAccess`) : jamais sur son propre
   * compte, jamais sur le dernier administrateur encore accessible.
   */
  private async withLocks<T>(
    tx: ModerationTx,
    userId: UserId,
    actorId: UserId,
    now: Date,
    removesAccess: boolean,
    work: (target: { role: string; status: string }) => Promise<T>,
  ): Promise<T> {
    const admins = await tx.lockAccessibleAdmins(now);
    const target = await tx.lockUser(userId);
    if (!target) throw new AdminResourceNotFoundError('USER');
    if (removesAccess) {
      if (userId === actorId) throw new ModerationForbiddenError('SELF_ACTION');
      if (
        target.role === 'admin' &&
        admins.includes(userId) &&
        admins.filter((id) => id !== userId).length === 0
      ) {
        throw new ModerationForbiddenError('LAST_ADMIN');
      }
    }
    return work(target);
  }

  /** Transaction d'une action protégée ; un refus de protection est audité en échec. */
  private async guarded<T>(
    action: AuditAction,
    userId: UserId,
    actorId: UserId,
    work: (tx: ModerationTx, now: Date) => Promise<T>,
  ): Promise<T> {
    const now = this.clock();
    try {
      return await this.deps.repository.transaction((tx) => work(tx, now));
    } catch (err) {
      if (err instanceof ModerationForbiddenError) {
        await this.deps.audit.insert({
          ...this.entry(action, userId, actorId, now, { refused: err.reason }),
          outcome: 'FAILURE',
        });
        this.deps.logger.warn('moderation refused', {
          action,
          userId,
          actorId,
          reason: err.reason,
        });
      }
      throw err;
    }
  }

  private async lift(userId: UserId, kind: RestrictionKind, reason: string, actorId: UserId) {
    const now = this.clock();
    const action: AuditAction =
      kind === 'SUSPENSION' ? 'USER_SUSPENSION_LIFTED' : 'USER_CHAT_RESTRICTION_LIFTED';
    return this.deps.repository.transaction(async (tx) => {
      if (!(await tx.lockUser(userId))) throw new AdminResourceNotFoundError('USER');
      const active = await tx.findActive(userId, kind, now);
      if (!active) {
        throw new ModerationConflictError(
          kind === 'SUSPENSION' ? 'NOT_SUSPENDED' : 'NOT_CHAT_RESTRICTED',
        );
      }
      await tx.liftSanction(active.id, actorId, reason, now);
      await tx.audit(this.entry(action, userId, actorId, now, { sanctionId: active.id, reason }));
      return { sanctionId: active.id };
    });
  }

  /** Échéance d'une mesure temporaire : heure du serveur, bornes de MODERATION_LIMITS. */
  private checkEnd(endsAt: Date | undefined, now: Date): void {
    if (!endsAt) return;
    const min = now.getTime() + MODERATION_LIMITS.minDurationMinutes * 60_000;
    const max = now.getTime() + MODERATION_LIMITS.maxDurationDays * 86_400_000;
    if (endsAt.getTime() < min) {
      throw new ValidationError({
        endsAt: `La fin doit être au moins ${MODERATION_LIMITS.minDurationMinutes} minutes après maintenant.`,
      });
    }
    if (endsAt.getTime() > max) {
      throw new ValidationError({
        endsAt: `Durée limitée à ${MODERATION_LIMITS.maxDurationDays} jours ; choisissez « indéterminée » au-delà.`,
      });
    }
  }

  private newRestriction(
    id: string,
    userId: UserId,
    kind: RestrictionKind,
    input: RestrictionInput,
    actorId: UserId,
    now: Date,
  ) {
    return {
      id,
      userId,
      kind,
      reason: input.reason,
      comment: input.comment ?? null,
      playerMessage: null,
      notificationId: null,
      startsAt: now,
      endsAt: input.endsAt ?? null,
      createdBy: actorId,
      createdAt: now,
      idempotencyKey: null,
    };
  }

  private replayWarning(s: Sanction, userId: UserId) {
    if (s.userId !== userId || s.kind !== 'WARNING') throw new AdminIdempotencyConflictError();
    return { sanctionId: s.id, delivered: s.notificationId !== null, replayed: true };
  }

  private replayNote(n: AdminNote, userId: UserId) {
    if (n.userId !== userId) throw new AdminIdempotencyConflictError();
    return { noteId: n.id, replayed: true };
  }

  private entry(
    action: AuditAction,
    userId: UserId,
    actorId: UserId,
    now: Date,
    details: Record<string, unknown>,
  ): AuditEntry {
    return {
      id: randomUUID(),
      actorId,
      action,
      targetType: 'USER',
      targetId: userId,
      outcome: 'SUCCESS',
      details,
      createdAt: now,
    };
  }
}
