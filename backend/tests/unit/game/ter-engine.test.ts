import type { CardId } from '../../../src/domain/cards/card';
import { InvalidCardError } from '../../../src/domain/cards/card';
import type { Game } from '../../../src/domain/game/game';
import {
  CardNotInHandError,
  CardNotPlayableError,
  FleeNotAllowedError,
  GameAccessDeniedError,
  GameAlreadyStartedError,
  GameNotFullError,
  GameNotInProgressError,
  NotAWinningHandError,
  NotYourTurnError,
  PlayerHasFledError,
  WinDeclarationNotAllowedError,
} from '../../../src/domain/game/game-errors';
import { toPlayerId, type PlayerId } from '../../../src/domain/game/game-id';
import { declareWin, flee, playCard, startGame } from '../../../src/domain/game/ter-engine';
import {
  declareBeforeFirstCard,
  fleeBeforeSecondTrick,
  mustFollowLeadColorWhenPossible,
} from '../../../src/domain/rules/rule-candidates';
import { UnresolvedRuleError } from '../../../src/domain/rules/unresolved-rule';
import { NOW, startedGame, waitingGame } from '../../fixtures/game-builders';
import { identityRandom, seededRandom } from '../../fixtures/random';
import { testRules, withRules } from '../../fixtures/rules';

const ctx = { rules: testRules, now: NOW };
const p = (name: string): PlayerId => toPlayerId(name);

/** Mains de la distribution « identité » à 2 joueurs (voir deck.test.ts). */
const TWO_PLAYER_HANDS: Record<string, CardId[]> = {
  p1: ['COEUR-3', 'COEUR-5', 'COEUR-7', 'COEUR-9', 'PIQUE-3'],
  p2: ['COEUR-4', 'COEUR-6', 'COEUR-8', 'COEUR-10', 'PIQUE-4'],
};

function play(game: Game, player: string, card: CardId) {
  return playCard(game, p(player), card, ctx);
}

describe('Moteur — démarrage et distribution', () => {
  it.each([2, 3, 4])(
    'à %i joueurs : 5 cartes chacun, le premier servi a le contrôle et joue',
    (n) => {
      const game = waitingGame(['p1', 'p2', 'p3', 'p4'].slice(0, n));
      const events = startGame(game, { ...ctx, random: seededRandom(n) });

      expect(game.status).toBe('in_progress');
      expect(game.startedAt).toEqual(NOW);
      const playState = game.play!;
      for (const id of playState.dealOrder) {
        expect(playState.hands[id]).toHaveLength(5);
      }
      expect(playState.stock).toHaveLength(31 - 5 * n);
      expect(new Set([...Object.values(playState.hands).flat(), ...playState.stock]).size).toBe(31);
      expect(playState.control).toEqual({ playerId: playState.dealOrder[0] });
      expect(playState.nextPlayerId).toBe(playState.dealOrder[0]);
      expect(playState.trickNumber).toBe(1);
      expect(events[0]?.type).toBe('game:started');
    },
  );

  it('envoie à chaque joueur sa main, en privé', () => {
    const game = waitingGame(['p1', 'p2']);
    const events = startGame(game, { ...ctx, random: identityRandom });
    const dealt = events.filter((e) => e.type === 'game:hand_dealt');

    expect(dealt).toEqual([
      { type: 'game:hand_dealt', recipientId: 'p1', payload: { cards: TWO_PLAYER_HANDS.p1 } },
      { type: 'game:hand_dealt', recipientId: 'p2', payload: { cards: TWO_PLAYER_HANDS.p2 } },
    ]);
    expect(JSON.stringify(events.find((e) => e.type === 'game:started'))).not.toContain('COEUR');
  });

  it('refuse de démarrer une table incomplète', () => {
    expect(() =>
      startGame(waitingGame(['p1', 'p2'], 3), { ...ctx, random: identityRandom }),
    ).toThrow(GameNotFullError);
  });

  it('refuse de démarrer deux fois', () => {
    const { game } = startedGame(TWO_PLAYER_HANDS);
    expect(() => startGame(game, { ...ctx, random: identityRandom })).toThrow(
      GameAlreadyStartedError,
    );
  });

  it('refuse une règle de distribution qui oublie ou duplique un joueur', () => {
    const rules = withRules({ dealOrder: (ids) => [ids[0]!, ids[0]!] });
    expect(() =>
      startGame(waitingGame(['p1', 'p2']), { rules, now: NOW, random: identityRandom }),
    ).toThrow(/dealOrder/);
  });
});

describe('Moteur — cycle de vie', () => {
  it('refuse de jouer une carte dans une partie en attente', () => {
    expect(() => play(waitingGame(['p1', 'p2']), 'p1', 'COEUR-3')).toThrow(GameNotInProgressError);
  });

  it('refuse de jouer une carte dans une partie terminée', () => {
    const { game } = startedGame(TWO_PLAYER_HANDS);
    game.status = 'finished';
    expect(() => play(game, 'p1', 'COEUR-3')).toThrow(GameNotInProgressError);
  });
});

describe('Moteur — jouer une carte', () => {
  it("refuse un joueur qui n'appartient pas à la partie", () => {
    const { game } = startedGame(TWO_PLAYER_HANDS);
    expect(() => play(game, 'intrus', 'COEUR-3')).toThrow(GameAccessDeniedError);
  });

  it("refuse un joueur dont ce n'est pas le tour", () => {
    const { game } = startedGame(TWO_PLAYER_HANDS);
    expect(() => play(game, 'p2', 'COEUR-4')).toThrow(NotYourTurnError);
  });

  it("refuse une carte absente de la main, et une carte qui n'existe pas", () => {
    const { game } = startedGame(TWO_PLAYER_HANDS);
    expect(() => play(game, 'p1', 'COEUR-4')).toThrow(CardNotInHandError);
    expect(() => playCard(game, p('p1'), 'PIQUE-10', ctx)).toThrow(InvalidCardError);
    expect(() => playCard(game, p('p1'), { id: 'COEUR-3' }, ctx)).toThrow(InvalidCardError);
  });

  it('refuse une carte non jouable selon la règle injectée', () => {
    const rules = withRules({ cardPlayability: mustFollowLeadColorWhenPossible });
    const { game } = startedGame(TWO_PLAYER_HANDS, rules);
    playCard(game, p('p1'), 'COEUR-3', { rules, now: NOW });
    expect(() => playCard(game, p('p2'), 'PIQUE-4', { rules, now: NOW })).toThrow(
      CardNotPlayableError,
    );
  });

  it("retire la carte de la main et la rend visible dans le tour, l'état restant cohérent", () => {
    const { game } = startedGame(TWO_PLAYER_HANDS);
    const events = play(game, 'p1', 'COEUR-3');

    expect(game.play!.hands.p1).not.toContain('COEUR-3');
    expect(game.play!.currentTrick).toEqual([{ playerId: 'p1', cardId: 'COEUR-3' }]);
    expect(game.play!.control).toEqual({ playerId: 'p1', cardId: 'COEUR-3' });
    expect(game.play!.nextPlayerId).toBe('p2');
    expect(events.map((e) => e.type)).toEqual(['game:card_played', 'game:turn_changed']);
  });

  it("n'altère pas l'état quand une commande est refusée", () => {
    const { game } = startedGame(TWO_PLAYER_HANDS);
    const before = structuredClone(game);
    expect(() => play(game, 'p1', 'COEUR-4')).toThrow();
    expect(game).toEqual(before);
  });
});

describe('Moteur — contrôle (spec §2.4)', () => {
  it('une carte supérieure de même famille prend le contrôle', () => {
    const { game } = startedGame(TWO_PLAYER_HANDS);
    play(game, 'p1', 'COEUR-3');
    const events = play(game, 'p2', 'COEUR-4');

    expect(events[0]?.payload).toMatchObject({ tookControl: true, controllerId: 'p2' });
    expect(game.play!.completedTricks[0]?.controllerId).toBe('p2');
  });

  it("une carte supérieure d'une autre famille ne prend pas le contrôle", () => {
    const { game } = startedGame({ p1: ['COEUR-3', 'PIQUE-5'], p2: ['PIQUE-9', 'COEUR-4'] });
    play(game, 'p1', 'COEUR-3');
    play(game, 'p2', 'PIQUE-9');
    expect(game.play!.completedTricks[0]?.controllerId).toBe('p1');
  });

  it('une carte inférieure de même famille ne prend pas le contrôle', () => {
    const { game } = startedGame({ p1: ['COEUR-8', 'PIQUE-5'], p2: ['COEUR-4', 'PIQUE-6'] });
    play(game, 'p1', 'COEUR-8');
    play(game, 'p2', 'COEUR-4');
    expect(game.play!.completedTricks[0]?.controllerId).toBe('p1');
  });

  it('le contrôle se compare à la carte du contrôleur ACTUEL dans le tour', () => {
    const { game } = startedGame({
      p1: ['COEUR-3', 'PIQUE-3'],
      p2: ['COEUR-6', 'PIQUE-4'],
      p3: ['COEUR-5', 'PIQUE-5'],
    });
    play(game, 'p1', 'COEUR-3');
    play(game, 'p2', 'COEUR-6'); // prend le contrôle
    play(game, 'p3', 'COEUR-5'); // > 3 mais < 6 : ne le reprend pas
    expect(game.play!.completedTricks[0]?.controllerId).toBe('p2');
  });

  it('le contrôleur ouvre le tour suivant et pose la nouvelle carte de référence', () => {
    const { game } = startedGame(TWO_PLAYER_HANDS);
    play(game, 'p1', 'COEUR-3');
    play(game, 'p2', 'COEUR-4');

    expect(game.play!.trickNumber).toBe(2);
    expect(game.play!.nextPlayerId).toBe('p2');
    expect(game.play!.control).toEqual({ playerId: 'p2' });
    expect(game.play!.currentTrick).toEqual([]);
  });
});

describe('Moteur — partie complète en 5 tours', () => {
  it('le joueur qui garde le contrôle après le 5e tour gagne', () => {
    const { game } = startedGame(TWO_PLAYER_HANDS);
    const moves: [string, CardId][] = [
      ['p1', 'COEUR-3'],
      ['p2', 'COEUR-4'], // tour 1 : p2 prend
      ['p2', 'PIQUE-4'],
      ['p1', 'PIQUE-3'], // tour 2 : p2 garde
      ['p2', 'COEUR-6'],
      ['p1', 'COEUR-7'], // tour 3 : p1 prend
      ['p1', 'COEUR-5'],
      ['p2', 'COEUR-8'], // tour 4 : p2 prend
      ['p2', 'COEUR-10'],
      ['p1', 'COEUR-9'], // tour 5 : p2 garde
    ];
    let events: ReturnType<typeof play> = [];
    for (const [player, card] of moves) {
      events = play(game, player, card);
    }

    expect(game.status).toBe('finished');
    expect(game.finishedAt).toEqual(NOW);
    expect(game.play!.completedTricks.map((t) => t.controllerId)).toEqual([
      'p2',
      'p2',
      'p1',
      'p2',
      'p2',
    ]);
    expect(game.result).toEqual({
      winnerId: 'p2',
      method: 'CONTROL_AFTER_LAST_TRICK',
      remainingOpponentIds: ['p1'],
      fledPlayerIds: [],
    });
    expect(game.play!.nextPlayerId).toBeUndefined();
    expect(Object.values(game.play!.hands).flat()).toEqual([]);
    expect(events.map((e) => e.type)).toEqual([
      'game:card_played',
      'game:trick_completed',
      'game:finished',
    ]);
    expect(() => play(game, 'p1', 'COEUR-3')).toThrow(GameNotInProgressError);
  });
});

describe('Moteur — gain instantané (spec §4)', () => {
  const winningHands = {
    p1: ['COEUR-3', 'PIQUE-3', 'TREFLE-3', 'COEUR-9', 'ETOILE-10'] as CardId[],
    p2: ['COEUR-4', 'COEUR-6', 'COEUR-8', 'COEUR-10', 'PIQUE-4'] as CardId[],
  };

  it('termine la partie, désigne le gagnant et révèle toutes les mains (§2.3)', () => {
    const { game } = startedGame(winningHands);
    const events = declareWin(game, p('p1'), ctx);

    expect(game.status).toBe('finished');
    expect(game.result).toEqual({
      winnerId: 'p1',
      method: 'INSTANT_WIN',
      instantWinConditions: ['THREE_THREES'],
      revealedHands: winningHands,
      remainingOpponentIds: ['p2'],
      fledPlayerIds: [],
    });
    expect(events).toEqual([{ type: 'game:finished', payload: { result: game.result } }]);
  });

  it('peut être déclaré par un joueur dont ce n’est pas le tour', () => {
    const { game } = startedGame({ p1: winningHands.p2, p2: winningHands.p1 });
    declareWin(game, p('p2'), ctx);
    expect(game.result?.winnerId).toBe('p2');
  });

  it('refuse une main non gagnante, et la partie continue (séquence « déroulement »)', () => {
    const { game } = startedGame(TWO_PLAYER_HANDS);
    const before = structuredClone(game);
    expect(() => declareWin(game, p('p1'), ctx)).toThrow(NotAWinningHandError);
    expect(game).toEqual(before);
  });

  it('respecte la fenêtre de déclaration injectée (R-07)', () => {
    const rules = withRules({ winDeclarationWindow: declareBeforeFirstCard });
    const { game } = startedGame(winningHands, rules);
    playCard(game, p('p1'), 'ETOILE-10', { rules, now: NOW });
    expect(() => declareWin(game, p('p1'), { rules, now: NOW })).toThrow(
      WinDeclarationNotAllowedError,
    );
  });
});

describe('Moteur — fuite (spec §2.5)', () => {
  const fourHands: Record<string, CardId[]> = {
    p1: ['COEUR-3', 'COEUR-4'],
    p2: ['PIQUE-3', 'PIQUE-4'],
    p3: ['TREFLE-3', 'TREFLE-4'],
    p4: ['ETOILE-3', 'ETOILE-4'],
  };

  it('retire le joueur du jeu ; il est sauté dans les tours suivants', () => {
    const { game } = startedGame(fourHands);
    const events = flee(game, p('p3'), ctx);

    expect(events).toEqual([{ type: 'game:player_fled', payload: { playerId: 'p3' } }]);
    expect(game.players.find((x) => x.playerId === 'p3')?.fledAt).toEqual(NOW);
    play(game, 'p1', 'COEUR-3');
    play(game, 'p2', 'PIQUE-3');
    expect(game.play!.nextPlayerId).toBe('p4');
    play(game, 'p4', 'ETOILE-3');
    expect(game.play!.completedTricks[0]?.plays.map((x) => x.playerId)).toEqual(['p1', 'p2', 'p4']);
    expect(() => play(game, 'p3', 'TREFLE-3')).toThrow(PlayerHasFledError);
  });

  it('passe au joueur suivant si le fuyard était attendu', () => {
    const { game } = startedGame(fourHands);
    play(game, 'p1', 'COEUR-3');
    flee(game, p('p2'), ctx);
    expect(game.play!.nextPlayerId).toBe('p3');
  });

  it('un seul joueur peut fuir par partie', () => {
    const { game } = startedGame(fourHands);
    flee(game, p('p3'), ctx);
    expect(() => flee(game, p('p4'), ctx)).toThrow(FleeNotAllowedError);
  });

  it('respecte la règle de délai injectée (R-05)', () => {
    const rules = withRules({ fleeEligibility: fleeBeforeSecondTrick });
    const { game } = startedGame(fourHands, rules);
    for (const [player, card] of [
      ['p1', 'COEUR-3'],
      ['p2', 'PIQUE-3'],
      ['p3', 'TREFLE-3'],
      ['p4', 'ETOILE-3'],
    ] as const) {
      playCard(game, p(player), card, { rules, now: NOW });
    }
    expect(() => flee(game, p('p2'), { rules, now: NOW })).toThrow(FleeNotAllowedError);
  });

  it('cas non définis par les documents : fuite du contrôleur, ou partie réduite à un joueur (R-30)', () => {
    expect(() => flee(startedGame(fourHands).game, p('p1'), ctx)).toThrow(UnresolvedRuleError);
    expect(() => flee(startedGame(TWO_PLAYER_HANDS).game, p('p2'), ctx)).toThrow(
      UnresolvedRuleError,
    );
  });
});
