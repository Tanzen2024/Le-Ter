import { randomUUID } from 'node:crypto';

import request from 'supertest';

import type { UserId } from '../../../src/domain/users/user';
import { PostgresAdminAuditRepository } from '../../../src/repositories/postgres-admin-audit.repository';
import { PostgresModerationRepository } from '../../../src/repositories/postgres-moderation.repository';
import { PostgresTournamentRepository } from '../../../src/repositories/postgres-tournament.repository';
import { PlayerModerationService } from '../../../src/services/admin/player-moderation.service';
import { NotificationService } from '../../../src/services/notifications/notification.service';
import { createLogger } from '../../../src/utils/logger';
import {
  adminLogin,
  asAdmin,
  createAdmin,
  createAdminTestApp,
  type AdminSession,
  type AdminTestContext,
} from '../../fixtures/admin';
import { registerAndLogin } from '../../fixtures/auth';
import {
  createMigratedDatabase,
  PGLITE_TIMEOUT_MS,
  type TestDatabase,
} from '../../fixtures/pglite';

/**
 * Gestion des joueurs dans l'administration (D-079) : activation / désactivation,
 * suspension, révocation des sessions, avertissements, restriction du chat, notes internes et
 * journal de modération. Tout est appliqué par le backend, persistant, audité, et ne touche
 * jamais un solde, une transaction, une partie ni `platform_ledger`.
 */
jest.setTimeout(PGLITE_TIMEOUT_MS);

const HOUR = 3_600_000;

let database: TestDatabase;
let ctx: AdminTestContext;
let admin: AdminSession;
let api: ReturnType<typeof asAdmin>;

beforeAll(async () => {
  database = await createMigratedDatabase();
}, PGLITE_TIMEOUT_MS);
afterAll(() => database.close());

beforeEach(async () => {
  ctx = createAdminTestApp(database.sql, {
    extra: {
      notifications: new NotificationService(new PostgresTournamentRepository(database.sql), () =>
        ctx.now(),
      ),
    },
  });
  admin = await createAdmin(ctx.app, database.sql);
  api = asAdmin(ctx.app, admin.accessToken);
});
afterEach(() => database.reset());

const user = (id: string) => `/api/admin/users/${id}`;
const me = (token: string) =>
  request(ctx.app).get('/api/auth/me').set('Authorization', `Bearer ${token}`);
const playerLogin = (email: string, password: string) =>
  request(ctx.app).post('/api/auth/login').send({ email, password });
const refresh = (refreshToken: string) =>
  request(ctx.app).post('/api/auth/refresh').send({ refreshToken });

/** Après une avance d'horloge au-delà de 30 min, la session d'administration est expirée. */
async function reloginAdmin() {
  admin = await adminLogin(ctx.app, admin.email, admin.password, admin.userId);
  api = asAdmin(ctx.app, admin.accessToken);
}

async function auditRows(action: string) {
  const { rows } = await database.sql.query<{
    actor_id: string;
    target_id: string;
    outcome: string;
    details: Record<string, unknown>;
  }>(
    `SELECT actor_id, target_id, outcome, details FROM admin_audit_log
     WHERE action = $1 ORDER BY created_at, id`,
    [action],
  );
  return rows;
}

/** Empreinte des données financières et de jeu : aucune action de modération n'y touche. */
async function financialSnapshot() {
  const { rows } = await database.sql.query(
    `SELECT
       (SELECT count(*) FROM wallet_transactions)::int AS transactions,
       (SELECT COALESCE(sum(balance), 0)::text FROM wallets) AS balances,
       (SELECT COALESCE(sum(reserved), 0)::text FROM wallets) AS reserved,
       (SELECT count(*) FROM platform_ledger)::int AS ledger,
       (SELECT count(*) FROM payments)::int AS payments,
       (SELECT count(*) FROM games)::int AS games`,
  );
  return rows[0];
}

describe('Activation et désactivation du compte', () => {
  it('désactive (sessions révoquées, connexion refusée), idempotent, puis réactive', async () => {
    const player = await registerAndLogin(ctx.app);
    const before = await financialSnapshot();

    const res = await api.post(`${user(player.userId)}/disable`, { reason: 'Fraude au paiement' });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'disabled', changed: true, revokedSessions: 1 });

    // Anciens jetons refusés côté serveur ; nouvelle connexion refusée.
    expect((await me(player.accessToken)).status).toBe(401);
    expect((await refresh(player.refreshToken)).status).toBe(401);
    const denied = await playerLogin(player.email, player.password);
    expect(denied.status).toBe(403);
    expect(denied.body.code).toBe('ACCOUNT_DISABLED');

    // Idempotent : aucune nouvelle écriture ni nouvel audit.
    const again = await api.post(`${user(player.userId)}/disable`, { reason: 'Fraude' });
    expect(again.body).toEqual({ status: 'disabled', changed: false, revokedSessions: 0 });
    expect(await auditRows('USER_DISABLED')).toEqual([
      expect.objectContaining({
        actor_id: admin.userId,
        target_id: player.userId,
        outcome: 'SUCCESS',
        details: { reason: 'Fraude au paiement', revokedSessions: 1 },
      }),
    ]);

    // Persistance : la liste filtre le compte comme désactivé.
    const list = await api.get('/api/admin/users?status=disabled');
    expect(list.body.items.map((u: { id: string }) => u.id)).toEqual([player.userId]);

    const enabled = await api.post(`${user(player.userId)}/enable`, { reason: 'Vérifié' });
    expect(enabled.body).toEqual({ status: 'active', changed: true, revokedSessions: 0 });
    // Les anciennes sessions ne sont pas restaurées ; une nouvelle connexion fonctionne.
    expect((await me(player.accessToken)).status).toBe(401);
    expect((await playerLogin(player.email, player.password)).status).toBe(200);
    expect(await financialSnapshot()).toEqual(before);
  });

  it('exige le rôle admin et un motif ; refuse les champs inconnus', async () => {
    const player = await registerAndLogin(ctx.app);
    const other = await registerAndLogin(ctx.app);
    await request(ctx.app)
      .post(`${user(other.userId)}/disable`)
      .send({ reason: 'x'.repeat(10) })
      .expect(401);
    const forbidden = await request(ctx.app)
      .post(`${user(other.userId)}/disable`)
      .set('Authorization', `Bearer ${player.accessToken}`)
      .send({ reason: 'Tentative' });
    expect(forbidden.status).toBe(403);
    expect((await api.post(`${user(other.userId)}/disable`, {})).status).toBe(400);
    const spoof = await api.post(`${user(other.userId)}/disable`, {
      reason: 'Motif valable',
      actorId: other.userId,
    });
    expect(spoof.status).toBe(400);
    expect(spoof.body.fields).toEqual({ actorId: 'Champ inconnu.' });
    expect((await api.post(`${user(randomUUID())}/disable`, { reason: 'Inconnu' })).status).toBe(
      404,
    );
    const { rows } = await database.sql.query('SELECT status FROM users WHERE id = $1', [
      other.userId,
    ]);
    expect(rows[0]).toEqual({ status: 'active' });
  });

  it('refuse l’auto-désactivation et l’auto-suspension (auditées en échec)', async () => {
    const self = await api.post(`${user(admin.userId)}/disable`, { reason: 'Test' });
    expect(self.status).toBe(403);
    expect(self.body.code).toBe('SELF_ACTION_FORBIDDEN');
    const suspend = await api.post(`${user(admin.userId)}/suspension`, { reason: 'Test' });
    expect(suspend.body.code).toBe('SELF_ACTION_FORBIDDEN');
    expect(await auditRows('USER_DISABLED')).toEqual([
      expect.objectContaining({ outcome: 'FAILURE', details: { refused: 'SELF_ACTION' } }),
    ]);
    // L'administrateur reste connecté.
    expect((await api.get('/api/admin/auth/session')).status).toBe(200);
  });

  it('protège le dernier super administrateur accessible, même en concurrence', async () => {
    const second = await createAdmin(ctx.app, database.sql);
    const service = new PlayerModerationService({
      repository: new PostgresModerationRepository(database.sql),
      audit: new PostgresAdminAuditRepository(database.sql),
      logger: createLogger({}, () => undefined),
      clock: () => ctx.now(),
    });
    // Chacun désactive l'autre au même moment : l'une passe, l'autre est refusée.
    const results = await Promise.allSettled([
      service.setAccountEnabled(second.userId as UserId, false, 'Croisé', admin.userId as UserId),
      service.setAccountEnabled(admin.userId as UserId, false, 'Croisé', second.userId as UserId),
    ]);
    const statuses = results.map((r) => r.status).sort();
    expect(statuses).toEqual(['fulfilled', 'rejected']);
    const rejected = results.find((r) => r.status === 'rejected') as PromiseRejectedResult;
    expect(rejected.reason).toMatchObject({
      name: 'ModerationForbiddenError',
      reason: 'LAST_ADMIN',
    });
    const { rows } = await database.sql.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM users WHERE role = 'admin' AND status = 'active'`,
    );
    expect(rows[0]?.n).toBe(1);
  });
});

describe('Fiche détaillée et historique', () => {
  it('renvoie l’état de modération et la sécurité, sans jeton ni mot de passe', async () => {
    const player = await registerAndLogin(ctx.app);
    const res = await api.get(`${user(player.userId)}/moderation`);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      suspension: null,
      chatRestriction: null,
      isSelf: false,
      security: { activeSessions: 1, lastLoginAt: ctx.now().toISOString() },
    });
    const text = JSON.stringify(res.body);
    expect(text).not.toContain(player.refreshToken);
    expect(text).not.toMatch(/password|hash|token_hash/i);

    const detail = await api.get(user(player.userId));
    expect(detail.body.user).toMatchObject({ suspension: null, chatRestriction: null });
    expect(detail.body.user.actions).toBeUndefined();

    expect((await api.get(`${user(randomUUID())}/moderation`)).status).toBe(404);
    const forbidden = await request(ctx.app)
      .get(`${user(player.userId)}/moderation`)
      .set('Authorization', `Bearer ${player.accessToken}`);
    expect(forbidden.status).toBe(403);
  });

  it('historiques paginés et limités au joueur demandé', async () => {
    const [A, B] = [await registerAndLogin(ctx.app), await registerAndLogin(ctx.app)];
    // Sans Idempotency-Key, refusé : aucune ligne.
    expect((await api.post(`${user(B.userId)}/warnings`, { reason: 'Sans clé' })).status).toBe(400);

    const warn = (id: string, reason: string) =>
      request(ctx.app)
        .post(`${user(id)}/warnings`)
        .set('Authorization', `Bearer ${admin.accessToken}`)
        .set('Idempotency-Key', randomUUID())
        .send({ reason });
    for (let i = 0; i < 3; i += 1) await warn(A.userId, `Avertissement ${i}`);
    await warn(B.userId, 'Avertissement B');

    const page1 = await api.get(`${user(A.userId)}/sanctions?page=1&limit=2`);
    expect(page1.body).toMatchObject({ page: 1, limit: 2, total: 3 });
    expect(page1.body.items).toHaveLength(2);
    const page2 = await api.get(`${user(A.userId)}/sanctions?page=2&limit=2`);
    expect(page2.body.items).toHaveLength(1);
    const reasons = [...page1.body.items, ...page2.body.items].map(
      (s: { reason: string }) => s.reason,
    );
    expect(reasons).not.toContain('Avertissement B');
  });
});

describe('Suspension', () => {
  it('temporaire : accès refusé partout, puis rétabli à l’échéance (heure du serveur)', async () => {
    const player = await registerAndLogin(ctx.app);
    const endsAt = new Date(ctx.now().getTime() + HOUR).toISOString();
    const res = await api.post(`${user(player.userId)}/suspension`, {
      reason: 'Comportement abusif',
      comment: 'Signalé par trois joueurs',
      endsAt,
    });
    expect(res.status).toBe(201);
    expect(res.body.revokedSessions).toBe(1);

    expect((await me(player.accessToken)).status).toBe(401);
    expect((await refresh(player.refreshToken)).status).toBe(401);
    const denied = await playerLogin(player.email, player.password);
    expect(denied.status).toBe(403);
    expect(denied.body).toMatchObject({
      code: 'ACCOUNT_SUSPENDED',
      details: { suspendedUntil: endsAt },
    });

    const again = await api.post(`${user(player.userId)}/suspension`, { reason: 'Encore' });
    expect(again.status).toBe(409);
    expect(again.body.code).toBe('ALREADY_SUSPENDED');

    const view = await api.get(`${user(player.userId)}/moderation`);
    expect(view.body.suspension).toMatchObject({
      state: 'ACTIVE',
      endsAt,
      reason: 'Comportement abusif',
    });
    const listed = await api.get('/api/admin/users?status=suspended');
    expect(listed.body.items.map((u: { id: string }) => u.id)).toEqual([player.userId]);
    expect(listed.body.items[0].suspension).toEqual({ endsAt });

    // Échéance passée : aucune écriture, l'accès revient ; le statut n'a jamais changé.
    ctx.advance(HOUR + 1000);
    expect((await playerLogin(player.email, player.password)).status).toBe(200);
    await reloginAdmin();
    const after = await api.get(`${user(player.userId)}/moderation`);
    expect(after.body.suspension).toBeNull();
    const history = await api.get(`${user(player.userId)}/sanctions`);
    expect(history.body.items[0]).toMatchObject({ kind: 'SUSPENSION', state: 'EXPIRED' });
  });

  it('indéterminée, levée avant échéance avec motif', async () => {
    const player = await registerAndLogin(ctx.app);
    await api.post(`${user(player.userId)}/suspension`, { reason: 'Enquête en cours' }).expect(201);
    const denied = await playerLogin(player.email, player.password);
    expect(denied.body.details).toEqual({ suspendedUntil: null });

    expect((await api.post(`${user(player.userId)}/suspension/lift`, {})).status).toBe(400);
    const lifted = await api.post(`${user(player.userId)}/suspension/lift`, {
      reason: 'Enquête close',
    });
    expect(lifted.status).toBe(200);
    expect((await playerLogin(player.email, player.password)).status).toBe(200);
    const noMore = await api.post(`${user(player.userId)}/suspension/lift`, { reason: 'Encore' });
    expect(noMore.body.code).toBe('NOT_SUSPENDED');
    expect((await auditRows('USER_SUSPENSION_LIFTED'))[0]?.details).toMatchObject({
      reason: 'Enquête close',
    });
  });

  it('l’expiration ne réactive pas un compte désactivé pour une autre raison', async () => {
    const player = await registerAndLogin(ctx.app);
    await api.post(`${user(player.userId)}/suspension`, {
      reason: 'Suspension courte',
      endsAt: new Date(ctx.now().getTime() + HOUR).toISOString(),
    });
    await api.post(`${user(player.userId)}/disable`, { reason: 'Compte frauduleux' });
    ctx.advance(2 * HOUR);
    const denied = await playerLogin(player.email, player.password);
    expect(denied.body.code).toBe('ACCOUNT_DISABLED');
  });

  it('valide l’échéance : passée ou au-delà d’un an refusée', async () => {
    const player = await registerAndLogin(ctx.app);
    const past = await api.post(`${user(player.userId)}/suspension`, {
      reason: 'Motif',
      endsAt: new Date(ctx.now().getTime() - HOUR).toISOString(),
    });
    expect(past.status).toBe(400);
    const far = await api.post(`${user(player.userId)}/suspension`, {
      reason: 'Motif',
      endsAt: new Date(ctx.now().getTime() + 400 * 24 * HOUR).toISOString(),
    });
    expect(far.status).toBe(400);
    expect((await me(player.accessToken)).status).toBe(200);
  });
});

describe('Révocation des sessions', () => {
  it('invalide les jetons du joueur seulement, reconnexion possible', async () => {
    const [A, B] = [await registerAndLogin(ctx.app), await registerAndLogin(ctx.app)];
    const res = await api.post(`${user(A.userId)}/sessions/revoke`, { reason: 'Appareil volé' });
    expect(res.body).toEqual({ revokedSessions: 1 });
    expect((await me(A.accessToken)).status).toBe(401);
    expect((await refresh(A.refreshToken)).status).toBe(401);
    // Autre joueur et administrateur non affectés.
    expect((await me(B.accessToken)).status).toBe(200);
    expect((await api.get('/api/admin/auth/session')).status).toBe(200);
    // Reconnexion normale.
    expect((await playerLogin(A.email, A.password)).status).toBe(200);
    // Ni jeton ni empreinte dans le journal.
    const audit = await auditRows('USER_SESSIONS_REVOKED');
    expect(audit[0]?.details).toEqual({ revokedSessions: 1, reason: 'Appareil volé' });
    expect(JSON.stringify(audit)).not.toContain(A.refreshToken);
    const { rows } = await database.sql.query(
      `SELECT revoked_reason FROM refresh_tokens WHERE user_id = $1 AND revoked_reason = 'admin_revoked'`,
      [A.userId],
    );
    expect(rows).toHaveLength(1);
  });

  it('refuse de révoquer ses propres sessions', async () => {
    const res = await api.post(`${user(admin.userId)}/sessions/revoke`, {});
    expect(res.status).toBe(403);
    expect((await api.get('/api/admin/auth/session')).status).toBe(200);
  });
});

describe('Avertissements, restriction du chat, notes et journal', () => {
  function withKey(path: string, body: object, key = randomUUID()) {
    return request(ctx.app)
      .post(path)
      .set('Authorization', `Bearer ${admin.accessToken}`)
      .set('Idempotency-Key', key)
      .send(body);
  }

  it('avertissement transmis par notification ; texte interne jamais exposé au joueur', async () => {
    const player = await registerAndLogin(ctx.app);
    const key = randomUUID();
    const body = {
      reason: 'Langage inapproprié',
      playerMessage: 'Merci de rester courtois dans le chat.',
      comment: 'NOTE-INTERNE-SECRETE',
    };
    const first = await withKey(`${user(player.userId)}/warnings`, body, key);
    expect(first.status).toBe(201);
    expect(first.body).toMatchObject({ delivered: true, replayed: false });
    // Même clé : aucun doublon.
    const replay = await withKey(`${user(player.userId)}/warnings`, body, key);
    expect(replay.status).toBe(200);
    expect(replay.body).toMatchObject({ sanctionId: first.body.sanctionId, replayed: true });

    const seen = await request(ctx.app)
      .get('/api/notifications')
      .set('Authorization', `Bearer ${player.accessToken}`)
      .expect(200);
    expect(seen.body.notifications).toHaveLength(1);
    expect(seen.body.notifications[0]).toMatchObject({
      type: 'MODERATION_WARNING',
      payload: { message: 'Merci de rester courtois dans le chat.' },
    });
    expect(JSON.stringify(seen.body)).not.toMatch(/NOTE-INTERNE|Langage inapproprié/);

    ctx.advance(1000);
    const silent = await withKey(`${user(player.userId)}/warnings`, { reason: 'Simple rappel' });
    expect(silent.body.delivered).toBe(false);
    const list = await api.get(`${user(player.userId)}/sanctions`);
    expect(list.body.items.map((s: { delivered: boolean }) => s.delivered)).toEqual([false, true]);
  });

  it('restriction du chat : enregistrée, visible, levée ; le compte reste actif', async () => {
    const player = await registerAndLogin(ctx.app);
    const res = await api.post(`${user(player.userId)}/chat-restriction`, {
      reason: 'Spam répété',
      endsAt: new Date(ctx.now().getTime() + 24 * HOUR).toISOString(),
    });
    expect(res.status).toBe(201);
    expect((await me(player.accessToken)).status).toBe(200);
    const view = await api.get(`${user(player.userId)}/moderation`);
    expect(view.body.chatRestriction).toMatchObject({ state: 'ACTIVE', reason: 'Spam répété' });
    const dup = await api.post(`${user(player.userId)}/chat-restriction`, { reason: 'Encore' });
    expect(dup.body.code).toBe('ALREADY_CHAT_RESTRICTED');
    await api
      .post(`${user(player.userId)}/chat-restriction/lift`, { reason: 'Excuses' })
      .expect(200);
    expect((await api.get(`${user(player.userId)}/moderation`)).body.chatRestriction).toBeNull();
  });

  it('notes : auteur imposé par le serveur, suppression logique tracée', async () => {
    const player = await registerAndLogin(ctx.app);
    const spoof = await withKey(`${user(player.userId)}/notes`, {
      body: 'Note',
      authorId: player.userId,
    });
    expect(spoof.status).toBe(400);
    const created = await withKey(`${user(player.userId)}/notes`, {
      body: '<script>alert(1)</script> appel au support',
    });
    expect(created.status).toBe(201);
    const notes = await api.get(`${user(player.userId)}/notes`);
    expect(notes.body.items[0]).toMatchObject({
      body: '<script>alert(1)</script> appel au support',
      author: { id: admin.userId },
      deleted: null,
    });

    const noteId = created.body.noteId as string;
    await api
      .post(`${user(player.userId)}/notes/${noteId}/delete`, { reason: 'Erreur de saisie' })
      .expect(200);
    const again = await api.post(`${user(player.userId)}/notes/${noteId}/delete`, {
      reason: 'Encore',
    });
    expect(again.body.code).toBe('NOTE_ALREADY_DELETED');
    // Autre joueur : 404 (une note n'est jamais atteinte par un autre joueur).
    const other = await registerAndLogin(ctx.app);
    expect(
      (await api.post(`${user(other.userId)}/notes/${noteId}/delete`, { reason: 'Erreur' })).status,
    ).toBe(404);
    const after = await api.get(`${user(player.userId)}/notes`);
    expect(after.body.items[0]).toMatchObject({
      body: null,
      deleted: { by: { id: admin.userId }, reason: 'Erreur de saisie' },
    });
    const { rows } = await database.sql.query('SELECT body FROM user_admin_notes WHERE id = $1', [
      noteId,
    ]);
    expect(rows).toHaveLength(1);
    // Ni modification ni suppression physique possibles en base.
    await expect(
      database.sql.query('DELETE FROM user_admin_notes WHERE id = $1', [noteId]),
    ).rejects.toThrow();
  });

  it('journal de modération : actions du joueur, sans les consultations par défaut', async () => {
    const player = await registerAndLogin(ctx.app);
    await api.get(user(player.userId)).expect(200);
    ctx.advance(1000);
    await api.post(`${user(player.userId)}/sessions/revoke`, {}).expect(200);
    ctx.advance(1000);
    await api.post(`${user(player.userId)}/chat-restriction`, { reason: 'Spam' }).expect(201);
    const log = await api.get(`${user(player.userId)}/moderation-log`);
    expect(log.body.items.map((e: { action: string }) => e.action)).toEqual([
      'USER_CHAT_RESTRICTED',
      'USER_SESSIONS_REVOKED',
    ]);
    expect(log.body.items[0].actor).toEqual({ id: admin.userId, username: expect.any(String) });
    const withViews = await api.get(`${user(player.userId)}/moderation-log?includeViews=true`);
    expect(withViews.body.total).toBe(3);
  });
});
