import { createHash, randomBytes } from 'node:crypto';

/**
 * Jetons de rafraîchissement OPAQUES : 256 bits aléatoires (base64url, 43 caractères).
 * Seule leur empreinte SHA-256 est stockée. Un sel est inutile : le jeton est déjà
 * aléatoire et impossible à deviner, contrairement à un mot de passe.
 */
const REFRESH_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

export function generateRefreshToken(): { token: string; hash: string } {
  const token = randomBytes(32).toString('base64url');
  return { token, hash: hashRefreshToken(token) };
}

export function hashRefreshToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export function isWellFormedRefreshToken(value: unknown): value is string {
  return typeof value === 'string' && REFRESH_TOKEN_PATTERN.test(value);
}
