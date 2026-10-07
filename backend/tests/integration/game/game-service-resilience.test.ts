import { GameFullError, NotYourTurnError } from '../../../src/domain/game/game-errors';
import type { GameEvent } from '../../../src/domain/game/game-events';
import { createGameServiceFixture, listen, player } from '../../fixtures/game-service.fixture';
import { identityRandom } from '../../fixtures/random';
import { testRules } from '../../fixtures/rules';

const p1 = player('player-1');
const p2 = player('player-2');
const p3 = player('player-3');

describe('GameService — robustesse', () => {
  it('une diffusion en échec ne fait pas échouer une commande déjà enregistrée (D-024)', async () => {
    const { service, repository, logLines } = createGameServiceFixture();
    const game = await service.createGame(p1, { maxPlayers: 3 });
    await service.subscribe(game.id, p1, () => {
      throw new Error('connexion fermée');
    });

    const joined = await service.joinGame(game.id, p2);

    expect(joined.version).toBe(2);
    expect((await repository.findById(game.id))?.players).toHaveLength(2);
    expect(logLines).toContainEqual(
      expect.objectContaining({
        level: 'error',
        message: 'game event publish failed',
        gameId: game.id,
        type: 'game:player_joined',
      }),
    );
  });

  it('une commande refusée est journalisée avec gameId, playerId, action et cause', async () => {
    const { service, logLines } = createGameServiceFixture();
    const game = await service.createGame(p1, { maxPlayers: 2 });
    await service.joinGame(game.id, p2);

    await expect(service.joinGame(game.id, p3, { commandId: 'cmd-1' })).rejects.toThrow(
      GameFullError,
    );

    expect(logLines).toContainEqual(
      expect.objectContaining({
        level: 'warn',
        message: 'game command rejected',
        gameId: game.id,
        playerId: p3,
        action: 'JOIN_GAME',
        commandId: 'cmd-1',
        errorName: 'GameFullError',
      }),
    );
  });

  it('une violation de règle est journalisée sans révéler la main du joueur', async () => {
    const { service, logLines } = createGameServiceFixture({
      rules: testRules,
      random: identityRandom,
    });
    const game = await service.createGame(p1, { maxPlayers: 2 });
    await service.joinGame(game.id, p2);
    await service.startGame(game.id, p1);

    await expect(service.playCard(game.id, p2, 'COEUR-4')).rejects.toThrow(NotYourTurnError);

    const rejected = logLines.find((l) => l.message === 'game command rejected');
    expect(rejected).toMatchObject({ action: 'PLAY_CARD', errorName: 'NotYourTurnError' });
    // Les mains (COEUR-3… pour p1) ne doivent jamais apparaître dans les logs.
    expect(JSON.stringify(logLines)).not.toMatch(/COEUR-3|COEUR-5|PIQUE-3/);
  });

  it("les événements d'une même commande partagent la version et sont ordonnés par sequence", async () => {
    const { service } = createGameServiceFixture({ rules: testRules, random: identityRandom });
    const game = await service.createGame(p1, { maxPlayers: 2 });
    await service.joinGame(game.id, p2);
    const received: GameEvent[] = await listen(service, game.id, p1);
    await service.startGame(game.id, p1);
    await service.playCard(game.id, p1, 'COEUR-3');

    const played = received.filter((e) => e.version === 4);
    expect(played.map((e) => [e.type, e.sequence])).toEqual([
      ['game:card_played', 0],
      ['game:turn_changed', 1],
    ]);
    // Événements privés : p1 ne reçoit que sa main, la séquence garde sa place globale.
    const started = received.filter((e) => e.version === 3);
    expect(started.map((e) => e.type)).toEqual(['game:started', 'game:hand_dealt']);
    expect(started[0]?.sequence).toBe(0);
    expect(started[1]?.sequence).toBeGreaterThan(0);
  });
});
