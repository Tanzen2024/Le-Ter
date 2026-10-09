import type { UserId, UserRole, UserStatus } from '../domain/users/user';

/**
 * Sessions d'authentification (port). Une session = une suite de jetons de
 * rafraîchissement liés par `sessionId` ; à chaque rotation, l'ancien jeton est
 * révoqué et un nouveau est créé dans la même session.
 *
 * R-32 : un utilisateur a au plus UNE session active. Toutes les opérations qui
 * créent ou révoquent un jeton sont sérialisées par utilisateur.
 */
export interface NewRefreshToken {
  id: string;
  sessionId: string;
  /** Empreinte SHA-256 du jeton ; le jeton lui-même n'est jamais stocké. */
  tokenHash: string;
  createdAt: Date;
  expiresAt: Date;
  /**
   * Borne ABSOLUE de la session (session d'administration : 8 h). Aucune rotation ne
   * prolonge un jeton au-delà. Absente : sessions des joueurs, sans borne absolue.
   */
  sessionExpiresAt?: Date;
}

export type RotationFailure = 'unknown' | 'revoked' | 'expired' | 'account_disabled';

export type RotationResult =
  | { ok: true; userId: UserId; role: UserRole; sessionId: string }
  | { ok: false; reason: RotationFailure; userId?: UserId };

export interface ActiveAuthSession {
  role: UserRole;
  status: UserStatus;
}

export interface AuthSessionRepository {
  /**
   * Ouvre une session après une connexion réussie : révoque toutes les sessions
   * actives de l'utilisateur, puis enregistre le premier jeton de la nouvelle.
   * @returns le nombre de jetons révoqués.
   */
  startSession(userId: UserId, token: NewRefreshToken): Promise<number>;

  /**
   * Rotation atomique : le jeton `tokenHash` est révoqué et `next` est créé dans la
   * même session. Deux rotations concurrentes du même jeton : une seule réussit.
   */
  rotate(
    tokenHash: string,
    next: Omit<NewRefreshToken, 'sessionId' | 'sessionExpiresAt'>,
  ): Promise<RotationResult>;

  /** Révoque le jeton s'il est actif. @returns la session révoquée, ou null. */
  revoke(tokenHash: string, now: Date): Promise<{ userId: UserId; sessionId: string } | null>;

  /** Session encore active (non révoquée, non expirée) de cet utilisateur, ou null. */
  findActiveSession(
    userId: UserId,
    sessionId: string,
    now: Date,
  ): Promise<ActiveAuthSession | null>;
}
