import jwt from 'jsonwebtoken';

import { isUserId, newUserId, playerIdOf } from '../../../src/domain/users/user';
import {
  AccessTokenService,
  InvalidAccessTokenError,
} from '../../../src/services/auth/access-token.service';
import { PasswordService } from '../../../src/services/auth/password.service';
import {
  generateRefreshToken,
  hashRefreshToken,
  isWellFormedRefreshToken,
} from '../../../src/services/auth/refresh-token';

const SECRET = 'unit-secret-'.padEnd(48, 'y');
const NOW = new Date('2026-10-07T10:00:00Z');
const SESSION = '11111111-1111-4111-8111-111111111111';

describe('PasswordService (bcrypt)', () => {
  const passwords = new PasswordService(4);

  it('hache sans jamais stocker le mot de passe en clair, et vérifie', async () => {
    const hash = await passwords.hashPassword('Secret123');

    expect(hash).toMatch(/^\$2[aby]\$04\$/);
    expect(hash).not.toContain('Secret123');
    expect(await passwords.verifyPassword('Secret123', hash)).toBe(true);
    expect(await passwords.verifyPassword('secret123', hash)).toBe(false);
  });

  it('deux hachages du même mot de passe diffèrent (sel)', async () => {
    expect(await passwords.hashPassword('Secret123')).not.toBe(
      await passwords.hashPassword('Secret123'),
    );
  });

  it('la comparaison factice (email inconnu) renvoie toujours false', async () => {
    expect(await passwords.verifyAgainstDummy('le-ter-dummy-password')).toBe(false);
  });

  it('utilise un coût de production de 12 par défaut', async () => {
    const hash = await new PasswordService().hashPassword('x1');
    expect(hash).toMatch(/^\$2[aby]\$12\$/);
  });
});

describe('AccessTokenService (JWT)', () => {
  const tokens = new AccessTokenService(SECRET, 900);
  const userId = newUserId();

  it('signe un jeton minimal : sub, role, sid, iat, exp (15 min), iss, aud', () => {
    const token = tokens.sign({ userId, role: 'user', sessionId: SESSION }, NOW);
    const payload = jwt.decode(token) as Record<string, unknown>;

    expect(Object.keys(payload).sort()).toEqual(['aud', 'exp', 'iat', 'iss', 'role', 'sid', 'sub']);
    expect(payload.sub).toBe(userId);
    expect((payload.exp as number) - (payload.iat as number)).toBe(900);
    expect(tokens.verify(token, NOW)).toEqual({ userId, role: 'user', sessionId: SESSION });
  });

  it('refuse un jeton expiré', () => {
    const token = tokens.sign({ userId, role: 'user', sessionId: SESSION }, NOW);
    const later = new Date(NOW.getTime() + 901_000);
    expect(() => tokens.verify(token, later)).toThrow(new InvalidAccessTokenError('expired'));
  });

  it('refuse une signature d’un autre secret, un jeton modifié ou « alg: none »', () => {
    const forged = jwt.sign({ role: 'user', sid: SESSION }, 'autre-secret'.padEnd(48, 'z'), {
      subject: userId,
      issuer: 'le-ter-api',
      audience: 'le-ter-app',
    });
    const unsigned = jwt.sign({ role: 'user', sid: SESSION }, '', {
      algorithm: 'none',
      subject: userId,
      issuer: 'le-ter-api',
      audience: 'le-ter-app',
    });
    const valid = tokens.sign({ userId, role: 'user', sessionId: SESSION }, NOW);
    const [header, , signature] = valid.split('.');
    const tampered = `${header}.${Buffer.from(
      JSON.stringify({ sub: newUserId(), role: 'user', sid: SESSION }),
    ).toString('base64url')}.${signature}`;

    for (const token of [forged, unsigned, tampered, 'pas-un-jwt']) {
      expect(() => tokens.verify(token, NOW)).toThrow(InvalidAccessTokenError);
    }
  });

  it('refuse un `sub` qui n’est pas un UUID ou un rôle inconnu', () => {
    const sign = (sub: string, role: string) =>
      jwt.sign({ role, sid: SESSION, iat: NOW.getTime() / 1000 }, SECRET, {
        subject: sub,
        issuer: 'le-ter-api',
        audience: 'le-ter-app',
        expiresIn: 60,
      });
    expect(() => tokens.verify(sign('admin', 'user'), NOW)).toThrow(InvalidAccessTokenError);
    expect(() => tokens.verify(sign(userId, 'admin'), NOW)).toThrow(InvalidAccessTokenError);
  });

  it('exige un secret d’au moins 32 caractères', () => {
    expect(() => new AccessTokenService('court', 900)).toThrow('JWT_SECRET trop court');
  });
});

describe('Refresh tokens opaques', () => {
  it('256 bits aléatoires, stockés sous forme d’empreinte SHA-256', () => {
    const a = generateRefreshToken();
    const b = generateRefreshToken();

    expect(isWellFormedRefreshToken(a.token)).toBe(true);
    expect(a.token).not.toBe(b.token);
    expect(a.hash).toBe(hashRefreshToken(a.token));
    expect(a.hash).toMatch(/^[0-9a-f]{64}$/);
    expect(a.hash).not.toContain(a.token);
  });

  it('rejette un jeton mal formé', () => {
    for (const value of ['', 'abc', 'x'.repeat(44), 42, null, `${'a'.repeat(42)}!`]) {
      expect(isWellFormedRefreshToken(value)).toBe(false);
    }
  });
});

describe('UserId → PlayerId', () => {
  it('un PlayerId est l’identifiant du compte, sans transformation', () => {
    const userId = newUserId();
    expect(isUserId(userId)).toBe(true);
    expect(playerIdOf(userId)).toBe(userId);
    expect(isUserId('player-1')).toBe(false);
  });
});
