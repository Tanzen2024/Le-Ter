import { randomUUID } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { Pool } from 'pg';
import { createClient, type RedisClientType } from 'redis';

import { loadMigrations, runMigrations } from '../../../src/database/migrator';
import { createPgSqlClient, type SqlClient } from '../../../src/database/sql-client';
import type { UserId } from '../../../src/domain/users/user';
import { createLogger } from '../../../src/utils/logger';
import { RedisPubSubTransport } from '../../../src/websocket/pubsub-transport';
import { PubSubUserEventBus, type UserEvent } from '../../../src/websocket/user-event-bus';
import {
  balances,
  createTournamentTestStack,
  fillWith,
  HOUR,
  saveTournamentSettings,
  seedAdmin,
  TestClock,
  tournamentInput,
} from '../../fixtures/tournaments';

/**
 * D-112 avec un VRAI Redis et un VRAI PostgreSQL : Redis ne transporte qu'un SIGNAL « gain
 * crédité », émis après le COMMIT ; PostgreSQL reste la seule source de vérité. Une panne Redis
 * ne fait ni échouer, ni répéter, ni annoncer un crédit inexistant.
 *
 * Exécutée seulement si TEST_DATABASE_URL désigne `le_ter_test` (différente de DATABASE_URL) ET
 * TEST_REDIS_URL est défini. Pub/Sub seulement (aucune clé Redis écrite).
 */
const url = process.env.TEST_DATABASE_URL;
const redisUrl = process.env.TEST_REDIS_URL;

function applicationDatabaseUrl(): string | undefined {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  const envFile = resolve(__dirname, '../../../.env');
  if (!existsSync(envFile)) return undefined;
  const line = readFileSync(envFile, 'utf8')
    .split(/\r?\n/)
    .find((l) => /^\s*DATABASE_URL\s*=/.test(l));
  return line
    ?.replace(/^\s*DATABASE_URL\s*=\s*/, '')
    .replace(/^["']|["']$/g, '')
    .trim();
}

const dbName = (() => {
  try {
    return url ? decodeURIComponent(new URL(url).pathname.replace(/^\//, '')) : undefined;
  } catch {
    return undefined;
  }
})();
const ready =
  Boolean(url) && Boolean(redisUrl) && url !== applicationDatabaseUrl() && dbName === 'le_ter_test';
const describeWithInfra = ready ? describe : describe.skip;
jest.setTimeout(180_000);

describeWithInfra('D-112 : signaux de gain sur Redis réel, PostgreSQL source de vérité', () => {
  const schema = `tournament_payout_signals_${randomUUID().replace(/-/g, '')}`;
  const logger = createLogger({}, () => undefined);
  const clients: RedisClientType[] = [];
  let pool: Pool;
  let sql: SqlClient;

  async function redis(): Promise<RedisClientType> {
    const client: RedisClientType = createClient({ url: redisUrl });
    client.on('error', () => undefined);
    await client.connect();
    clients.push(client);
    return client;
  }
  const bus = async () =>
    new PubSubUserEventBus(new RedisPubSubTransport(await redis(), await redis()), logger);

  beforeAll(async () => {
    const admin = new Pool({ connectionString: url, max: 1 });
    const { rows } = await admin.query<{ db: string }>('SELECT current_database() AS db');
    if (rows[0]?.db !== 'le_ter_test') {
      await admin.end();
      throw new Error(`Base inattendue (${rows[0]?.db}) : exécution refusée`);
    }
    await admin.query(`CREATE SCHEMA ${schema}`);
    await admin.end();
    pool = new Pool({ connectionString: url, max: 20, options: `-c search_path=${schema}` });
    sql = createPgSqlClient(pool);
    await runMigrations(sql, await loadMigrations());
    await saveTournamentSettings(sql);
  });
  afterAll(async () => {
    await Promise.all(clients.map((c) => c.quit().catch(() => undefined)));
    await pool?.query(`DROP SCHEMA ${schema} CASCADE`);
    await pool?.end();
  });

  async function endedTournament(
    clock: TestClock,
    stack: ReturnType<typeof createTournamentTestStack>,
  ) {
    const admin = await seedAdmin(sql, `admin-${randomUUID()}`);
    const t = await stack.tournaments.createAsAdmin(admin, tournamentInput(clock, HOUR));
    await fillWith(stack, sql, t.id);
    clock.set(t.startsAt);
    await stack.tournaments.advance(t.id);
    clock.set(t.endsAt);
    return t;
  }

  const creditedOf = async (tournamentId: string, userId: string) =>
    (
      await sql.query<{ status: string }>(
        'SELECT status FROM tournament_payouts WHERE tournament_id = $1 AND player_id = $2',
        [tournamentId, userId],
      )
    ).rows[0]?.status;

  it('signal reçu par une AUTRE instance, seulement quand PostgreSQL montre le crédit', async () => {
    const clock = new TestClock();
    const publisher = await bus();
    const listener = await bus();
    const stack = createTournamentTestStack(sql, clock, { userEvents: publisher });
    try {
      const t = await endedTournament(clock, stack);
      // Les résultats ne sont écrits qu'à la clôture : on s'abonne aux 20 participants.
      const participants = (
        await sql.query<{ player_id: string }>(
          'SELECT player_id FROM tournament_player_accounts WHERE tournament_id = $1',
          [t.id],
        )
      ).rows;
      const seen: { event: UserEvent; statusAtReception: string | undefined }[] = [];
      const pending: Promise<void>[] = [];
      for (const p of participants) {
        listener.subscribe(p.player_id as UserId, (event) => {
          if (event.notificationType !== 'TOURNAMENT_PRIZE_CREDITED') return;
          pending.push(
            creditedOf(t.id, event.userId).then((statusAtReception) => {
              seen.push({ event, statusAtReception });
            }),
          );
        });
      }
      await new Promise((r) => setTimeout(r, 500)); // abonnements Redis effectifs
      await stack.tournaments.advance(t.id);
      for (let i = 0; i < 100 && seen.length < 3; i += 1) {
        await new Promise((r) => setTimeout(r, 50));
        await Promise.all(pending);
      }
      expect(seen).toHaveLength(3);
      expect(seen.every((s) => s.statusAtReception === 'CREDITED')).toBe(true);
    } finally {
      await stack.stop();
    }
  });

  it('Redis indisponible au moment du crédit : crédit unique en base, aucune reprise de crédit', async () => {
    const clock = new TestClock();
    const brokenPublisher = await redis();
    const brokenSubscriber = await redis();
    const broken = new PubSubUserEventBus(
      new RedisPubSubTransport(brokenPublisher, brokenSubscriber),
      logger,
    );
    const stack = createTournamentTestStack(sql, clock, { userEvents: broken });
    try {
      const t = await endedTournament(clock, stack);
      // Coupure de Redis pour cette instance juste avant les versements.
      await brokenPublisher.quit();
      await expect(stack.tournaments.advance(t.id)).resolves.toMatchObject({ status: 'COMPLETED' });
      const prizes = (
        await sql.query<{ user_id: string; tokens: string }>(
          `SELECT user_id, tokens FROM wallet_transactions
           WHERE kind = 'tournament_prize' AND idempotency_key LIKE $1`,
          [`tournament-prize:${t.id}:%`],
        )
      ).rows;
      expect(prizes).toHaveLength(3);
      // Notifications en base (source de vérité), une par gain.
      const notices = await sql.query<{ n: number }>(
        `SELECT count(*)::int AS n FROM notifications
         WHERE type = 'TOURNAMENT_PRIZE_CREDITED' AND payload->>'tournamentId' = $1`,
        [t.id],
      );
      expect(notices.rows[0]!.n).toBe(3);

      // Redis rétabli (nouvelle instance) : la reprise ne recrédite rien.
      const restored = createTournamentTestStack(sql, clock, { userEvents: await bus() });
      try {
        clock.advance(61_000);
        await restored.tournaments.advance(t.id);
        await restored.scheduler.tick();
      } finally {
        await restored.stop();
      }
      const after = await sql.query<{ n: number }>(
        `SELECT count(*)::int AS n FROM wallet_transactions
         WHERE kind = 'tournament_prize' AND idempotency_key LIKE $1`,
        [`tournament-prize:${t.id}:%`],
      );
      expect(after.rows[0]!.n).toBe(3);
      for (const p of prizes) {
        const { balance } = await balances(sql, p.user_id as UserId);
        expect(balance).toBeGreaterThanOrEqual(Number(p.tokens));
      }
    } finally {
      await stack.stop();
    }
  });
});
