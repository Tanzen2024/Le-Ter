import { OllamaLanguageModel } from '../../../src/services/ai/ollama-language-model';
import { createComplaintServices } from '../../../src/services/complaints/create-complaint-services';
import { silentLogger } from '../../../src/utils/logger';
import { asAdmin, createAdmin, seedPendingPayment, type AdminSession } from '../../fixtures/admin';
import { registerAndLogin } from '../../fixtures/auth';
import {
  analysis,
  as,
  complaintBody,
  createComplaintTestApp,
  FakeLanguageModel,
  financialSnapshot,
  key,
  reply,
  type ComplaintTestContext,
} from '../../fixtures/complaints';
import {
  createMigratedDatabase,
  PGLITE_TIMEOUT_MS,
  type TestDatabase,
} from '../../fixtures/pglite';

/**
 * Durcissement des réclamations (D-114) : pannes du fournisseur (erreur, sortie mal formée,
 * délai réel), analyses concurrentes, idempotence, accès croisés, minimisation, pièces.
 */
jest.setTimeout(PGLITE_TIMEOUT_MS);

let database: TestDatabase;
let player: Awaited<ReturnType<typeof registerAndLogin>>;
let other: Awaited<ReturnType<typeof registerAndLogin>>;
let admin: AdminSession;
let t: ComplaintTestContext;
let model: FakeLanguageModel;

beforeAll(async () => {
  database = await createMigratedDatabase();
}, PGLITE_TIMEOUT_MS);
afterAll(() => database.close());

async function setup(options: Parameters<typeof createComplaintTestApp>[1] = {}) {
  t = createComplaintTestApp(database.sql, options);
  player = await registerAndLogin(t.app);
  other = await registerAndLogin(t.app);
  admin = await createAdmin(t.app, database.sql);
}

beforeEach(async () => {
  model = new FakeLanguageModel();
  await setup({ model });
});
afterEach(async () => {
  await t.services.analyzer.idle();
  await database.reset();
});

async function createComplaint(token = player.accessToken, body = complaintBody()) {
  const res = await as(t.app, token).post('/api/complaints', body, key());
  await t.services.analyzer.idle();
  return res;
}

async function analysisState(id: string) {
  const { rows } = await database.sql.query<{
    status: string;
    ai_analysis_status: string;
    ai_summary: string | null;
  }>('SELECT status, ai_analysis_status, ai_summary FROM complaints WHERE id = $1', [id]);
  return rows[0];
}

describe('panne du fournisseur : jamais de blocage, jamais de décision automatique', () => {
  it.each([
    ['erreur inattendue', new Error('socket hang up')],
    ['sortie non JSON', 'Bien sûr ! Voici le résumé…'],
    ['JSON mal formé', '{"summary": "tronqué'],
    ['schéma non respecté', JSON.stringify({ résumé: 'x' })],
    [
      'résumé qui invente un remboursement',
      JSON.stringify({ summary: "J'ai remboursé 99999 jetons au joueur." }),
    ],
  ])('%s : dossier en examen humain, analyse marquée indisponible', async (_case, output) => {
    model.responses = [output];
    const res = await createComplaint();
    expect(res.status).toBe(201);
    const state = await analysisState(res.body.complaint.id);
    expect(state).toEqual({
      status: 'IN_REVIEW',
      ai_analysis_status: 'UNAVAILABLE',
      ai_summary: null,
    });
    // Consultable normalement par le joueur, sans détail technique.
    const view = await as(t.app, player.accessToken).get(
      `/api/complaints/${res.body.complaint.id}`,
    );
    expect(view.status).toBe(200);
    expect(JSON.stringify(view.body)).not.toMatch(/socket|hang up|stack|ollama/i);
  });

  it('délai réel dépassé chez Ollama (faux serveur figé) : réponse dégradée lisible, aucune configuration exposée', async () => {
    const hanging = ((_url: string, init: RequestInit) =>
      new Promise((_resolve, reject) =>
        init.signal?.addEventListener('abort', () =>
          reject(Object.assign(new Error('aborted'), { name: 'TimeoutError' })),
        ),
      )) as unknown as typeof fetch;
    await t.services.analyzer.idle();
    await database.reset();
    await setup({
      model: new OllamaLanguageModel({
        baseUrl: 'http://ollama.internal:11434',
        model: 'qwen2.5:1.5b',
        timeoutMs: 50,
        contextTokens: 2048,
        keepAlive: '1m',
        fetchImpl: hanging,
      }),
    });
    await seedPendingPayment(database.sql, player.userId, { amount: 3000 });
    const conversation = await as(t.app, player.accessToken).post('/api/support/conversations', {
      language: 'fr',
    });
    const res = await as(t.app, player.accessToken).post(
      `/api/support/conversations/${conversation.body.conversation.id}/messages`,
      { content: 'Ma recharge MTN de 3000 FCFA ?', language: 'fr' },
      key(),
    );
    expect(res.status).toBe(201);
    expect(res.body.assistantMessage.meta.mode).toBe('DEGRADED');
    expect(res.body.assistantMessage.content).toMatch(/n’est pas disponible pour le moment/);
    expect(res.body.assistantMessage.meta.verified[0]).toMatch(/3000 FCFA/);
    expect(JSON.stringify(res.body)).not.toMatch(/ollama\.internal|11434|TimeoutError|TIMEOUT/);
    // Le dossier déposé ensuite n'attend pas le modèle et n'est jamais bloqué en AI_ANALYSIS.
    const created = await createComplaint();
    expect((await analysisState(created.body.complaint.id))?.status).toBe('IN_REVIEW');
  });

  it("sans fournisseur : l'assistant indique que l'assistance automatique n'est pas disponible", async () => {
    await t.services.analyzer.idle();
    await database.reset();
    await setup();
    const conversation = await as(t.app, player.accessToken).post('/api/support/conversations', {
      language: 'en',
    });
    const res = await as(t.app, player.accessToken).post(
      `/api/support/conversations/${conversation.body.conversation.id}/messages`,
      { content: 'I lost my connection during a game', language: 'en' },
      key(),
    );
    expect(res.body.assistantMessage.meta.mode).toBe('DEGRADED');
    expect(res.body.assistantMessage.content).toMatch(/not available right now/);
    expect((await as(t.app, player.accessToken).get('/api/support/assistant')).body).toEqual({
      mode: 'DEGRADED',
    });
  });
});

describe('analyse : une seule exécution par dossier, même avec deux instances', () => {
  it('deux analyseurs concurrents : un seul appel au modèle, un seul événement de fin', async () => {
    model.fallback = new Error('pas d’analyse à la création');
    const created = await createComplaint();
    const id = created.body.complaint.id;
    await database.sql.query(
      `UPDATE complaints SET status = 'OPEN', ai_analysis_status = 'PENDING', ai_summary = NULL,
         analysis_claimed_at = NULL, updated_at = '2026-10-09T07:00:00Z' WHERE id = $1`,
      [id],
    );
    const modelA = new FakeLanguageModel();
    const modelB = new FakeLanguageModel();
    const summary = JSON.stringify({
      summary: 'Le joueur déclare une recharge non créditée ; à vérifier.',
    });
    modelA.fallback = summary;
    modelB.fallback = summary;
    const clock = () => new Date('2026-10-09T08:00:00Z');
    const a = createComplaintServices({
      sql: database.sql,
      logger: silentLogger,
      model: modelA,
      clock,
    });
    const b = createComplaintServices({
      sql: database.sql,
      logger: silentLogger,
      model: modelB,
      clock,
    });
    await Promise.all([
      a.analyzer.analyze(id),
      b.analyzer.analyze(id),
      a.analyzer.sweep(),
      b.analyzer.sweep(),
    ]);
    await Promise.all([a.analyzer.idle(), b.analyzer.idle()]);
    expect(modelA.requests.length + modelB.requests.length).toBe(1);
    const { rows } = await database.sql.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM complaint_events
       WHERE complaint_id = $1 AND type IN ('AI_ANALYSIS_COMPLETED', 'AI_ANALYSIS_UNAVAILABLE')`,
      [id],
    );
    // 1 à la création (indisponible) + 1 pour la reprise : jamais deux pour la même reprise.
    expect(rows[0]?.n).toBe(2);
    expect(await analysisState(id)).toMatchObject({
      status: 'IN_REVIEW',
      ai_analysis_status: 'COMPLETED',
    });
  });
});

describe('idempotence des actions administratives', () => {
  it("rejouer une assignation, une priorité ou une décision n'écrit rien de plus", async () => {
    const id = (await createComplaint()).body.complaint.id;
    const api = asAdmin(t.app, admin.accessToken);
    for (let i = 0; i < 2; i += 1) {
      await api
        .post(`/api/admin/complaints/${id}/assign`, { assigneeId: admin.userId })
        .expect(200);
      await api.post(`/api/admin/complaints/${id}/priority`, { priority: 'URGENT' }).expect(200);
    }
    const decision = {
      status: 'REJECTED',
      expectedStatus: 'IN_REVIEW',
      decision: 'Aucune anomalie constatée.',
    };
    expect((await api.post(`/api/admin/complaints/${id}/status`, decision)).status).toBe(200);
    expect((await api.post(`/api/admin/complaints/${id}/status`, decision)).status).toBe(409);
    const { rows } = await database.sql.query<{ action: string; n: number }>(
      `SELECT action, count(*)::int AS n FROM admin_audit_log WHERE target_id = $1 GROUP BY action ORDER BY action`,
      [id],
    );
    expect(rows).toEqual([
      { action: 'COMPLAINT_ASSIGNED', n: 1 },
      { action: 'COMPLAINT_PRIORITY_CHANGED', n: 1 },
      { action: 'COMPLAINT_STATUS_CHANGED', n: 1 },
    ]);
    const notified = await database.sql.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM notifications WHERE user_id = $1 AND payload->>'event' = 'DECISION'`,
      [player.userId],
    );
    expect(notified.rows[0]?.n).toBe(1);
  });
});

describe('autorisations', () => {
  it("un administrateur ne lit pas le dossier d'un joueur par les routes joueur", async () => {
    const id = (await createComplaint()).body.complaint.id;
    expect((await as(t.app, admin.accessToken).get(`/api/complaints/${id}`)).status).toBe(404);
    expect((await as(t.app, admin.accessToken).post(`/api/complaints/${id}/close`)).status).toBe(
      404,
    );
  });

  it("la conversation d'un autre joueur ne sert ni à lire ni à créer un dossier", async () => {
    model.fallback = analysis({ category: 'OTHER', clarifyingQuestion: 'Pouvez-vous préciser ?' });
    const mine = await as(t.app, player.accessToken).post('/api/support/conversations', {
      language: 'fr',
    });
    await as(t.app, player.accessToken).post(
      `/api/support/conversations/${mine.body.conversation.id}/messages`,
      { content: 'Mon secret : problème de retrait', language: 'fr' },
      key(),
    );
    const theirs = await as(t.app, other.accessToken).get('/api/support/conversations/current');
    expect(theirs.body).toEqual({ conversation: null, messages: [] });
    const stolen = await as(t.app, other.accessToken).post(
      '/api/complaints',
      complaintBody({ conversationId: mine.body.conversation.id }),
      key(),
    );
    expect(stolen.status).toBe(422);
    expect(stolen.body.fields).toEqual({ conversationId: 'Élément introuvable parmi les vôtres.' });
  });

  it("ignore userId / playerId / accountId envoyés à l'assistant", async () => {
    await seedPendingPayment(database.sql, other.userId, { amount: 7777 });
    model.responses = [
      analysis({ category: 'PAYMENT', tools: ['check_payment'] }),
      reply('Je vérifie votre recharge.'),
    ];
    const conversation = await as(t.app, player.accessToken).post('/api/support/conversations', {
      language: 'fr',
    });
    const res = await as(t.app, player.accessToken).post(
      `/api/support/conversations/${conversation.body.conversation.id}/messages?userId=${other.userId}`,
      {
        content: 'Ma recharge ?',
        language: 'fr',
        userId: other.userId,
        playerId: other.userId,
        accountId: other.userId,
      },
      key(),
    );
    expect(res.body.assistantMessage.meta.checks).toEqual([
      { tool: 'check_payment', outcome: 'NOT_FOUND' },
    ]);
    expect(JSON.stringify(model.requests)).not.toContain('7777');
  });
});

describe('minimisation des données transmises au modèle', () => {
  it('ne transmet pas le solde pour une question de recharge, même si le modèle le demande', async () => {
    await database.sql.query(
      `INSERT INTO wallets (user_id, balance, created_at, updated_at) VALUES ($1, 424242, now(), now())`,
      [player.userId],
    );
    await seedPendingPayment(database.sql, player.userId, { amount: 2000 });
    model.responses = [
      analysis({
        category: 'PAYMENT',
        tools: ['get_wallet_history', 'check_payment', 'list_recent_games'],
      }),
      reply('Votre recharge de 2000 FCFA attend la confirmation de l’opérateur.'),
    ];
    const conversation = await as(t.app, player.accessToken).post('/api/support/conversations', {
      language: 'fr',
    });
    const res = await as(t.app, player.accessToken).post(
      `/api/support/conversations/${conversation.body.conversation.id}/messages`,
      { content: 'Ma recharge ?', language: 'fr' },
      key(),
    );
    expect(res.body.assistantMessage.meta.checks).toEqual([
      { tool: 'check_payment', outcome: 'FOUND' },
    ]);
    expect(JSON.stringify(model.requests)).not.toContain('424242');
  });

  it('refuse une réponse qui affirme un crédit non constaté et conserve les soldes', async () => {
    await seedPendingPayment(database.sql, player.userId, { amount: 2000 });
    const before = await financialSnapshot(database.sql, player.userId);
    model.responses = [
      analysis({ category: 'PAYMENT', tools: ['check_payment'] }),
      reply('Votre paiement est confirmé et vos jetons ont été crédités.'),
    ];
    const conversation = await as(t.app, player.accessToken).post('/api/support/conversations', {
      language: 'fr',
    });
    const res = await as(t.app, player.accessToken).post(
      `/api/support/conversations/${conversation.body.conversation.id}/messages`,
      { content: 'Ma recharge ?', language: 'fr' },
      key(),
    );
    expect(res.body.assistantMessage.content).not.toMatch(/crédités|est confirmé/);
    expect(await financialSnapshot(database.sql, player.userId)).toBe(before);
  });
});

describe('pièces justificatives : contenu réel, jamais le type annoncé', () => {
  const PDF = Buffer.from('%PDF-1.4\n1 0 obj << /Type /Catalog >> endobj\ntrailer << >>\n%%EOF');
  const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 9, 9, 9]);

  async function stored(id: string) {
    const { rows } = await database.sql.query<{ content_type: string }>(
      'SELECT content_type FROM complaint_attachments WHERE complaint_id = $1 ORDER BY created_at, id',
      [id],
    );
    return rows.map((r) => r.content_type);
  }

  it('PDF valide accepté ; type annoncé falsifié remplacé par le type réel ; fichier vide refusé', async () => {
    const id = (await createComplaint()).body.complaint.id;
    const api = as(t.app, player.accessToken);
    expect(
      (await api.upload(`/api/complaints/${id}/attachments`, PDF, 'application/pdf')).status,
    ).toBe(201);
    // Image envoyée comme « PDF » : enregistrée comme image (signature), jamais comme annoncé.
    expect(
      (await api.upload(`/api/complaints/${id}/attachments`, PNG, 'application/pdf')).status,
    ).toBe(201);
    expect((await stored(id)).sort()).toEqual(['application/pdf', 'image/png']);
    expect(
      (await api.upload(`/api/complaints/${id}/attachments`, Buffer.alloc(0), 'image/png')).status,
    ).toBe(400);
    // Script annoncé comme JPEG : refusé.
    expect(
      (
        await api.upload(
          `/api/complaints/${id}/attachments`,
          Buffer.from('#!/bin/sh\nrm -rf /'),
          'image/jpeg',
        )
      ).status,
    ).toBe(415);
  });

  it('limite le nombre de pièces par dossier et refuse sur un dossier clos', async () => {
    const id = (await createComplaint()).body.complaint.id;
    const api = as(t.app, player.accessToken);
    for (let i = 0; i < 5; i += 1) {
      const png = Buffer.concat([PNG, Buffer.from([i])]);
      expect((await api.upload(`/api/complaints/${id}/attachments`, png, 'image/png')).status).toBe(
        201,
      );
    }
    const sixth = await api.upload(
      `/api/complaints/${id}/attachments`,
      Buffer.concat([PNG, Buffer.from([9, 9])]),
      'image/png',
    );
    expect(sixth.status).toBe(409);
    expect(sixth.body.code).toBe('TOO_MANY_ATTACHMENTS');
    await api.post(`/api/complaints/${id}/close`).expect(200);
    expect(
      (await api.upload(`/api/complaints/${id}/attachments`, PDF, 'application/pdf')).status,
    ).toBe(409);
  });
});
