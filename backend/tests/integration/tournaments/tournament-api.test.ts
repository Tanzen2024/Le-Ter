import request from 'supertest';

import type { UserId } from '../../../src/domain/users/user';
import { adminLogin } from '../../fixtures/admin';
import { registerAndLogin } from '../../fixtures/auth';
import {
  createMigratedDatabase,
  PGLITE_TIMEOUT_MS,
  type TestDatabase,
} from '../../fixtures/pglite';
import {
  createTournamentTestStack,
  fillWith,
  fund,
  HOUR,
  TestClock,
  type TournamentTestStack,
} from '../../fixtures/tournaments';

/**
 * API HTTP des tournois (D-054) : authentification, rôle admin, inscription avec
 * réservation, table attribuée, résultats, export, notifications. Codes d'erreur stables.
 */
jest.setTimeout(60_000);

let database: TestDatabase;
let stack: TournamentTestStack;

beforeAll(async () => {
  database = await createMigratedDatabase();
}, PGLITE_TIMEOUT_MS);
afterAll(() => database.close());
beforeEach(() => {
  stack = createTournamentTestStack(database.sql, new TestClock());
});
afterEach(async () => {
  await stack.stop();
  await database.reset();
});

async function user(balance = 0, role: 'user' | 'admin' = 'user') {
  const session = await registerAndLogin(stack.app);
  const id = session.userId as UserId;
  if (role === 'admin')
    await database.sql.query(`UPDATE users SET role = 'admin' WHERE id = $1`, [id]);
  if (balance > 0) await fund(database.sql, id, balance);
  // Toute route /api/admin/* exige une session d'administration (D-061).
  const token =
    role === 'admin'
      ? (await adminLogin(stack.app, session.email, session.password, id)).accessToken
      : session.accessToken;
  const auth = `Bearer ${token}`;
  return {
    id,
    get: (path: string) => request(stack.app).get(path).set('Authorization', auth),
    post: (path: string, body: object = {}) =>
      request(stack.app).post(path).set('Authorization', auth).send(body),
    patch: (path: string, body: object) =>
      request(stack.app).patch(path).set('Authorization', auth).send(body),
  };
}

function body(startsInMs = HOUR, extra: Record<string, unknown> = {}) {
  const startsAt = new Date(stack.clock.now().getTime() + startsInMs);
  return {
    startsAt: startsAt.toISOString(),
    endsAt: new Date(startsAt.getTime() + 2 * HOUR).toISOString(),
    entryFee: 1000,
    minimumPlayers: 20,
    maximumPlayers: 50,
    prizeRules: [
      { rank: 1, percent: 50 },
      { rank: 2, percent: 30 },
      { rank: 3, percent: 20 },
    ],
    ...extra,
  };
}

describe('accès', () => {
  it('401 sans jeton ; 403 pour un joueur sur l’administration', async () => {
    await request(stack.app).get('/api/tournaments/active').expect(401);
    const player = await user();
    const res = await player.post('/api/admin/tournaments', body());
    expect(res.status).toBe(403);
  });

  it('aucun tournoi : null et serverNow', async () => {
    const player = await user();
    const res = await player.get('/api/tournaments/active').expect(200);
    expect(res.body.tournament).toBeNull();
    expect(typeof res.body.serverNow).toBe('string');
  });
});

describe('parcours complet', () => {
  it('admin crée → joueur s’inscrit (réservation) → rejoint sa table → résultats et export', async () => {
    const admin = await user(0, 'admin');
    const [ana, ben, cid] = [await user(5000), await user(5000), await user(500)];

    const created = await admin.post('/api/admin/tournaments', body()).expect(201);
    const id = created.body.tournament.tournamentId as string;
    expect(created.body.tournament).toMatchObject({
      status: 'REGISTRATION_OPEN',
      entryFee: 1000,
      currency: 'XAF',
      platformFeePercent: 10,
      prizeRules: [
        { rank: 1, percent: 50 },
        { rank: 2, percent: 30 },
        { rank: 3, percent: 20 },
      ],
    });

    const view = (await ana.get('/api/tournaments/active').expect(200)).body.tournament;
    expect(view).toMatchObject({ tournamentId: id, canRegister: true, registration: null });

    const registered = await ana.post(`/api/tournaments/${id}/register`).expect(201);
    expect(registered.body.tournament.registration).toMatchObject({
      status: 'REGISTERED',
      reservation: { amount: 1000, currency: 'XAF', status: 'ACTIVE' },
    });
    expect((await ana.post(`/api/tournaments/${id}/register`)).body.code).toBe(
      'ALREADY_REGISTERED',
    );
    const poor = await cid.post(`/api/tournaments/${id}/register`);
    expect([poor.status, poor.body.code]).toEqual([409, 'INSUFFICIENT_BALANCE']);
    await ben.post(`/api/tournaments/${id}/register`).expect(201);
    await fillWith(stack, database.sql, id); // minimum de 20 participants (D-057)

    expect((await ana.post(`/api/tournaments/${id}/join`)).body.code).toBe(
      'TOURNAMENT_NOT_STARTED',
    );

    stack.clock.set(new Date(body().startsAt));
    stack.clock.advance(1000);
    const notRegistered = await cid.post(`/api/tournaments/${id}/join`);
    expect([notRegistered.status, notRegistered.body.code]).toEqual([403, 'NOT_REGISTERED']);

    const seat = (await ana.post(`/api/tournaments/${id}/join`).expect(200)).body;
    expect(seat).toEqual({
      tournamentId: id,
      sessionId: expect.any(String),
      gameId: expect.any(String),
    });
    await ana.get(`/api/games/${seat.gameId}`).expect(200);

    const results = await ana.get(`/api/tournaments/${id}/results`);
    expect([results.status, results.body.code]).toEqual([409, 'TOURNAMENT_RESULTS_UNAVAILABLE']);

    // Fin du tournoi : cagnotte 18 000 (20 × 1 000 − 10 %), 50/30/20 → 9 000, 5 400, 3 600.
    stack.clock.advance(3 * HOUR);
    await stack.scheduler.tick();
    const final = (await ana.get(`/api/tournaments/${id}/results`).expect(200)).body;
    const prizes = final.results.map((r: { prizeAmount: number }) => r.prizeAmount);
    expect(prizes).toHaveLength(20);
    expect(prizes.slice(0, 3)).toEqual([9000, 5400, 3600]);
    expect(prizes.slice(3).every((x: number) => x === 0)).toBe(true);
    expect(final.share).toContain('TOURNOI TERMINÉ');
    const csv = await admin.get(`/api/admin/tournaments/${id}/results.csv`).expect(200);
    expect(csv.headers['content-type']).toContain('text/csv');
    expect(csv.text).toContain(
      'Tournament,Player,Rank,Initial Tokens,Remaining Tokens,Games Played,Games Won,Score,Prize Amount',
    );

    const notifications = (await ana.get('/api/notifications').expect(200)).body;
    expect(notifications.unread).toBeGreaterThan(0);
    const first = notifications.notifications[0].id as string;
    await ana.post(`/api/notifications/${first}/read`).expect(200);
    await ben.post(`/api/notifications/${first}/read`).expect(404); // pas la sienne
  });

  it('désinscription libère la réservation ; annulation admin libère tout', async () => {
    const admin = await user(0, 'admin');
    const ana = await user(5000);
    const id = (await admin.post('/api/admin/tournaments', body()).expect(201)).body.tournament
      .tournamentId as string;
    await ana.post(`/api/tournaments/${id}/register`).expect(201);
    const after = await ana.post(`/api/tournaments/${id}/unregister`).expect(200);
    expect(after.body.tournament.registration).toBeNull();
    await ana.post(`/api/tournaments/${id}/register`).expect(201);
    const cancelled = await admin.post(`/api/admin/tournaments/${id}/cancel`).expect(200);
    expect(cancelled.body.tournament).toMatchObject({
      status: 'CANCELLED',
      cancellationReason: 'ADMIN_CANCELLED',
    });
    const regs = (await admin.get(`/api/admin/tournaments/${id}/registrations`).expect(200)).body;
    expect(regs.registrations[0].reservation.status).toBe('RELEASED');
  });
});

describe('confidentialité des brouillons (D-056)', () => {
  it('brouillon : créateur et admin seulement ; un autre joueur reçoit 404 ; visible une fois publié', async () => {
    const admin = await user(0, 'admin');
    const [owner, other] = [await user(), await user()];
    const id = (await owner.post('/api/tournaments', body(2 * HOUR)).expect(201)).body.tournament
      .tournamentId as string;

    await owner.get(`/api/tournaments/${id}`).expect(200);
    for (const path of [`/api/tournaments/${id}`, `/api/tournaments/${id}/standings`]) {
      const res = await other.get(path);
      expect([res.status, res.body.code]).toEqual([404, 'TOURNAMENT_NOT_FOUND']);
    }
    await admin.get(`/api/tournaments/${id}`).expect(200);
    await admin.get(`/api/admin/tournaments/${id}`).expect(200);

    // En attente d'approbation : toujours privé.
    await owner.post(`/api/tournaments/${id}/submit`).expect(200);
    expect((await other.get(`/api/tournaments/${id}`)).status).toBe(404);

    // Publié : visible de tous.
    await admin.post(`/api/admin/tournaments/${id}/approve`).expect(200);
    await other.get(`/api/tournaments/${id}`).expect(200);
  });

  it('proposition refusée (jamais publiée) : reste privée', async () => {
    const admin = await user(0, 'admin');
    const [owner, other] = [await user(), await user()];
    const id = (await owner.post('/api/tournaments', body(2 * HOUR)).expect(201)).body.tournament
      .tournamentId as string;
    await owner.post(`/api/tournaments/${id}/submit`).expect(200);
    await admin.post(`/api/admin/tournaments/${id}/reject`).expect(200);
    expect((await other.get(`/api/tournaments/${id}`)).status).toBe(404);
    await owner.get(`/api/tournaments/${id}`).expect(200);
  });
});

describe('liste d’administration', () => {
  it('créateur, inscrits, dates ; filtre par statut', async () => {
    const admin = await user(0, 'admin');
    const ana = await user(5000);
    const id = (await admin.post('/api/admin/tournaments', body()).expect(201)).body.tournament
      .tournamentId as string;
    await ana.post(`/api/tournaments/${id}/register`).expect(201);
    const proposal = (await ana.post('/api/tournaments', body(6 * HOUR)).expect(201)).body
      .tournament.tournamentId as string;

    const all = (await admin.get('/api/admin/tournaments').expect(200)).body.tournaments;
    expect(all).toHaveLength(2);
    const published = all.find((t: { tournamentId: string }) => t.tournamentId === id);
    expect(published).toMatchObject({
      status: 'REGISTRATION_OPEN',
      creatorType: 'ADMIN',
      registeredCount: 1,
      entryFee: 1000,
      minimumPlayers: 20,
      maximumPlayers: 50,
      platformFeePercent: 10,
      createdAt: expect.any(String),
      creatorName: expect.any(String),
    });
    const drafts = (await admin.get('/api/admin/tournaments?status=DRAFT').expect(200)).body
      .tournaments;
    expect(drafts.map((t: { tournamentId: string }) => t.tournamentId)).toEqual([proposal]);
    expect((await admin.get('/api/admin/tournaments?status=NOPE')).status).toBe(400);
  });
});

describe('proposition par un joueur et paramètres', () => {
  it('joueur propose (brouillon), soumet ; admin approuve ; chevauchement refusé', async () => {
    const admin = await user(0, 'admin');
    const ana = await user();
    const draft = await ana.post('/api/tournaments', body(2 * HOUR)).expect(201);
    expect(draft.body.tournament.status).toBe('DRAFT');
    const id = draft.body.tournament.tournamentId as string;
    expect((await ana.post('/api/tournaments', body(8 * HOUR))).body.code).toBe(
      'TOO_MANY_PENDING_TOURNAMENTS',
    );
    await ana.post(`/api/tournaments/${id}/submit`).expect(200);
    const approved = await admin.post(`/api/admin/tournaments/${id}/approve`).expect(200);
    expect(approved.body.tournament.status).toBe('REGISTRATION_OPEN');
    const overlap = await admin.post('/api/admin/tournaments', body(2 * HOUR + 30 * 60_000));
    expect([overlap.status, overlap.body.code]).toEqual([409, 'TOURNAMENT_OVERLAP']);
  });

  it('validation : répartition à 120 % refusée (400, champ prizeRules)', async () => {
    const admin = await user(0, 'admin');
    const res = await admin.post(
      '/api/admin/tournaments',
      body(HOUR, {
        prizeRules: [
          { rank: 1, percent: 60 },
          { rank: 2, percent: 60 },
        ],
      }),
    );
    expect(res.status).toBe(400);
    expect(res.body.fields).toHaveProperty('prizeRules');
  });

  it('paramètres plateforme : lecture, modification auditée, bornes', async () => {
    const admin = await user(0, 'admin');
    const current = (await admin.get('/api/admin/tournaments/settings').expect(200)).body.settings;
    expect(current).toEqual({
      platformFeePercent: 10,
      initialTournamentTokens: 1000,
      defaultTournamentStake: 100,
      maximumPendingTournamentsPerPlayer: 1,
      tournamentTransitionMinutes: 0,
      rankingTokensWeightPercent: 50,
      rankingGamesWeightPercent: 50,
    });
    const updated = await admin
      .patch('/api/admin/tournaments/settings', { platformFeePercent: 12.5 })
      .expect(200);
    expect(updated.body.settings.platformFeePercent).toBe(12.5);
    const bad = await admin.patch('/api/admin/tournaments/settings', { platformFeePercent: 90 });
    expect(bad.status).toBe(400);
  });
});

describe('règles de durée (D-058) et de participants (D-057)', () => {
  it('durée 29 et 121 min refusées ; 30, 45 et 120 min acceptées ; participants 19 / 1 001 refusés', async () => {
    const admin = await user(0, 'admin');
    const lasting = (startsIn: number, minutes: number, extra: Record<string, unknown> = {}) => {
      const startsAt = new Date(stack.clock.now().getTime() + startsIn);
      return body(startsIn, {
        endsAt: new Date(startsAt.getTime() + minutes * 60_000).toISOString(),
        ...extra,
      });
    };
    for (const minutes of [29, 121]) {
      const res = await admin.post('/api/admin/tournaments', lasting(HOUR, minutes));
      expect([res.status, res.body.fields?.endsAt]).toEqual([
        400,
        'Durée entre 30 minutes et 120 minutes.',
      ]);
    }
    for (const extra of [
      { minimumPlayers: 19 },
      { maximumPlayers: 19 },
      { maximumPlayers: 1001 },
    ]) {
      const res = await admin.post('/api/admin/tournaments', lasting(HOUR, 60, extra));
      expect(res.status).toBe(400);
    }
    await admin.post('/api/admin/tournaments', lasting(HOUR, 45)).expect(201);
    await admin.post('/api/admin/tournaments', lasting(2 * HOUR, 30)).expect(201);
    await admin
      .post('/api/admin/tournaments', lasting(4 * HOUR, 120, { maximumPlayers: 1000 }))
      .expect(201);
  });

  it('les mêmes règles s’appliquent à une proposition de joueur (29 / 121 min refusées, 30 acceptée)', async () => {
    const ana = await user();
    const startsAt = new Date(stack.clock.now().getTime() + 2 * HOUR);
    const lasting = (minutes: number) =>
      body(2 * HOUR, {
        endsAt: new Date(startsAt.getTime() + minutes * 60_000).toISOString(),
      });
    for (const minutes of [29, 121]) {
      const res = await ana.post('/api/tournaments', lasting(minutes));
      expect([res.status, res.body.fields?.endsAt]).toEqual([
        400,
        'Durée entre 30 minutes et 120 minutes.',
      ]);
    }
    await ana.post('/api/tournaments', lasting(30)).expect(201);
  });
});

describe('tournoi complet (D-057)', () => {
  it('capacité atteinte : 409 TOURNAMENT_FULL avec un message convivial, aucune réservation', async () => {
    const admin = await user(0, 'admin');
    const late = await user(5000);
    const id = (
      await admin.post('/api/admin/tournaments', body(HOUR, { maximumPlayers: 20 })).expect(201)
    ).body.tournament.tournamentId as string;
    await fillWith(stack, database.sql, id, 20);
    const res = await late.post(`/api/tournaments/${id}/register`);
    expect([res.status, res.body.code]).toEqual([409, 'TOURNAMENT_FULL']);
    expect(res.body.message).toContain('Tournoi complet 🎉');
    const wallet = await database.sql.query<{ reserved: string }>(
      'SELECT reserved FROM wallets WHERE user_id = $1',
      [late.id],
    );
    expect(Number(wallet.rows[0]!.reserved)).toBe(0);
  });

  it('dernière place disputée par deux requêtes simultanées : une seule inscription', async () => {
    const admin = await user(0, 'admin');
    const [a, b] = [await user(5000), await user(5000)];
    const id = (
      await admin.post('/api/admin/tournaments', body(HOUR, { maximumPlayers: 20 })).expect(201)
    ).body.tournament.tournamentId as string;
    await fillWith(stack, database.sql, id, 19);
    const responses = await Promise.all([
      a.post(`/api/tournaments/${id}/register`),
      b.post(`/api/tournaments/${id}/register`),
    ]);
    expect(responses.map((r) => r.status).sort()).toEqual([201, 409]);
    expect(responses.find((r) => r.status === 409)!.body.code).toBe('TOURNAMENT_FULL');
    expect(await stack.repository.countActiveRegistrations(id as never)).toBe(20);
  });
});

describe('planification et prochain tournoi (D-059)', () => {
  /** Créneau n°i : début dans (1 + 3i) h, durée 1 h. */
  const slot = (i: number, extra: Record<string, unknown> = {}) => {
    const startsAt = new Date(stack.clock.now().getTime() + HOUR + i * 3 * HOUR);
    return body(HOUR + i * 3 * HOUR, {
      endsAt: new Date(startsAt.getTime() + HOUR).toISOString(),
      ...extra,
    });
  };

  it('6e tournoi en attente : 409 TOO_MANY_WAITING_TOURNAMENTS, message compréhensible', async () => {
    const admin = await user(0, 'admin');
    for (let i = 0; i < 5; i += 1) await admin.post('/api/admin/tournaments', slot(i)).expect(201);
    const refused = await admin.post('/api/admin/tournaments', slot(5));
    expect([refused.status, refused.body.code, refused.body.message]).toEqual([
      409,
      'TOO_MANY_WAITING_TOURNAMENTS',
      'Limite atteinte : 5 tournois sont déjà en attente de démarrage. Réessaie dès que l’un d’eux aura commencé.',
    ]);
    const ana = await user();
    const proposal = await ana.post('/api/tournaments', slot(6));
    expect([proposal.status, proposal.body.code]).toEqual([409, 'TOO_MANY_WAITING_TOURNAMENTS']);
  });

  it('chevauchement : 409 TOURNAMENT_OVERLAP ; périodes qui se suivent acceptées', async () => {
    const admin = await user(0, 'admin');
    const start = new Date(stack.clock.now().getTime() + 24 * HOUR);
    const period = (from: number, to: number) =>
      admin.post(
        '/api/admin/tournaments',
        body(0, {
          startsAt: new Date(start.getTime() + from * HOUR).toISOString(),
          endsAt: new Date(start.getTime() + to * HOUR).toISOString(),
        }),
      );
    expect((await period(0, 1)).status).toBe(201);
    expect((await period(1, 2)).status).toBe(201);
    const overlap = await period(0.5, 1.5);
    expect([overlap.status, overlap.body.code]).toEqual([409, 'TOURNAMENT_OVERLAP']);
  });

  it('GET /next : null sans inscription ; sinon date, début, fin du plus proche', async () => {
    const admin = await user(0, 'admin');
    const ana = await user(5000);
    expect((await ana.get('/api/tournaments/next').expect(200)).body).toEqual({
      tournament: null,
    });
    const later = (await admin.post('/api/admin/tournaments', slot(3)).expect(201)).body
      .tournament;
    const sooner = (await admin.post('/api/admin/tournaments', slot(1)).expect(201)).body
      .tournament;
    await admin.post('/api/admin/tournaments', slot(0)).expect(201); // non inscrite
    for (const t of [later, sooner]) {
      await ana.post(`/api/tournaments/${t.tournamentId}/register`).expect(201);
    }
    const res = await ana.get('/api/tournaments/next').expect(200);
    expect(res.body.tournament).toEqual({
      tournamentId: sooner.tournamentId,
      startsAt: sooner.startsAt,
      endsAt: sooner.endsAt,
      timezone: 'Africa/Douala',
    });
    await request(stack.app).get('/api/tournaments/next').expect(401);
  });

  it('GET /next : le plus proche annulé → le suivant ; tous commencés → null', async () => {
    const admin = await user(0, 'admin');
    const ana = await user(5000);
    const created = [];
    for (const i of [1, 2]) {
      created.push((await admin.post('/api/admin/tournaments', slot(i)).expect(201)).body.tournament);
    }
    const [sooner, later] = created;
    for (const t of created) {
      await ana.post(`/api/tournaments/${t.tournamentId}/register`).expect(201);
    }
    await admin.post(`/api/admin/tournaments/${sooner.tournamentId}/cancel`).expect(200);
    const res = await ana.get('/api/tournaments/next').expect(200);
    expect(res.body.tournament).toMatchObject({
      tournamentId: later.tournamentId,
      startsAt: later.startsAt,
      endsAt: later.endsAt,
    });
    stack.clock.set(new Date(Date.parse(later.startsAt) + 1000));
    expect((await ana.get('/api/tournaments/next').expect(200)).body.tournament).toBeNull();
  });
});

describe('tournois sans nom ni description (D-060)', () => {
  const noNameOrDescription = (t: Record<string, unknown>) => {
    expect(t).not.toHaveProperty('name');
    expect(t).not.toHaveProperty('description');
  };

  it('création admin et joueur, modification, lecture : aucun nom ni description', async () => {
    const admin = await user(0, 'admin');
    const ana = await user(5000);
    const created = (await admin.post('/api/admin/tournaments', body()).expect(201)).body
      .tournament;
    noNameOrDescription(created);
    const id = created.tournamentId as string;

    const updated = await admin
      .patch(`/api/admin/tournaments/${id}`, { entryFee: 1500 })
      .expect(200);
    expect(updated.body.tournament).toMatchObject({ tournamentId: id, entryFee: 1500 });
    noNameOrDescription(updated.body.tournament);

    const proposal = (await ana.post('/api/tournaments', body(6 * HOUR)).expect(201)).body
      .tournament;
    noNameOrDescription(proposal);
    const patched = await ana
      .patch(`/api/tournaments/${proposal.tournamentId}`, { entryFee: 500 })
      .expect(200);
    expect(patched.body.tournament.entryFee).toBe(500);

    await ana.post(`/api/tournaments/${id}/register`).expect(201);
    noNameOrDescription((await ana.get(`/api/tournaments/${id}`).expect(200)).body.tournament);
    noNameOrDescription((await ana.get('/api/tournaments/active').expect(200)).body.tournament);
    noNameOrDescription((await ana.get('/api/tournaments/next').expect(200)).body.tournament);
    for (const t of (await admin.get('/api/admin/tournaments').expect(200)).body.tournaments) {
      noNameOrDescription(t);
    }
    for (const t of (await ana.get('/api/tournaments/mine').expect(200)).body.tournaments) {
      noNameOrDescription(t);
    }
  });

  it('un ancien client qui envoie encore name / description : ignorés, rien n’est stocké', async () => {
    const admin = await user(0, 'admin');
    const res = await admin
      .post('/api/admin/tournaments', body(HOUR, { name: 'Ancien', description: 'x' }))
      .expect(201);
    noNameOrDescription(res.body.tournament);
  });
});
