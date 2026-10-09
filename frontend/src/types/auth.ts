/** Compte tel que renvoyé par l'API (jamais de mot de passe ni de hash). */
export interface PublicUser {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  /** Pseudo : nom visible en jeu. Ce n'est pas un identifiant de connexion. */
  username: string;
  phone: string;
  phoneVerified: boolean;
  /** `admin` : administration de la détection uniquement (D-049, D-053). */
  role: 'user' | 'admin';
  createdAt: string;
}

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
}

/** Inscription (R-15) : exactement ces 7 champs. */
export interface RegisterPayload {
  firstName: string;
  lastName: string;
  email: string;
  username: string;
  phone: string;
  password: string;
  confirmPassword: string;
}

export interface LoginPayload {
  email: string;
  password: string;
}
