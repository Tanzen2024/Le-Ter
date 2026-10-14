import type { CardId } from '../../../src/domain/cards/card';
import { DealInProgressError } from '../../../src/domain/game/game-errors';
import type { GameId, PlayerId } from '../../../src/domain/game/game-id';
import { TURN_DURATION_MS, dealPhaseDurationMs } from '../../../src/domain/rules/rule-set';
import { GameService } from '../../../src/services/game/game.service';
import { GameTimerRegistry } from '../../../src/services/game/game-timer-registry';
import type { SessionService } from '../../../src/services/sessions/session.service';
import { DeadlineSupervisor } from '../../../src/services/timers/deadline-supervisor';
import { silentLogger } from '../../../src/utils/logger';
import { InMemoryGameEventHub } from '../../../src/websocket/in-memory-game-event-hub';
import {
  allowAllParticipation,
  createGameServiceFixture,
  listen,
  player,
} from '../../fixtures/game-service.fixture';
import { deckForHands, decksRandom } from '../../fixtures/random';
import { testRules } from '../../fixtures/rules';

/**
 * Phase de distribution (D-102) : AUCUN temps de décision ne court avant que le serveur ait
 * confirmé la distribution (COMPLETE_DEAL). Le premier timer de tour n'est créé qu'à cette
 * transition ; J1 dispose alors de toute la durée du tour.
 *
 * Mains (vraie distribution 3 + 2, aucune main gagnante instantanée) :
 *   p1 (J1) : 5♠ 10♣ 8♥ 9⭐ 10♥ — p2 : 7♠ 9♠ 4♥ 6♣ 8♠
 */
const [p1, p2, p3] = [player('player-1'), player('player-2'), player('player-3')];
const T0 = new Date('2026-10-14T10:00:00.000Z');
const TURN = TURN_DURATION_MS;
const H1: CardId[] = ['PIQUE-5', 'TREFLE-10', 'COEUR-8', 'ETOILE-9', 'COEUR-10'];
const H2: CardId[] = ['PIQUE-7', 'PIQUE-9', 'COEUR-4', 'TREFLE-6', 'PIQUE-8'];
/** 2 joueurs = 4 lots (3 + 2 par joueur). */
const DEAL = dealPhaseDurationMs(4);
const at = (ms: number) => new Date(T0.getTime() + ms);

/** Partie à 2 démarrée avec la VRAIE phase de distribution (comme en production). */
async function dealingGame() {
  const fixture = createGameServiceFixture({
    rules: testRules,
    random: decksRandom(deckForHands([H1, H2])),
    dealDurationMs: dealPhaseDurationMs,
  });
  const created = await fixture.service.createGame(p1, { maxPlayers: 2 });
  await fixture.service.joinGame(created.id, p2);
  const events = await listen(fixture.service, created.id, p1);
  const game = await fixture.service.startGame(created.id, p1);
  return { ...fixture, game, events };
}

const ofType = <E extends { type: string }>(events: E[], type: string) =>
  events.filter((e) => e.type === type);

/** Superviseur réduit aux parties (aucune ronde de session dans ces scénarios). */
function supervisorFor(games: GameService) {
  const sessions = {
    recoverDecisionTimers: async () => ({ scheduled: 0, processed: 0 }),
  } as unknown as SessionService;
  return new DeadlineSupervisor({ games, sessions, logger: silentLogger });
}

beforeEach(() => {
  jest.useFakeTimers();
  jest.setSystemTime(T0);
});
afterEach(() => jest.useRealTimers());

describe('Durée de la phase de distribution (D-102)', () => {
  it('suit le calendrier des lots du téléphone, sans temps de décision', () => {
    expect(dealPhaseDurationMs(0)).toBe(0);
    expect(dealPhaseDurationMs(4)).toBe(2_520); // 2 joueurs
    expect(dealPhaseDurationMs(8)).toBe(4_200); // 4 joueurs
  });
});

describe('Démarrage : distribution AVANT tout timer de décision (D-102)', () => {
  it('au début de la distribution : mains complètes, aucune échéance de tour, phase persistée', async () => {
    const { game, repository, events } = await dealingGame();
    const stored = (await repository.findById(game.id))!;
    expect(stored.status).toBe('in_progress');
    expect(stored.dealEndsAt).toEqual(at(DEAL));
    expect(stored.turnStartedAt).toBeUndefined();
    expect(stored.turnDeadlineAt).toBeUndefined();
    expect(stored.play?.hands[p1]).toHaveLength(5);
    expect(stored.play?.hands[p2]).toHaveLength(5);
    const started = ofType(events, 'game:started')[0];
    expect(started?.payload).toMatchObject({ dealEndsAt: at(DEAL).toISOString() });
    expect(started?.payload).not.toHaveProperty('turnDeadlineAt');
    expect(ofType(events, 'game:deal_completed')).toHaveLength(0);
    expect(await repository.findTurnDeadlines()).toEqual([]);
    expect(await repository.findDealDeadlines()).toEqual([
      { gameId: game.id, deadlineAt: at(DEAL) },
    ]);
  });

  it('vue joueur pendant la distribution : aucune échéance, aucune action (roulette et barres inactives)', async () => {
    const { service, game } = await dealingGame();
    for (const viewer of [p1, p2]) {
      const view = await service.getGameForPlayer(game.id, viewer);
      expect(view.dealEndsAt).toEqual(at(DEAL));
      expect(view.turnDeadlineAt).toBeUndefined();
      expect(view.turnStartedAt).toBeUndefined();
      expect(view.myActions).toEqual({
        canPlayCard: false,
        playableCardIds: [],
        canFlee: false,
        canDeclareInstantWin: false,
      });
    }
  });

  it('aucune décision acceptée pendant la distribution (carte, fuite) : état inchangé', async () => {
    const { service, game, repository } = await dealingGame();
    await expect(service.playCard(game.id, p1, 'PIQUE-5')).rejects.toThrow(DealInProgressError);
    await expect(service.flee(game.id, p2)).rejects.toThrow(DealInProgressError);
    const stored = (await repository.findById(game.id))!;
    expect(stored.version).toBe(game.version);
    expect(stored.play?.currentTrick).toEqual([]);
  });

  it('aucun callback d’expiration ni confirmation avant la fin de la distribution', async () => {
    const { service, game, events } = await dealingGame();
    // Déclenchement anticipé (timer en avance, balayage) : sans effet.
    const early = await service.handleDealDeadline(game.id);
    expect(early.version).toBe(game.version);
    expect((await service.handleTurnTimeout(game.id)).version).toBe(game.version);
    await jest.advanceTimersByTimeAsync(DEAL - 1);
    expect(ofType(events, 'game:deal_completed')).toHaveLength(0);
    expect(ofType(events, 'game:turn_timeout')).toHaveLength(0);
  });

  it('confirmation serveur à la fin : premier timer créé à cet instant, durée COMPLÈTE pour J1', async () => {
    const { game, repository, events, timers } = await dealingGame();
    await jest.advanceTimersByTimeAsync(DEAL);
    const completed = ofType(events, 'game:deal_completed');
    expect(completed).toHaveLength(1);
    expect(completed[0]?.payload).toMatchObject({
      nextPlayerId: p1,
      trickNumber: 1,
      turnStartedAt: at(DEAL).toISOString(),
      turnDeadlineAt: at(DEAL + TURN).toISOString(),
    });
    const stored = (await repository.findById(game.id))!;
    expect(stored.dealEndsAt).toBeUndefined();
    expect(stored.turnStartedAt).toEqual(at(DEAL));
    expect(stored.turnDeadlineAt).toEqual(at(DEAL + TURN));
    expect(stored.version).toBe(game.version + 1);
    expect(timers.has(game.id)).toBe(true);

    // Le temps de distribution n'est pas décompté : l'échéance tombe TURN après la confirmation.
    await jest.advanceTimersByTimeAsync(TURN - 1);
    expect(ofType(events, 'game:turn_timeout')).toHaveLength(0);
    await jest.advanceTimersByTimeAsync(1);
    expect(ofType(events, 'game:turn_timeout')).toEqual([
      expect.objectContaining({ payload: expect.objectContaining({ playerId: p1 }) }),
    ]);
  });

  it('déclenchements dupliqués (timer, balayage, deux instances) : une seule confirmation, un seul timer', async () => {
    const { service, game, repository, events } = await dealingGame();
    const hub = new InMemoryGameEventHub();
    const timersTwo = new GameTimerRegistry();
    const two = new GameService({
      repository,
      publisher: hub,
      subscriber: hub,
      timers: timersTwo,
      participationPolicy: allowAllParticipation,
      logger: silentLogger,
      rules: testRules,
    });
    jest.setSystemTime(at(DEAL));
    await Promise.all([
      service.handleDealDeadline(game.id),
      two.handleDealDeadline(game.id),
      service.handleDealDeadline(game.id),
      supervisorFor(two).sweep(),
    ]);
    const stored = (await repository.findById(game.id))!;
    expect(stored.version).toBe(game.version + 1);
    expect(stored.turnDeadlineAt).toEqual(at(DEAL + TURN));
    expect(ofType(events, 'game:deal_completed')).toHaveLength(1);
    timersTwo.cancelAll();
  });

  it('reconnexion pendant puis après la distribution : état réel, échéance restaurée', async () => {
    const { service, game } = await dealingGame();
    await jest.advanceTimersByTimeAsync(1_000);
    const during = await service.getGameForPlayer(game.id, p2);
    expect(during.turnDeadlineAt).toBeUndefined();
    expect(during.dealEndsAt).toEqual(at(DEAL));

    await jest.advanceTimersByTimeAsync(DEAL - 1_000 + 4_000); // 4 s après la confirmation
    const after = await service.getGameForPlayer(game.id, p1);
    expect(after.dealEndsAt).toBeUndefined();
    expect(after.turnStartedAt).toEqual(at(DEAL));
    expect(after.turnDeadlineAt).toEqual(at(DEAL + TURN));
    expect(after.myActions.canPlayCard).toBe(true);
  });

  it('carte acceptée : le timer du tour s’arrête, le tour suivant a sa propre échéance', async () => {
    const { service, game, events } = await dealingGame();
    await jest.advanceTimersByTimeAsync(DEAL + 2_000);
    const after = await service.playCard(game.id, p1, 'PIQUE-5');
    expect(after.play?.nextPlayerId).toBe(p2);
    expect(after.turnDeadlineAt).toEqual(at(DEAL + 2_000 + TURN));
    // L'ancienne échéance de J1 passe sans effet.
    await jest.advanceTimersByTimeAsync(TURN - 1);
    expect(ofType(events, 'game:turn_timeout')).toHaveLength(0);
    await jest.advanceTimersByTimeAsync(1);
    expect(ofType(events, 'game:turn_timeout')).toEqual([
      expect.objectContaining({ payload: expect.objectContaining({ playerId: p2 }) }),
    ]);
  });

  it('partie complète après la distribution : tours suivants, 5e tour automatique, fin sans échéance', async () => {
    const { service, game, repository, events } = await dealingGame();
    await jest.advanceTimersByTimeAsync(DEAL);
    for (let guard = 0; guard < 20; guard += 1) {
      const stored = (await repository.findById(game.id))!;
      if (stored.status !== 'in_progress') break;
      const next = stored.play!.nextPlayerId as PlayerId;
      const view = await service.getGameForPlayer(game.id, next);
      await service.playCard(game.id, next, view.myActions.playableCardIds[0]);
    }
    const finished = (await repository.findById(game.id))!;
    expect(finished.status).toBe('finished');
    expect(finished.play?.completedTricks).toHaveLength(5);
    expect(finished.turnDeadlineAt).toBeUndefined();
    expect(finished.dealEndsAt).toBeUndefined();
    expect(ofType(events, 'game:last_trick_automatic')).toHaveLength(1);
    expect(ofType(events, 'game:deal_completed')).toHaveLength(1);
    expect(ofType(events, 'game:turn_timeout')).toHaveLength(0);
  });

  it('arrêt administratif pendant la distribution : phase close, aucune confirmation ensuite', async () => {
    const { service, game, events, timers } = await dealingGame();
    const stopped = await service.finishGame(game.id);
    expect(stopped.dealEndsAt).toBeUndefined();
    expect(timers.has(game.id)).toBe(false);
    jest.setSystemTime(at(DEAL));
    await service.handleDealDeadline(game.id);
    expect(ofType(events, 'game:deal_completed')).toHaveLength(0);
  });
});

describe('Isolation et reprise (D-011, D-102)', () => {
  it('deux parties ne partagent aucun timer : chacune confirme SA distribution', async () => {
    const fixture = createGameServiceFixture({
      rules: testRules,
      random: decksRandom(deckForHands([H1, H2]), deckForHands([H1, H2])),
      dealDurationMs: dealPhaseDurationMs,
    });
    const start = async (a: PlayerId, b: PlayerId): Promise<GameId> => {
      const g = await fixture.service.createGame(a, { maxPlayers: 2 });
      await fixture.service.joinGame(g.id, b);
      await fixture.service.startGame(g.id, a);
      return g.id;
    };
    const gameA = await start(p1, p2);
    await jest.advanceTimersByTimeAsync(1_000);
    const gameB = await start(p3, player('player-4'));

    await jest.advanceTimersByTimeAsync(DEAL - 1_000);
    const a = (await fixture.repository.findById(gameA))!;
    const b = (await fixture.repository.findById(gameB))!;
    expect(a.dealEndsAt).toBeUndefined();
    expect(a.turnDeadlineAt).toEqual(at(DEAL + TURN));
    expect(b.dealEndsAt).toEqual(at(1_000 + DEAL));
    expect(b.turnDeadlineAt).toBeUndefined();

    await jest.advanceTimersByTimeAsync(1_000);
    expect((await fixture.repository.findById(gameB))?.turnDeadlineAt).toEqual(
      at(1_000 + DEAL + TURN),
    );
  });

  it('redémarrage pendant la distribution : timer de distribution reconstruit, puis premier tour complet', async () => {
    const fixture = await dealingGame();
    fixture.timers.cancelAll(); // le processus s'arrête
    jest.setSystemTime(at(1_000));
    const hub = new InMemoryGameEventHub();
    const timers = new GameTimerRegistry();
    const service = new GameService({
      repository: fixture.repository,
      publisher: hub,
      subscriber: hub,
      timers,
      participationPolicy: allowAllParticipation,
      logger: silentLogger,
      rules: testRules,
    });
    const report = await supervisorFor(service).recover();
    expect(report).toMatchObject({ dealTimersScheduled: 1, dealDeadlinesProcessed: 0 });
    expect(timers.has(fixture.game.id)).toBe(true);
    await jest.advanceTimersByTimeAsync(DEAL - 1_000);
    expect((await fixture.repository.findById(fixture.game.id))?.turnDeadlineAt).toEqual(
      at(DEAL + TURN),
    );
    timers.cancelAll();
  });

  it('distribution échue pendant l’arrêt : confirmée au redémarrage, J1 garde toute sa durée', async () => {
    const fixture = await dealingGame();
    fixture.timers.cancelAll();
    jest.setSystemTime(at(DEAL + 30_000));
    const hub = new InMemoryGameEventHub();
    const service = new GameService({
      repository: fixture.repository,
      publisher: hub,
      subscriber: hub,
      timers: new GameTimerRegistry(),
      participationPolicy: allowAllParticipation,
      logger: silentLogger,
      rules: testRules,
    });
    const report = await supervisorFor(service).recover();
    expect(report).toMatchObject({ dealDeadlinesProcessed: 1, turnTimeoutsProcessed: 0 });
    const stored = (await fixture.repository.findById(fixture.game.id))!;
    expect(stored.turnStartedAt).toEqual(at(DEAL + 30_000));
    expect(stored.turnDeadlineAt).toEqual(at(DEAL + 30_000 + TURN));
    expect(stored.turnTimedOutAt).toBeUndefined();
  });
});
