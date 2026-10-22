import { randomUUID } from 'node:crypto';

import {
  asAdmin,
  createAdmin,
  createAdminTestApp,
  type AdminTestContext,
} from '../../fixtures/admin';
import { registerAndLogin } from '../../fixtures/auth';
import {
  createMigratedDatabase,
  PGLITE_TIMEOUT_MS,
  type TestDatabase,
} from '../../fixtures/pglite';

/**
 * Recettes de la caisse UNIQUE par origine (D-120) : Fap-Fap, Tournois, GARAM TIA. Garde-fous
 * en base (source cohérente avec la partie ou le tournoi, une écriture par origine), filtres
 * combinables de l'administration (source, période, recherche) et agrégats du tableau de bord
 * (total = somme des sources).
 */
jest.setTimeout(PGLITE_TIMEOUT_MS);

let database: TestDatabase;
let ctx: AdminTestContext;
let api: ReturnType<typeof asAdmin>;

beforeAll(async () => {
  database = await createMigratedDatabase();
}, PGLITE_TIMEOUT_MS);
afterAll(() => database.close());
beforeEach(async () => {
  ctx = createAdminTestApp(database.sql);
  const admin = await createAdmin(ctx.app, database.sql);
  api = asAdmin(ctx.app, admin.accessToken);
});
afterEach(() => database.reset());

const AT = '2026-10-20T08:00:00Z';

async function seedGame(gameType: 'TER' | 'GARAM') {
  const a = await registerAndLogin(ctx.app);
  const sessionId = randomUUID();
  const gameId = randomUUID();
  await database.sql.query(
    `INSERT INTO sessions (id, version, status, creator_id, created_at, updated_at, max_players,
       game_type, garam_variant)
     VALUES ($1, 1, 'open', $2, $3, $3, 2, $4, CASE WHEN $4::text = 'GARAM' THEN 15 END)`,
    [sessionId, a.userId, AT, gameType],
  );
  await database.sql.query(
    `INSERT INTO games (id, version, status, creator_id, max_players, state, created_at,
       updated_at, session_id, first_player_id, game_type, garam_variant)
     VALUES ($1, 1, 'waiting', $2, 2, '{"recentCommandIds":[]}', $3, $3, $4, $2, $5,
       CASE WHEN $5::text = 'GARAM' THEN 15 END)`,
    [gameId, a.userId, AT, sessionId, gameType],
  );
  return { gameId, sessionId };
}

async function seedTournament() {
  const tournamentId = randomUUID();
  await database.sql.query(
    `INSERT INTO tournaments (game_type, id, starts_at, ends_at, created_at, updated_at, status,
       entry_fee, platform_fee_bps, participants, gross_pool, platform_fee, prize_pool,
       published_at, blocked_until, registration_closes_at, started_at, ranking_method,
       settlement_rule)
     VALUES ('TER', $1, '2026-10-15T10:00:00Z', '2026-10-15T11:00:00Z',
             '2026-10-01T10:00:00Z', '2026-10-15T10:00:00Z', 'IN_PROGRESS',
             1000, 1000, 15, 15000, 1500, 13500,
             '2026-10-01T10:00:00Z', '2026-10-15T11:00:00Z', '2026-10-15T10:00:00Z',
             '2026-10-15T10:00:00Z', 'D106_CAPITAL_RATIO', 'D111_ORDINARY_RULES')`,
    [tournamentId],
  );
  return tournamentId;
}

const gameEntry = (gameId: string, amount: number, at: string, source: string) =>
  database.sql.query(
    `INSERT INTO platform_ledger (id, game_id, kind, amount, fee_bps, currency, created_at, source)
     VALUES ($1, $2, 'GAME_COMMISSION', $3, 100, 'XAF', $4, $5)`,
    [randomUUID(), gameId, amount, at, source],
  );
const tournamentEntry = (tournamentId: string, kind: string, amount: number, at: string) =>
  database.sql.query(
    `INSERT INTO platform_ledger (id, tournament_id, kind, amount, fee_bps, currency, created_at,
       source)
     VALUES ($1, $2, $3, $4, 1000, 'XAF', $5, 'TOURNAMENT')`,
    [randomUUID(), tournamentId, kind, amount, at],
  );

/**
 * Fap-Fap 500 (20/10 08:00), GARAM 750 (20/10 09:00), tournoi : commission 1 500 (15/10),
 * rangs non occupés 300 (25/09). Total 3 050.
 */
async function seedLedger() {
  const fap = await seedGame('TER');
  const garam = await seedGame('GARAM');
  const tournamentId = await seedTournament();
  await gameEntry(fap.gameId, 500, '2026-10-20T08:00:00Z', 'FAP_FAP');
  await gameEntry(garam.gameId, 750, '2026-10-20T09:00:00Z', 'GARAM_TIA');
  await tournamentEntry(tournamentId, 'TOURNAMENT_PLATFORM_FEE', 1_500, '2026-10-15T10:00:00Z');
  await tournamentEntry(tournamentId, 'UNALLOCATED_PRIZE', 300, '2026-09-25T10:00:00Z');
  return { fap, garam, tournamentId };
}

const amounts = (bySource: { source: string; amount: number }[]) =>
  Object.fromEntries(bySource.map((s) => [s.source, s.amount]));

describe('caisse unique, source obligatoire et cohérente (base)', () => {
  it('une commission de partie porte la source du jeu de sa partie', async () => {
    const garam = await seedGame('GARAM');
    await expect(gameEntry(garam.gameId, 10, AT, 'FAP_FAP')).rejects.toThrow();
    await expect(gameEntry(garam.gameId, 10, AT, 'TOURNAMENT')).rejects.toThrow();
    await expect(
      database.sql.query(
        `INSERT INTO platform_ledger (id, game_id, kind, amount, currency, created_at)
         VALUES ($1, $2, 'GAME_COMMISSION', 10, 'XAF', $3)`,
        [randomUUID(), garam.gameId, AT],
      ),
    ).rejects.toThrow();
    await gameEntry(garam.gameId, 10, AT, 'GARAM_TIA');
  });

  it('idempotence : une seule commission par partie, une seule écriture par tournoi et type', async () => {
    const { fap, tournamentId } = await seedLedger();
    await expect(gameEntry(fap.gameId, 500, AT, 'FAP_FAP')).rejects.toThrow();
    await expect(
      tournamentEntry(tournamentId, 'TOURNAMENT_PLATFORM_FEE', 1_500, AT),
    ).rejects.toThrow();
    const { rows } = await database.sql.query<{ n: number }>(
      'SELECT count(*)::int AS n FROM platform_ledger',
    );
    expect(rows[0]!.n).toBe(4);
  });
});

describe('liste des écritures : source, filtres combinables, recherche', () => {
  const list = async (query: string) =>
    (await api.get(`/api/admin/platform-account/entries${query}`).expect(200)).body;

  it('chaque écriture affiche sa source ; filtre par source', async () => {
    const { garam } = await seedLedger();
    const all = await list('');
    expect(all.total).toBe(4);
    expect(all.items.map((e: { source: string }) => e.source).sort()).toEqual([
      'FAP_FAP',
      'GARAM_TIA',
      'TOURNAMENT',
      'TOURNAMENT',
    ]);
    const onlyGaram = await list('?source=GARAM_TIA');
    expect(onlyGaram.total).toBe(1);
    expect(onlyGaram.items[0]).toMatchObject({
      source: 'GARAM_TIA',
      amount: 750,
      origin: { type: 'GAME', id: garam.gameId, sessionId: garam.sessionId },
    });
    expect((await list('?source=FAP_FAP')).total).toBe(1);
    expect((await list('?source=TOURNAMENT')).total).toBe(2);
    await api.get('/api/admin/platform-account/entries?source=AUTRE').expect(400);
  });

  it('source + période ; source + période + recherche', async () => {
    const { garam, tournamentId } = await seedLedger();
    const today = '&from=2026-10-20T00:00:00Z&to=2026-10-21T00:00:00Z';
    expect((await list(`?source=GARAM_TIA${today}`)).total).toBe(1);
    expect((await list(`?source=TOURNAMENT${today}`)).total).toBe(0);
    expect((await list(`?from=2026-10-01T00:00:00Z&to=2026-10-21T00:00:00Z`)).total).toBe(3);
    // Recherche par référence de partie, de session, de tournoi (préfixe).
    expect((await list(`?q=${garam.gameId.slice(0, 8)}`)).total).toBe(1);
    expect((await list(`?q=${garam.sessionId.slice(0, 8)}&source=GARAM_TIA`)).total).toBe(1);
    expect((await list(`?q=${garam.gameId.slice(0, 8)}&source=FAP_FAP`)).total).toBe(0);
    expect(
      (await list(`?q=${tournamentId.slice(0, 8)}&source=TOURNAMENT${today}`)).total,
    ).toBe(0);
    expect((await list(`?q=${tournamentId.slice(0, 8)}&source=TOURNAMENT`)).total).toBe(2);
  });
});

describe('compte financier et tableau de bord : répartition par source', () => {
  it('compte : solde global = somme des écritures = somme des sources', async () => {
    await seedLedger();
    const account = (await api.get('/api/admin/platform-account').expect(200)).body;
    expect(amounts(account.bySource)).toEqual({ FAP_FAP: 500, TOURNAMENT: 1_800, GARAM_TIA: 750 });
    expect(account.computedBalance.amount).toBe(3_050);
  });

  it.each([
    ['30 derniers jours', '2026-09-21T00:00:00Z', { FAP_FAP: 500, TOURNAMENT: 1_800, GARAM_TIA: 750 }],
    ['7 derniers jours', '2026-10-14T00:00:00Z', { FAP_FAP: 500, TOURNAMENT: 1_500, GARAM_TIA: 750 }],
    ['aujourd’hui', '2026-10-20T00:00:00Z', { FAP_FAP: 500, TOURNAMENT: 0, GARAM_TIA: 750 }],
  ])('%s : total = Fap-Fap + Tournois + GARAM TIA ; caisse globale inchangée', async (_, from, expected) => {
    await seedLedger();
    const res = await api
      .get(`/api/admin/dashboard?from=${from}&to=2026-10-21T00:00:00Z`)
      .expect(200);
    const { commissions } = res.body;
    expect(amounts(commissions.bySource)).toEqual(expected);
    const sum = Object.values(expected).reduce((a, b) => a + b, 0);
    expect(commissions.total).toBe(sum);
    expect(res.body.platformRevenue).toBe(sum);
    // La caisse UNIQUE (tout l'historique) ne dépend pas de la période.
    expect(res.body.platformAccountBalance).toBe(3_050);
  });

  it('période personnalisée + source : indicateurs de cette source seulement', async () => {
    await seedLedger();
    const custom = '&from=2026-10-20T08:30:00Z&to=2026-10-20T10:00:00Z';
    const garam = (await api.get(`/api/admin/dashboard?source=GARAM_TIA${custom}`).expect(200))
      .body.commissions;
    expect(garam).toMatchObject({ source: 'GARAM_TIA', total: 750, entries: 1 });
    const fap = (await api.get(`/api/admin/dashboard?source=FAP_FAP${custom}`).expect(200)).body
      .commissions;
    expect(fap).toMatchObject({ source: 'FAP_FAP', total: 0, entries: 0 });
    await api.get('/api/admin/dashboard?source=AUTRE').expect(400);
  });
});
