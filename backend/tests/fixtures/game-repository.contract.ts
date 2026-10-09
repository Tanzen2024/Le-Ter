import type { Game } from '../../src/domain/game/game';
import { GameNotFoundError, GameVersionConflictError } from '../../src/domain/game/game-errors';
import { isGameId, type PlayerId } from '../../src/domain/game/game-id';
import type { GameRepository } from '../../src/repositories/game.repository';
import { NOW, startedGame, waitingGame } from './game-builders';
import { testPlayerId } from './users';

/**
 * Joueurs du contrat : de vrais identifiants de compte (UUID), car PostgreSQL exige
 * qu'un joueur existe dans `users` (migration 0003). L'implémentation PostgreSQL
 * doit créer ces comptes (CONTRACT_PLAYER_NAMES) avant chaque test.
 */
export const CONTRACT_PLAYER_NAMES = ['alice', 'bob', 'carol', 'dave', 'erin'] as const;
const [alice, bob, carol, dave, erin] = CONTRACT_PLAYER_NAMES.map(testPlayerId) as [
  PlayerId,
  PlayerId,
  PlayerId,
  PlayerId,
  PlayerId,
];
const mallory = testPlayerId('mallory');

/**
 * Partie telle qu'elle est PERSISTÉE : sans le pseudo des joueurs, donnée d'affichage que
 * PostgreSQL relit dans `users` (D-064) et que la mémoire ne connaît pas.
 */
export function withoutUsernames(game: Game | null): Game | null {
  return game && { ...game, players: game.players.map(({ username: _username, ...p }) => p) };
}
const nobody = testPlayerId('nobody');

/**
 * Contrat commun à toutes les implémentations de GameRepository : la mémoire
 * et PostgreSQL doivent se comporter exactement de la même façon pour GameService.
 */
export function describeGameRepositoryContract(
  name: string,
  setup: () => Promise<{ repository: GameRepository; teardown?: () => Promise<void> }>,
): void {
  describe(`GameRepository (contrat) — ${name}`, () => {
    let repository: GameRepository;
    let teardown: (() => Promise<void>) | undefined;

    beforeEach(async () => {
      ({ repository, teardown } = await setup());
    });
    afterEach(async () => {
      await teardown?.();
    });

    it('génère des gameId valides et uniques', () => {
      const ids = Array.from({ length: 100 }, () => repository.nextId());
      expect(ids.every(isGameId)).toBe(true);
      expect(new Set(ids).size).toBe(100);
    });

    it('relit une partie en attente à l’identique', async () => {
      const game = { ...waitingGame([alice, bob], 4), stakeAmount: 100 };
      await repository.insert(game);

      expect(withoutUsernames(await repository.findById(game.id))).toEqual(game);
    });

    it('relit une partie démarrée (mains, tours, contrôle) à l’identique', async () => {
      const { game } = startedGame({
        [alice]: ['PIQUE-7', 'COEUR-3', 'TREFLE-4', 'ETOILE-5', 'COEUR-6'],
        [bob]: ['PIQUE-3', 'COEUR-7', 'TREFLE-5', 'ETOILE-6', 'COEUR-4'],
      });
      game.turnStartedAt = NOW;
      game.turnDeadlineAt = new Date(NOW.getTime() + 30_000);
      game.recentCommandIds = ['cmd-1'];
      await repository.insert(game);

      expect(withoutUsernames(await repository.findById(game.id))).toEqual(game);
    });

    it('renvoie null pour une partie inconnue', async () => {
      expect(await repository.findById(repository.nextId())).toBeNull();
    });

    it('refuse d’insérer deux fois la même partie', async () => {
      const game = waitingGame([alice, bob]);
      await repository.insert(game);
      await expect(repository.insert(game)).rejects.toThrow('Partie déjà existante');
    });

    it("ne partage jamais de référence avec l'appelant", async () => {
      const game = waitingGame([alice], 2);
      await repository.insert(game);

      game.players.push({ playerId: mallory, seat: 1, tablePosition: 1, joinedAt: NOW });
      const loaded = await repository.findById(game.id);
      loaded!.players.push({ playerId: mallory, seat: 1, tablePosition: 1, joinedAt: NOW });

      expect((await repository.findById(game.id))?.players).toHaveLength(1);
    });

    it('enregistre une nouvelle version, joueurs et champs effacés compris', async () => {
      const game = waitingGame([alice], 3);
      game.turnStartedAt = NOW;
      game.turnDeadlineAt = new Date(NOW.getTime() + 1000);
      await repository.insert(game);

      const next: Game = structuredClone(game);
      next.version = 2;
      next.players.push({ playerId: bob, seat: 1, tablePosition: 1, joinedAt: NOW });
      next.players[0]!.fledAt = NOW;
      delete next.turnDeadlineAt;
      await repository.save(next, 1);

      expect(withoutUsernames(await repository.findById(game.id))).toEqual(next);
    });

    it('refuse une écriture basée sur une version périmée, sans rien modifier', async () => {
      const game = waitingGame([alice, bob]);
      await repository.insert(game);
      await repository.save({ ...game, version: 2 }, 1);

      const stale = { ...game, version: 2, status: 'finished' as const };
      await expect(repository.save(stale, 1)).rejects.toThrow(GameVersionConflictError);
      expect(await repository.findById(game.id)).toMatchObject({ version: 2, status: 'waiting' });
    });

    it("signale une partie inexistante à l'écriture", async () => {
      await expect(repository.save(waitingGame([alice]), 1)).rejects.toThrow(GameNotFoundError);
    });

    it('deux écritures concurrentes de la même version : une seule réussit', async () => {
      const game = waitingGame([alice], 4);
      await repository.insert(game);

      const withPlayer = (id: PlayerId): Game => ({
        ...structuredClone(game),
        version: 2,
        players: [...game.players, { playerId: id, seat: 1, tablePosition: 1, joinedAt: NOW }],
      });
      const results = await Promise.allSettled([
        repository.save(withPlayer(bob), 1),
        repository.save(withPlayer(carol), 1),
      ]);

      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
      const rejected = results.filter((r) => r.status === 'rejected');
      expect(rejected).toHaveLength(1);
      expect((rejected[0] as PromiseRejectedResult).reason).toBeInstanceOf(
        GameVersionConflictError,
      );
      expect((await repository.findById(game.id))?.players).toHaveLength(2);
    });

    it('écrire la partie A ne modifie pas la partie B', async () => {
      const a = waitingGame([alice, bob], 4);
      const b = waitingGame([carol, dave], 4);
      await repository.insert(a);
      await repository.insert(b);

      await repository.save(
        {
          ...a,
          version: 2,
          players: [...a.players, { playerId: erin, seat: 2, tablePosition: 2, joinedAt: NOW }],
        },
        1,
      );

      expect(withoutUsernames(await repository.findById(b.id))).toEqual(b);
    });

    it('ne renvoie que les parties actives du joueur', async () => {
      const active = waitingGame([alice, bob]);
      const finished = {
        ...waitingGame([alice, carol]),
        status: 'finished' as const,
        endReason: 'ADMIN_STOP' as const,
      };
      const other = waitingGame([carol, dave]);
      for (const g of [active, finished, other]) {
        await repository.insert(g);
      }

      const games = await repository.findActiveByPlayer(alice);
      expect(games.map((g) => g.id)).toEqual([active.id]);
      expect(await repository.findActiveByPlayer(nobody)).toEqual([]);
    });
  });
}
