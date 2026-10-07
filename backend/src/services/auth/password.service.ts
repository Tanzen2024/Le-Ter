import bcrypt from 'bcryptjs';

/**
 * Hachage des mots de passe avec bcrypt (implémentation JavaScript `bcryptjs` : même
 * algorithme et même format `$2b$`, sans compilation native). Le mot de passe en clair
 * ne quitte jamais ce service : ni log, ni JWT, ni Redis.
 */
export const DEFAULT_BCRYPT_COST = 12;

/** bcrypt ignore tout ce qui dépasse 72 octets : le validateur refuse au-delà. */
export const BCRYPT_MAX_PASSWORD_BYTES = 72;

export class PasswordService {
  private dummyHash: Promise<string> | undefined;

  constructor(private readonly cost = DEFAULT_BCRYPT_COST) {}

  hashPassword(password: string): Promise<string> {
    return bcrypt.hash(password, this.cost);
  }

  verifyPassword(password: string, hash: string): Promise<boolean> {
    return bcrypt.compare(password, hash);
  }

  /**
   * Comparaison factice, au même coût, quand l'email est inconnu : la durée de la
   * réponse ne révèle pas si le compte existe.
   */
  async verifyAgainstDummy(password: string): Promise<false> {
    this.dummyHash ??= bcrypt.hash('le-ter-dummy-password', this.cost);
    await bcrypt.compare(password, await this.dummyHash);
    return false;
  }
}
