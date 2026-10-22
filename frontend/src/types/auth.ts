/** Compte tel que renvoyé par l'API (jamais de mot de passe ni de hash). */
export interface PublicUser {
  id: string;
  /**
   * Numéro d'ordre du joueur sur la plateforme (D-133) : rang d'inscription, attribué par le
   * serveur. Absent d'une réponse d'un serveur plus ancien : le HUD affiche alors « — ».
   */
  playerNumber?: number;
  firstName: string;
  lastName: string;
  /** Facultatif pour un joueur (D-135) : null s'il n'en a pas donné. */
  email: string | null;
  /** Pseudo : nom visible en jeu. Ce n'est pas un identifiant de connexion. */
  username: string;
  phone: string;
  phoneVerified: boolean;
  /** Un code de récupération actif existe (D-135). Le code lui-même n'est jamais renvoyé ici. */
  hasRecoveryCode?: boolean;
  /** `admin` : administration de la détection uniquement (D-049, D-053). */
  role: 'user' | 'admin';
  createdAt: string;
}

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
}

/** Inscription (R-15, D-135) : téléphone obligatoire, email facultatif (vide = aucun). */
export interface RegisterPayload {
  firstName: string;
  lastName: string;
  email: string;
  username: string;
  /** Pays (ISO 3166-1 alpha-2) : le serveur en déduit l'indicatif et les règles du numéro. */
  country: string;
  /** Numéro NATIONAL, sans indicatif : le serveur reconstruit le numéro international. */
  phone: string;
  password: string;
  confirmPassword: string;
}

/** Connexion par email, ou par pays + numéro national (D-135). */
export type LoginPayload =
  | { email: string; password: string }
  | { country: string; phone: string; password: string };

/** « Mot de passe oublié ? », étape code (D-135) : téléphone OU email du compte (D-142). */
export type RecoveryVerifyPayload =
  | { email: string; code: string }
  | { country: string; phone: string; code: string };

/** Autorisation temporaire, à usage unique, reçue après un code valide. */
export interface ResetGrant {
  resetToken: string;
  expiresAt: string;
}

export interface RecoveryResetPayload {
  resetToken: string;
  newPassword: string;
  confirmPassword: string;
}

/** Corps de POST /api/auth/password (compte du jeton, aucun identifiant envoyé). */
export interface ChangePasswordPayload {
  currentPassword: string;
  newPassword: string;
  confirmPassword: string;
}
