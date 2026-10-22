import type { UserId, UserRole, UserStatus } from '../domain/users/user';

/**
 * Récupération d'un compte joueur par code (D-135), port. Le code en clair n'entre jamais
 * ici : seulement son empreinte bcrypt. Toutes les écritures d'un compte verrouillent sa
 * ligne `users` (même règle que les sessions, R-32).
 */

/** État de récupération d'un compte, trouvé par son téléphone. */
export interface RecoveryTarget {
  userId: UserId;
  role: UserRole;
  status: UserStatus;
  /** Empreinte du code actif ; null : aucun code (jamais généré, utilisé ou remplacé). */
  recoveryCodeHash: string | null;
  /** Blocage temporaire après trop d'échecs ; null : aucun. */
  lockedUntil: Date | null;
}

export interface RecoveryLockPolicy {
  /** Échecs consécutifs avant blocage. */
  maxFailures: number;
  lockMs: number;
}

export interface NewResetGrant {
  id: string;
  tokenHash: string;
  createdAt: Date;
  expiresAt: Date;
}

export interface CompletedReset {
  userId: UserId;
  revokedSessions: number;
}

export interface PasswordRecoveryRepository {
  findTargetByPhone(phone: string): Promise<RecoveryTarget | null>;

  /** Même cible, retrouvée par l'email du compte (D-142 : « Téléphone ou email »). */
  findTargetByEmail(email: string): Promise<RecoveryTarget | null>;

  /**
   * Compte un code refusé. Au seuil, le compte est bloqué `lockMs` et le compteur repart à 0.
   * @returns la fin du blocage s'il vient d'être posé, sinon null.
   */
  recordFailure(userId: UserId, now: Date, policy: RecoveryLockPolicy): Promise<Date | null>;

  /**
   * Code accepté : sous verrou, et SEULEMENT si le code actif est toujours `expectedHash`
   * (pas remplacé ni utilisé entre-temps), remet les échecs à 0, invalide les autorisations
   * encore ouvertes du compte et crée `grant`. @returns false sinon (rien n'est écrit).
   */
  issueResetGrant(userId: UserId, expectedHash: string, grant: NewResetGrant): Promise<boolean>;

  /**
   * Réinitialisation, en UNE transaction : autorisation valide (non utilisée, non expirée,
   * compte actif) → nouveau mot de passe, ancien code invalidé et remplacé par `newCodeHash`,
   * autorisation consommée, toutes les sessions fermées (`password_reset`).
   * @returns null si l'autorisation n'est pas (ou plus) valable.
   */
  completeReset(
    tokenHash: string,
    passwordHash: string,
    newCodeHash: string,
    now: Date,
  ): Promise<CompletedReset | null>;

  /**
   * Remplace le code du compte (ancien invalidé, nouveau actif, blocage levé).
   * @returns false si le compte n'existe pas ou n'est pas actif.
   */
  replaceCode(userId: UserId, codeHash: string, now: Date): Promise<boolean>;
}
