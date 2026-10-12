import type { AuditEntry } from '../domain/admin/admin';
import type {
  AdminNote,
  RestrictionKind,
  Sanction,
  SanctionKind,
} from '../domain/admin/moderation';
import type { UserId, UserRole, UserStatus } from '../domain/users/user';
import type { AdminRevocationReason } from './auth-session.repository';

export interface ModerationPage {
  page: number;
  limit: number;
}

export interface NewSanction {
  id: string;
  userId: UserId;
  kind: SanctionKind;
  reason: string;
  comment: string | null;
  playerMessage: string | null;
  notificationId: string | null;
  startsAt: Date;
  endsAt: Date | null;
  createdBy: UserId;
  createdAt: Date;
  idempotencyKey: string | null;
}

export interface NewAdminNote {
  id: string;
  userId: UserId;
  authorId: UserId;
  body: string;
  createdAt: Date;
  idempotencyKey: string;
}

/** Faits de sécurité d'un compte, sans aucun jeton ni empreinte. */
export interface AccountSecurity {
  /** Début de la session la plus récente (connexion), ou null. */
  lastLoginAt: Date | null;
  /** Dernier jeton émis (connexion ou renouvellement) : dernière activité de session connue. */
  lastSessionActivityAt: Date | null;
  /** Sessions actives (0 ou 1, R-32). */
  activeSessions: number;
}

/**
 * Opérations d'UNE transaction de modération (D-079). Le service y applique ses règles ; la
 * ligne `users` ciblée et celles des administrateurs sont verrouillées avant toute écriture,
 * comme le font les opérations de session (D-029) : deux actions concurrentes sur un même
 * compte, ou sur les deux derniers administrateurs, s'exécutent l'une après l'autre.
 */
export interface ModerationTx {
  /**
   * Verrouille les comptes administrateurs (ordre fixe) et renvoie ceux qui peuvent encore
   * accéder à l'administration : actifs et non suspendus à `now`.
   */
  lockAccessibleAdmins(now: Date): Promise<UserId[]>;
  /** Verrouille le compte ciblé ; null s'il n'existe pas. */
  lockUser(userId: UserId): Promise<{ role: UserRole; status: UserStatus } | null>;
  setStatus(userId: UserId, status: UserStatus, now: Date): Promise<void>;
  revokeSessions(userId: UserId, now: Date, reason: AdminRevocationReason): Promise<number>;
  findActive(userId: UserId, kind: RestrictionKind, now: Date): Promise<Sanction | null>;
  insertSanction(sanction: NewSanction): Promise<void>;
  liftSanction(id: string, liftedBy: UserId, reason: string, now: Date): Promise<void>;
  /** Notification dans l'application (D-054) ; identifiant de la ligne créée. */
  insertWarningNotification(input: {
    id: string;
    userId: UserId;
    warningId: string;
    message: string;
    createdAt: Date;
  }): Promise<void>;
  insertNote(note: NewAdminNote): Promise<void>;
  findNote(userId: UserId, noteId: string): Promise<AdminNote | null>;
  deleteNote(noteId: string, deletedBy: UserId, reason: string, now: Date): Promise<void>;
  audit(entry: AuditEntry): Promise<void>;
}

export interface ModerationRepository {
  transaction<T>(work: (tx: ModerationTx) => Promise<T>): Promise<T>;
  userExists(userId: UserId): Promise<boolean>;
  findActive(userId: UserId, kind: RestrictionKind, now: Date): Promise<Sanction | null>;
  findSanctionByKey(idempotencyKey: string): Promise<Sanction | null>;
  findNoteByKey(idempotencyKey: string): Promise<AdminNote | null>;
  security(userId: UserId, now: Date): Promise<AccountSecurity>;
  listSanctions(
    userId: UserId,
    page: ModerationPage,
  ): Promise<{ total: number; items: Sanction[] }>;
  listNotes(userId: UserId, page: ModerationPage): Promise<{ total: number; items: AdminNote[] }>;
}
