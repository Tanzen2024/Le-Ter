import type { UserId } from '../../../src/domain/users/user';
import type { AdminEvent } from '../../../src/websocket/admin-event-bus';
import {
  createMigratedDatabase,
  PGLITE_TIMEOUT_MS,
  type TestDatabase,
} from '../../fixtures/pglite';
import {
  createTournamentTestStack,
  HOUR,
  saveTournamentSettings,
  seedAdmin,
  seedPlayers,
  TestClock,
  tournamentInput,
  type TournamentTestStack,
} from '../../fixtures/tournaments';

/**
 * Temps réel de l'administration (D-116) : un signal TOURNAMENT_APPROVAL quand la file des
 * propositions à approuver change, APRÈS commit ; aucun signal quand rien ne change.
 */
jest.setTimeout(120_000);

let database: TestDatabase;
let stack: TournamentTestStack;
let admin: UserId;
let players: UserId[];
let events: AdminEvent[];

beforeAll(async () => {
  database = await createMigratedDatabase();
}, PGLITE_TIMEOUT_MS);
afterAll(() => database.close());
beforeEach(async () => {
  events = [];
  stack = createTournamentTestStack(database.sql, new TestClock(), {
    adminEvents: { publish: (e) => events.push(e) },
  });
  admin = await seedAdmin(database.sql);
  players = await seedPlayers(database.sql, ['player-0', 'player-1'], 5000);
  await saveTournamentSettings(database.sql);
});
afterEach(async () => {
  await stack.stop();
  await database.reset();
});

const SIGNAL: AdminEvent = { type: 'attention', source: 'TOURNAMENT_APPROVAL' };
const p = (i: number) => players[i]!;

async function proposal(player: number, slot: number) {
  const before = events.length;
  const draft = await stack.tournaments.createAsPlayer(
    p(player),
    tournamentInput(stack.clock, 2 * HOUR + slot * 3 * HOUR),
  );
  expect(events).toHaveLength(before); // un brouillon n'est pas à approuver
  return stack.tournaments.submit(draft.id, p(player));
}

it('soumission : un signal ; soumission répétée : aucun', async () => {
  const t = await proposal(0, 0);
  expect(events).toEqual([SIGNAL]);
  await stack.tournaments.submit(t.id, p(0));
  expect(events).toEqual([SIGNAL]);
});

it('approbation puis refus : un signal chacun ; refus répété : aucun', async () => {
  const a = await proposal(0, 0);
  const b = await proposal(1, 1);
  events.length = 0;
  await stack.tournaments.approve(a.id, admin);
  expect(events).toEqual([SIGNAL]);
  await stack.tournaments.reject(b.id, admin);
  expect(events).toEqual([SIGNAL, SIGNAL]);
  await stack.tournaments.reject(b.id, admin);
  expect(events).toHaveLength(2);
});

it('annulation d’une proposition : un signal ; d’un brouillon : aucun', async () => {
  const t = await proposal(0, 0);
  events.length = 0;
  await stack.tournaments.cancel(t.id, { userId: p(0), isAdmin: false });
  expect(events).toEqual([SIGNAL]);

  const draft = await stack.tournaments.createAsPlayer(
    p(1),
    tournamentInput(stack.clock, 2 * HOUR + 3 * HOUR),
  );
  await stack.tournaments.cancel(draft.id, { userId: p(1), isAdmin: false });
  expect(events).toEqual([SIGNAL]);
});

it('un signal en échec ne fait pas échouer la soumission', async () => {
  await stack.stop();
  stack = createTournamentTestStack(database.sql, new TestClock(), {
    adminEvents: {
      publish: () => {
        throw new Error('Redis indisponible');
      },
    },
  });
  const draft = await stack.tournaments.createAsPlayer(
    p(0),
    tournamentInput(stack.clock, 2 * HOUR),
  );
  await expect(stack.tournaments.submit(draft.id, p(0))).resolves.toMatchObject({
    status: 'PENDING_APPROVAL',
  });
});
