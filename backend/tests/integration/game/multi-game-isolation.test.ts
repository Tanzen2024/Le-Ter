import {
  GameAccessDeniedError,
  GameFinishedError,
  GameFullError,
  GameVersionConflictError,
} from '../../../src/domain/game/game-errors';
import {
  createGameServiceFixture,
  listen,
  noopCommand,
  player,
} from '../../fixtures/game-service.fixture';

const p1 = player('player-1');
const p2 = player('player-2');
const p3 = player('player-3');
const p4 = player('player-4');
const p5 = player('player-5');

describe('Isolation multi-parties', () => {
  it('TEST 1 — modifier la partie A ne change pas la partie B', async () => {
    const { service, repository } = createGameServiceFixture();
    const gameA = await service.createGame(p1, { maxPlayers: 4 });
    const gameB = await service.createGame(p4, { maxPlayers: 2 });
    const snapshotB = await repository.findById(gameB.id);

    await service.joinGame(gameA.id, p2);
    await service.joinGame(gameA.id, p3);
    await service.executePlayerCommand(gameA.id, p1, 'TEST', {}, noopCommand);

    expect(gameA.id).not.toBe(gameB.id);
    expect((await repository.findById(gameA.id))?.players).toHaveLength(3);
    expect(await repository.findById(gameB.id)).toEqual(snapshotB);
  });

  it("TEST 2 — un événement de A n'est reçu que par les joueurs de A", async () => {
    const { service } = createGameServiceFixture();
    const gameA = await service.createGame(p1, { maxPlayers: 4 });
    const gameB = await service.createGame(p4, { maxPlayers: 2 });
    await service.joinGame(gameB.id, p5);

    const inboxA1 = await listen(service, gameA.id, p1);
    const inboxB4 = await listen(service, gameB.id, p4);
    const inboxB5 = await listen(service, gameB.id, p5);

    await service.joinGame(gameA.id, p2);

    expect(inboxA1.map((e) => e.type)).toEqual(['game:player_joined']);
    expect(inboxA1.every((e) => e.gameId === gameA.id)).toBe(true);
    expect(inboxB4).toEqual([]);
    expect(inboxB5).toEqual([]);
  });

  describe('TEST 3 — timers indépendants', () => {
    beforeEach(() => jest.useFakeTimers());
    afterEach(() => jest.useRealTimers());

    it("l'expiration du timer de A ne touche pas B", async () => {
      const { service, timers } = createGameServiceFixture();
      const gameA = await service.createGame(p1, { maxPlayers: 2 });
      const gameB = await service.createGame(p4, { maxPlayers: 2 });
      const inboxA = await listen(service, gameA.id, p1);
      const inboxB = await listen(service, gameB.id, p4);

      await service.armTurnTimer(gameA.id, 1_000);
      await service.armTurnTimer(gameB.id, 5_000);
      expect(timers.size).toBe(2);

      await jest.advanceTimersByTimeAsync(1_000);

      expect(inboxA.map((e) => e.type)).toEqual(['game:turn_timeout']);
      expect(inboxB).toEqual([]);
      expect(timers.has(gameA.id)).toBe(false);
      expect(timers.has(gameB.id)).toBe(true);

      await jest.advanceTimersByTimeAsync(4_000);
      expect(inboxB.map((e) => e.type)).toEqual(['game:turn_timeout']);
    });

    it("un timer périmé (état changé depuis l'armement) est ignoré", async () => {
      const { service } = createGameServiceFixture();
      const game = await service.createGame(p1, { maxPlayers: 2 });
      const inbox = await listen(service, game.id, p1);

      await service.armTurnTimer(game.id, 1_000);
      await service.executePlayerCommand(game.id, p1, 'TEST', {}, noopCommand);
      await jest.advanceTimersByTimeAsync(1_000);

      expect(inbox.map((e) => e.type)).not.toContain('game:turn_timeout');
    });
  });

  it('TEST 4 — actions simultanées dans deux parties différentes', async () => {
    const { service } = createGameServiceFixture();
    const gameA = await service.createGame(p1, { maxPlayers: 2 });
    const gameB = await service.createGame(p3, { maxPlayers: 2 });

    const [afterA, afterB] = await Promise.all([
      service.joinGame(gameA.id, p2),
      service.joinGame(gameB.id, p4),
    ]);

    expect(afterA.players.map((p) => p.playerId)).toEqual([p1, p2]);
    expect(afterB.players.map((p) => p.playerId)).toEqual([p3, p4]);
    expect(afterA.version).toBe(2);
    expect(afterB.version).toBe(2);
  });

  it('TEST 5 — un joueur de A ne peut ni lire, ni écouter, ni agir sur B', async () => {
    const { service, repository } = createGameServiceFixture();
    await service.createGame(p1, { maxPlayers: 2 });
    const gameB = await service.createGame(p4, { maxPlayers: 2 });
    const before = await repository.findById(gameB.id);

    await expect(service.getGameForPlayer(gameB.id, p1)).rejects.toThrow(GameAccessDeniedError);
    await expect(service.subscribe(gameB.id, p1, () => undefined)).rejects.toThrow(
      GameAccessDeniedError,
    );
    await expect(
      service.executePlayerCommand(gameB.id, p1, 'TEST', {}, noopCommand),
    ).rejects.toThrow(GameAccessDeniedError);

    expect(await repository.findById(gameB.id)).toEqual(before);
  });

  it("TEST 6 — à la reconnexion, le joueur ne récupère que l'état de sa partie", async () => {
    const { service } = createGameServiceFixture();
    const gameA = await service.createGame(p1, { maxPlayers: 2 });
    await service.joinGame(gameA.id, p2);
    await service.createGame(p4, { maxPlayers: 2 });

    const active = await service.findActiveGamesForPlayer(p2);
    expect(active.map((g) => g.gameId)).toEqual([gameA.id]);

    const view = await service.getGameForPlayer(gameA.id, p2);
    expect(view.gameId).toBe(gameA.id);
    expect(view.viewerId).toBe(p2);
    expect(view).not.toHaveProperty('recentCommandIds');
  });

  describe('TEST 7 — terminer A ne perturbe pas B', () => {
    beforeEach(() => jest.useFakeTimers());
    afterEach(() => jest.useRealTimers());

    it('B continue normalement et seul le timer de A est détruit', async () => {
      const { service, timers } = createGameServiceFixture();
      const gameA = await service.createGame(p1, { maxPlayers: 2 });
      const gameB = await service.createGame(p3, { maxPlayers: 2 });
      await service.armTurnTimer(gameA.id, 1_000);
      await service.armTurnTimer(gameB.id, 1_000);

      const finished = await service.finishGame(gameA.id);

      expect(finished.status).toBe('finished');
      expect(timers.has(gameA.id)).toBe(false);
      expect(timers.has(gameB.id)).toBe(true);
      await expect(service.joinGame(gameA.id, p2)).rejects.toThrow(GameFinishedError);

      const afterB = await service.joinGame(gameB.id, p4);
      expect(afterB.status).toBe('waiting');
      expect(afterB.players).toHaveLength(2);
      expect(await service.findActiveGamesForPlayer(p1)).toEqual([]);
    });
  });
});

describe('Concurrence au sein d’une même partie', () => {
  it('des arrivées simultanées ne dépassent jamais la capacité', async () => {
    const { service, repository } = createGameServiceFixture();
    const game = await service.createGame(p1, { maxPlayers: 2 });

    const results = await Promise.allSettled([
      service.joinGame(game.id, p2),
      service.joinGame(game.id, p3),
      service.joinGame(game.id, p4),
    ]);

    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const rejected = results.filter((r) => r.status === 'rejected');
    expect(rejected).toHaveLength(2);
    for (const r of rejected) {
      expect((r as PromiseRejectedResult).reason).toBeInstanceOf(GameFullError);
    }
    expect((await repository.findById(game.id))?.players).toHaveLength(2);
  });

  it('une double soumission (même commandId) est appliquée une seule fois', async () => {
    const { service } = createGameServiceFixture();
    const game = await service.createGame(p1, { maxPlayers: 2 });
    const handler = jest.fn(noopCommand);

    const [first, second] = await Promise.all([
      service.executePlayerCommand(game.id, p1, 'TEST', { commandId: 'cmd-1' }, handler),
      service.executePlayerCommand(game.id, p1, 'TEST', { commandId: 'cmd-1' }, handler),
    ]);

    expect(handler).toHaveBeenCalledTimes(1);
    expect(first.version).toBe(2);
    expect(second.version).toBe(2);
  });

  it('une commande basée sur une version périmée est refusée', async () => {
    const { service } = createGameServiceFixture();
    const game = await service.createGame(p1, { maxPlayers: 2 });
    await service.joinGame(game.id, p2);

    await expect(
      service.executePlayerCommand(game.id, p1, 'TEST', { expectedVersion: 1 }, noopCommand),
    ).rejects.toThrow(GameVersionConflictError);
  });

  it("un non-membre reste refusé même en rejouant le commandId d'un membre", async () => {
    const { service } = createGameServiceFixture();
    const game = await service.createGame(p1, { maxPlayers: 2 });
    await service.executePlayerCommand(game.id, p1, 'TEST', { commandId: 'cmd-1' }, noopCommand);

    await expect(
      service.executePlayerCommand(game.id, p5, 'TEST', { commandId: 'cmd-1' }, noopCommand),
    ).rejects.toThrow(GameAccessDeniedError);
  });
});

describe('Observabilité', () => {
  it('chaque commande est journalisée avec gameId, playerId et action', async () => {
    const { service, logLines } = createGameServiceFixture();
    const game = await service.createGame(p1, { maxPlayers: 2 });
    await service.joinGame(game.id, p2);

    expect(logLines).toContainEqual(
      expect.objectContaining({ gameId: game.id, playerId: p2, action: 'JOIN_GAME', version: 2 }),
    );
  });
});
