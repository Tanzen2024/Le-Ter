import { randomUUID } from 'node:crypto';

import type { Express } from 'express';
import request from 'supertest';

import type { SqlClient } from '../../src/database/sql-client';
import {
  ModelUnavailableError,
  type LanguageModel,
  type ModelRequest,
} from '../../src/services/ai/language-model';
import {
  createComplaintServices,
  type ComplaintServices,
} from '../../src/services/complaints/create-complaint-services';
import { silentLogger } from '../../src/utils/logger';
import { createAdminTestApp, type AdminTestContext } from './admin';

/**
 * Faux modèle de langage : aucune requête réseau, aucun coût. Chaque appel reçoit la requête
 * complète (pour vérifier ce qui serait transmis au fournisseur) et renvoie la réponse prévue.
 */
export class FakeLanguageModel implements LanguageModel {
  readonly provider = 'fake';
  readonly model = 'fake-model';
  readonly requests: ModelRequest[] = [];
  /** Réponses successives ; une fonction peut lire la requête ; une erreur simule une panne. */
  responses: (string | Error | ((request: ModelRequest) => string))[] = [];
  /** Réponse quand la file est vide. */
  fallback: string | Error = new ModelUnavailableError('NETWORK');

  generate(request: ModelRequest): Promise<string> {
    this.requests.push(request);
    const next = this.responses.shift() ?? this.fallback;
    if (next instanceof Error) return Promise.reject(next);
    return Promise.resolve(typeof next === 'function' ? next(request) : next);
  }
}

export const analysis = (overrides: Record<string, unknown> = {}) =>
  JSON.stringify({
    category: 'OTHER',
    confidence: 'high',
    references: {},
    tools: [],
    needsHuman: false,
    playerWantsComplaint: false,
    ...overrides,
  });

export const reply = (text: string, suggestComplaint = false) =>
  JSON.stringify({ reply: text, suggestComplaint });

export interface ComplaintTestContext {
  app: Express;
  ctx: AdminTestContext;
  services: ComplaintServices;
}

/** Application complète (auth, administration, réclamations) ; `model` absent = mode dégradé. */
export function createComplaintTestApp(
  sql: SqlClient,
  options: { model?: LanguageModel; maxTurns?: number } = {},
): ComplaintTestContext {
  // L'horloge du service suit celle de l'application, créée juste après.
  const holder: { ctx?: AdminTestContext } = {};
  const services = createComplaintServices({
    sql,
    logger: silentLogger,
    ...(options.model && { model: options.model }),
    limits: { playerMessagesPerHour: 1000, maxTurnsPerConversation: options.maxTurns ?? 15 },
    clock: () => holder.ctx?.now() ?? new Date('2026-10-09T08:00:00Z'),
  });
  const ctx = createAdminTestApp(sql, {
    extra: {
      complaints: {
        complaints: services.complaints,
        assistant: services.assistant,
        limits: { assistantMessagesPerHour: 1000 },
      },
    },
  });
  holder.ctx = ctx;
  return { app: ctx.app, ctx, services };
}

export function as(app: Express, token: string) {
  const auth = `Bearer ${token}`;
  return {
    get: (path: string) => request(app).get(path).set('Authorization', auth),
    post: (path: string, body: object = {}, key?: string) => {
      const req = request(app).post(path).set('Authorization', auth);
      if (key) req.set('Idempotency-Key', key);
      return req.send(body);
    },
    upload: (path: string, data: Buffer, contentType: string) =>
      request(app)
        .post(path)
        .set('Authorization', auth)
        .set('Content-Type', contentType)
        .send(data),
  };
}

export const key = () => `key-${randomUUID()}`;

export function complaintBody(overrides: Record<string, unknown> = {}) {
  return {
    category: 'PAYMENT',
    title: 'Recharge non créditée',
    description: 'Mon paiement MTN Money a été validé mais mon compte n’a pas été crédité.',
    ...overrides,
  };
}

/** Partie terminée entre deux joueurs, réglée ou non, gain crédité ou non (SQL réel). */
export async function seedFinishedGame(
  sql: SqlClient,
  winnerId: string,
  loserId: string,
  options: { settled?: boolean; credited?: boolean; at?: string } = {},
) {
  const at = options.at ?? '2026-10-09T07:30:00Z';
  const sessionId = randomUUID();
  const gameId = randomUUID();
  await sql.query(
    `INSERT INTO sessions (id, version, status, creator_id, created_at, updated_at, max_players)
     VALUES ($1, 1, 'open', $2, $3, $3, 2)`,
    [sessionId, winnerId, at],
  );
  await sql.query(
    `INSERT INTO games (id, version, status, creator_id, max_players, state, created_at, updated_at,
       started_at, finished_at, session_id, first_player_id, winner_id, end_reason, stake_amount)
     VALUES ($1, 1, 'finished', $2, 2, '{}'::jsonb, $3, $3, $3, $3, $4, $2, $2,
       'CONTROL_AFTER_LAST_TRICK', 100)`,
    [gameId, winnerId, at, sessionId],
  );
  for (const [seat, player] of [winnerId, loserId].entries()) {
    await sql.query(
      `INSERT INTO game_players (game_id, player_id, seat, joined_at, active, table_position)
       VALUES ($1, $2, $3, $4, true, $5)`,
      [gameId, player, seat, at, seat],
    );
  }
  if (options.settled) {
    await sql.query(
      `INSERT INTO game_settlements (game_id, session_id, stake, reserved_per_player, commission_bps,
         status, outcome, winner_id, participants, unit_amount, gross_amount, commission_amount,
         net_gain, opened_at, settled_at)
       VALUES ($1, $2, 100, 200, 500, 'SETTLED', 'SIMPLE', $3, 2, 100, 200, 10, 190, $4, $4)`,
      [gameId, sessionId, winnerId, at],
    );
  }
  if (options.credited) {
    await sql.query(
      `INSERT INTO wallets (user_id, balance, created_at, updated_at) VALUES ($1, 0, $2, $2)
       ON CONFLICT (user_id) DO NOTHING`,
      [winnerId, at],
    );
    await sql.query(
      `INSERT INTO wallet_transactions (id, user_id, kind, status, tokens, idempotency_key,
         created_at, updated_at, completed_at, game_id)
       VALUES ($1, $2, 'game_winnings', 'succeeded', 190, $3, $4, $4, $4, $5)`,
      [randomUUID(), winnerId, `winnings-${gameId}`, at, gameId],
    );
  }
  return { gameId, sessionId };
}

/** Soldes et écritures d'un joueur : preuve que l'assistant n'a rien modifié. */
export async function financialSnapshot(sql: SqlClient, userId: string) {
  const wallet = await sql.query('SELECT balance, reserved FROM wallets WHERE user_id = $1', [
    userId,
  ]);
  const entries = await sql.query(
    'SELECT id, kind, status, tokens FROM wallet_transactions WHERE user_id = $1 ORDER BY id',
    [userId],
  );
  const payments = await sql.query(
    `SELECT p.id, p.status FROM payments p JOIN wallet_transactions wt ON wt.id = p.wallet_transaction_id
     WHERE wt.user_id = $1 ORDER BY p.id`,
    [userId],
  );
  const games = await sql.query('SELECT id, status, winner_id FROM games ORDER BY id');
  return JSON.stringify([wallet.rows, entries.rows, payments.rows, games.rows]);
}
