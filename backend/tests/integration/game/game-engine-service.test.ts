import { GameAccessDeniedError, NotYourTurnError } from '../../../src/domain/game/game-errors';
import type { GameEvent } from '../../../src/domain/game/game-events';
import { UnresolvedRuleError } from '../../../src/domain/rules/unresolved-rule';
import { createGameServiceFixture, player } from '../../fixtures/game-service.fixture';
import { identityRandom, seededRandom } from '../../fixtures/random';
import { testRules } from '../../fixtures/rules';

const [p1, p2, p3, p4] = ['player-1', 'player-2', 'player-3', 'player-4'].map(player) as [
  ReturnType<typeof player>,
  ReturnType<typeof player>,
  ReturnType<typeof player>,
  ReturnType<typeof player>,
];

/** Deux parties complètes à 2 joueurs, démarrées avec la distribution « identité ». */
async function twoStartedGames() {
  const fixture = createGameServiceFixture({ rules: testRules, random: identityRandom });
  const { service } = fixture;
  const gameA = await service.createGame(p1, { maxPlayers: 2, stakeAmount: 100 });
  await service.joinGame(gameA.id, p2);
  const gameB = await service.createGame(p3, { maxPlayers: 2, stakeAmount: 500 });
  await service.joinGame(gameB.id, p4);
  await service.startGame(gameA.id);
  await service.startGame(gameB.id);
  return { ...fixture, gameA, gameB };
}

describe('Moteur via GameService', () => {
  it('refuse toute commande de jeu tant que les règles ne sont pas configurées', async () => {
    const { service } = createGameServiceFixture();
    const game = await service.createGame(p1, { maxPlayers: 2 });
    await service.joinGame(game.id, p2);
    await expect(service.startGame(game.id)).rejects.toThrow(UnresolvedRuleError);
  });

  it('joue une partie et incrémente la version à chaque commande validée', async () => {
    const { service, gameA } = await twoStartedGames();
    const before = await service.getGameForPlayer(gameA.id, p1);
    const after = await service.playCard(gameA.id, p1, 'COEUR-3', { commandId: 'c1' });

    expect(after.version).toBe(before.version + 1);
    expect(after.play?.currentTrick).toEqual([{ playerId: p1, cardId: 'COEUR-3' }]);
    expect(after.play?.nextPlayerId).toBe(p2);
  });

  it('la vue joueur ne contient que la main du joueur qui regarde', async () => {
    const { service, gameA } = await twoStartedGames();
    const view = await service.getGameForPlayer(gameA.id, p1);

    expect(view.play?.myHand).toEqual(['COEUR-3', 'COEUR-5', 'COEUR-7', 'COEUR-9', 'PIQUE-3']);
    expect(view.play?.handCounts).toEqual({ [p1]: 5, [p2]: 5 });
    expect(JSON.stringify(view)).not.toContain('COEUR-4'); // carte de p2
    expect(view.play).not.toHaveProperty('hands');
    expect(view.play).not.toHaveProperty('stock');
  });

  it('chaque main est envoyée à son seul destinataire, dans sa seule partie', async () => {
    const fixture = createGameServiceFixture({ rules: testRules, random: seededRandom(1) });
    const { service } = fixture;
    const gameA = await service.createGame(p1, { maxPlayers: 2 });
    await service.joinGame(gameA.id, p2);
    const gameB = await service.createGame(p3, { maxPlayers: 2 });
    await service.joinGame(gameB.id, p4);
    const inbox = new Map<string, GameEvent[]>();
    for (const [gameId, id] of [
      [gameA.id, p1],
      [gameA.id, p2],
      [gameB.id, p3],
      [gameB.id, p4],
    ] as const) {
      const events: GameEvent[] = [];
      inbox.set(id, events);
      await service.subscribe(gameId, id, (e) => events.push(e));
    }

    await service.startGame(gameA.id);

    const handsOf = (id: string) => inbox.get(id)!.filter((e) => e.type === 'game:hand_dealt');
    expect(handsOf(p1)).toHaveLength(1);
    expect(handsOf(p2)).toHaveLength(1);
    expect(handsOf(p1)[0]?.payload).not.toEqual(handsOf(p2)[0]?.payload);
    expect(inbox.get(p3)).toEqual([]);
    expect(inbox.get(p4)).toEqual([]);
  });
});

describe('Moteur — isolation multi-parties', () => {
  it('jouer dans A ne modifie pas B', async () => {
    const { service, repository, gameA, gameB } = await twoStartedGames();
    const snapshotB = await repository.findById(gameB.id);

    await service.playCard(gameA.id, p1, 'COEUR-3');
    await service.playCard(gameA.id, p2, 'COEUR-4');

    expect(await repository.findById(gameB.id)).toEqual(snapshotB);
    expect((await repository.findById(gameA.id))?.play?.trickNumber).toBe(2);
  });

  it('deux parties ont des états différents et des mises distinctes', async () => {
    const { repository, gameA, gameB } = await twoStartedGames();
    const a = await repository.findById(gameA.id);
    const b = await repository.findById(gameB.id);

    expect(a?.stakeAmount).toBe(100);
    expect(b?.stakeAmount).toBe(500);
    expect(Object.keys(a!.play!.hands)).toEqual([p1, p2]);
    expect(Object.keys(b!.play!.hands)).toEqual([p3, p4]);
  });

  it('des commandes simultanées dans A et B sont toutes appliquées, sans interférence', async () => {
    const { service, gameA, gameB } = await twoStartedGames();

    const [afterA, afterB] = await Promise.all([
      service.playCard(gameA.id, p1, 'COEUR-3'),
      service.playCard(gameB.id, p3, 'COEUR-3'),
    ]);

    expect(afterA.play?.currentTrick).toEqual([{ playerId: p1, cardId: 'COEUR-3' }]);
    expect(afterB.play?.currentTrick).toEqual([{ playerId: p3, cardId: 'COEUR-3' }]);
  });

  it('un joueur de A ne peut ni jouer dans B ni y déclarer une victoire', async () => {
    const { service, repository, gameB } = await twoStartedGames();
    const before = await repository.findById(gameB.id);

    await expect(service.playCard(gameB.id, p1, 'COEUR-3')).rejects.toThrow(GameAccessDeniedError);
    await expect(service.declareWin(gameB.id, p1)).rejects.toThrow(GameAccessDeniedError);
    await expect(service.flee(gameB.id, p1)).rejects.toThrow(GameAccessDeniedError);
    expect(await repository.findById(gameB.id)).toEqual(before);
  });

  it('finir A par le jeu annule son timer ; celui de B continue', async () => {
    jest.useFakeTimers();
    try {
      const { service, timers, gameA, gameB } = await twoStartedGames();
      await service.armTurnTimer(gameA.id, 60_000);
      await service.armTurnTimer(gameB.id, 60_000);

      const moves = [
        [p1, 'COEUR-3'],
        [p2, 'COEUR-4'],
        [p2, 'PIQUE-4'],
        [p1, 'PIQUE-3'],
        [p2, 'COEUR-6'],
        [p1, 'COEUR-7'],
        [p1, 'COEUR-5'],
        [p2, 'COEUR-8'],
        [p2, 'COEUR-10'],
        [p1, 'COEUR-9'],
      ] as const;
      for (const [id, card] of moves) {
        await service.playCard(gameA.id, id, card);
      }

      const finishedA = await service.getGameForPlayer(gameA.id, p1);
      expect(finishedA.status).toBe('finished');
      expect(finishedA.result?.winnerId).toBe(p2);
      expect(timers.has(gameA.id)).toBe(false);
      expect(timers.has(gameB.id)).toBe(true);
      expect((await service.getGameForPlayer(gameB.id, p3)).status).toBe('in_progress');
    } finally {
      jest.useRealTimers();
    }
  });
});

describe('Moteur — concurrence dans une partie', () => {
  it('deux cartes envoyées en même temps par le même joueur : une seule est acceptée', async () => {
    const { service, gameA } = await twoStartedGames();

    const results = await Promise.allSettled([
      service.playCard(gameA.id, p1, 'COEUR-3'),
      service.playCard(gameA.id, p1, 'COEUR-5'),
    ]);

    expect(results[0]?.status).toBe('fulfilled');
    expect(results[1]?.status).toBe('rejected');
    expect((results[1] as PromiseRejectedResult).reason).toBeInstanceOf(NotYourTurnError);
  });

  it("deux joueurs jouent en même temps : l'ordre de la file décide, l'état reste valide", async () => {
    const { service, gameA } = await twoStartedGames();

    const [first, second] = await Promise.allSettled([
      service.playCard(gameA.id, p2, 'COEUR-4'), // arrive en premier, mais ce n'est pas son tour
      service.playCard(gameA.id, p1, 'COEUR-3'),
    ]);

    expect(first.status).toBe('rejected');
    expect(second.status).toBe('fulfilled');
  });

  it('une double soumission (même commandId) ne joue la carte qu’une fois', async () => {
    const { service, gameA } = await twoStartedGames();

    const [r1, r2] = await Promise.all([
      service.playCard(gameA.id, p1, 'COEUR-3', { commandId: 'same' }),
      service.playCard(gameA.id, p1, 'COEUR-3', { commandId: 'same' }),
    ]);

    expect(r1.version).toBe(r2.version);
    expect(r2.play?.currentTrick).toHaveLength(1);
  });
});

describe('Moteur — copies profondes', () => {
  it("modifier un état renvoyé ne modifie ni l'état stocké ni l'autre partie", async () => {
    const { service, repository, gameA, gameB } = await twoStartedGames();
    const returned = await service.playCard(gameA.id, p1, 'COEUR-3');

    returned.play!.hands[p2]!.length = 0;
    returned.play!.stock.push('COEUR-3');
    returned.play!.currentTrick.length = 0;
    returned.players.push({ playerId: p3, seat: 9, joinedAt: new Date() });

    const stored = await repository.findById(gameA.id);
    expect(stored?.play?.hands[p2]).toHaveLength(5);
    expect(stored?.play?.stock).toHaveLength(21);
    expect(stored?.play?.currentTrick).toHaveLength(1);
    expect(stored?.players).toHaveLength(2);
    expect((await repository.findById(gameB.id))?.play?.hands[p3]).toHaveLength(5);
  });

  it("modifier la charge utile d'un événement ne modifie pas l'état de la partie", async () => {
    const { service, repository, gameA } = await twoStartedGames();
    await service.subscribe(gameA.id, p1, (event) => {
      const plays = (event.payload as { plays?: unknown[] }).plays;
      plays?.splice(0);
    });

    await service.playCard(gameA.id, p1, 'COEUR-3');
    // Émet game:trick_completed, dont la charge utile contient `plays`.
    const returned = await service.playCard(gameA.id, p2, 'COEUR-4');

    expect(returned.play?.completedTricks[0]?.plays).toHaveLength(2);
    expect((await repository.findById(gameA.id))?.play?.completedTricks[0]?.plays).toHaveLength(2);
  });

  it('les mains de deux parties ne partagent aucune référence', async () => {
    const { repository, gameA, gameB } = await twoStartedGames();
    const a = await repository.findById(gameA.id);
    const b = await repository.findById(gameB.id);
    a!.play!.hands[p1]!.push('ETOILE-10');
    expect(b!.play!.hands[p3]).toHaveLength(5);
  });
});
