import {
  createMigratedDatabase,
  PGLITE_TIMEOUT_MS,
  type TestDatabase,
} from '../../fixtures/pglite';
import type { ServerErrorOccurrence } from '../../../src/domain/admin/server-errors';
import { PostgresServerErrorRepository } from '../../../src/repositories/postgres-server-error.repository';

let database: TestDatabase;

beforeAll(async () => {
  database = await createMigratedDatabase();
}, PGLITE_TIMEOUT_MS);

afterAll(async () => {
  await database.close();
});

const occurrence = (over: Partial<ServerErrorOccurrence> = {}): ServerErrorOccurrence => ({
  method: 'POST',
  route: '/api/wallet/deposits',
  status: 500,
  code: null,
  errorName: 'Error',
  message: 'panne 1',
  requestId: 'req-1',
  stack: 'Error: panne 1\n    at x',
  occurredAt: new Date('2026-10-25T10:00:00Z'),
  ...over,
});

describe('PostgresServerErrorRepository (D-168, migration 0057)', () => {
  it('condense les occurrences d’une même panne et liste la plus récente d’abord', async () => {
    const repo = new PostgresServerErrorRepository(database.sql);
    await repo.record(occurrence());
    await repo.record(
      occurrence({
        message: 'panne 2',
        requestId: 'req-2',
        occurredAt: new Date('2026-10-25T11:00:00Z'),
      }),
    );
    await repo.record(
      occurrence({
        route: '/api/games/:gameId',
        status: 503,
        code: 'SERVICE_TEMPORARILY_UNAVAILABLE',
        occurredAt: new Date('2026-10-25T09:00:00Z'),
      }),
    );

    const { total, items } = await repo.list({ page: 1, limit: 10 });
    expect(total).toBe(2);
    expect(items[0]).toMatchObject({
      route: '/api/wallet/deposits',
      occurrences: 2,
      message: 'panne 2',
      lastRequestId: 'req-2',
      firstSeenAt: new Date('2026-10-25T10:00:00Z'),
      lastSeenAt: new Date('2026-10-25T11:00:00Z'),
    });
    expect(items[1]).toMatchObject({ status: 503, code: 'SERVICE_TEMPORARILY_UNAVAILABLE', occurrences: 1 });

    const second = await repo.list({ page: 2, limit: 1 });
    expect(second.items.map((i) => i.status)).toEqual([503]);
  });

  it('message et trace trop longs : tronqués, jamais refusés', async () => {
    const repo = new PostgresServerErrorRepository(database.sql);
    await repo.record(
      occurrence({ route: '/api/long', message: 'x'.repeat(5000), stack: 'y'.repeat(20000) }),
    );
    const { items } = await repo.list({ page: 1, limit: 10 });
    const long = items.find((i) => i.route === '/api/long')!;
    expect(long.message.length).toBeLessThanOrEqual(1000);
    expect(long.lastStack!.length).toBeLessThanOrEqual(8000);
  });
});
