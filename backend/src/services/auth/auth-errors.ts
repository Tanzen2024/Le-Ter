import type { UniqueUserField } from '../../repositories/user.repository';

/**
 * Erreurs de l'authentification. Leurs messages sont destinés au client : ils ne
 * révèlent jamais si un compte existe ni pourquoi un jeton est refusé. La raison
 * précise (`reason`) ne sert qu'aux logs.
 */

/** Email inconnu OU mauvais mot de passe : même erreur, même message. */
export class InvalidCredentialsError extends Error {
  constructor() {
    super('Email ou mot de passe incorrect.');
    this.name = 'InvalidCredentialsError';
  }
}

export class AccountDisabledError extends Error {
  constructor() {
    super('Ce compte est désactivé.');
    this.name = 'AccountDisabledError';
  }
}

export class InvalidRefreshTokenError extends Error {
  constructor(readonly reason: string) {
    super('Session expirée. Veuillez vous reconnecter.');
    this.name = 'InvalidRefreshTokenError';
  }
}

/** Access token absent, invalide, expiré, ou session révoquée. */
export class AuthenticationRequiredError extends Error {
  constructor(readonly reason: string) {
    super('Authentification requise.');
    this.name = 'AuthenticationRequiredError';
  }
}

export class RegistrationConflictError extends Error {
  constructor(readonly fields: UniqueUserField[]) {
    super('Ces informations sont déjà utilisées par un autre compte.');
    this.name = 'RegistrationConflictError';
  }
}

export const CONFLICT_MESSAGES: Record<UniqueUserField, string> = {
  email: 'Cet email est déjà utilisé.',
  username: 'Ce pseudo est déjà pris.',
  phone: 'Ce numéro de téléphone est déjà utilisé.',
};
