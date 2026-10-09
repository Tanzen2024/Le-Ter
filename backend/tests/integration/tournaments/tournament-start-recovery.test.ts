import type { TournamentId } from '../../../src/domain/tournaments/tournament';
import type { UserId } from '../../../src/domain/users/user';
import type { TournamentRepository } from '../../../src/repositories/tournament.repository';
import { TournamentService } from '../../../src/services/tournaments/tournament.service';
import { createLogger } from '../../../src/utils/logger';
import {
  createMigratedDatabase,
  PGLITE_TIMEOUT_MS,
  type TestDatabase,
} from '../../fixtures/pglite';
import {
  balances,
  createTournamentTestStack,
  fillWith,
  HOUR,
  MINUTE,
  seedAdmin,
  seedPlayers,
  TestClock,
  tournamentInput,
  type TournamentTestStack,
} from '../../fixtures/tournaments';

/**
 * Démarrage bloqué (D-056) : un échec transitoire est retenté, un échec répété est annulé
 * (SYSTEM_ERROR) après le délai de récupération avec libération des réservations ACTIVES,
 * jamais celle d'un paiement capturé ; la récupération reprend après un redémarrage.
 */
jest.setTimeout(60_000);

let database: TestDatabase;
let stack: TournamentTestStack;
let players: UserId[];
let logs: Record<string, unknown>[];

beforeAll(async () => {
  database = await createMigratedDatabase();
}, PGLITE_TIMEOUT_MS);
afterAll(() => database.close());
beforeEach(async () => {
  stack = createTournamentTestStack(database.sql, new TestClock());
  players = await seedPlayers(database.sql, ['ana', 'ben', 'cid'], 5000);
  logs = [];
});
afterEach(async () => {
  await stack.stop();
  await database.reset();
});

/**
 * « Instance » dont la capture échoue tant que `failing()` est vrai (base indisponible,
 * erreur inattendue) : tout le reste passe par le vrai dépôt PostgreSQL.
 */
function serviceWithFaultyCapture(failing: () => boolean, startRecoveryMs = 15 * MINUTE) {
  const real = stack.repository;
  const repository = new Proxy(real, {
    get(target, prop) {
      if (prop === 'transaction') {
        return (work: Parameters<TournamentRepository['transaction']>[0]) =>
          target.transaction((uow) =>
            work(
              new Proxy(uow, {
                get(u, p) {
                  if (p === 'capture' && failing()) {
                    return async () => {
                      throw new Error('panne simulée pendant la capture');
                    };
                  }
                  const value = (u as unknown as Record<PropertyKey, unknown>)[p];
                  return typeof value === 'function' ? value.bind(u) : value;
                },
              }),
            ),
          );
      }
      const value = (target as unknown as Record<PropertyKey, unknown>)[prop];
      return typeof value === 'function' ? value.bind(target) : value;
    },
  }) as TournamentRepository;
  return new TournamentService({
    tournaments: repository,
    sessions: stack.sessions,
    games: stack.games,
    logger: createLogger({}, (line) => logs.push(JSON.parse(line))),
    clock: stack.clock.now,
    startRecoveryMs,
  });
}

async function registeredTournament(): Promise<TournamentId> {
  const admin = await seedAdmin(database.sql);
  const t = await stack.tournaments.createAsAdmin(admin, tournamentInput(stack.clock, HOUR));
  for (const p of players) await stack.tournaments.register(t.id, p);
  await fillWith(stack, database.sql, t.id); // minimum de 20 participants (D-057)
  stack.clock.set(t.startsAt);
  return t.id;
}

const status = async (id: TournamentId) => (await stack.repository.findById(id))!;
const entryTransactions = async () =>
  Number(
    (
      await database.sql.query<{ n: number }>(
        `SELECT count(*)::int AS n FROM wallet_transactions WHERE kind = 'tournament_entry'`,
      )
    ).rows[0]!.n,
  );
const reservationStatuses = async (id: TournamentId) =>
  (
    await database.sql.query<{ status: string }>(
      'SELECT status FROM wallet_reservations WHERE tournament_id = $1 ORDER BY status',
      [id],
    )
  ).rows.map((r) => r.status);

it('échec transitoire : reste STARTING, puis démarre au tick suivant (capture une seule fois)', async () => {
  const id = await registeredTournament();
  let fail = true;
  const service = serviceWithFaultyCapture(() => fail);
  expect((await service.advance(id)).status).toBe('STARTING');
  expect(await entryTransactions()).toBe(0);
  expect(await reservationStatuses(id)).toEqual(Array(20).fill('ACTIVE'));
  expect(logs.filter((l) => l.message === 'TOURNAMENT_START_FAILED')).toHaveLength(1);

  fail = false;
  stack.clock.advance(MINUTE);
  expect((await service.advance(id)).status).toBe('IN_PROGRESS');
  expect(await entryTransactions()).toBe(20);
  expect(await balances(database.sql, players[0]!)).toEqual({
    balance: 4000,
    reserved: 0,
    available: 4000,
  });
});

it('échec répété : alerte à partir du 3e échec, puis SYSTEM_ERROR et réservations libérées après le délai', async () => {
  const id = await registeredTournament();
  const service = serviceWithFaultyCapture(() => true);
  for (let i = 0; i < 3; i += 1) {
    await service.advance(id);
    stack.clock.advance(MINUTE);
  }
  expect((await status(id)).status).toBe('STARTING');
  const failures = logs.filter((l) => l.message === 'TOURNAMENT_START_FAILED');
  expect(failures.map((l) => l.alert)).toEqual([undefined, undefined, true]);

  stack.clock.advance(15 * MINUTE);
  const cancelled = await service.advance(id);
  expect(cancelled).toMatchObject({ status: 'CANCELLED', cancellationReason: 'SYSTEM_ERROR' });
  expect(await reservationStatuses(id)).toEqual(Array(20).fill('RELEASED'));
  expect(await entryTransactions()).toBe(0);
  for (const p of players) {
    expect(await balances(database.sql, p)).toEqual({
      balance: 5000,
      reserved: 0,
      available: 5000,
    });
  }
  // Rejouer ne libère rien de plus et ne change pas l'état.
  await service.advance(id);
  expect((await status(id)).status).toBe('CANCELLED');
});

it('redémarrage après le délai : une nouvelle instance reprend la récupération', async () => {
  const id = await registeredTournament();
  await serviceWithFaultyCapture(() => true).advance(id); // instance 1 : échec puis arrêt
  stack.clock.advance(20 * MINUTE);
  const restarted = serviceWithFaultyCapture(() => true); // compteur en mémoire perdu
  expect((await restarted.advance(id)).status).toBe('CANCELLED');
  expect(await reservationStatuses(id)).toEqual(Array(20).fill('RELEASED'));
});

it('redémarrage avant le délai, base rétablie : le tournoi démarre normalement', async () => {
  const id = await registeredTournament();
  await serviceWithFaultyCapture(() => true).advance(id);
  stack.clock.advance(2 * MINUTE);
  expect((await stack.tournaments.advance(id)).status).toBe('IN_PROGRESS');
});

it('jamais de libération si une capture est déjà validée : alerte critique, rien ne change', async () => {
  const id = await registeredTournament();
  await serviceWithFaultyCapture(() => true).advance(id);
  // État incohérent forcé (ne peut pas arriver par le code : capture et IN_PROGRESS sont une
  // seule transaction) : une réservation capturée alors que le tournoi est encore STARTING.
  await database.sql.query(
    `UPDATE wallet_reservations SET status = 'CAPTURED', captured_at = now()
     WHERE id = (SELECT id FROM wallet_reservations WHERE tournament_id = $1 LIMIT 1)`,
    [id],
  );
  stack.clock.advance(20 * MINUTE);
  const service = serviceWithFaultyCapture(() => true);
  expect((await service.advance(id)).status).toBe('STARTING');
  expect(logs.some((l) => l.message === 'TOURNAMENT_START_INCONSISTENT' && l.alert)).toBe(true);
  expect(await reservationStatuses(id)).toEqual([...Array(19).fill('ACTIVE'), 'CAPTURED']);
});
