import { InMemoryGameRepository } from '../../../src/repositories/in-memory-game.repository';
import { PostgresGameRepository } from '../../../src/repositories/postgres-game.repository';
import { NOW, waitingGame } from '../../fixtures/game-builders';
import {
  CONTRACT_PLAYER_NAMES,
  describeGameRepositoryContract,
  withoutUsernames,
} from '../../fixtures/game-repository.contract';
import {
  createMigratedDatabase,
  PGLITE_TIMEOUT_MS,
  type TestDatabase,
} from '../../fixtures/pglite';
import { withSeededSessions } from '../../fixtures/sessions';
import { seedUsers, testPlayerId } from '../../fixtures/users';

const alice = testPlayerId('alice');
const bob = testPlayerId('bob');
const extra = ['a', 'b', 'c', 'd', 'e'].map(testPlayerId);

let database: TestDatabase;

beforeAll(async () => {
  database = await createMigratedDatabase();
}, PGLITE_TIMEOUT_MS);
afterAll(async () => {
  await database.close();
});

describeGameRepositoryContract('mémoire', async () => ({
  repository: new InMemoryGameRepository(),
}));

describeGameRepositoryContract('PostgreSQL', async () => {
  await seedUsers(database.sql, CONTRACT_PLAYER_NAMES);
  return {
    // D-033 : chaque partie écrite appartient à une session existante (créée par la fixture).
    repository: withSeededSessions(new PostgresGameRepository(database.sql), database.sql),
    teardown: () => database.reset(),
  };
});

describe('PostgresGameRepository — stockage', () => {
  beforeEach(() => seedUsers(database.sql, ['alice', 'bob', 'a', 'b', 'c', 'd', 'e']));
  afterEach(() => database.reset());

  it('stocke les joueurs dans game_players et l’état de jeu dans games.state', async () => {
    const repository = withSeededSessions(new PostgresGameRepository(database.sql), database.sql);
    const game = { ...waitingGame([alice, bob], 4), recentCommandIds: ['cmd-1'] };
    await repository.insert(game);

    const { rows: players } = await database.sql.query(
      'SELECT player_id, seat FROM game_players WHERE game_id = $1 ORDER BY seat',
      [game.id],
    );
    expect(players).toEqual([
      { player_id: alice, seat: 0 },
      { player_id: bob, seat: 1 },
    ]);

    const { rows } = await database.sql.query<{ state: unknown }>(
      'SELECT state FROM games WHERE id = $1',
      [game.id],
    );
    expect(rows[0]?.state).toEqual({ recentCommandIds: ['cmd-1'] });
  });

  it('relit le pseudo de chaque joueur dans users (affichage, D-064), sans le persister', async () => {
    const repository = withSeededSessions(new PostgresGameRepository(database.sql), database.sql);
    const game = waitingGame([alice, bob], 4);
    await repository.insert(game);

    const loaded = await repository.findById(game.id);
    expect(loaded?.players.map((p) => [p.playerId, p.username])).toEqual([
      [alice, `u_${alice.slice(0, 8)}`],
      [bob, `u_${bob.slice(0, 8)}`],
    ]);
    // Le pseudo suit le compte (renommage) : il n'est jamais copié dans game_players.
    await database.sql.query('UPDATE users SET username = $1 WHERE id = $2', ['Roly_237', alice]);
    expect((await repository.findById(game.id))?.players[0]?.username).toBe('Roly_237');
  });

  it('une écriture refusée ne laisse aucune trace partielle (transaction)', async () => {
    const repository = withSeededSessions(new PostgresGameRepository(database.sql), database.sql);
    const game = waitingGame([alice], 4);
    await repository.insert(game);

    // Siège en double : la contrainte d'unicité échoue au COMMIT, après l'UPDATE de `games`.
    const invalid = {
      ...game,
      version: 2,
      players: [...game.players, { playerId: bob, seat: 0, joinedAt: NOW }],
    };
    await expect(repository.save(invalid, 1)).rejects.toThrow();

    expect(withoutUsernames(await repository.findById(game.id))).toEqual(game);
  });

  it('les contraintes du schéma refusent un état incohérent', async () => {
    const repository = withSeededSessions(new PostgresGameRepository(database.sql), database.sql);
    await expect(repository.insert(waitingGame(extra, 5))).rejects.toThrow();
    expect(await database.sql.query('SELECT 1 FROM games')).toMatchObject({ rows: [] });
  });
});
