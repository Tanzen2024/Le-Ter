import { randomUUID } from 'node:crypto';

import { createComplaintServices } from '../../../src/services/complaints/create-complaint-services';
import { silentLogger } from '../../../src/utils/logger';
import { asAdmin, createAdmin, seedPendingPayment, type AdminSession } from '../../fixtures/admin';
import { registerAndLogin } from '../../fixtures/auth';
import {
  as,
  complaintBody,
  createComplaintTestApp,
  key,
  seedFinishedGame,
  type ComplaintTestContext,
} from '../../fixtures/complaints';
import {
  createMigratedDatabase,
  PGLITE_TIMEOUT_MS,
  type TestDatabase,
} from '../../fixtures/pglite';

/**
 * Réclamations (D-114), SANS fournisseur d'IA : dépôt, suivi, isolation, workflow
 * administratif audité, notifications idempotentes, pièces justificatives, reprise.
 */
jest.setTimeout(PGLITE_TIMEOUT_MS);

let database: TestDatabase;
let t: ComplaintTestContext;
let player: Awaited<ReturnType<typeof registerAndLogin>>;
let other: Awaited<ReturnType<typeof registerAndLogin>>;
let admin: AdminSession;

beforeAll(async () => {
  database = await createMigratedDatabase();
}, PGLITE_TIMEOUT_MS);
afterAll(() => database.close());

beforeEach(async () => {
  t = createComplaintTestApp(database.sql);
  player = await registerAndLogin(t.app);
  other = await registerAndLogin(t.app);
  admin = await createAdmin(t.app, database.sql);
});
afterEach(async () => {
  await t.services.analyzer.idle();
  await database.reset();
});

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]);

async function create(body: Record<string, unknown> = complaintBody(), k = key()) {
  const res = await as(t.app, player.accessToken).post('/api/complaints', body, k);
  await t.services.analyzer.idle();
  return res;
}

async function notifications(userId: string) {
  const { rows } = await database.sql.query<{ payload: Record<string, unknown> }>(
    `SELECT payload FROM notifications WHERE user_id = $1 AND type = 'COMPLAINT_UPDATE' ORDER BY created_at, id`,
    [userId],
  );
  return rows.map((r) => r.payload);
}

describe('dépôt par un joueur authentifié (sans fournisseur IA)', () => {
  it('crée un dossier persistant avec une référence unique, puis le passe en examen', async () => {
    const res = await create();
    expect(res.status).toBe(201);
    expect(res.body.complaint).toMatchObject({
      reference: expect.stringMatching(/^RCL-\d{8}-[0-9A-HJKMNP-TV-Z]{6}$/),
      category: 'PAYMENT',
      priority: 'HIGH',
    });
    const detail = await as(t.app, player.accessToken).get(
      `/api/complaints/${res.body.complaint.reference}`,
    );
    expect(detail.status).toBe(200);
    // Analyse automatique indisponible (aucun modèle) : le dossier va directement au support.
    expect(detail.body.complaint.status).toBe('IN_REVIEW');
    expect(detail.body.events.map((e: { type: string }) => e.type)).toEqual([
      'CREATED',
      'STATUS_CHANGED',
      'STATUS_CHANGED',
    ]);
    const { rows } = await database.sql.query<{ ai_analysis_status: string }>(
      'SELECT ai_analysis_status FROM complaints WHERE id = $1',
      [res.body.complaint.id],
    );
    expect(rows[0]?.ai_analysis_status).toBe('UNAVAILABLE');
  });

  it('attribue des références distinctes et rejoue une même intention sans doublon', async () => {
    const k = key();
    const first = await create(complaintBody(), k);
    const replay = await create(complaintBody(), k);
    const second = await create();
    expect(replay.status).toBe(200);
    expect(replay.body.complaint.id).toBe(first.body.complaint.id);
    expect(second.body.complaint.reference).not.toBe(first.body.complaint.reference);
    const { rows } = await database.sql.query<{ n: number }>(
      'SELECT count(*)::int AS n FROM complaints',
    );
    expect(rows[0]?.n).toBe(2);
  });

  it('valide la catégorie, la description et exige une clé d’idempotence', async () => {
    const api = as(t.app, player.accessToken);
    expect(
      (await api.post('/api/complaints', complaintBody({ category: 'REFUND_ME' }), key())).status,
    ).toBe(400);
    expect(
      (await api.post('/api/complaints', complaintBody({ description: 'court' }), key())).status,
    ).toBe(400);
    expect((await api.post('/api/complaints', complaintBody())).status).toBe(400);
  });

  it('exige une authentification', async () => {
    const res = await as(t.app, 'invalid').post('/api/complaints', complaintBody(), key());
    expect(res.status).toBe(401);
  });

  it("ignore toute identité envoyée par le client : l'auteur est le titulaire du jeton", async () => {
    const res = await create(complaintBody({ userId: other.userId, playerId: other.userId }));
    const { rows } = await database.sql.query<{ user_id: string }>(
      'SELECT user_id FROM complaints WHERE id = $1',
      [res.body.complaint.id],
    );
    expect(rows[0]?.user_id).toBe(player.userId);
  });
});

describe('isolation entre joueurs', () => {
  it("liste uniquement ses dossiers ; ceux d'un autre répondent 404, par identifiant comme par référence", async () => {
    const mine = await create();
    const api = as(t.app, other.accessToken);
    expect((await api.get('/api/complaints')).body.complaints).toEqual([]);
    expect((await api.get(`/api/complaints/${mine.body.complaint.id}`)).status).toBe(404);
    expect((await api.get(`/api/complaints/${mine.body.complaint.reference}`)).status).toBe(404);
    expect(
      (
        await api.post(
          `/api/complaints/${mine.body.complaint.id}/messages`,
          { body: 'intrusion' },
          key(),
        )
      ).status,
    ).toBe(404);
    expect((await api.post(`/api/complaints/${mine.body.complaint.id}/close`)).status).toBe(404);
    expect(
      (await api.upload(`/api/complaints/${mine.body.complaint.id}/attachments`, PNG, 'image/png'))
        .status,
    ).toBe(404);
    const list = await as(t.app, player.accessToken).get('/api/complaints');
    expect(list.body.complaints).toHaveLength(1);
  });

  it("refuse de lier la partie ou le paiement d'un autre joueur", async () => {
    const { gameId } = await seedFinishedGame(database.sql, other.userId, admin.userId);
    const { paymentId } = await seedPendingPayment(database.sql, other.userId);
    const game = await create(complaintBody({ category: 'GAME_RESULT', links: { gameId } }));
    expect(game.status).toBe(422);
    expect(game.body.code).toBe('COMPLAINT_LINK_INVALID');
    const payment = await create(complaintBody({ links: { paymentId } }));
    expect(payment.status).toBe(422);
  });
});

describe('réclamation financière : suivi et éléments vérifiés', () => {
  it('lie le paiement du joueur et montre au support les faits lus dans les sources', async () => {
    const { paymentId } = await seedPendingPayment(database.sql, player.userId, { amount: 5000 });
    const res = await create(complaintBody({ links: { paymentId } }));
    expect(res.status).toBe(201);
    const detail = await asAdmin(t.app, admin.accessToken).get(
      `/api/admin/complaints/${res.body.complaint.id}`,
    );
    expect(detail.status).toBe(200);
    expect(detail.body.verified.payment).toMatchObject({
      paymentId,
      status: 'PENDING',
      amount: 5000,
    });
    expect(detail.body.aiAnalysis).toEqual({ status: 'UNAVAILABLE', summary: null });
    expect(detail.body.checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ tool: 'check_payment', outcome: 'FOUND', source: 'SYSTEM' }),
      ]),
    );
    // Un dossier financier n'est jamais clos automatiquement.
    expect(detail.body.complaint.status).toBe('IN_REVIEW');
  });
});

describe('workflow administratif audité', () => {
  it('demande d’informations, réponse du joueur, décision motivée, clôture — tout est tracé', async () => {
    const created = await create();
    const id = created.body.complaint.id;
    const adminApi = asAdmin(t.app, admin.accessToken);
    const api = as(t.app, player.accessToken);

    await adminApi
      .post(`/api/admin/complaints/${id}/assign`, { assigneeId: admin.userId })
      .expect(200);
    const info = await adminApi.post(`/api/admin/complaints/${id}/request-info`, {
      message: 'Merci de joindre la capture de la confirmation MTN.',
      expectedStatus: 'IN_REVIEW',
    });
    expect(info.body.status).toBe('WAITING_FOR_PLAYER');

    const answer = await api.post(
      `/api/complaints/${id}/messages`,
      { body: 'Voici la confirmation.' },
      key(),
    );
    expect(answer.status).toBe(201);
    expect(answer.body.status).toBe('IN_REVIEW');
    await api.upload(`/api/complaints/${id}/attachments`, PNG, 'image/png').expect(201);

    // Une note interne n'est jamais visible du joueur.
    await adminApi
      .post(`/api/admin/complaints/${id}/messages`, {
        body: 'Vérifier chez CinetPay.',
        internal: true,
      })
      .set('Idempotency-Key', key())
      .expect(201);

    const noDecision = await adminApi.post(`/api/admin/complaints/${id}/status`, {
      status: 'RESOLVED',
    });
    expect(noDecision.status).toBe(400);
    const stale = await adminApi.post(`/api/admin/complaints/${id}/status`, {
      status: 'REJECTED',
      expectedStatus: 'WAITING_FOR_PLAYER',
      decision: 'Paiement non retrouvé chez l’opérateur.',
    });
    expect(stale.status).toBe(409);
    expect(stale.body.code).toBe('COMPLAINT_CONFLICT');
    const decided = await adminApi.post(`/api/admin/complaints/${id}/status`, {
      status: 'RESOLVED',
      expectedStatus: 'IN_REVIEW',
      decision:
        'Paiement confirmé par la revérification administrative ; crédit appliqué par le service des paiements.',
    });
    expect(decided.body.status).toBe('RESOLVED');

    const view = await api.get(`/api/complaints/${id}`);
    expect(view.body.complaint).toMatchObject({
      status: 'RESOLVED',
      canReopen: true,
      nextStep: 'DECISION_RENDERED',
    });
    expect(view.body.messages.map((m: { body: string }) => m.body)).not.toContain(
      'Vérifier chez CinetPay.',
    );
    expect(
      view.body.messages.some((m: { visibility: string }) => m.visibility === 'INTERNAL'),
    ).toBe(false);

    const closed = await api.post(`/api/complaints/${id}/close`);
    expect(closed.body.status).toBe('CLOSED');
    expect(
      (await api.post(`/api/complaints/${id}/messages`, { body: 'encore' }, key())).status,
    ).toBe(409);

    const { rows: audit } = await database.sql.query<{ action: string; actor_id: string }>(
      `SELECT action, actor_id FROM admin_audit_log WHERE target_type = 'COMPLAINT' AND target_id = $1 ORDER BY created_at, id`,
      [id],
    );
    expect(audit.map((a) => a.action).sort()).toEqual([
      'COMPLAINT_ASSIGNED',
      'COMPLAINT_INFO_REQUESTED',
      'COMPLAINT_NOTE_ADDED',
      'COMPLAINT_STATUS_CHANGED',
    ]);
    expect(audit.every((a) => a.actor_id === admin.userId)).toBe(true);

    // Historique complet en ajout seul : aucune modification possible.
    await expect(
      database.sql.query('UPDATE complaint_events SET details = $1 WHERE complaint_id = $2', [
        '{}',
        id,
      ]),
    ).rejects.toThrow();
  });

  it('notifie le joueur une seule fois par événement, sans montant', async () => {
    const created = await create();
    const id = created.body.complaint.id;
    const adminApi = asAdmin(t.app, admin.accessToken);
    const replyKey = key();
    await adminApi
      .post(`/api/admin/complaints/${id}/messages`, { body: 'Nous examinons.' })
      .set('Idempotency-Key', replyKey);
    await adminApi
      .post(`/api/admin/complaints/${id}/messages`, { body: 'Nous examinons.' })
      .set('Idempotency-Key', replyKey);
    await adminApi.post(`/api/admin/complaints/${id}/request-info`, {
      message: 'Précisez l’heure.',
    });
    const list = await notifications(player.userId);
    expect(list.map((n) => n.event).sort()).toEqual(['CREATED', 'INFO_REQUESTED', 'REPLY']);
    for (const n of list) {
      expect(Object.keys(n).sort()).toEqual(['complaintId', 'event', 'reference', 'status']);
    }
    expect(await notifications(other.userId)).toEqual([]);
  });

  it("refuse l'administration des réclamations à un joueur (403) et sans session admin (401)", async () => {
    const created = await create();
    const asPlayer = as(t.app, player.accessToken);
    expect((await asPlayer.get('/api/admin/complaints')).status).toBe(403);
    expect(
      (
        await asPlayer.post(`/api/admin/complaints/${created.body.complaint.id}/status`, {
          status: 'RESOLVED',
          decision: 'x'.repeat(20),
        })
      ).status,
    ).toBe(403);
    expect((await as(t.app, 'bad').get('/api/admin/complaints')).status).toBe(401);
  });

  it('filtre la file par statut, catégorie, priorité et joueur', async () => {
    await create();
    await create(
      complaintBody({
        category: 'TECHNICAL',
        title: 'Déconnexion',
        description: 'Déconnecté en pleine partie hier soir.',
      }),
    );
    const api = asAdmin(t.app, admin.accessToken);
    expect((await api.get('/api/admin/complaints?category=TECHNICAL')).body.total).toBe(1);
    expect((await api.get('/api/admin/complaints?priority=HIGH')).body.total).toBe(1);
    expect((await api.get(`/api/admin/complaints?player=${player.userId}`)).body.total).toBe(2);
    expect((await api.get(`/api/admin/complaints?player=${other.userId}`)).body.total).toBe(0);
    expect((await api.get('/api/admin/complaints?status=IN_REVIEW')).body.total).toBe(2);
    expect((await api.get('/api/admin/complaints?status=NOPE')).status).toBe(400);
  });

  it('refuse d’assigner un dossier à un compte qui n’est pas administrateur', async () => {
    const created = await create();
    const res = await asAdmin(t.app, admin.accessToken).post(
      `/api/admin/complaints/${created.body.complaint.id}/assign`,
      { assigneeId: other.userId },
    );
    expect(res.status).toBe(422);
  });

  it('contestation : au plus deux fois après une décision', async () => {
    const created = await create();
    const id = created.body.complaint.id;
    const adminApi = asAdmin(t.app, admin.accessToken);
    const api = as(t.app, player.accessToken);
    for (let i = 0; i < 2; i += 1) {
      await adminApi
        .post(`/api/admin/complaints/${id}/status`, {
          status: 'REJECTED',
          decision: 'Aucune anomalie constatée.',
        })
        .expect(200);
      expect(
        (await api.post(`/api/complaints/${id}/reopen`, { reason: 'Je conteste.' })).body.status,
      ).toBe('IN_REVIEW');
    }
    await adminApi.post(`/api/admin/complaints/${id}/status`, {
      status: 'REJECTED',
      decision: 'Aucune anomalie constatée.',
    });
    const third = await api.post(`/api/complaints/${id}/reopen`, { reason: 'Je conteste encore.' });
    expect(third.status).toBe(409);
    expect(third.body.code).toBe('REOPEN_LIMIT_REACHED');
  });
});

describe('pièces justificatives', () => {
  it('accepte une image reconnue par son contenu, refuse le reste, protège la lecture', async () => {
    const created = await create();
    const id = created.body.complaint.id;
    const api = as(t.app, player.accessToken);
    const uploaded = await api.upload(`/api/complaints/${id}/attachments`, PNG, 'image/png');
    expect(uploaded.status).toBe(201);
    expect((await api.upload(`/api/complaints/${id}/attachments`, PNG, 'image/png')).status).toBe(
      409,
    );
    // Contenu HTML annoncé comme image : refusé (signature).
    expect(
      (
        await api.upload(
          `/api/complaints/${id}/attachments`,
          Buffer.from('<html><script>x</script>'),
          'image/png',
        )
      ).status,
    ).toBe(415);
    expect(
      (
        await api.upload(
          `/api/complaints/${id}/attachments`,
          Buffer.alloc(3 * 1024 * 1024 + 10, 0xff),
          'image/jpeg',
        )
      ).status,
    ).toBe(413);

    const attachmentId = uploaded.body.attachment.id;
    const own = await api.get(`/api/complaints/${id}/attachments/${attachmentId}`);
    expect(own.status).toBe(200);
    expect(own.headers['content-type']).toBe('image/png');
    expect(own.headers['x-content-type-options']).toBe('nosniff');
    expect(
      (await as(t.app, other.accessToken).get(`/api/complaints/${id}/attachments/${attachmentId}`))
        .status,
    ).toBe(404);

    const viaAdmin = await asAdmin(t.app, admin.accessToken).get(
      `/api/admin/complaints/${id}/attachments/${attachmentId}`,
    );
    expect(viaAdmin.status).toBe(200);
    const { rows } = await database.sql.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM admin_audit_log WHERE action = 'COMPLAINT_ATTACHMENT_VIEWED' AND target_id = $1`,
      [id],
    );
    expect(rows[0]?.n).toBe(1);
  });
});

describe('reprise après redémarrage du backend', () => {
  it('reprend une analyse interrompue et retrouve le dossier avec de nouveaux services', async () => {
    // Dossier laissé en AI_ANALYSIS par une instance arrêtée en pleine analyse.
    const created = await create();
    const id = created.body.complaint.id;
    // Bail pris par l'instance arrêtée à 07:00 : expiré pour la nouvelle instance (08:00).
    await database.sql.query(
      `UPDATE complaints SET status = 'AI_ANALYSIS', ai_analysis_status = 'PENDING',
         analysis_claimed_at = '2026-10-09T07:00:00Z', updated_at = '2026-10-09T07:00:00Z'
       WHERE id = $1`,
      [id],
    );
    const restarted = createComplaintServices({
      sql: database.sql,
      logger: silentLogger,
      clock: () => new Date('2026-10-09T08:00:00Z'),
    });
    expect(await restarted.analyzer.sweep()).toBe(1);
    await restarted.analyzer.idle();
    const reloaded = await restarted.complaints.getForPlayer(
      player.userId as never,
      created.body.complaint.reference,
    );
    expect(reloaded.complaint.status).toBe('IN_REVIEW');
  });
});

describe('aucune fuite de secret ni de donnée d’un autre joueur', () => {
  it('ne renvoie au joueur ni assignation interne, ni note, ni identifiant d’administrateur', async () => {
    const created = await create();
    const id = created.body.complaint.id;
    await asAdmin(t.app, admin.accessToken).post(`/api/admin/complaints/${id}/assign`, {
      assigneeId: admin.userId,
    });
    const view = await as(t.app, player.accessToken).get(`/api/complaints/${id}`);
    const text = JSON.stringify(view.body);
    expect(text).not.toContain(admin.userId);
    expect(text).not.toContain(other.userId);
    expect(text).not.toMatch(/password|passwordHash|accessToken|refreshToken/i);
    expect(view.body.events.some((e: { type: string }) => e.type === 'ASSIGNED')).toBe(false);
  });

  it('les identifiants malformés sont refusés sans requête SQL dangereuse', async () => {
    const api = as(t.app, player.accessToken);
    expect((await api.get(`/api/complaints/${encodeURIComponent("1' OR '1'='1")}`)).status).toBe(
      400,
    );
    expect((await api.get(`/api/complaints/${randomUUID()}`)).status).toBe(404);
  });
});
