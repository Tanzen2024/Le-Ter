import type { AdminSession, AdminSessionEndReason, AuditEntry } from '../domain/admin/admin';
import type { UserId } from '../domain/users/user';

/** Sessions d'administration (port). Toutes les écritures sont auditées dans la même transaction. */
export interface AdminSessionRepository {
  /**
   * Enregistre une connexion réussie : termine (REPLACED) les sessions d'administration encore
   * ouvertes du compte, crée la nouvelle, écrit `audit` (ADMIN_LOGIN_SUCCEEDED).
   */
  open(session: AdminSession, audit: AuditEntry): Promise<void>;

  find(sessionId: string): Promise<AdminSession | null>;

  /**
   * Enregistre une activité : `last_activity_at = now` si la session est ouverte et que la
   * dernière écriture date d'au moins `minIntervalSeconds`. Sans verrou (idempotent).
   */
  touch(sessionId: string, now: Date, minIntervalSeconds: number): Promise<void>;

  /**
   * Termine la session (déconnexion ou expiration) et révoque les jetons de rafraîchissement
   * de la session d'authentification associée, avec `audit`. Idempotent : une session déjà
   * terminée n'est pas modifiée et rien n'est audité.
   * @returns vrai si cet appel a terminé la session.
   */
  end(
    session: { sessionId: string; userId: UserId },
    reason: AdminSessionEndReason,
    now: Date,
    audit: AuditEntry,
  ): Promise<boolean>;
}
