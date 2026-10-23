import { InMemoryAdminEventHub, type AdminEvent } from '../../../src/websocket/admin-event-bus';
import { asAdmin, createAdmin, type AdminSession } from '../../fixtures/admin';
import { registerAndLogin } from '../../fixtures/auth';
import {
  as,
  complaintBody,
  createComplaintTestApp,
  key,
  type ComplaintTestContext,
} from '../../fixtures/complaints';
import {
  createMigratedDatabase,
  PGLITE_TIMEOUT_MS,
  type TestDatabase,
} from '../../fixtures/pglite';

/**
 * Cloche de l'administration et réclamations (D-114, D-116) : une réclamation déposée par le
 * joueur apparaît dans les points d'attention (`pendingComplaints`), et chaque écriture d'un
 * dossier émet le signal `COMPLAINT` qui fait relire les compteurs, sans aucune donnée.
 */
jest.setTimeout(PGLITE_TIMEOUT_MS);

let database: TestDatabase;
let t: ComplaintTestContext;
let player: Awaited<ReturnType<typeof registerAndLogin>>;
let admin: AdminSession;
let hub: InMemoryAdminEventHub;
let signals: AdminEvent[];

beforeAll(async () => {
  database = await createMigratedDatabase();
}, PGLITE_TIMEOUT_MS);
afterAll(() => database.close());

beforeEach(async () => {
  hub = new InMemoryAdminEventHub();
  signals = [];
  hub.subscribe((e) => signals.push(e));
  t = createComplaintTestApp(database.sql, { adminEvents: hub });
  player = await registerAndLogin(t.app);
  admin = await createAdmin(t.app, database.sql);
});
afterEach(async () => {
  await t.services.analyzer.idle();
  await database.reset();
});

const pending = async () =>
  (await asAdmin(t.app, admin.accessToken).get('/api/admin/attention').expect(200)).body.alerts
    .pendingComplaints as number;

describe('cloche de l’administration : réclamations à traiter', () => {
  it('dépôt par le joueur : compté et signalé ; attente du joueur, décision : décompté', async () => {
    expect(await pending()).toBe(0);

    const created = await as(t.app, player.accessToken).post(
      '/api/complaints',
      complaintBody(),
      key(),
    );
    expect(created.status).toBe(201);
    await t.services.analyzer.idle();
    const id = created.body.complaint.id as string;
    expect(await pending()).toBe(1);
    expect(signals.length).toBeGreaterThan(0);
    // Le signal ne transporte que sa source : ni dossier, ni joueur, ni contenu.
    expect(signals.every((s) => JSON.stringify(s) === '{"type":"attention","source":"COMPLAINT"}')).toBe(true);

    // Informations demandées au joueur : la balle est dans son camp.
    const adminApi = asAdmin(t.app, admin.accessToken);
    const status = (await database.sql.query<{ status: string }>(
      'SELECT status FROM complaints WHERE id = $1',
      [id],
    )).rows[0]!.status;
    signals.length = 0;
    await adminApi
      .post(`/api/admin/complaints/${id}/request-info`, {
        message: 'Merci de joindre la capture de la confirmation MTN.',
        expectedStatus: status,
      })
      .expect(200);
    expect(await pending()).toBe(0);
    expect(signals).toHaveLength(1);

    // Réponse du joueur : de nouveau à traiter, signalé.
    signals.length = 0;
    await as(t.app, player.accessToken)
      .post(`/api/complaints/${id}/messages`, { body: 'Voici la confirmation.' }, key())
      .expect(201);
    expect(await pending()).toBe(1);
    expect(signals).toHaveLength(1);

    // Décision motivée : plus rien à traiter.
    await adminApi
      .post(`/api/admin/complaints/${id}/status`, {
        status: 'RESOLVED',
        expectedStatus: 'IN_REVIEW',
        decision: 'Paiement confirmé par la revérification administrative du service des paiements.',
      })
      .expect(200);
    expect(await pending()).toBe(0);
  });

  it('refus (dossier introuvable) : aucun signal', async () => {
    await as(t.app, player.accessToken)
      .post('/api/complaints/RCL-20261009-ABCDEF/messages', { body: 'Bonjour.' }, key())
      .expect(404);
    expect(signals).toHaveLength(0);
  });
});
