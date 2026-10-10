import {
  LowestCardAutomaticSelectionStrategy,
  type AutomaticCardSelectionContext,
  type AutomaticCardSelectionStrategy,
} from '../../../src/domain/game/automatic-card-selection';
import { SUITS, cardFromId, type CardId } from '../../../src/domain/cards/card';
import type { Game } from '../../../src/domain/game/game';
import { TurnExpiredError } from '../../../src/domain/game/game-errors';
import type { PlayerId } from '../../../src/domain/game/game-id';
import { TURN_DURATION_MS } from '../../../src/domain/rules/rule-set';

import { rotateFrom } from '../../../src/domain/sessions/table-order';
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

/** Durée de production d'un tour (D-034, 15 s depuis D-068) : les scénarios en dépendent. */
const TURN = TURN_DURATION_MS;

/**
 * Timer de tour (D-034) et coup automatique (D-036) : 15 s par tour, SERVER-AUTHORITATIVE,
 * échéance persistée ; à l'échéance, TURN_TIMEOUT puis le serveur joue la plus petite
 * carte de la famille du contrôle si le joueur en possède, sinon la plus petite de sa main,
 * par le MÊME chemin qu'un coup manuel.
 *
 * Mains distribuées par la vraie distribution (3 + 2), sans main gagnante instantanée :
 *   p1 (J1, meneur) : 5♠ 10♣ 8♥ 9⭐ 10♥
 *   p2              : 7♠ 9♠ 4♥ 6♣ 8♠   (aucune ⭐)
 *   p3 (à 3)        : 3♣ 4⭐ 6♥ 6♠ 10⭐
 */
const [p1, p2, p3] = [player('player-1'), player('player-2'), player('player-3')];
const T0 = new Date('2026-10-07T10:00:00.000Z');

const H1: CardId[] = ['PIQUE-5', 'TREFLE-10', 'COEUR-8', 'ETOILE-9', 'COEUR-10'];
const H2: CardId[] = ['PIQUE-7', 'PIQUE-9', 'COEUR-4', 'TREFLE-6', 'PIQUE-8'];
const H3: CardId[] = ['TREFLE-3', 'ETOILE-4', 'COEUR-6', 'PIQUE-6', 'ETOILE-10'];

const AUTO_PLAY_EVENTS = [
  'game:turn_timeout',
  'game:auto_card_played',
  'game:card_played',
  'game:turn_changed',
];

/** Stratégie de TEST qui renvoie une carte imposée, pour vérifier le contrat du port. */
class ScriptedSelection implements AutomaticCardSelectionStrategy {
  readonly calls: AutomaticCardSelectionContext[] = [];
  constructor(private readonly card: CardId) {}
  selectCard(context: AutomaticCardSelectionContext): CardId {
    this.calls.push(structuredClone(context));
    return this.card;
  }
}

/** Espion : délègue à la stratégie officielle et enregistre chaque appel. */
class SpySelection implements AutomaticCardSelectionStrategy {
  readonly calls: AutomaticCardSelectionContext[] = [];
  private readonly official = new LowestCardAutomaticSelectionStrategy();
  selectCard(context: AutomaticCardSelectionContext): CardId {
    this.calls.push(structuredClone(context));
    return this.official.selectCard(context);
  }
}

/** Stratégie qui tombe en panne : simule un processus arrêté avant le coup automatique. */
const crashingSelection: AutomaticCardSelectionStrategy = {
  selectCard: () => {
    throw new Error('processus arrêté');
  },
};

type FixtureOptions = Parameters<typeof createGameServiceFixture>[0];

async function startedGame(options: FixtureOptions & { threePlayers?: boolean } = {}) {
  const { threePlayers, ...fixtureOptions } = options;
  const hands = threePlayers ? [H1, H2, H3] : [H1, H2];
  const fixture = createGameServiceFixture({
    rules: testRules,
    random: decksRandom(deckForHands(hands)),
    ...fixtureOptions,
  });
  const game = await fixture.service.createGame(p1, { maxPlayers: threePlayers ? 3 : 2 });
  await fixture.service.joinGame(game.id, p2);
  if (threePlayers) {
    await fixture.service.joinGame(game.id, p3);
  }
  const started = await fixture.service.startGame(game.id, p1);
  const events = await listen(fixture.service, game.id, p1);
  const eventsP2 = await listen(fixture.service, game.id, p2);
  return { ...fixture, game: started, events, eventsP2 };
}

/** Oracle indépendant de D-036 : la carte que le serveur DOIT jouer. */
function expectedAutoCard(hand: readonly CardId[], leadCardId?: CardId): CardId {
  const cards = hand.map(cardFromId);
  const lead = leadCardId && cardFromId(leadCardId);
  const family = lead ? cards.filter((c) => c.suit === lead.suit) : [];
  const pool = family.length > 0 ? family : cards;
  const min = Math.min(...pool.map((c) => c.value));
  // Égalité de valeur entre familles : départage technique PROVISOIRE (ordre de SUITS),
  // non validé par le métier (R-06) — l'oracle reproduit le comportement actuel.
  const tied = pool.filter((c) => c.value === min);
  return tied.sort((a, b) => SUITS.indexOf(a.suit) - SUITS.indexOf(b.suit))[0]!.id;
}

const playCommands = (logLines: Record<string, unknown>[]) =>
  logLines.filter((l) => l.action === 'PLAY_CARD');

beforeEach(() => {
  jest.useFakeTimers();
  jest.setSystemTime(T0);
});
afterEach(() => jest.useRealTimers());

describe('Timer de tour — 15 secondes, autorité du serveur (D-034)', () => {
  it('le démarrage arme le timer de J1 ; début, échéance et joueur attendu sont persistés', async () => {
    const { game, repository, timers } = await startedGame();
    expect(TURN_DURATION_MS).toBe(15_000);
    const stored = await repository.findById(game.id);
    expect(stored).toMatchObject({
      turnStartedAt: T0,
      turnDeadlineAt: new Date(T0.getTime() + TURN),
    });
    expect(stored?.play?.nextPlayerId).toBe(p1);
    expect(stored?.turnTimedOutAt).toBeUndefined();
    expect(timers.has(game.id)).toBe(true);
  });

  it('jouer AVANT l’échéance : accepté, le tour suivant reçoit sa propre échéance de 15 s', async () => {
    const { service, game, events } = await startedGame();
    jest.setSystemTime(new Date(T0.getTime() + TURN - 1));
    const after = await service.playCard(game.id, p1, 'PIQUE-5');
    expect(after.play?.nextPlayerId).toBe(p2);
    expect(after.turnDeadlineAt).toEqual(new Date(T0.getTime() + 2 * TURN - 1));
    expect(events.find((e) => e.type === 'game:turn_changed')?.payload).toMatchObject({
      nextPlayerId: p2,
      turnDeadlineAt: new Date(T0.getTime() + 2 * TURN - 1).toISOString(),
    });
    // L'ancienne échéance (T0 + 15 s) passe sans effet : seule la nouvelle compte.
    await jest.advanceTimersByTimeAsync(TURN - 1);
    expect(events.filter((e) => e.type === 'game:turn_timeout')).toHaveLength(0);
    await jest.advanceTimersByTimeAsync(1);
    expect(events.filter((e) => e.type === 'game:turn_timeout')).toEqual([
      expect.objectContaining({ payload: expect.objectContaining({ playerId: p2 }) }),
    ]);
  });

  it('jouer APRÈS l’échéance (avant même que le timer ne se déclenche) : refusé, TURN_EXPIRED', async () => {
    const { service, game, repository } = await startedGame();
    jest.setSystemTime(new Date(T0.getTime() + TURN)); // échéance atteinte, timer non exécuté
    await expect(service.playCard(game.id, p1, 'PIQUE-5')).rejects.toThrow(TurnExpiredError);
    expect((await repository.findById(game.id))?.play?.hands[p1]).toHaveLength(5);
  });

  it('le timeout ne fait ni quitter, ni fuir, ni finir la partie', async () => {
    const { game, repository } = await startedGame();
    await jest.advanceTimersByTimeAsync(TURN);
    const stored = await repository.findById(game.id);
    expect(stored?.status).toBe('in_progress');
    expect(stored?.players.map((p) => [p.playerId, p.fledAt])).toEqual([
      [p1, undefined],
      [p2, undefined],
    ]);
  });

  it('un déclenchement anticipé est sans effet', async () => {
    const { service, game, events } = await startedGame();
    const early = await service.handleTurnTimeout(game.id);
    expect(early.version).toBe(game.version);
    expect(events).toEqual([]);
  });
});

describe('Coup automatique après TURN_TIMEOUT — règle D-036 (stratégie par défaut)', () => {
  it('à l’échéance : TURN_TIMEOUT puis PLAY_CARD automatique ; persistance, version, événements', async () => {
    const { service, game, events, eventsP2, repository, logLines } = await startedGame();
    await jest.advanceTimersByTimeAsync(TURN);

    // p1 ouvre le tour : aucune famille imposée → plus petite carte de la main : 5♠.
    const stored = (await repository.findById(game.id))!;
    expect(stored.play?.currentTrick).toEqual([{ playerId: p1, cardId: 'PIQUE-5' }]);
    expect(stored.play?.hands[p1]).toEqual(H1.filter((c) => c !== 'PIQUE-5'));
    expect(stored.play?.nextPlayerId).toBe(p2);
    expect(stored.turnTimedOutAt).toBeUndefined();
    expect(stored.turnDeadlineAt).toEqual(new Date(T0.getTime() + 2 * TURN));
    // Deux commandes enregistrées : l'expiration (v+1), puis le coup automatique (v+2).
    expect(stored.version).toBe(game.version + 2);
    expect(stored.recentCommandIds).toContain(`auto-play:${game.id}:1:0`);

    expect(events.map((e) => e.type)).toEqual(AUTO_PLAY_EVENTS);
    expect(events.map((e) => e.version)).toEqual([
      game.version + 1,
      game.version + 2,
      game.version + 2,
      game.version + 2,
    ]);
    expect(events.every((e) => e.actorId === undefined)).toBe(true);
    expect(events[2]!.payload).toMatchObject({ playerId: p1, cardId: 'PIQUE-5' });

    // L'adversaire reçoit l'événement PUBLIC de la carte jouée, jamais la main de p1.
    expect(eventsP2.map((e) => e.type)).toEqual(AUTO_PLAY_EVENTS);
    const otherCards = H1.filter((c) => c !== 'PIQUE-5');
    expect(JSON.stringify(eventsP2)).not.toMatch(new RegExp(otherCards.join('|')));
    // Main privée à jour dans la vue de p1 ; la vue de p2 ne contient pas la main de p1.
    const viewP1 = await service.getGameForPlayer(game.id, p1);
    expect(viewP1.play?.myHand).toEqual(otherCards);
    const viewP2 = await service.getGameForPlayer(game.id, p2);
    expect(JSON.stringify(viewP2)).not.toMatch(new RegExp(otherCards.join('|')));

    // Le joueur n'a envoyé aucune commande PLAY_CARD ; il ne peut plus jouer ce tour.
    expect(playCommands(logLines)).toEqual([]);
    expect(logLines.filter((l) => l.message === 'AUTO_CARD_PLAY')).toHaveLength(1);
    await expect(service.playCard(game.id, p1, 'TREFLE-10')).rejects.toThrow();
  });

  it('CAS A : famille du contrôle 5♠ → la plus petite ♠ (7♠), pas le 4♥ plus petit', async () => {
    const { service, game, repository } = await startedGame();
    await service.playCard(game.id, p1, 'PIQUE-5');
    await jest.advanceTimersByTimeAsync(TURN);
    const stored = (await repository.findById(game.id))!;
    // Tour 1 terminé : 5♠ puis 7♠ (automatique).
    expect(stored.play?.completedTricks[0]?.plays).toEqual([
      { playerId: p1, cardId: 'PIQUE-5' },
      { playerId: p2, cardId: 'PIQUE-7' },
    ]);
    expect(stored.play?.hands[p2]).toEqual(['PIQUE-9', 'COEUR-4', 'TREFLE-6', 'PIQUE-8']);
  });

  it('CAS B : aucune carte de la famille du contrôle (9⭐) → plus petite carte de la main (4♥)', async () => {
    const { service, game, repository } = await startedGame();
    await service.playCard(game.id, p1, 'ETOILE-9');
    await jest.advanceTimersByTimeAsync(TURN);
    const stored = (await repository.findById(game.id))!;
    expect(stored.play?.completedTricks[0]?.plays).toEqual([
      { playerId: p1, cardId: 'ETOILE-9' },
      { playerId: p2, cardId: 'COEUR-4' },
    ]);
  });

  it('déterministe : le même état initial donne toujours la même carte', async () => {
    const played: CardId[] = [];
    for (let i = 0; i < 5; i++) {
      const { service, game, repository } = await startedGame();
      await service.playCard(game.id, p1, 'COEUR-8');
      await jest.advanceTimersByTimeAsync(TURN);
      played.push((await repository.findById(game.id))!.play!.completedTricks[0]!.plays[1]!.cardId);
      jest.setSystemTime(T0);
    }
    expect(new Set(played)).toEqual(new Set(['COEUR-4']));
  });

  it('partie terminée avant l’échéance : aucune carte automatique', async () => {
    const { service, game, events, repository } = await startedGame();
    await service.finishGame(game.id);
    await jest.advanceTimersByTimeAsync(2 * TURN);
    jest.setSystemTime(new Date(T0.getTime() + 3 * TURN));
    await service.handleTurnTimeout(game.id);
    await service.retryAutomaticPlay(game.id);
    const stored = (await repository.findById(game.id))!;
    expect(stored.play?.hands[p1]).toHaveLength(5);
    expect(stored.play?.currentTrick).toEqual([]);
    expect(events.map((e) => e.type)).toEqual(['game:finished']);
  });

  it('tour déjà joué avant l’exécution du timeout : l’ancien TURN_TIMEOUT est ignoré', async () => {
    const { service, game, events, repository } = await startedGame();
    jest.setSystemTime(new Date(T0.getTime() + TURN - 1_000));
    await service.playCard(game.id, p1, 'PIQUE-5');
    const before = (await repository.findById(game.id))!;
    // Le TURN_TIMEOUT du tour de p1 (échéance T0 + 15 s) arrive en retard.
    jest.setSystemTime(new Date(T0.getTime() + TURN));
    const after = await service.handleTurnTimeout(game.id);
    expect(after.version).toBe(before.version);
    expect(after.play?.nextPlayerId).toBe(p2);
    expect(after.play?.hands[p2]).toHaveLength(5);
    expect(events.filter((e) => e.type === 'game:turn_timeout')).toHaveLength(0);
  });

  it('même TURN_TIMEOUT reçu deux fois (et reprise) : une seule carte jouée', async () => {
    const { service, game, events, repository } = await startedGame();
    jest.setSystemTime(new Date(T0.getTime() + TURN));
    await Promise.all([
      service.handleTurnTimeout(game.id),
      service.handleTurnTimeout(game.id),
      service.retryAutomaticPlay(game.id),
    ]);
    await service.handleTurnTimeout(game.id);
    await service.retryAutomaticPlay(game.id);
    const stored = (await repository.findById(game.id))!;
    expect(stored.play?.currentTrick).toEqual([{ playerId: p1, cardId: 'PIQUE-5' }]);
    expect(stored.play?.hands[p1]).toHaveLength(4);
    expect(stored.version).toBe(game.version + 2);
    expect(events.filter((e) => e.type === 'game:turn_timeout')).toHaveLength(1);
    expect(events.filter((e) => e.type === 'game:auto_card_played')).toHaveLength(1);
  });

  it('deux instances backend sur le même dépôt : un seul PLAY_CARD automatique', async () => {
    const one = await startedGame();
    const hub = new InMemoryGameEventHub();
    const two = new GameService({
      repository: one.repository,
      publisher: hub,
      subscriber: hub,
      timers: new GameTimerRegistry(),
      participationPolicy: allowAllParticipation,
      logger: silentLogger,
      rules: testRules,
    });
    const eventsTwo = await listen(two, one.game.id, p1);
    jest.setSystemTime(new Date(T0.getTime() + TURN));
    await Promise.all([
      one.service.handleTurnTimeout(one.game.id),
      two.handleTurnTimeout(one.game.id),
      one.service.handleTurnTimeout(one.game.id),
      two.handleTurnTimeout(one.game.id),
    ]);
    await Promise.all([one.service.idle(), two.idle()]);
    const stored = (await one.repository.findById(one.game.id))!;
    expect(stored.play?.currentTrick).toEqual([{ playerId: p1, cardId: 'PIQUE-5' }]);
    expect(stored.version).toBe(one.game.version + 2);
    const all = [...one.events, ...eventsTwo];
    expect(all.filter((e) => e.type === 'game:turn_timeout')).toHaveLength(1);
    expect(all.filter((e) => e.type === 'game:auto_card_played')).toHaveLength(1);
  });

  it('joueur ayant fui : jamais attendu, aucune carte automatique pour lui', async () => {
    const { service, game, repository, events } = await startedGame({ threePlayers: true });
    await service.flee(game.id, p2);
    await jest.advanceTimersByTimeAsync(TURN); // p1 expire
    await jest.advanceTimersByTimeAsync(TURN); // p3 expire (p2 ignoré)
    const stored = (await repository.findById(game.id))!;
    expect(stored.play?.completedTricks[0]?.plays.map((p) => p.playerId)).toEqual([p1, p3]);
    expect(stored.play?.hands[p2]).toHaveLength(5);
    const autoFor = events
      .filter((e) => e.type === 'game:auto_card_played')
      .map((e) => e.payload.playerId);
    expect(autoFor).toEqual([p1, p3]);
  });
});

describe('D-036 — jeu manuel vs jeu automatique (le système ne choisit qu’après timeout)', () => {
  it('TEST 1 — l’ouvreur du TOUR 2 expire : plus petite carte de sa main ; puis le suivant expire : famille d’ouverture', async () => {
    const spy = new SpySelection();
    const { service, game, repository, events } = await startedGame({ autoCardSelection: spy });
    // Tour 1 joué à la main : p2 prend le contrôle avec 9♠ et ouvre le tour 2.
    await service.playCard(game.id, p1, 'PIQUE-5');
    await service.playCard(game.id, p2, 'PIQUE-9');
    expect((await repository.findById(game.id))!.play?.nextPlayerId).toBe(p2);

    // p2 ouvre le tour 2 et ne joue pas : main 7♠ 4♥ 6♣ 8♠ → 4♥.
    await jest.advanceTimersByTimeAsync(TURN);
    expect(spy.calls).toHaveLength(1);
    expect(spy.calls[0]).toMatchObject({ playerId: p2, trickNumber: 2, currentTrick: [] });
    expect(spy.calls[0]!.leadCardId).toBeUndefined();
    let stored = (await repository.findById(game.id))!;
    expect(stored.play?.currentTrick).toEqual([{ playerId: p2, cardId: 'COEUR-4' }]);
    expect(stored.play?.nextPlayerId).toBe(p1);

    // p1 suit sans jouer : main 10♣ 8♥ 9⭐ 10♥, ouverture 4♥ → plus petite ♥ : 8♥.
    await jest.advanceTimersByTimeAsync(TURN);
    expect(spy.calls[1]).toMatchObject({ playerId: p1, trickNumber: 2, leadCardId: 'COEUR-4' });
    stored = (await repository.findById(game.id))!;
    expect(stored.play?.completedTricks[1]?.plays).toEqual([
      { playerId: p2, cardId: 'COEUR-4' },
      { playerId: p1, cardId: 'COEUR-8' },
    ]);
    expect(events.filter((e) => e.type === 'game:auto_card_played').map((e) => e.payload)).toEqual([
      { playerId: p2, trickNumber: 2 },
      { playerId: p1, trickNumber: 2 },
    ]);
  });

  it('TEST 5 — partie entièrement jouée à la main dans les délais : la stratégie n’est JAMAIS appelée', async () => {
    const spy = new SpySelection();
    const { service, game, repository, events } = await startedGame({ autoCardSelection: spy });
    // Chaque joueur choisit lui-même sa carte, à 14 s (avant l'échéance de 15 s).
    const manual: [PlayerId, CardId][] = [
      [p1, 'PIQUE-5'],
      [p2, 'PIQUE-9'], // p2 prend le contrôle
      [p2, 'COEUR-4'],
      [p1, 'COEUR-8'], // p1 reprend le contrôle
      [p1, 'TREFLE-10'],
      [p2, 'TREFLE-6'],
      [p1, 'ETOILE-9'],
      [p2, 'PIQUE-7'], // p2 sans ⭐ : carte libre, choisie par lui
    ];
    for (const [playerId, cardId] of manual) {
      await jest.advanceTimersByTimeAsync(TURN - 1_000);
      await service.playCard(game.id, playerId, cardId);
    }
    const finished = (await repository.findById(game.id))!;
    expect(finished.status).toBe('finished');
    // Le joueur a joué la carte qu'IL a choisie (pas la plus petite : 9♠ et non 7♠).
    expect(finished.play?.completedTricks[0]?.plays[1]).toEqual({
      playerId: p2,
      cardId: 'PIQUE-9',
    });
    // 5e tour : les dernières cartes jouées par le moteur, sans stratégie.
    expect(finished.play?.completedTricks[4]?.plays).toEqual([
      { playerId: p1, cardId: 'COEUR-10' },
      { playerId: p2, cardId: 'PIQUE-8' },
    ]);
    expect(spy.calls).toEqual([]);
    const types = events.map((e) => e.type);
    expect(types).not.toContain('game:turn_timeout');
    expect(types).not.toContain('game:auto_card_played');
    expect(types).toContain('game:last_trick_automatic');
  });

  it('TEST 9 — 5e tour : la carte unique est jouée sans appel à la stratégie (aucun timer)', async () => {
    const spy = new SpySelection();
    const { game, repository } = await startedGame({ autoCardSelection: spy });
    for (let i = 0; i < 30 && (await repository.findById(game.id))!.status !== 'finished'; i++) {
      await jest.advanceTimersByTimeAsync(TURN);
    }
    const finished = (await repository.findById(game.id))!;
    expect(finished.status).toBe('finished');
    expect(finished.play?.completedTricks).toHaveLength(5);
    expect(spy.calls).toHaveLength(8); // 2 joueurs × tours 1 à 4
    expect(spy.calls.every((c) => c.trickNumber <= 4)).toBe(true);
    expect(finished.turnDeadlineAt).toBeUndefined();
  });
});

describe('Partie complète sans aucune action : tours 1 à 4 par D-036, 5e tour automatique', () => {
  async function playOutByTimeouts(
    game: Game,
    repository: { findById(id: Game['id']): Promise<Game | null> },
  ) {
    for (let i = 0; i < 30; i++) {
      const current = (await repository.findById(game.id))!;
      if (current.status === 'finished') {
        return current;
      }
      await jest.advanceTimersByTimeAsync(TURN);
    }
    throw new Error('la partie ne s’est pas terminée');
  }

  /** Rejoue la partie terminée et vérifie chaque carte des tours 1 à 4 avec l'oracle. */
  function checkEveryAutomaticCard(finished: Game, initialHands: Record<PlayerId, CardId[]>) {
    const hands = structuredClone(initialHands);
    const tricks = finished.play!.completedTricks;
    expect(tricks.map((t) => t.number)).toEqual([1, 2, 3, 4, 5]);
    for (const trick of tricks.slice(0, 4)) {
      const lead = trick.plays[0]!.cardId;
      trick.plays.forEach(({ playerId, cardId }, index) => {
        expect(cardId).toBe(expectedAutoCard(hands[playerId]!, index === 0 ? undefined : lead));
        hands[playerId] = hands[playerId]!.filter((c) => c !== cardId);
      });
    }
    // 5e tour : chaque joueur actif joue sa DERNIÈRE carte, sans choix.
    for (const { playerId, cardId } of tricks[4]!.plays) {
      expect(hands[playerId]).toEqual([cardId]);
    }
    return tricks;
  }

  it('2 joueurs : aucune commande client ; le contrôleur final gagne', async () => {
    const { game, repository, events, logLines } = await startedGame();
    const finished = await playOutByTimeouts(game, repository);
    const tricks = checkEveryAutomaticCard(finished, { [p1]: H1, [p2]: H2 });

    // 8 coups automatiques (tours 1 à 4), aucun au 5e tour (pas de timer, pas de choix).
    const autos = events.filter((e) => e.type === 'game:auto_card_played');
    expect(autos).toHaveLength(8);
    expect(autos.every((e) => (e.payload.trickNumber as number) <= 4)).toBe(true);
    const lastTrick = events.find((e) => e.type === 'game:last_trick_automatic')!;
    const fifthController = tricks[3]!.controllerId;
    expect(lastTrick.payload.order).toEqual(rotateFrom([p1, p2], fifthController));
    expect(finished.result).toMatchObject({
      winnerId: tricks[4]!.controllerId,
      method: 'CONTROL_AFTER_LAST_TRICK',
    });
    expect(playCommands(logLines)).toEqual([]);
  });

  it('3 joueurs dont un fuyard : ordre antihoraire, fuyard ignoré à chaque tour et au 5e', async () => {
    const { service, game, repository, events } = await startedGame({ threePlayers: true });
    await service.flee(game.id, p2);
    const finished = await playOutByTimeouts(game, repository);
    const tricks = checkEveryAutomaticCard(finished, { [p1]: H1, [p3]: H3 } as Record<
      PlayerId,
      CardId[]
    >);
    for (const trick of tricks) {
      expect(trick.plays.map((p) => p.playerId)).not.toContain(p2);
      // Sens antihoraire à partir du meneur, parmi les joueurs actifs (p1 → p3 → p1…).
      expect(trick.plays.map((p) => p.playerId)).toEqual(
        rotateFrom([p1, p3], trick.plays[0]!.playerId),
      );
    }
    expect(finished.play?.hands[p2]).toHaveLength(5);
    expect(
      events.filter((e) => e.type === 'game:auto_card_played' && e.payload.playerId === p2),
    ).toEqual([]);
    expect(finished.result?.winnerId).toBe(tricks[4]!.controllerId);
  });
});

describe('AutomaticCardSelectionStrategy — contrat du port', () => {
  it('la stratégie ne reçoit QUE la main du joueur concerné, l’état public et la carte de contrôle', async () => {
    const strategy = new ScriptedSelection('PIQUE-7');
    const { service, game } = await startedGame({ autoCardSelection: strategy });
    await service.playCard(game.id, p1, 'PIQUE-5');
    await jest.advanceTimersByTimeAsync(TURN);

    expect(strategy.calls).toHaveLength(1);
    const context = strategy.calls[0]!;
    expect({ ...context, hand: [...context.hand].sort() }).toEqual({
      gameId: game.id,
      playerId: p2,
      hand: [...H2].sort(),
      trickNumber: 1,
      currentTrick: [{ playerId: p1, cardId: 'PIQUE-5' }],
      controllerId: p1,
      leadCardId: 'PIQUE-5',
      controlCardId: 'PIQUE-5',
    });
    // Aucune autre carte de p1 n'est visible par la stratégie.
    expect(JSON.stringify(context)).not.toMatch(/TREFLE-10|COEUR-8|ETOILE-9|COEUR-10/);
  });

  it('une carte illégale n’est jamais jouée : même validation qu’un coup manuel', async () => {
    // p2 possède des ♠ : le 4♥ est refusé par les règles officielles (CARD_NOT_PLAYABLE).
    const strategy = new ScriptedSelection('COEUR-4');
    const { service, game, repository, logLines } = await startedGame({
      autoCardSelection: strategy,
    });
    await service.playCard(game.id, p1, 'PIQUE-5');
    await jest.advanceTimersByTimeAsync(TURN);
    const stored = (await repository.findById(game.id))!;
    expect(stored.play?.hands[p2]).toHaveLength(5);
    expect(stored.turnTimedOutAt).toBeDefined();
    expect(logLines.find((l) => l.message === 'AUTO_CARD_PLAY rejected')).toMatchObject({
      errorName: 'CardNotPlayableError',
    });
  });
});

describe('Reconstruction des timers après redémarrage', () => {
  /** Nouvelle « instance » sur le même dépôt : timers vides, comme après un redémarrage. */
  function restart(fixture: Awaited<ReturnType<typeof startedGame>>) {
    fixture.timers.cancelAll(); // le processus s'arrête : ses timers en mémoire disparaissent
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
    return { service, timers, hub };
  }

  it('arrêt à 4 s, redémarrage : réarmé pour les 16 s restantes, puis coup automatique', async () => {
    const fixture = await startedGame();
    jest.setSystemTime(new Date(T0.getTime() + 4_000));
    const { service, timers } = restart(fixture);

    const deadlines = await service.findTurnDeadlines();
    expect(deadlines).toEqual([
      { gameId: fixture.game.id, deadlineAt: new Date(T0.getTime() + TURN), timedOut: false },
    ]);
    service.syncTurnTimer({ ...fixture.game });
    expect(timers.has(fixture.game.id)).toBe(true);

    await jest.advanceTimersByTimeAsync(TURN - 4_000 - 1);
    expect((await fixture.repository.findById(fixture.game.id))?.play?.currentTrick).toEqual([]);
    await jest.advanceTimersByTimeAsync(1);
    expect((await fixture.repository.findById(fixture.game.id))?.play?.currentTrick).toEqual([
      { playerId: p1, cardId: 'PIQUE-5' },
    ]);
  });

  it('échéance déjà dépassée au redémarrage : traitée immédiatement, une seule carte', async () => {
    const fixture = await startedGame();
    jest.setSystemTime(new Date(T0.getTime() + 3 * TURN));
    const { service } = restart(fixture);
    await service.handleTurnTimeout(fixture.game.id);
    await service.handleTurnTimeout(fixture.game.id);
    const stored = (await fixture.repository.findById(fixture.game.id))!;
    expect(stored.play?.currentTrick).toEqual([{ playerId: p1, cardId: 'PIQUE-5' }]);
    expect(stored.version).toBe(fixture.game.version + 2);
  });

  it('arrêt entre TURN_TIMEOUT et le coup automatique : coup repris au redémarrage', async () => {
    const fixture = await startedGame({ autoCardSelection: crashingSelection });
    await jest.advanceTimersByTimeAsync(TURN);
    const pendingState = (await fixture.repository.findById(fixture.game.id))!;
    expect(pendingState.turnTimedOutAt).toBeDefined();
    expect(pendingState.play?.currentTrick).toEqual([]);

    const { service } = restart(fixture);
    const [pending] = await service.findTurnDeadlines();
    expect(pending?.timedOut).toBe(true);
    await service.retryAutomaticPlay(fixture.game.id);
    await service.retryAutomaticPlay(fixture.game.id);
    const stored = (await fixture.repository.findById(fixture.game.id))!;
    expect(stored.play?.currentTrick).toEqual([{ playerId: p1, cardId: 'PIQUE-5' }]);
    expect(stored.version).toBe(pendingState.version + 1);
  });

  it('instance arrêtée entre TURN_TIMEOUT et le coup automatique : le balayage d’une autre instance le joue, une fois', async () => {
    const fixture = await startedGame({ autoCardSelection: crashingSelection });
    await jest.advanceTimersByTimeAsync(TURN);
    const pendingState = (await fixture.repository.findById(fixture.game.id))!;
    expect(pendingState.turnTimedOutAt).toBeDefined();
    expect(pendingState.play?.currentTrick).toEqual([]);

    // Seconde instance déjà en marche : aucun redémarrage, seulement le balayage périodique.
    const { service } = restart(fixture);
    const sessions = {
      recoverDecisionTimers: async () => ({ scheduled: 0, processed: 0 }),
    } as unknown as SessionService;
    const supervisor = new DeadlineSupervisor({ games: service, sessions, logger: silentLogger });
    await supervisor.sweep();
    await supervisor.sweep();
    const stored = (await fixture.repository.findById(fixture.game.id))!;
    expect(stored.play?.currentTrick).toEqual([{ playerId: p1, cardId: 'PIQUE-5' }]);
    expect(stored.version).toBe(pendingState.version + 1);
    expect(stored.play?.nextPlayerId).toBe(p2);
  });
});
