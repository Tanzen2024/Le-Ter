import request from 'supertest';
import type { Express } from 'express';

import { createApp } from '../../src/app';
import type { SqlClient } from '../../src/database/sql-client';
import type { AuthRateLimits } from '../../src/routes/auth.routes';
import type { AuthService } from '../../src/services/auth/auth.service';
import { createAuthService } from '../../src/services/auth/create-auth-service';
import { createLogger, type Logger } from '../../src/utils/logger';

export const TEST_JWT_SECRET = 'test-secret-'.padEnd(64, 'x');
export const ACCESS_TTL_SECONDS = 15 * 60;
export const REFRESH_TTL_SECONDS = 30 * 24 * 3600;

/** Limites très hautes : les tests fonctionnels ne doivent pas déclencher le 429. */
export const NO_RATE_LIMITS: AuthRateLimits = {
  register: { windowMs: 60_000, max: 1_000_000 },
  loginPerAccount: { windowMs: 60_000, max: 1_000_000 },
  loginPerIp: { windowMs: 60_000, max: 1_000_000 },
  refresh: { windowMs: 60_000, max: 1_000_000 },
};

export interface AuthTestContext {
  app: Express;
  auth: AuthService;
  logLines: Record<string, unknown>[];
  /** Avance l'horloge du service (expiration des jetons). */
  advance(ms: number): void;
}

/** Application complète sur une base PGlite migrée, bcrypt au coût minimal. */
export function createAuthTestApp(
  sql: SqlClient,
  options: { rateLimits?: AuthRateLimits } = {},
): AuthTestContext {
  let now = new Date('2026-10-07T10:00:00Z');
  const logLines: Record<string, unknown>[] = [];
  const logger: Logger = createLogger({}, (line) => logLines.push(JSON.parse(line)));
  const auth = createAuthService(
    sql,
    {
      jwtSecret: TEST_JWT_SECRET,
      accessTokenTtlSeconds: ACCESS_TTL_SECONDS,
      refreshTokenTtlSeconds: REFRESH_TTL_SECONDS,
      bcryptCost: 4,
      clock: () => now,
    },
    logger,
  );
  const app = createApp({ logger, auth, authRateLimits: options.rateLimits ?? NO_RATE_LIMITS });
  return {
    app,
    auth,
    logLines,
    advance: (ms) => {
      now = new Date(now.getTime() + ms);
    },
  };
}

let sequence = 0;

/** Inscription valide (R-15), unique à chaque appel. */
export function validRegistration(overrides: Record<string, unknown> = {}) {
  sequence += 1;
  return {
    firstName: 'Awa',
    lastName: 'Ndiaye',
    email: `awa${sequence}@example.com`,
    username: `awa_${sequence}`,
    // Pays + numéro NATIONAL (inscription avec pays) : 67 + 7 chiffres, mobile camerounais valide.
    country: 'CM',
    phone: `67${String(sequence).padStart(7, '0')}`,
    password: 'Secret123',
    confirmPassword: 'Secret123',
    ...overrides,
  };
}

export interface Session {
  userId: string;
  accessToken: string;
  refreshToken: string;
}

/** Inscrit un compte puis s'y connecte. */
export async function registerAndLogin(
  app: Express,
  overrides: Record<string, unknown> = {},
): Promise<Session & { email: string; password: string }> {
  const body = validRegistration(overrides);
  const registered = await request(app).post('/api/auth/register').send(body).expect(201);
  // Joueur sans email (D-135) : connexion par téléphone.
  const session = body.email
    ? await login(app, body.email, body.password)
    : await loginWith(app, { country: body.country, phone: body.phone, password: body.password });
  return {
    ...session,
    userId: registered.body.user.id,
    email: body.email,
    password: body.password,
  };
}

export function login(app: Express, email: string, password: string): Promise<Session> {
  return loginWith(app, { email, password });
}

/** Connexion avec un corps quelconque : email ou pays + téléphone (D-135). */
export async function loginWith(app: Express, body: object): Promise<Session> {
  const res = await request(app).post('/api/auth/login').send(body).expect(200);
  return {
    userId: res.body.user.id,
    accessToken: res.body.accessToken,
    refreshToken: res.body.refreshToken,
  };
}

/** Jetons actifs (non révoqués) d'un utilisateur, lus directement en base. */
export async function activeTokenCount(sql: SqlClient, userId: string): Promise<number> {
  const { rows } = await sql.query<{ n: number }>(
    'SELECT count(*)::int AS n FROM refresh_tokens WHERE user_id = $1 AND revoked_at IS NULL',
    [userId],
  );
  return rows[0]?.n ?? 0;
}
