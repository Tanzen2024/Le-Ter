import { createHash, randomBytes, randomInt } from 'node:crypto';

/**
 * Code de récupération d'un joueur (D-135) : « LT-XXXX-XXXX-XXXX », 12 caractères tirés au
 * hasard cryptographique dans l'alphabet de Crockford (32 symboles, sans I, L, O ni U, qui se
 * confondent à la lecture) : 60 bits d'aléa. Le code en clair n'existe que dans la réponse qui
 * le crée ; la base ne garde que son empreinte bcrypt (PasswordService). Jamais journalisé.
 */
const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const GROUPS = 3;
const GROUP_LENGTH = 4;
const PREFIX = 'LT';

export function generateRecoveryCode(): string {
  const groups = Array.from({ length: GROUPS }, () =>
    Array.from({ length: GROUP_LENGTH }, () => ALPHABET[randomInt(ALPHABET.length)]).join(''),
  );
  return [PREFIX, ...groups].join('-');
}

/**
 * Forme canonique d'un code saisi : majuscules, sans espaces ni tirets, préfixe facultatif,
 * confusions courantes corrigées (O → 0, I et L → 1). `null` s'il ne peut pas être un code :
 * il est alors refusé sans comparaison.
 */
export function normalizeRecoveryCode(input: string): string | null {
  let compact = input.toUpperCase().replace(/[\s-]/g, '');
  if (compact.startsWith(PREFIX) && compact.length === PREFIX.length + GROUPS * GROUP_LENGTH) {
    compact = compact.slice(PREFIX.length);
  }
  compact = compact.replace(/O/g, '0').replace(/[IL]/g, '1');
  if (compact.length !== GROUPS * GROUP_LENGTH) return null;
  if ([...compact].some((c) => !ALPHABET.includes(c))) return null;
  return compact;
}

/** Ce qui est haché : la forme canonique, pour qu'une saisie avec ou sans tirets soit égale. */
export function recoveryCodeSecret(code: string): string {
  const canonical = normalizeRecoveryCode(code);
  if (!canonical) throw new RangeError('Code de récupération mal formé');
  return canonical;
}

/**
 * Autorisation temporaire de réinitialisation : 32 octets aléatoires (base64url), comme un
 * refresh token. Seule son empreinte SHA-256 est stockée.
 */
export function generateResetToken(): { token: string; hash: string } {
  const token = randomBytes(32).toString('base64url');
  return { token, hash: hashResetToken(token) };
}

export function hashResetToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export function isWellFormedResetToken(value: string): boolean {
  return /^[A-Za-z0-9_-]{43}$/.test(value);
}
