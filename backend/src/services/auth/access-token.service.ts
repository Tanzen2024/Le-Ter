import jwt from 'jsonwebtoken';

import { isUserId, type UserId, type UserRole } from '../../domain/users/user';

const ALGORITHM = 'HS256';
const ISSUER = 'le-ter-api';
const AUDIENCE = 'le-ter-app';
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** Contenu vérifié d'un access token : `sub` est l'identité authentifiée. */
export interface AccessTokenClaims {
  userId: UserId;
  role: UserRole;
  /** Session d'origine : le jeton est refusé dès que cette session est révoquée (R-32). */
  sessionId: string;
}

export class InvalidAccessTokenError extends Error {
  constructor(readonly reason: 'expired' | 'invalid') {
    super(`Access token ${reason === 'expired' ? 'expiré' : 'invalide'}`);
    this.name = 'InvalidAccessTokenError';
  }
}

/**
 * Access tokens JWT HS256, courts (15 min par défaut). Charge utile minimale :
 * `sub` (UserId), `role`, `sid` (session) + `iat`, `exp`, `iss`, `aud`. Aucun mot de
 * passe, aucune donnée financière ni état de partie.
 */
export class AccessTokenService {
  constructor(
    private readonly secret: string,
    private readonly ttlSeconds: number,
  ) {
    if (secret.length < 32) {
      throw new Error('JWT_SECRET trop court (32 caractères minimum)');
    }
  }

  sign(claims: AccessTokenClaims, now: Date): string {
    return jwt.sign(
      { role: claims.role, sid: claims.sessionId, iat: Math.floor(now.getTime() / 1000) },
      this.secret,
      {
        algorithm: ALGORITHM,
        expiresIn: this.ttlSeconds,
        subject: claims.userId,
        issuer: ISSUER,
        audience: AUDIENCE,
      },
    );
  }

  /** Vérifie signature, algorithme (HS256 imposé), émetteur, audience et expiration. */
  verify(token: string, now: Date): AccessTokenClaims {
    let payload: string | jwt.JwtPayload;
    try {
      payload = jwt.verify(token, this.secret, {
        algorithms: [ALGORITHM],
        issuer: ISSUER,
        audience: AUDIENCE,
        clockTimestamp: Math.floor(now.getTime() / 1000),
      });
    } catch (err) {
      throw new InvalidAccessTokenError(
        err instanceof jwt.TokenExpiredError ? 'expired' : 'invalid',
      );
    }
    if (typeof payload === 'string') {
      throw new InvalidAccessTokenError('invalid');
    }
    const { sub, role, sid } = payload as jwt.JwtPayload & { role?: unknown; sid?: unknown };
    if (!isUserId(sub) || role !== 'user' || typeof sid !== 'string' || !UUID_PATTERN.test(sid)) {
      throw new InvalidAccessTokenError('invalid');
    }
    return { userId: sub, role, sessionId: sid };
  }
}
