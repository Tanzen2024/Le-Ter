import type { User, UserId } from '../domain/users/user';

/** Champs uniques d'un compte. */
export type UniqueUserField = 'email' | 'username' | 'phone';

/** Un compte avec cet email, ce pseudo ou ce téléphone existe déjà. */
export class DuplicateUserError extends Error {
  constructor(readonly fields: UniqueUserField[]) {
    super(`Compte déjà existant (${fields.join(', ')})`);
    this.name = 'DuplicateUserError';
  }
}

/** Persistance des comptes (port). Implémentation : PostgresUserRepository. */
export interface UserRepository {
  /** Lève DuplicateUserError si l'email, le pseudo ou le téléphone est déjà pris. */
  insert(user: User): Promise<void>;
  findById(id: UserId): Promise<User | null>;
  /** `email` doit être normalisé (minuscules). */
  findByEmail(email: string): Promise<User | null>;
  /** Champs déjà utilisés par un autre compte (pseudo comparé sans la casse). */
  findTakenFields(candidate: Pick<User, UniqueUserField>): Promise<UniqueUserField[]>;
  /**
   * Remplace le hash du mot de passe SEULEMENT s'il vaut encore `expectedHash` (compte
   * actif) : deux changements concurrents ne s'écrasent pas. @returns false sinon.
   */
  updatePasswordHash(
    id: UserId,
    expectedHash: string,
    newHash: string,
    now: Date,
  ): Promise<boolean>;
}
