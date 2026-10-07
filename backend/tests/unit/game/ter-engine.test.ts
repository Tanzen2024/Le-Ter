import type { CardId } from '../../../src/domain/cards/card';
import { InvalidCardError } from '../../../src/domain/cards/card';
import type { Game } from '../../../src/domain/game/game';
import {
  CardNotInHandError,
  CardNotPlayableError,
  FleeNotAllowedError,
  GameAccessDeniedError,
  GameAlreadyStartedError,
  GameNotEnoughPlayersError,
  GameNotInProgressError,
  NotAWinningHandError,
  NotYourTurnError,
  PlayerHasFledError,
  WinDeclarationNotAllowedError,
} from '../../../src/domain/game/game-errors';
import { toPlayerId, type PlayerId } from '../../../src/domain/game/game-id';
import { toPlayerView } from '../../../src/domain/game/game-view';
import {
  declareWin,
  flee,
  playCard,
  playableCards,
  startGame,
  tableOrder,
} from '../../../src/domain/game/ter-engine';
import { UnresolvedRuleError } from '../../../src/domain/rules/unresolved-rule';
import { NOW, startedGame, waitingGame } from '../../fixtures/game-builders';
import { deckForHands, decksRandom, identityRandom, seededRandom } from '../../fixtures/random';
import { testRules } from '../../fixtures/rules';

/**
 * Moteur du Ter selon le SOCLE DE VÉRITÉ (D-035, 52 décisions + précisions validées).
 * Les règles sont les règles OFFICIELLES (testRules = OFFICIAL_TER_RULES).
 */
const ctx = { rules: testRules, now: NOW };
const p = (name: string): PlayerId => toPlayerId(name);

function play(game: Game, player: string, card: CardId) {
  return playCard(game, p(player), card, ctx);
}

/** Mains de scénario à 2 joueurs (aucune n'est une main gagnante instantanée). */
const TWO_PLAYER_HANDS: Record<string, CardId[]> = {
  p1: ['COEUR-3', 'COEUR-5', 'COEUR-7', 'COEUR-9', 'PIQUE-3'],
  p2: ['COEUR-4', 'COEUR-6', 'COEUR-8', 'COEUR-10', 'PIQUE-4'],
};

/** Mains produites par la VRAIE distribution « identité » à 2 joueurs (3 puis 2). */
const IDENTITY_DEAL_HANDS: Record<string, CardId[]> = {
  p1: ['COEUR-3', 'COEUR-4', 'COEUR-5', 'COEUR-9', 'COEUR-10'],
  p2: ['COEUR-6', 'COEUR-7', 'COEUR-8', 'PIQUE-3', 'PIQUE-4'],
};

describe('Distribution (décisions 25-34)', () => {
  it.each([2, 3, 4])(
    'à %i joueurs : 5 cartes chacun, 31 cartes au total, le reste inaccessible, J1 a le contrôle',
    (n) => {
      const game = waitingGame(['p1', 'p2', 'p3', 'p4'].slice(0, n));
      startGame(game, { ...ctx, random: seededRandom(n) });
      const playState = game.play!;
      for (const id of playState.dealOrder) {
        expect(playState.hands[id]).toHaveLength(5);
      }
      expect(Object.values(playState.hands).flat()).toHaveLength(5 * n); // 10, 15, 20
      expect(playState.stock).toHaveLength(31 - 5 * n);
      expect(new Set([...Object.values(playState.hands).flat(), ...playState.stock]).size).toBe(31);
      expect(playState.control).toEqual({ playerId: playState.dealOrder[0] });
      expect(playState.nextPlayerId).toBe(playState.dealOrder[0]);
    },
  );

  it('chaque joueur reçoit SA main en privé, groupée en un lot de 3 puis un lot de 2', () => {
    const game = waitingGame(['p1', 'p2']);
    const events = startGame(game, { ...ctx, random: identityRandom });
    const batches = (cards: CardId[]) => [cards.slice(0, 3), cards.slice(3)];
    expect(events.filter((e) => e.type === 'game:hand_dealt')).toEqual([
      {
        type: 'game:hand_dealt',
        recipientId: 'p1',
        payload: {
          playerId: 'p1',
          cards: IDENTITY_DEAL_HANDS.p1,
          batches: batches(IDENTITY_DEAL_HANDS.p1!),
        },
      },
      {
        type: 'game:hand_dealt',
        recipientId: 'p2',
        payload: {
          playerId: 'p2',
          cards: IDENTITY_DEAL_HANDS.p2,
          batches: batches(IDENTITY_DEAL_HANDS.p2!),
        },
      },
    ]);
  });

  it('événement public : ordre antihoraire, lots 3+3+3 puis 2+2+2, échéance du tour, aucune carte', () => {
    const game = waitingGame(['p1', 'p2', 'p3'], 4);
    const events = startGame(game, { now: NOW, random: seededRandom(7) });
    expect(game.play!.trickOrder).toEqual(['p1', 'p2', 'p3']);
    expect(events[0]).toMatchObject({
      type: 'game:started',
      payload: {
        dealOrder: ['p1', 'p2', 'p3'],
        firstPlayerId: 'p1',
        controllerId: 'p1',
        dealSequence: [
          { pass: 1, playerId: 'p1', count: 3 },
          { pass: 1, playerId: 'p2', count: 3 },
          { pass: 1, playerId: 'p3', count: 3 },
          { pass: 2, playerId: 'p1', count: 2 },
          { pass: 2, playerId: 'p2', count: 2 },
          { pass: 2, playerId: 'p3', count: 2 },
        ],
      },
    });
    expect(JSON.stringify(events[0])).not.toMatch(/COEUR|PIQUE|TREFLE|ETOILE/);
  });

  it('ordre de la table = sièges fixes, à partir de J1 (J1 → J2 → J3 → J4)', () => {
    const game = waitingGame(['p1', 'p2', 'p3', 'p4']);
    game.players.reverse();
    game.firstPlayerId = p('p3');
    expect(tableOrder(game)).toEqual(['p3', 'p4', 'p1', 'p2']);
  });

  it('aucune pioche, aucun remplacement : une carte jouée fait passer la main de 5 à 4', () => {
    const { game } = startedGame(TWO_PLAYER_HANDS);
    const stockBefore = [...game.play!.stock];
    play(game, 'p1', 'COEUR-3');
    expect(game.play!.hands.p1).toHaveLength(4);
    expect(game.play!.stock).toEqual(stockBefore);
  });

  it('refuse 1 seul joueur, et un second démarrage', () => {
    expect(() => startGame(waitingGame(['p1'], 4), { ...ctx, random: identityRandom })).toThrow(
      GameNotEnoughPlayersError,
    );
    const { game } = startedGame(TWO_PLAYER_HANDS);
    expect(() => startGame(game, { ...ctx, random: identityRandom })).toThrow(
      GameAlreadyStartedError,
    );
  });
});

describe('Jouer une carte : obligation de famille (décisions 44-50)', () => {
  it('refuse un non-membre, un joueur hors tour, une carte absente ou inexistante', () => {
    const { game } = startedGame(TWO_PLAYER_HANDS);
    expect(() => play(game, 'intrus', 'COEUR-3')).toThrow(GameAccessDeniedError);
    expect(() => play(game, 'p2', 'COEUR-4')).toThrow(NotYourTurnError);
    expect(() => play(game, 'p1', 'COEUR-4')).toThrow(CardNotInHandError);
    expect(() => playCard(game, p('p1'), 'PIQUE-10', ctx)).toThrow(InvalidCardError);
  });

  it('le meneur joue librement', () => {
    const { game } = startedGame(TWO_PLAYER_HANDS);
    expect(playableCards(game, p('p1'), testRules).sort()).toEqual(
      [...TWO_PLAYER_HANDS.p1!].sort(),
    );
    play(game, 'p1', 'PIQUE-3');
    expect(game.play!.control).toEqual({ playerId: 'p1', cardId: 'PIQUE-3' });
  });

  it('possède la famille : DOIT la jouer, même une valeur inférieure (autre famille refusée)', () => {
    const { game } = startedGame({
      p1: ['COEUR-8', 'PIQUE-5'],
      p2: ['COEUR-4', 'PIQUE-9'],
    });
    play(game, 'p1', 'COEUR-8');
    expect(playableCards(game, p('p2'), testRules)).toEqual(['COEUR-4']);
    const before = structuredClone(game);
    expect(() => play(game, 'p2', 'PIQUE-9')).toThrow(CardNotPlayableError);
    expect(game).toEqual(before); // refus : état inchangé
    play(game, 'p2', 'COEUR-4'); // inférieure mais de la famille : autorisée
    expect(game.play!.completedTricks[0]?.controllerId).toBe('p1');
  });

  it('ne possède pas la famille : n’importe quelle carte', () => {
    const { game } = startedGame({ p1: ['COEUR-8', 'PIQUE-5'], p2: ['PIQUE-9', 'TREFLE-3'] });
    play(game, 'p1', 'COEUR-8');
    expect(playableCards(game, p('p2'), testRules).sort()).toEqual(['PIQUE-9', 'TREFLE-3']);
    play(game, 'p2', 'TREFLE-3');
  });
});

describe('Contrôle (décisions 38-43, 51-52)', () => {
  const FOUR = {
    p1: ['COEUR-7', 'PIQUE-3'] as CardId[],
    p2: ['COEUR-5', 'PIQUE-4'] as CardId[],
    p3: ['COEUR-9', 'PIQUE-5'] as CardId[],
    p4: ['COEUR-8', 'PIQUE-6'] as CardId[],
  };

  it('fin de tour : la plus haute carte de la famille de départ prend le contrôle (7♥ → 9♥)', () => {
    const { game } = startedGame(FOUR);
    play(game, 'p1', 'COEUR-7');
    play(game, 'p2', 'COEUR-5');
    play(game, 'p3', 'COEUR-9');
    play(game, 'p4', 'COEUR-8');
    expect(game.play!.completedTricks[0]?.controllerId).toBe('p3');
  });

  it('le nouveau contrôleur ouvre le tour suivant ; ordre antihoraire J3 → J4 → J1 → J2', () => {
    const { game } = startedGame(FOUR);
    for (const [player, card] of [
      ['p1', 'COEUR-7'],
      ['p2', 'COEUR-5'],
      ['p3', 'COEUR-9'],
      ['p4', 'COEUR-8'],
    ] as const) {
      play(game, player, card);
    }
    expect(game.play!.trickNumber).toBe(2);
    expect(game.play!.nextPlayerId).toBe('p3');
    expect(game.play!.trickOrder).toEqual(['p3', 'p4', 'p1', 'p2']);
  });

  it('le contrôleur ne rejoue pas dans le même tour (décision 42)', () => {
    const { game } = startedGame(FOUR);
    play(game, 'p1', 'COEUR-7');
    play(game, 'p2', 'COEUR-5');
    play(game, 'p3', 'COEUR-9'); // prend le contrôle
    expect(game.play!.nextPlayerId).toBe('p4');
  });

  it('personne ne prend le contrôle : le contrôleur précédent le garde (décision 41)', () => {
    const { game } = startedGame({
      p1: ['COEUR-9', 'PIQUE-3'],
      p2: ['COEUR-4', 'PIQUE-4'],
      p3: ['TREFLE-10', 'PIQUE-5'], // plus forte, mais d'une autre famille
    });
    play(game, 'p1', 'COEUR-9');
    play(game, 'p2', 'COEUR-4');
    play(game, 'p3', 'TREFLE-10');
    expect(game.play!.completedTricks[0]?.controllerId).toBe('p1');
    expect(game.play!.nextPlayerId).toBe('p1');
  });

  it('carte supérieure de même famille → contrôle pendant le tour (événement control_changed)', () => {
    const { game } = startedGame(TWO_PLAYER_HANDS);
    play(game, 'p1', 'COEUR-3');
    const events = play(game, 'p2', 'COEUR-4');
    expect(events.map((e) => e.type)).toContain('game:control_changed');
    expect(events[0]?.payload).toMatchObject({ tookControl: true, controllerId: 'p2' });
  });
});

describe('Partie complète : 5 tours, 5e tour AUTOMATIQUE, contrôleur final gagnant', () => {
  it('à la fin du 4e tour, le 5e se joue seul et le contrôleur final gagne', () => {
    const { game } = startedGame(TWO_PLAYER_HANDS);
    const moves: [string, CardId][] = [
      ['p1', 'COEUR-3'],
      ['p2', 'COEUR-4'], // tour 1 : p2 prend
      ['p2', 'PIQUE-4'],
      ['p1', 'PIQUE-3'], // tour 2 : p1 doit suivre ♠ ; p2 garde
      ['p2', 'COEUR-6'],
      ['p1', 'COEUR-7'], // tour 3 : p1 prend
      ['p1', 'COEUR-5'],
    ];
    for (const [player, card] of moves) {
      play(game, player, card);
    }
    expect(game.play!.trickNumber).toBe(4);
    const events = play(game, 'p2', 'COEUR-8'); // fin du tour 4 : p2 prend

    expect(game.status).toBe('finished');
    expect(game.play!.completedTricks.map((t) => t.controllerId)).toEqual([
      'p2',
      'p2',
      'p1',
      'p2',
      'p2',
    ]);
    expect(game.play!.completedTricks[4]?.plays).toEqual([
      { playerId: 'p2', cardId: 'COEUR-10' },
      { playerId: 'p1', cardId: 'COEUR-9' },
    ]);
    expect(game.result).toEqual({
      winnerId: 'p2',
      method: 'CONTROL_AFTER_LAST_TRICK',
      remainingOpponentIds: ['p1'],
      fledPlayerIds: [],
    });
    expect(game.endReason).toBe('CONTROL_AFTER_LAST_TRICK');
    expect(game.turnDeadlineAt).toBeUndefined();
    expect(events.map((e) => e.type)).toEqual([
      'game:card_played',
      'game:control_changed',
      'game:trick_completed',
      'game:last_trick_automatic',
      'game:card_played',
      'game:card_played',
      'game:trick_completed',
      'game:finished',
    ]);
    expect(events.filter((e) => e.payload?.automatic === true)).toHaveLength(2);
    expect(Object.values(game.play!.hands).flat()).toEqual([]);
  });

  const THREE = {
    p1: ['COEUR-3', 'COEUR-5', 'COEUR-7', 'PIQUE-8', 'TREFLE-9'] as CardId[],
    p2: ['COEUR-4', 'COEUR-6', 'COEUR-8', 'PIQUE-9', 'TREFLE-10'] as CardId[],
    p3: ['ETOILE-3', 'ETOILE-4', 'ETOILE-5', 'ETOILE-6', 'ETOILE-8'] as CardId[],
  };

  it('le 5e tour ignore le joueur qui a fui ; ses cartes ne sont jamais jouées', () => {
    const { game } = startedGame(THREE);
    flee(game, p('p3'), ctx);
    for (const [player, card] of [
      ['p1', 'COEUR-3'],
      ['p2', 'COEUR-4'],
      ['p2', 'PIQUE-9'],
      ['p1', 'PIQUE-8'],
      ['p2', 'TREFLE-10'],
      ['p1', 'TREFLE-9'],
      ['p2', 'COEUR-6'],
      ['p1', 'COEUR-7'], // fin du tour 4 : p1 prend, puis 5e tour automatique
    ] as const) {
      play(game, player, card);
    }
    expect(game.status).toBe('finished');
    expect(game.play!.completedTricks[4]?.plays).toEqual([
      { playerId: 'p1', cardId: 'COEUR-5' },
      { playerId: 'p2', cardId: 'COEUR-8' },
    ]);
    expect(game.result).toMatchObject({ winnerId: 'p2', fledPlayerIds: ['p3'] });
    expect(game.play!.hands.p3).toHaveLength(5);
  });
});

describe('Fuir (D-035)', () => {
  const FOUR = {
    p1: ['COEUR-3', 'COEUR-4', 'COEUR-5', 'COEUR-6', 'COEUR-7'] as CardId[],
    p2: ['PIQUE-3', 'PIQUE-4', 'PIQUE-5', 'PIQUE-6', 'PIQUE-7'] as CardId[],
    p3: ['TREFLE-3', 'TREFLE-4', 'TREFLE-5', 'TREFLE-6', 'TREFLE-7'] as CardId[],
    p4: ['ETOILE-3', 'ETOILE-4', 'ETOILE-5', 'ETOILE-6', 'ETOILE-7'] as CardId[],
  };

  it('tour 1, avant sa première carte : le joueur devient inactif et est sauté', () => {
    const { game } = startedGame(FOUR);
    const events = flee(game, p('p3'), ctx);
    expect(events).toEqual([{ type: 'game:player_fled', payload: { playerId: 'p3' } }]);
    play(game, 'p1', 'COEUR-3');
    play(game, 'p2', 'PIQUE-3');
    expect(game.play!.nextPlayerId).toBe('p4');
    expect(() => play(game, 'p3', 'TREFLE-3')).toThrow(PlayerHasFledError);
  });

  it('refusé après sa première carte (même au tour 1), et au tour 2', () => {
    const { game } = startedGame(FOUR);
    play(game, 'p1', 'COEUR-3');
    expect(() => flee(game, p('p1'), ctx)).toThrow(FleeNotAllowedError);
    play(game, 'p2', 'PIQUE-3');
    play(game, 'p3', 'TREFLE-3');
    play(game, 'p4', 'ETOILE-3');
    expect(game.play!.trickNumber).toBe(2);
    expect(() => flee(game, p('p2'), ctx)).toThrow(FleeNotAllowedError);
  });

  it('un seul joueur peut fuir par partie', () => {
    const { game } = startedGame(FOUR);
    flee(game, p('p3'), ctx);
    expect(() => flee(game, p('p4'), ctx)).toThrow(FleeNotAllowedError);
  });

  it('le joueur qui a le contrôle peut fuir : le suivant antihoraire mène le tour', () => {
    const { game } = startedGame(FOUR);
    const events = flee(game, p('p1'), ctx);
    expect(game.play!.control).toEqual({ playerId: 'p2' });
    expect(game.play!.nextPlayerId).toBe('p2');
    expect(game.play!.trickOrder).toEqual(['p2', 'p3', 'p4']);
    expect(events.map((e) => e.type)).toEqual([
      'game:player_fled',
      'game:control_changed',
      'game:turn_changed',
    ]);
  });

  it('partie à 2 : fuir laisserait un seul joueur — non défini, refusé (R-30)', () => {
    const { game } = startedGame(TWO_PLAYER_HANDS);
    expect(() => flee(game, p('p2'), ctx)).toThrow(UnresolvedRuleError);
    expect(toPlayerView(game, p('p2')).myActions.canFlee).toBe(false);
  });

  it('vue : bouton Fuir présent au tour 1, absent après la première carte du joueur', () => {
    const { game } = startedGame(FOUR);
    expect(toPlayerView(game, p('p1')).myActions.canFlee).toBe(true);
    play(game, 'p1', 'COEUR-3');
    expect(toPlayerView(game, p('p1')).myActions.canFlee).toBe(false);
    expect(toPlayerView(game, p('p2')).myActions.canFlee).toBe(true);
  });
});

describe('Victoire instantanée (D-035)', () => {
  const WITH_WINNER = {
    // p3 : 5 cartes de la même famille (rang 3) ; les autres : aucune combinaison.
    p1: ['COEUR-8', 'COEUR-9', 'PIQUE-9', 'TREFLE-10', 'ETOILE-4'] as CardId[],
    p2: ['COEUR-10', 'PIQUE-7', 'PIQUE-8', 'TREFLE-9', 'ETOILE-5'] as CardId[],
    p3: ['ETOILE-3', 'ETOILE-6', 'ETOILE-7', 'ETOILE-8', 'ETOILE-9'] as CardId[],
  };

  it('une seule main gagnante : PAS de victoire automatique ; le joueur peut déclarer', () => {
    const { game } = startedGame(WITH_WINNER);
    expect(game.status).toBe('in_progress');
    expect(toPlayerView(game, p('p3')).myActions.canDeclareInstantWin).toBe(true);
    expect(toPlayerView(game, p('p3')).myInstantWin).toEqual({
      rank: 3,
      combination: 'FIVE_SAME_SUIT',
    });
    expect(toPlayerView(game, p('p1')).myInstantWin).toBeUndefined();
    expect(JSON.stringify(toPlayerView(game, p('p1')))).not.toContain('FIVE_SAME_SUIT');

    const events = declareWin(game, p('p3'), ctx); // même hors de son tour
    expect(game.result).toMatchObject({
      winnerId: 'p3',
      method: 'INSTANT_WIN',
      instantWinRank: 3,
      instantWinCombination: 'FIVE_SAME_SUIT',
      automatic: false,
      victoryType: 'SIMPLE',
      revealedHands: WITH_WINNER,
    });
    expect(events.map((e) => e.type)).toEqual(['game:finished']);
  });

  it('le joueur peut continuer à jouer ; le droit est perdu dès sa première carte', () => {
    const { game } = startedGame({ p3: WITH_WINNER.p3, p1: WITH_WINNER.p1, p2: WITH_WINNER.p2 });
    play(game, 'p3', 'ETOILE-3');
    expect(toPlayerView(game, p('p3')).myActions.canDeclareInstantWin).toBe(false);
    expect(() => declareWin(game, p('p3'), ctx)).toThrow(WinDeclarationNotAllowedError);
  });

  it('main non gagnante : refus, la partie continue', () => {
    const { game } = startedGame(WITH_WINNER);
    const before = structuredClone(game);
    expect(() => declareWin(game, p('p1'), ctx)).toThrow(NotAWinningHandError);
    expect(game).toEqual(before);
  });

  it('fuir avec une main gagnante : la fuite s’applique, la main ne compte plus', () => {
    const { game } = startedGame(WITH_WINNER);
    flee(game, p('p3'), ctx);
    expect(game.play!.instantWins?.p3).toBeUndefined();
    expect(() => declareWin(game, p('p3'), ctx)).toThrow(PlayerHasFledError);
  });

  // Par la VRAIE distribution (paquet imposé).
  const RANK_2: CardId[] = ['COEUR-3', 'COEUR-4', 'COEUR-5', 'PIQUE-3', 'PIQUE-4']; // somme 19
  const RANK_5_A: CardId[] = ['COEUR-9', 'PIQUE-9', 'TREFLE-9', 'COEUR-10', 'TREFLE-10'];
  const RANK_5_B: CardId[] = ['COEUR-8', 'PIQUE-8', 'TREFLE-8', 'COEUR-6', 'PIQUE-6'];

  it('plusieurs mains, rangs différents : le meilleur rang gagne AUTOMATIQUEMENT (victoire simple)', () => {
    const game = waitingGame(['p1', 'p2']);
    const events = startGame(game, {
      ...ctx,
      random: decksRandom(deckForHands([RANK_5_A, RANK_2])),
    });
    expect(game.status).toBe('finished');
    expect(game.result).toMatchObject({
      winnerId: 'p2',
      method: 'INSTANT_WIN',
      instantWinRank: 2,
      automatic: true,
      victoryType: 'SIMPLE',
    });
    expect(game.endReason).toBe('INSTANT_WIN');
    expect(game.turnDeadlineAt).toBeUndefined();
    expect(events.at(-1)?.type).toBe('game:finished');
  });

  it('plusieurs mains au même meilleur rang : aucun gagnant, partie annulée pour reprise', () => {
    const game = waitingGame(['p1', 'p2']);
    const events = startGame(game, {
      ...ctx,
      random: decksRandom(deckForHands([RANK_5_A, RANK_5_B])),
    });
    expect(game.status).toBe('finished');
    expect(game.result).toBeUndefined();
    expect(game.endReason).toBe('INSTANT_WIN_TIE');
    expect(game.instantWinTie).toEqual({ rank: 5, playerIds: ['p1', 'p2'] });
    expect(events.at(-1)).toEqual({
      type: 'game:instant_win_tie',
      payload: { rank: 5, playerIds: ['p1', 'p2'] },
    });
    // Les mains ne sont pas révélées par l'égalité.
    expect(JSON.stringify(events.filter((e) => !e.recipientId))).not.toMatch(/COEUR-9|PIQUE-8/);
  });

  it('3 joueurs, rangs 2, 5, 5 : le rang 2 est unique, il gagne automatiquement', () => {
    const game = waitingGame(['p1', 'p2', 'p3']);
    startGame(game, {
      ...ctx,
      random: decksRandom(deckForHands([RANK_5_A, RANK_2, RANK_5_B])),
    });
    expect(game.result).toMatchObject({ winnerId: 'p2', instantWinRank: 2, automatic: true });
  });
});

describe('Cycle de vie', () => {
  it('aucune action dans une partie en attente ou terminée', () => {
    expect(() => play(waitingGame(['p1', 'p2']), 'p1', 'COEUR-3')).toThrow(GameNotInProgressError);
    const { game } = startedGame(TWO_PLAYER_HANDS);
    game.status = 'finished';
    expect(() => play(game, 'p1', 'COEUR-3')).toThrow(GameNotInProgressError);
  });
});
