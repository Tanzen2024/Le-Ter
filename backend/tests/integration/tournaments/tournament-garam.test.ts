import type { GameId, PlayerId } from '../../../src/domain/game/game-id';
import type { GaramCardId } from '../../../src/domain/garam/garam-cards';
import type { SessionId } from '../../../src/domain/sessions/session';
import type { Tournament } from '../../../src/domain/tournaments/tournament';
import type { UserId } from '../../../src/domain/users/user';
import { registerAndLogin } from '../../fixtures/auth';
import {
  createMigratedDatabase,
  PGLITE_TIMEOUT_MS,
  type TestDatabase,
} from '../../fixtures/pglite';
import { garamDecksRandom } from '../../fixtures/random';
import {
  createTournamentTestStack,
  fillWith,
  fund,
  HOUR,
  saveTournamentSettings,
  seedAdmin,
  TestClock,
  tournamentInput,
  type TournamentTestStack,
} from '../../fixtures/tournaments';

/**
 * Tournoi de GARAM TIA (D-127) : jeu et variante choisis à la création, tables du tournoi
 * jouées par le moteur GARAM avec la variante du tournoi, règlement en jetons du tournoi
 * (sans commission), pénalité « moins de X » comprise. Mécanismes de tournoi inchangés.
 */
jest.setTimeout(120_000);

interface Player {
  id: UserId;
  pid: PlayerId;
}

let database: TestDatabase;
let stack: TournamentTestStack;
let admin: UserId;
let ana: Player;
let ben: Player;

/** ana dégage ♥9 et garde 20 ; ben joue ♥3 et garde ♣9 + ♠6 = 15 ; terre d'As : aucun tirage. */
const ANA_20_BEN_15: GaramCardId[] = [
  'COEUR-9', 'TREFLE-10', 'CARREAU-10',
  'COEUR-3', 'TREFLE-9', 'PIQUE-6',
  'CARREAU-11', 'TREFLE-11', 'COEUR-11',
];

beforeAll(async () => {
  database = await createMigratedDatabase();
}, PGLITE_TIMEOUT_MS);
afterAll(() => database.close());

async function player(): Promise<Player> {
  const session = await registerAndLogin(stack.app);
  const id = session.userId as UserId;
  await fund(database.sql, id, 5000);
  return { id, pid: id as string as PlayerId };
}

beforeEach(async () => {
  stack = createTournamentTestStack(database.sql, new TestClock(), {
    random: garamDecksRandom(ANA_20_BEN_15),
    gameClock: true,
  });
  await saveTournamentSettings(database.sql);
  admin = await seedAdmin(database.sql);
  ana = await player();
  ben = await player();
});
afterEach(async () => {
  await stack.stop();
  await database.reset();
});

async function startedGaramTournament(garamVariant: 15 | 16 | 17 | 18): Promise<Tournament> {
  const t = await stack.tournaments.createAsAdmin(
    admin,
    tournamentInput(stack.clock, HOUR, { gameType: 'GARAM', garamVariant }),
  );
  await stack.tournaments.register(t.id, ana.id);
  await stack.tournaments.register(t.id, ben.id);
  await fillWith(stack, database.sql, t.id);
  stack.clock.set(t.startsAt);
  return stack.tournaments.advance(t.id);
}

describe('tournoi GARAM TIA (D-127)', () => {
  it('création : le jeu et la variante sont enregistrés ; sans variante, refusé', async () => {
    const t = await stack.tournaments.createAsAdmin(
      admin,
      tournamentInput(stack.clock, HOUR, { gameType: 'GARAM', garamVariant: 16 }),
    );
    expect(t).toMatchObject({ gameType: 'GARAM', garamVariant: 16 });
    const { rows } = await database.sql.query<{ game_type: string; garam_variant: number }>(
      'SELECT game_type, garam_variant FROM tournaments WHERE id = $1',
      [t.id],
    );
    expect(rows[0]).toEqual({ game_type: 'GARAM', garam_variant: 16 });
    await expect(
      stack.tournaments.createAsAdmin(
        admin,
        tournamentInput(stack.clock, 3 * HOUR, { gameType: 'GARAM' }),
      ),
    ).rejects.toMatchObject({ fields: { garamVariant: expect.any(String) } });
  });

  it('table du tournoi : manche GARAM avec la variante du tournoi, règlement en jetons', async () => {
    const t = await startedGaramTournament(17);
    const seat = await stack.tournaments.join(t.id, ana.id);
    await stack.tournaments.join(t.id, ben.id);
    const gameId = seat.gameId as GameId;

    const waiting = await stack.games.findGame(gameId);
    expect(waiting).toMatchObject({ gameType: 'GARAM', garamVariant: 17, tournamentId: t.id });
    const session = await stack.sessions.getSession(seat.sessionId as SessionId, ana.pid);
    expect(session.session).toMatchObject({ gameType: 'GARAM', garamVariant: 17 });

    await stack.games.startGame(gameId, ana.pid);
    await stack.games.playCard(gameId, ana.pid, 'COEUR-9');
    await stack.games.playCard(gameId, ben.pid, 'COEUR-3');
    await stack.tournaments.idle();

    const done = await stack.games.findGame(gameId);
    expect(done?.result).toMatchObject({
      winnerId: ana.pid,
      method: 'GARAM_BEST_SCORE',
      scores: { [ana.pid]: 20, [ben.pid]: 15 },
      belowThresholdIds: [ben.pid],
      penaltyThreshold: 17,
    });
    // Jetons du tournoi : ben paie sa mise + la pénalité « moins de 17 » (= une mise), versées
    // à ana sans commission ; aucune écriture dans la caisse de la plateforme.
    const anaAccount = await stack.repository.findAccount(t.id, ana.id);
    const benAccount = await stack.repository.findAccount(t.id, ben.id);
    expect(anaAccount?.currentTokens).toBe(t.initialTournamentTokens + 2 * t.stakePerGame);
    expect(benAccount?.currentTokens).toBe(t.initialTournamentTokens - 2 * t.stakePerGame);
    const ledger = await database.sql.query('SELECT 1 FROM platform_ledger WHERE game_id = $1', [
      gameId,
    ]);
    expect(ledger.rows).toHaveLength(0);
  });
});
