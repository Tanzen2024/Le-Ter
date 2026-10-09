import { createHash, randomUUID } from 'node:crypto';

import type { Express } from 'express';
import request from 'supertest';

import { createApp, type AppDependencies } from '../../src/app';
import type { SqlClient } from '../../src/database/sql-client';
import type { AdminLoginLimits } from '../../src/domain/admin/admin';
import { PostgresPaymentRepository } from '../../src/repositories/postgres-payment.repository';
import { createAdminServices } from '../../src/services/admin/create-admin-services';
import type { AuthService } from '../../src/services/auth/auth.service';
import { createAuthService } from '../../src/services/auth/create-auth-service';
import type { CinetPayPaymentStatus } from '../../src/services/payments/cinetpay/cinetpay-client';
import { PaymentService } from '../../src/services/payments/payment.service';
import { createLogger, type Logger } from '../../src/utils/logger';
import { NO_RATE_LIMITS, registerAndLogin, TEST_JWT_SECRET } from './auth';

/** Limites de connexion admin très hautes : les tests fonctionnels ne déclenchent pas le 429. */
export const NO_ADMIN_LOGIN_LIMITS: AdminLoginLimits = {
  perAccount: { windowMs: 60_000, max: 1_000_000 },
  perEmail: { windowMs: 60_000, max: 1_000_000 },
  perIp: { windowMs: 60_000, max: 1_000_000 },
};

/** Lecture du statut chez CinetPay, simulée : aucun appel réseau, aucun paiement réel. */
export class FakeCinetPayStatus {
  readonly remote = new Map<string, Omit<CinetPayPaymentStatus, 'code'>>();
  calls = 0;
  fail = false;

  getPaymentStatus(identifier: string): Promise<CinetPayPaymentStatus> {
    this.calls += 1;
    if (this.fail) return Promise.reject(new Error('CinetPay injoignable (simulé)'));
    const remote = this.remote.get(identifier);
    if (!remote) return Promise.reject(new Error('inconnu'));
    return Promise.resolve({ code: remote.status === 'SUCCESS' ? 100 : 2002, ...remote });
  }
}

export interface AdminTestContext {
  app: Express;
  auth: AuthService;
  cinetpay: FakeCinetPayStatus;
  logLines: Record<string, unknown>[];
  now(): Date;
  advance(ms: number): void;
}

/**
 * Application complète (authentification, paiements, administration) sur une base PGlite
 * migrée, avec une horloge partagée contrôlée par le test.
 */
export function createAdminTestApp(
  sql: SqlClient,
  options: {
    loginLimits?: AdminLoginLimits;
    cinetpay?: boolean;
    extra?: Partial<AppDependencies>;
    logger?: Logger;
  } = {},
): AdminTestContext {
  let current = new Date('2026-10-09T08:00:00Z');
  const clock = () => current;
  const logLines: Record<string, unknown>[] = [];
  const logger = options.logger ?? createLogger({}, (line) => logLines.push(JSON.parse(line)));
  const auth = createAuthService(
    sql,
    {
      jwtSecret: TEST_JWT_SECRET,
      accessTokenTtlSeconds: 15 * 60,
      refreshTokenTtlSeconds: 30 * 24 * 3600,
      bcryptCost: 4,
      clock,
    },
    logger,
  );
  const cinetpay = new FakeCinetPayStatus();
  const payments = new PaymentService({
    payments: new PostgresPaymentRepository(sql),
    ...(options.cinetpay !== false && { cinetpay }),
    logger,
    clock,
  });
  const admin = createAdminServices({ sql, auth, logger, payments, clock });
  const app = createApp({
    logger,
    auth,
    authRateLimits: NO_RATE_LIMITS,
    payments,
    admin: {
      ...admin,
      loginLimits: options.loginLimits ?? NO_ADMIN_LOGIN_LIMITS,
      system: { nodeEnv: 'test', cinetpay: options.cinetpay === false ? null : 'sandbox' },
    },
    ...options.extra,
  });
  return {
    app,
    auth,
    cinetpay,
    logLines,
    now: clock,
    advance: (ms) => {
      current = new Date(current.getTime() + ms);
    },
  };
}

export interface AdminSession {
  userId: string;
  email: string;
  password: string;
  accessToken: string;
  refreshToken: string;
}

/**
 * Compte administrateur : inscription normale, rôle `admin` attribué comme le fait
 * `npm run user:role` (même SQL), puis connexion à l'administration.
 */
export async function createAdmin(app: Express, sql: SqlClient): Promise<AdminSession> {
  const account = await registerAndLogin(app);
  await sql.query(`UPDATE users SET role = 'admin' WHERE id = $1`, [account.userId]);
  return adminLogin(app, account.email, account.password, account.userId);
}

export async function adminLogin(
  app: Express,
  email: string,
  password: string,
  userId?: string,
): Promise<AdminSession> {
  const res = await request(app)
    .post('/api/admin/auth/login')
    .send({ email, password })
    .expect(200);
  return {
    userId: userId ?? res.body.user.id,
    email,
    password,
    accessToken: res.body.accessToken,
    refreshToken: res.body.refreshToken,
  };
}

/** Client HTTP authentifié par un jeton d'administration. */
export function asAdmin(app: Express, token: string) {
  const auth = `Bearer ${token}`;
  return {
    get: (path: string) => request(app).get(path).set('Authorization', auth),
    post: (path: string, body: object = {}) =>
      request(app).post(path).set('Authorization', auth).send(body),
    patch: (path: string, body: object = {}) =>
      request(app).patch(path).set('Authorization', auth).send(body),
  };
}

/**
 * Achat CinetPay en attente, inséré directement (même forme que le flux réel D-050) :
 * transaction `deposit` pending + paiement PENDING initialisé (référence, empreinte du jeton).
 */
export async function seedPendingPayment(
  sql: SqlClient,
  userId: string,
  options: { amount?: number; tokens?: number; createdAt?: Date; reference?: string | null } = {},
) {
  const amount = options.amount ?? 1000;
  const tokens = options.tokens ?? amount;
  const at = (options.createdAt ?? new Date('2026-10-09T07:00:00Z')).toISOString();
  const walletTransactionId = randomUUID();
  const paymentId = randomUUID();
  const merchant = `LT${randomUUID().replace(/-/g, '').slice(0, 20)}`;
  const reference = options.reference === undefined ? `cp-${randomUUID()}` : options.reference;
  await sql.query(
    `INSERT INTO wallets (user_id, balance, created_at, updated_at) VALUES ($1, 0, $2, $2)
     ON CONFLICT (user_id) DO NOTHING`,
    [userId, at],
  );
  await sql.query(
    `INSERT INTO wallet_transactions (id, user_id, kind, status, tokens, idempotency_key,
       created_at, updated_at)
     VALUES ($1, $2, 'deposit', 'pending', $3, $4, $5, $5)`,
    [walletTransactionId, userId, tokens, randomUUID(), at],
  );
  await sql.query(
    `INSERT INTO payments (id, wallet_transaction_id, provider, merchant_transaction_id,
       provider_reference, amount, currency, status, notify_token_hash, created_at, updated_at)
     VALUES ($1, $2, 'cinetpay', $3, $4, $5, 'XAF', 'PENDING', $6, $7, $7)`,
    [
      paymentId,
      walletTransactionId,
      merchant,
      reference,
      amount,
      reference ? createHash('sha256').update(`notify-${paymentId}`).digest('hex') : null,
      at,
    ],
  );
  return { paymentId, walletTransactionId, merchant, reference };
}

/**
 * Administration à brancher dans une application de test existante (`createApp({ admin })`) :
 * toutes les routes /api/admin/* exigent une session d'administration (D-061).
 */
export function testAdminDependencies(sql: SqlClient, auth: AuthService, logger: Logger) {
  return {
    ...createAdminServices({ sql, auth, logger }),
    loginLimits: NO_ADMIN_LOGIN_LIMITS,
    system: { nodeEnv: 'test', cinetpay: null },
  };
}
