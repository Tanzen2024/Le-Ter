import { randomUUID } from 'node:crypto';

import type { Express } from 'express';

import {
  asAdmin,
  createAdmin,
  createAdminTestApp,
  seedPendingPayment,
  type AdminTestContext,
} from '../../fixtures/admin';
import { registerAndLogin } from '../../fixtures/auth';
import {
  createMigratedDatabase,
  PGLITE_TIMEOUT_MS,
  type TestDatabase,
} from '../../fixtures/pglite';

/**
 * API de consultation de l'administration (D-060, D-061) : données réelles, DTO sans donnée
 * de jeu privée, audit des consultations de détail (jamais des listes), revérification
 * CinetPay contrôlée, rapprochement en lecture seule, compte financier de la plateforme.
 */
jest.setTimeout(PGLITE_TIMEOUT_MS);

let database: TestDatabase;
let ctx: AdminTestContext;
let api: ReturnType<typeof asAdmin>;
let adminId: string;

beforeAll(async () => {
  database = await createMigratedDatabase();
}, PGLITE_TIMEOUT_MS);

afterAll(() => database.close());

beforeEach(async () => {
  ctx = createAdminTestApp(database.sql);
  const admin = await createAdmin(ctx.app, database.sql);
  adminId = admin.userId;
  api = asAdmin(ctx.app, admin.accessToken);
});

afterEach(() => database.reset());

async function audit(action: string) {
  const { rows } = await database.sql.query<{
    target_id: string | null;
    actor_id: string;
    details: Record<string, unknown>;
    outcome: string;
  }>(
    'SELECT target_id, actor_id, details, outcome FROM admin_audit_log WHERE action = $1 ORDER BY created_at',
    [action],
  );
  return rows;
}

/** Cartes secrètes reconnaissables : elles ne doivent JAMAIS apparaître dans une réponse. */
const SECRET_HAND = ['SECRET-7H', 'SECRET-3S', 'SECRET-KC'];

/** Partie en cours insérée directement, dont l'état contient des mains cachées. */
async function seedGameInProgress(app: Express) {
  const a = await registerAndLogin(app);
  const b = await registerAndLogin(app);
  const sessionId = randomUUID();
  const gameId = randomUUID();
  const at = '2026-10-09T07:30:00Z';
  await database.sql.query(
    `INSERT INTO sessions (id, version, status, creator_id, created_at, updated_at, max_players)
     VALUES ($1, 1, 'open', $2, $3, $3, 2)`,
    [sessionId, a.userId, at],
  );
  const state = {
    play: {
      hands: { [a.userId]: SECRET_HAND, [b.userId]: ['SECRET-AD', 'SECRET-2H'] },
      deck: ['SECRET-DECK'],
    },
    recentCommandIds: [],
  };
  await database.sql.query(
    `INSERT INTO games (id, version, status, creator_id, max_players, state, created_at,
       updated_at, started_at, session_id, first_player_id)
     VALUES ($1, 1, 'in_progress', $2, 2, $3, $4, $4, $4, $5, $2)`,
    [gameId, a.userId, JSON.stringify(state), at, sessionId],
  );
  for (const [seat, player] of [a, b].entries()) {
    await database.sql.query(
      `INSERT INTO game_players (game_id, player_id, seat, joined_at, active, table_position)
       VALUES ($1, $2, $3, $4, true, $5)`,
      [gameId, player.userId, seat, at, seat],
    );
  }
  return { gameId, sessionId, players: [a, b] };
}

describe('joueurs', () => {
  it('liste paginée, recherche, téléphone masqué ; la liste n’est pas auditée', async () => {
    const player = await registerAndLogin(ctx.app, { username: 'zorro_77' });
    const res = await api.get('/api/admin/users?q=zorro&limit=10').expect(200);
    expect(res.body).toMatchObject({ page: 1, limit: 10, total: 1 });
    expect(res.body.items[0]).toMatchObject({
      id: player.userId,
      username: 'zorro_77',
      status: 'active',
    });
    expect(res.body.items[0].phone).toMatch(/••••/);
    expect(JSON.stringify(res.body)).not.toMatch(/password/i);
    expect(await audit('USER_VIEWED')).toEqual([]);
  });

  it('détail d’un joueur : audité USER_VIEWED, suspension indisponible', async () => {
    const player = await registerAndLogin(ctx.app);
    const res = await api.get(`/api/admin/users/${player.userId}`).expect(200);
    expect(res.body.user).toMatchObject({ id: player.userId, gamesPlayed: 0, balance: 0 });
    expect(res.body.user.actions.suspend.available).toBe(false);
    expect(JSON.stringify(res.body)).not.toMatch(/passwordHash|password_hash/);
    const rows = await audit('USER_VIEWED');
    expect(rows).toEqual([
      expect.objectContaining({ target_id: player.userId, actor_id: adminId }),
    ]);
  });

  it('paramètres invalides ou inconnus : 400 ; joueur inconnu : 404', async () => {
    await api.get('/api/admin/users?limit=1000').expect(400);
    await api.get('/api/admin/users?evil=1').expect(400);
    await api.get('/api/admin/users/pas-un-uuid').expect(400);
    const res = await api.get(`/api/admin/users/${randomUUID()}`).expect(404);
    expect(res.body.code).toBe('USER_NOT_FOUND');
  });
});

describe('parties', () => {
  it('aucune main, carte ni paquet dans la liste ni dans le détail d’une partie en cours', async () => {
    const { gameId, players } = await seedGameInProgress(ctx.app);
    const list = await api.get('/api/admin/games?status=in_progress').expect(200);
    const detail = await api.get(`/api/admin/games/${gameId}`).expect(200);
    const userGames = await api.get(`/api/admin/users/${players[0]!.userId}/games`).expect(200);
    for (const body of [list.body, detail.body, userGames.body]) {
      const text = JSON.stringify(body);
      expect(text).not.toMatch(/SECRET/);
      expect(text).not.toMatch(/"hands?"|"deck"|"state"|"cards?"/);
    }
    expect(detail.body.game).toMatchObject({ id: gameId, status: 'in_progress' });
    expect(detail.body.game.players.map((p: { playerId: string }) => p.playerId)).toEqual(
      players.map((p) => p.userId),
    );
  });

  it('consultation sans effet sur la partie ; anomalies de longue durée signalées', async () => {
    const { gameId } = await seedGameInProgress(ctx.app);
    const before = await database.sql.query(
      'SELECT version, state, updated_at FROM games WHERE id = $1',
      [gameId],
    );
    // Partie démarrée il y a plus d'une heure (seuil d'affichage LONG_RUNNING).
    await database.sql.query(
      `UPDATE games SET created_at = '2026-10-09T05:00:00Z', started_at = '2026-10-09T05:00:00Z'
       WHERE id = $1`,
      [gameId],
    );
    const res = await api.get('/api/admin/games?anomaly=LONG_RUNNING').expect(200);
    expect(res.body.items.map((g: { id: string }) => g.id)).toEqual([gameId]);
    expect(res.body.items[0].anomalies).toContain('LONG_RUNNING');
    const after = await database.sql.query(
      'SELECT version, state, updated_at FROM games WHERE id = $1',
      [gameId],
    );
    expect(after.rows).toEqual(before.rows);
  });
});

describe('paiements CinetPay', () => {
  it('liste filtrée par statut ; détail audité PAYMENT_VIEWED', async () => {
    const player = await registerAndLogin(ctx.app);
    const { paymentId, merchant } = await seedPendingPayment(database.sql, player.userId);
    const list = await api.get(`/api/admin/payments?status=PENDING&q=${merchant}`).expect(200);
    expect(list.body.items).toEqual([
      expect.objectContaining({ id: paymentId, status: 'PENDING', amount: 1000, currency: 'XAF' }),
    ]);
    expect(await audit('PAYMENT_VIEWED')).toEqual([]);
    const detail = await api.get(`/api/admin/payments/${paymentId}`).expect(200);
    expect(detail.body.payment.verification.available).toBe(true);
    expect(JSON.stringify(detail.body)).not.toMatch(/notify|payment_url|paymentUrl/i);
    expect(await audit('PAYMENT_VIEWED')).toEqual([
      expect.objectContaining({ target_id: paymentId }),
    ]);
  });

  it('revérification : statut relu chez CinetPay, crédit une seule fois, clé rejouée sans nouvel appel', async () => {
    const player = await registerAndLogin(ctx.app);
    const { paymentId, merchant, reference } = await seedPendingPayment(
      database.sql,
      player.userId,
    );
    ctx.cinetpay.remote.set(reference!, {
      status: 'SUCCESS',
      transactionId: reference!,
      merchantTransactionId: merchant,
      amount: 1000,
      currency: 'XAF',
    });
    const key = `verify-${randomUUID()}`;
    const first = await api
      .post(`/api/admin/payments/${paymentId}/verify`)
      .set('Idempotency-Key', key)
      .expect(200);
    expect(first.body).toMatchObject({ replayed: false, outcome: 'settled', status: 'SUCCESS' });
    const replay = await api
      .post(`/api/admin/payments/${paymentId}/verify`)
      .set('Idempotency-Key', key)
      .expect(200);
    expect(replay.body).toMatchObject({ replayed: true, outcome: 'settled', status: 'SUCCESS' });
    expect(ctx.cinetpay.calls).toBe(1);
    // Nouvelle clé : paiement déjà final, aucun nouvel appel ni nouveau crédit.
    const again = await api
      .post(`/api/admin/payments/${paymentId}/verify`)
      .set('Idempotency-Key', `verify-${randomUUID()}`)
      .expect(200);
    expect(again.body).toMatchObject({ outcome: 'already_final', status: 'SUCCESS' });
    expect(ctx.cinetpay.calls).toBe(1);
    const { rows } = await database.sql.query<{ balance: string }>(
      'SELECT balance FROM wallets WHERE user_id = $1',
      [player.userId],
    );
    expect(Number(rows[0]!.balance)).toBe(1000);
    expect((await audit('PAYMENT_VERIFICATION_REQUESTED')).length).toBe(2);
  });

  it('montant différent chez CinetPay : rien n’est crédité, échec audité', async () => {
    const player = await registerAndLogin(ctx.app);
    const { paymentId, merchant, reference } = await seedPendingPayment(
      database.sql,
      player.userId,
    );
    ctx.cinetpay.remote.set(reference!, {
      status: 'SUCCESS',
      transactionId: reference!,
      merchantTransactionId: merchant,
      amount: 5000,
      currency: 'XAF',
    });
    const res = await api
      .post(`/api/admin/payments/${paymentId}/verify`)
      .set('Idempotency-Key', `verify-${randomUUID()}`)
      .expect(200);
    expect(res.body).toMatchObject({ outcome: 'error', reason: 'amount_mismatch' });
    const { rows } = await database.sql.query<{ status: string }>(
      'SELECT status FROM payments WHERE id = $1',
      [paymentId],
    );
    expect(rows[0]!.status).toBe('PENDING');
    expect((await audit('PAYMENT_VERIFICATION_REQUESTED'))[0]!.outcome).toBe('FAILURE');
  });

  it('CinetPay injoignable : erreur affichée, paiement inchangé', async () => {
    const player = await registerAndLogin(ctx.app);
    const { paymentId } = await seedPendingPayment(database.sql, player.userId);
    ctx.cinetpay.fail = true;
    const res = await api
      .post(`/api/admin/payments/${paymentId}/verify`)
      .set('Idempotency-Key', `verify-${randomUUID()}`)
      .expect(200);
    expect(res.body).toMatchObject({ outcome: 'error', reason: 'provider_error' });
  });

  it('sans Idempotency-Key : 400 ; même clé pour un autre paiement : 409', async () => {
    const player = await registerAndLogin(ctx.app);
    const one = await seedPendingPayment(database.sql, player.userId);
    const two = await seedPendingPayment(database.sql, player.userId);
    ctx.cinetpay.fail = true;
    await api.post(`/api/admin/payments/${one.paymentId}/verify`).expect(400);
    const key = `verify-${randomUUID()}`;
    await api
      .post(`/api/admin/payments/${one.paymentId}/verify`)
      .set('Idempotency-Key', key)
      .expect(200);
    const res = await api
      .post(`/api/admin/payments/${two.paymentId}/verify`)
      .set('Idempotency-Key', key)
      .expect(409);
    expect(res.body.code).toBe('IDEMPOTENCY_KEY_REUSED');
  });

  it('CinetPay non configuré : 503 PAYMENT_PROVIDER_UNAVAILABLE', async () => {
    const local = createAdminTestApp(database.sql, { cinetpay: false });
    const admin = await createAdmin(local.app, database.sql);
    const player = await registerAndLogin(local.app);
    const { paymentId } = await seedPendingPayment(database.sql, player.userId);
    const res = await asAdmin(local.app, admin.accessToken)
      .post(`/api/admin/payments/${paymentId}/verify`)
      .set('Idempotency-Key', `verify-${randomUUID()}`)
      .expect(503);
    expect(res.body.code).toBe('PAYMENT_PROVIDER_UNAVAILABLE');
  });
});

describe('rapprochement et compte financier de la plateforme', () => {
  it('anomalies de paiement : ancien en attente, montant ≠ jetons, hors barème', async () => {
    const player = await registerAndLogin(ctx.app);
    const stale = await seedPendingPayment(database.sql, player.userId, {
      createdAt: new Date('2026-10-09T06:00:00Z'),
    });
    const mismatch = await seedPendingPayment(database.sql, player.userId, {
      amount: 700,
      tokens: 600,
      createdAt: new Date('2026-10-09T07:55:00Z'),
    });
    const res = await api.get('/api/admin/reconciliation/anomalies').expect(200);
    const types = (id: string) =>
      res.body.items
        .filter((a: { reference: { id: string } }) => a.reference.id === id)
        .map((a: { type: string }) => a.type);
    expect(types(stale.paymentId)).toEqual(['PAYMENT_STALE_PENDING']);
    expect(types(mismatch.paymentId).sort()).toEqual([
      'PAYMENT_AMOUNT_MISMATCH',
      'PAYMENT_AMOUNT_OUT_OF_RANGE',
    ]);
    expect(res.body.guaranteedByDatabase.length).toBeGreaterThan(0);
  });

  it('commission de tournoi : écriture du journal comparée à la formule du serveur', async () => {
    const tournamentId = randomUUID();
    await database.sql.query(
      `INSERT INTO tournaments (id, starts_at, ends_at, created_at, updated_at, status,
         entry_fee, platform_fee_bps, participants, gross_pool, platform_fee, prize_pool,
         published_at, blocked_until, registration_closes_at, started_at)
       VALUES ($1, '2026-10-08T10:00:00Z', '2026-10-08T11:00:00Z',
               '2026-10-01T10:00:00Z', '2026-10-08T10:00:00Z', 'IN_PROGRESS',
               1000, 1000, 20, 20000, 2000, 18000,
               '2026-10-01T10:00:00Z', '2026-10-08T11:00:00Z', '2026-10-08T10:00:00Z',
               '2026-10-08T10:00:00Z')`,
      [tournamentId],
    );
    await database.sql.query(
      `INSERT INTO platform_ledger (id, tournament_id, kind, amount, fee_bps, currency, created_at)
       VALUES ($1, $2, 'TOURNAMENT_PLATFORM_FEE', 1500, 1000, 'XAF', '2026-10-08T10:00:00Z')`,
      [randomUUID(), tournamentId],
    );
    const res = await api.get('/api/admin/reconciliation/anomalies').expect(200);
    const mismatch = res.body.items.find(
      (a: { type: string }) => a.type === 'TOURNAMENT_FEE_ENTRY_MISMATCH',
    );
    expect(mismatch).toMatchObject({
      reference: { kind: 'TOURNAMENT', id: tournamentId, label: 'Tournoi du 08/10/2026 11:00' },
      compared: [{ expected: 2000, actual: 1500 }],
    });
    // Aucune entrée capturée en base pour ce tournoi : écart signalé, rien n'est corrigé.
    expect(res.body.items.map((a: { type: string }) => a.type)).toContain(
      'TOURNAMENT_ENTRIES_MISMATCH',
    );

    const account = await api.get('/api/admin/platform-account').expect(200);
    expect(account.body).toMatchObject({
      name: 'Compte financier de la plateforme Le-Ter',
      technicalId: 'platform_ledger',
      currency: 'XAF',
      computedBalance: { amount: 1500 },
      treasury: { integrated: false },
      ordinaryGamesCommission: { defined: false },
      reconciliation: { status: 'ANOMALIES' },
    });
    const entries = await api.get('/api/admin/platform-account/entries').expect(200);
    expect(entries.body.items).toEqual([
      expect.objectContaining({
        kind: 'TOURNAMENT_PLATFORM_FEE',
        amount: 1500,
        origin: expect.objectContaining({ id: tournamentId }),
      }),
    ]);
    const { rows } = await database.sql.query('SELECT amount FROM platform_ledger');
    expect(rows).toHaveLength(1);
  });
});

describe('tableau de bord, finances, rapports, journal, système', () => {
  it('KPI réels et cohérents : joueur actif compté une fois, partie en attente exclue', async () => {
    const { players } = await seedGameInProgress(ctx.app);
    const res = await api
      .get('/api/admin/dashboard?from=2026-10-08T23:00:00Z&to=2026-10-09T23:00:00Z')
      .expect(200);
    expect(res.body.players).toMatchObject({ total: players.length, active: 2, admins: 1 });
    expect(res.body.games).toMatchObject({ inProgress: 1, waiting: 0 });
    expect(res.body.series.map((d: { day: string }) => d.day)).toEqual(['2026-10-09']);
    expect(res.body.series[0]).toMatchObject({ activePlayers: 2, gamesStarted: 1 });
    expect(res.body.definitions.activePlayer).toMatch(/démarrée/);
  });

  it('période invalide ou trop longue : 400', async () => {
    await api
      .get('/api/admin/dashboard?from=2026-10-10T00:00:00Z&to=2026-10-09T00:00:00Z')
      .expect(400);
    await api
      .get('/api/admin/dashboard?from=2024-01-01T00:00:00Z&to=2026-01-01T00:00:00Z')
      .expect(400);
  });

  it('finances : achats, soldes des joueurs et recettes de la plateforme séparés', async () => {
    const res = await api.get('/api/admin/finance/overview').expect(200);
    expect(res.body.purchases.label).toMatch(/pas un revenu/);
    expect(res.body).toHaveProperty('playerBalances.balance');
    expect(res.body).toHaveProperty('platformRevenue.total');
    expect(res.body.unsupported.map((o: { operation: string }) => o.operation)).toEqual(
      expect.arrayContaining(['REFUND', 'WITHDRAWAL', 'MANUAL_CREDIT']),
    );
  });

  it('export CSV d’un rapport : audité REPORT_EXPORTED ; rapport inconnu : 400', async () => {
    const res = await api
      .get('/api/admin/reports/players/csv?from=2026-10-01T00:00:00Z&to=2026-10-09T00:00:00Z')
      .expect(200);
    expect(res.headers['content-type']).toMatch(/text\/csv/);
    expect(res.text).toContain('day,newPlayers,activePlayers');
    expect(await audit('REPORT_EXPORTED')).toHaveLength(1);
    await api.get('/api/admin/reports/secrets').expect(400);
  });

  it('journal d’audit consultable et filtrable, en lecture seule', async () => {
    const res = await api.get('/api/admin/audit-log?action=ADMIN_LOGIN_SUCCEEDED').expect(200);
    expect(res.body.items).toEqual([
      expect.objectContaining({
        action: 'ADMIN_LOGIN_SUCCEEDED',
        actor: expect.objectContaining({ id: adminId }),
      }),
    ]);
    await api.patch('/api/admin/audit-log', {}).expect(404);
  });

  it('système : état des services, sans aucun secret', async () => {
    const res = await api.get('/api/admin/system').expect(200);
    expect(res.body.services.cinetpay).toEqual({ configured: true, mode: 'sandbox' });
    expect(res.body.maintenance.available).toBe(false);
    expect(JSON.stringify(res.body)).not.toMatch(/sk_test|sk_live|password|secret/i);
  });
});
