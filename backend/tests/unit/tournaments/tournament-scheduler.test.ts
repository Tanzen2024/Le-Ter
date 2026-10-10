import { createServer, type Server, type Socket } from 'node:net';

import { Pool } from 'pg';

import { createPgSqlClient } from '../../../src/database/sql-client';
import type { TournamentId } from '../../../src/domain/tournaments/tournament';
import { PostgresTournamentRepository } from '../../../src/repositories/postgres-tournament.repository';
import type { TournamentRepository } from '../../../src/repositories/tournament.repository';
import { TournamentScheduler } from '../../../src/services/tournaments/tournament-scheduler';
import type { TournamentService } from '../../../src/services/tournaments/tournament.service';
import { createLogger } from '../../../src/utils/logger';

/**
 * Planificateur des tournois face à une base qui ne répond plus (VM Docker figée,
 * hôte saturé) : un tick ne rejette jamais (un rejet non géré arrêterait Node 22),
 * l'échec est journalisé et le tick suivant reprend normalement.
 */
type LogLine = { level: string; message: string; [key: string]: unknown };

function stack(overrides: {
  settlePendingGames?: () => Promise<number>;
  findDue?: (now: Date) => Promise<TournamentId[]>;
  repository?: TournamentRepository;
}) {
  const logs: LogLine[] = [];
  const advance = jest.fn(async (_id: TournamentId) => undefined);
  const settlePendingGames = jest.fn(overrides.settlePendingGames ?? (async () => 0));
  const findDue = jest.fn(overrides.findDue ?? (async () => [] as TournamentId[]));
  const scheduler = new TournamentScheduler({
    tournaments: { settlePendingGames, advance } as unknown as TournamentService,
    repository: overrides.repository ?? ({ findDue } as unknown as TournamentRepository),
    logger: createLogger({}, (line) => logs.push(JSON.parse(line) as LogLine)),
    clock: () => new Date('2026-10-09T16:00:00Z'),
  });
  return { scheduler, logs, advance, settlePendingGames, findDue };
}

const id = (s: string) => s as TournamentId;

describe('TournamentScheduler — base indisponible', () => {
  it('un échec de findDue est journalisé, sans rejet ni avancement', async () => {
    const err = new Error('Connection terminated due to connection timeout', {
      cause: new Error('Connection terminated unexpectedly'),
    });
    const s = stack({ findDue: async () => Promise.reject(err) });

    await expect(s.scheduler.tick()).resolves.toEqual({ settled: 0, advanced: 0 });

    expect(s.advance).not.toHaveBeenCalled();
    expect(s.logs).toEqual([
      expect.objectContaining({
        level: 'error',
        message: 'tournament due lookup failed',
        error: 'Connection terminated due to connection timeout',
        cause: 'Connection terminated unexpectedly',
        durationMs: expect.any(Number),
      }),
    ]);
  });

  it("l'échec de la reprise des parties n'empêche pas les transitions dues", async () => {
    const s = stack({
      settlePendingGames: async () => Promise.reject(new Error('Query read timeout')),
      findDue: async () => [id('t1'), id('t2')],
    });

    await expect(s.scheduler.tick()).resolves.toEqual({ settled: 0, advanced: 2 });

    expect(s.advance.mock.calls.map(([t]) => t)).toEqual(['t1', 't2']);
    expect(s.logs.map((l) => l.message)).toEqual(['tournament games recovery failed']);
  });

  it('le tick suivant reprend après un échec ponctuel', async () => {
    let calls = 0;
    const s = stack({
      findDue: async () => {
        calls += 1;
        if (calls === 1) throw new Error('canceling statement due to statement timeout');
        return [id('t1')];
      },
    });

    await s.scheduler.tick();
    await expect(s.scheduler.tick()).resolves.toEqual({ settled: 0, advanced: 1 });
    expect(s.advance).toHaveBeenCalledTimes(1);
  });

  it('deux ticks qui se chevauchent : un seul passage, aucun traitement en double', async () => {
    let release!: (ids: TournamentId[]) => void;
    const s = stack({ findDue: () => new Promise((resolve) => (release = resolve)) });

    const first = s.scheduler.tick();
    await expect(s.scheduler.tick()).resolves.toEqual({ settled: 0, advanced: 0 });
    release([id('t1')]);
    await expect(first).resolves.toEqual({ settled: 0, advanced: 1 });

    expect(s.settlePendingGames).toHaveBeenCalledTimes(1);
    expect(s.findDue).toHaveBeenCalledTimes(1);
    expect(s.advance).toHaveBeenCalledTimes(1);
  });

  it('start() : un échec en arrière-plan ne produit aucun rejet non géré', async () => {
    const unhandled = jest.fn();
    process.on('unhandledRejection', unhandled);
    try {
      const s = stack({ findDue: async () => Promise.reject(new Error('Query read timeout')) });
      s.scheduler.start();
      s.scheduler.stop();
      await s.scheduler.idle();
      await new Promise((resolve) => setImmediate(resolve));
      expect(unhandled).not.toHaveBeenCalled();
      expect(s.logs.map((l) => l.message)).toEqual(['tournament due lookup failed']);
    } finally {
      process.off('unhandledRejection', unhandled);
    }
  });
});

/**
 * Reproduction du symptôme observé, sans Docker : un serveur TCP qui accepte la connexion
 * mais ne répond jamais, comme un PostgreSQL dont la VM est figée. Le vrai pilote `pg`,
 * le vrai SqlClient et le vrai dépôt produisent « Connection terminated due to connection
 * timeout » ; le planificateur le journalise au lieu d'arrêter le processus.
 */
describe('TournamentScheduler — vrai pilote pg face à un serveur figé', () => {
  let server: Server;
  const sockets = new Set<Socket>();
  let pool: Pool;

  beforeAll(async () => {
    server = createServer((socket) => {
      sockets.add(socket);
      socket.on('close', () => sockets.delete(socket));
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const { port } = server.address() as { port: number };
    pool = new Pool({
      connectionString: `postgres://u:p@127.0.0.1:${port}/db`,
      connectionTimeoutMillis: 200,
      max: 2,
    });
  });

  afterAll(async () => {
    await pool.end();
    for (const socket of sockets) socket.destroy();
    await new Promise((resolve) => server.close(resolve));
  });

  it('délai de connexion dépassé : journalisé, le tick se termine', async () => {
    const repository = new PostgresTournamentRepository(createPgSqlClient(pool));
    const s = stack({ repository, settlePendingGames: async () => 0 });

    await expect(s.scheduler.tick()).resolves.toEqual({ settled: 0, advanced: 0 });

    expect(s.logs).toEqual([
      expect.objectContaining({
        message: 'tournament due lookup failed',
        error: 'Connection terminated due to connection timeout',
      }),
    ]);
    // Aucune connexion conservée : le pool n'a rien gardé de la tentative ratée.
    expect(pool.totalCount).toBe(0);
  });
});
