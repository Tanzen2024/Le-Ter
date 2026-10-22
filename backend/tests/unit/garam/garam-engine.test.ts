import type { Game } from '../../../src/domain/game/game';
import { toPlayerView } from '../../../src/domain/game/game-view';
import type { PlayerId } from '../../../src/domain/game/game-id';
import {
  createGaramDeck,
  GARAM_DECK_SIZE,
  parseGaramCardId,
  type GaramCardId,
} from '../../../src/domain/garam/garam-cards';
import {
  canDeclareGaramWin,
  completeGaramDeal,
  dealtSpecialOf,
  declareGaramWin,
  drawGaramCard,
  garamAutomaticCard,
  garamDealPhaseMs,
  garamDealSequence,
  garamPlayableCards,
  playGaramAutomatically,
  playGaramCard,
  startGaramGame,
  stakeVoteAccepted,
  stakeVoteComplete,
  voteGaramStake,
} from '../../../src/domain/garam/garam-engine';
import {
  GARAM_AUTO_DRAW_AFTER_FIRST_ROUND_MS,
  GARAM_AUTO_DRAW_STEP_MS,
  GARAM_AUTO_DECLARE_MS,
  GARAM_DISPLAYED_TURN_MS,
  GARAM_PASS_NOTICE_MS,
  GARAM_SPECIAL_PRIORITY,
  GARAM_TURN_DURATION_MS,
  GARAM_VARIANTS,
  isBelowGaramThreshold,
  type GaramPlay,
  type GaramVariant,
} from '../../../src/domain/garam/garam-rules';
import { TURN_DURATION_MS } from '../../../src/domain/rules/rule-set';
import { planGaramSettlement } from '../../../src/domain/rules/game-settlement';
import { NOW, waitingGame } from '../../fixtures/game-builders';
import { garamDecksRandom, seededRandom } from '../../fixtures/random';

const ctx = { now: NOW };

const garamDeckRandom = (deck: GaramCardId[]) => garamDecksRandom(deck);

function garamWaiting(names: string[], garamVariant: GaramVariant = 15): Game {
  return { ...waitingGame(names), gameType: 'GARAM', garamVariant, stakeAmount: 100 };
}

/** Démarre par la VRAIE distribution : mains (3 par joueur, ordre de la table) puis terre. */
function started(hands: GaramCardId[][], terre: GaramCardId[], variant: GaramVariant = 15): Game {
  const names = hands.map((_, i) => ['a', 'b', 'c', 'd'][i] as string);
  const game = garamWaiting(names, variant);
  startGaramGame(game, {
    ...ctx,
    random: garamDeckRandom([...hands.flat(), ...terre]),
    dealDurationMs: () => 0,
  });
  return game;
}

const A = 'a' as PlayerId;
const B = 'b' as PlayerId;
const C = 'c' as PlayerId;
const play = (g: Game) => g.garam as GaramPlay;

/** Le contrôleur ne peut rien tirer : il annonce « Je passe », son échéance clôt son tirage (D-140). */
function passControl(game: Game) {
  const controller = play(game).controllerId as PlayerId;
  expect(play(game).passing?.playerId).toBe(controller);
  return playGaramAutomatically(game, controller, ctx);
}

describe('paquet GARAM TIA (§2)', () => {
  it('35 cartes : cœur, trèfle, carreau 3-10 + As ; pique 3-10 sans As ; As = 11', () => {
    const deck = createGaramDeck();
    expect(deck).toHaveLength(GARAM_DECK_SIZE);
    expect(new Set(deck).size).toBe(35);
    expect(deck).toContain('CARREAU-11');
    expect(deck).not.toContain('PIQUE-11');
    expect(deck.filter((c) => c.startsWith('PIQUE'))).toHaveLength(8);
    expect(parseGaramCardId('COEUR-11').value).toBe(11);
    expect(() => parseGaramCardId('PIQUE-11')).toThrow();
    expect(() => parseGaramCardId('ETOILE-5')).toThrow();
  });
});

describe('distribution (§3.4)', () => {
  it.each([
    [2, 3],
    [3, 4],
    [4, 5],
  ])('%i joueurs : 3 cartes chacun, terre de %i cartes, sans remise', (n, terreSize) => {
    for (let seed = 1; seed < 40; seed++) {
      const game = garamWaiting(['a', 'b', 'c', 'd'].slice(0, n));
      startGaramGame(game, { ...ctx, random: seededRandom(seed), dealDurationMs: () => 0 });
      const p = play(game);
      expect(p.order).toEqual(['a', 'b', 'c', 'd'].slice(0, n));
      expect(p.dealerId).toBe('a'); // le créateur dégage en premier (§3.5)
      expect(Object.values(p.initialHands).every((h) => h.length === 3)).toBe(true);
      expect(p.terre).toHaveLength(terreSize);
      const all = [...Object.values(p.initialHands).flat(), ...p.terre, ...p.stock];
      expect(new Set(all).size).toBe(35);
    }
  });

  it('les mains adverses ne sont jamais dans la vue ; le terre est public', () => {
    const game = started(
      [
        ['COEUR-3', 'TREFLE-7', 'PIQUE-9'],
        ['CARREAU-4', 'COEUR-8', 'TREFLE-10'],
      ],
      ['PIQUE-5', 'COEUR-6', 'TREFLE-4'],
    );
    const view = toPlayerView(game, A);
    expect(view.gameType).toBe('GARAM');
    expect(view.garam?.myHand).toEqual(['COEUR-3', 'TREFLE-7', 'PIQUE-9']);
    expect(view.garam?.terre).toEqual(['PIQUE-5', 'COEUR-6', 'TREFLE-4']);
    expect(view.garam?.handCounts).toEqual({ a: 3, b: 3 });
    expect(JSON.stringify(view)).not.toContain('CARREAU-4');
    expect(view.play).toBeUndefined();
  });
});

describe('les 5 mains spéciales (D-130) : détection sur les 3 cartes reçues', () => {
  it.each([
    [['COEUR-7', 'TREFLE-7', 'PIQUE-7'], 'THREE_SEVENS'],
    [['COEUR-5', 'TREFLE-5', 'PIQUE-5'], 'THREE_OF_A_KIND'],
    [['COEUR-11', 'TREFLE-11', 'CARREAU-11'], 'THREE_OF_A_KIND'], // trois As : identiques
    [['COEUR-3', 'TREFLE-3', 'PIQUE-4'], 'SUM_TEN'], // seule somme 10 du paquet : 3 + 3 + 4
    [['COEUR-4', 'COEUR-8', 'COEUR-10'], 'SAME_SUIT'],
    [['TREFLE-7', 'PIQUE-8', 'CARREAU-6'], 'SUM_TWENTY_ONE'],
    [['COEUR-11', 'TREFLE-11', 'PIQUE-10'], undefined], // deux As : pas une main spéciale
    [['CARREAU-4', 'COEUR-8', 'TREFLE-10'], undefined],
  ] as [GaramCardId[], string | undefined][])('%j → %s', (cards, expected) => {
    expect(dealtSpecialOf(cards)).toBe(expected);
  });

  it('priorités définitives : 1 trois 7, 2 trois identiques ≠ 7, 3 somme 10, 4 même famille, 5 somme 21', () => {
    expect(GARAM_SPECIAL_PRIORITY).toEqual({
      THREE_SEVENS: 1,
      THREE_OF_A_KIND: 2,
      SUM_TEN: 3,
      SAME_SUIT: 4,
      SUM_TWENTY_ONE: 5,
    });
    // Trois 7 restent priorité 1, jamais « trois identiques ».
    expect(dealtSpecialOf(['COEUR-7', 'TREFLE-7', 'CARREAU-7'])).toBe('THREE_SEVENS');
    // Même famille ET somme 21 : la meilleure priorité (4).
    expect(dealtSpecialOf(['COEUR-11', 'COEUR-4', 'COEUR-6'])).toBe('SAME_SUIT');
  });
});

describe('une seule main spéciale : déclarée AUTOMATIQUEMENT par le serveur (D-137)', () => {
  const plain: GaramCardId[] = ['PIQUE-5', 'COEUR-6', 'TREFLE-4'];
  const sevens = () =>
    started(
      [
        ['COEUR-7', 'TREFLE-7', 'PIQUE-7'],
        ['CARREAU-4', 'COEUR-8', 'TREFLE-10'],
      ],
      plain,
    );

  it('G1 : en attente après la distribution (court délai, annonce publique, aucun bouton), puis déclarée par le serveur à l’échéance', () => {
    const game = sevens();
    expect(game.status).toBe('in_progress');
    // Échéance = délai de la déclaration automatique, pas un tour de 15 s.
    expect(game.turnDeadlineAt!.getTime() - NOW.getTime()).toBe(GARAM_AUTO_DECLARE_MS);
    for (const viewer of [A, B]) {
      const view = toPlayerView(game, viewer);
      expect(view.garam?.specialPending).toBe(true);
      expect(view.myActions.canDeclareInstantWin).toBe(false); // plus de bouton
      expect(view.myActions.canPlayCard).toBe(false);
      expect(view.myActions.playableCardIds).toEqual([]);
    }
    expect(toPlayerView(game, A).garam?.mySpecial).toBe('THREE_SEVENS');
    expect(JSON.stringify(toPlayerView(game, B))).not.toContain('THREE_SEVENS');
    // L'échéance : le serveur déclare pour le détenteur (même opération que la déclaration).
    const events = playGaramAutomatically(game, A, ctx);
    expect(game.result).toMatchObject({
      winnerId: A,
      method: 'GARAM_AUTOMATIC_WIN',
      garamCondition: 'THREE_SEVENS',
      automatic: true,
    });
    expect(events.map((e) => e.type)).toEqual(['game:finished']);
    expect(toPlayerView(game, B).garam?.specialPending).toBeUndefined();
  });

  it('G4/G5 : une seule exécution : une seconde déclaration (serveur ou joueur) est refusée', () => {
    const game = sevens();
    playGaramAutomatically(game, A, ctx);
    const result = structuredClone(game.result);
    expect(() => playGaramAutomatically(game, A, ctx)).toThrow();
    expect(() => declareGaramWin(game, A, ctx)).toThrow();
    expect(game.result).toEqual(result);
  });

  it('G6 : un autre joueur ne peut pas la déclarer', () => {
    const game = sevens();
    expect(() => declareGaramWin(game, B, ctx)).toThrow(/Main non gagnante/);
    expect(game.status).toBe('in_progress');
  });

  it('même avant son tour (somme 10 d’un non-dégageur)', () => {
    const game = started(
      [
        ['CARREAU-4', 'COEUR-8', 'TREFLE-10'],
        ['COEUR-3', 'TREFLE-3', 'PIQUE-4'],
      ],
      ['PIQUE-5', 'COEUR-6', 'TREFLE-5'],
    );
    // L'échéance porte le tour du dégageur (a), mais c'est la main de b qui est déclarée.
    playGaramAutomatically(game, A, ctx);
    expect(game.result).toMatchObject({ winnerId: B, garamCondition: 'SUM_TEN', automatic: true });
  });

  it('aucune carte avant la déclaration : le détenteur ne peut plus « jouer pour le Koraté »', () => {
    const game = sevens();
    expect(canDeclareGaramWin(game, A)).toBe(true);
    expect(garamPlayableCards(game, A)).toEqual([]);
    expect(() => playGaramCard(game, A, 'COEUR-7', ctx)).toThrow(/main spéciale/);
    expect(play(game).firstCards).toEqual([]);
    expect(game.status).toBe('in_progress');
  });

  it('G2 : sans main spéciale : tour normal de 15 s, aucune annonce, la manche continue', () => {
    const game = started(
      [
        ['CARREAU-4', 'COEUR-8', 'TREFLE-10'],
        ['COEUR-3', 'TREFLE-5', 'PIQUE-9'],
      ],
      plain,
    );
    expect(game.turnDeadlineAt!.getTime() - NOW.getTime()).toBe(GARAM_TURN_DURATION_MS);
    expect(toPlayerView(game, A).garam?.specialPending).toBeUndefined();
    playGaramAutomatically(game, A, ctx); // Katika : une carte, jamais de déclaration
    expect(game.status).toBe('in_progress');
    expect(play(game).firstCards).toHaveLength(1);
  });

  it('après une distribution présentée : l’attente commence à la fin de la distribution', () => {
    const game = garamWaiting(['a', 'b']);
    startGaramGame(game, {
      ...ctx,
      random: garamDeckRandom([
        'COEUR-7', 'TREFLE-7', 'PIQUE-7', 'CARREAU-4', 'COEUR-8', 'TREFLE-10', ...plain,
      ]),
      dealDurationMs: () => 5_000,
    });
    expect(game.turnDeadlineAt).toBeUndefined(); // distribution : aucune échéance de tour
    const end = new Date(NOW.getTime() + 5_000);
    const events = completeGaramDeal(game, { now: end }) ?? [];
    expect(events[0]?.payload).toMatchObject({ specialPending: true });
    expect(game.turnDeadlineAt!.getTime() - end.getTime()).toBe(GARAM_AUTO_DECLARE_MS);
  });

  it('l’ancienne règle « terre de même famille » n’existe plus', () => {
    const game = started(
      [
        ['CARREAU-4', 'COEUR-8', 'TREFLE-10'],
        ['COEUR-3', 'TREFLE-5', 'PIQUE-9'],
      ],
      ['PIQUE-5', 'PIQUE-6', 'PIQUE-4'],
    );
    expect(game.status).toBe('in_progress');
    expect(toPlayerView(game, A).myActions.canDeclareInstantWin).toBe(false);
  });
});

describe('plusieurs mains spéciales : arbitrage AUTOMATIQUE par priorité (D-130)', () => {
  const terre: GaramCardId[] = ['PIQUE-10', 'COEUR-9', 'TREFLE-9'];
  const arbitrated = (hands: GaramCardId[][], t: GaramCardId[] = terre) => started(hands, t);

  it('trois 7 contre trois 5 : trois 7 (1 > 2), sans attendre les tours', () => {
    const game = arbitrated([
      ['COEUR-5', 'TREFLE-5', 'PIQUE-5'],
      ['COEUR-7', 'TREFLE-7', 'PIQUE-7'],
    ]);
    expect(game.result).toMatchObject({ winnerId: B, garamCondition: 'THREE_SEVENS', automatic: true });
  });

  it('trois 7, trois 5, rien : trois 7', () => {
    const game = arbitrated([
      ['COEUR-7', 'TREFLE-7', 'PIQUE-7'],
      ['COEUR-5', 'TREFLE-5', 'PIQUE-5'],
      ['CARREAU-4', 'COEUR-8', 'TREFLE-10'],
    ], ['PIQUE-10', 'COEUR-9', 'TREFLE-9', 'CARREAU-9']);
    expect(game.result).toMatchObject({ winnerId: A, garamCondition: 'THREE_SEVENS' });
  });

  it('trois 5 (2), somme 10 (3), somme 21 (5) : trois 5', () => {
    const game = arbitrated([
      ['COEUR-5', 'TREFLE-5', 'PIQUE-5'],
      ['COEUR-3', 'TREFLE-3', 'PIQUE-4'],
      ['TREFLE-7', 'PIQUE-8', 'CARREAU-6'],
    ], ['PIQUE-10', 'COEUR-9', 'TREFLE-9', 'CARREAU-9']);
    expect(game.result).toMatchObject({ winnerId: A, garamCondition: 'THREE_OF_A_KIND' });
  });

  it('somme 10 (3) contre somme 21 (5) : somme 10, même si 21 est plus élevé', () => {
    const game = arbitrated([
      ['COEUR-3', 'TREFLE-3', 'PIQUE-4'],
      ['TREFLE-7', 'PIQUE-8', 'CARREAU-6'],
    ]);
    expect(game.result).toMatchObject({ winnerId: A, garamCondition: 'SUM_TEN' });
  });

  it('même famille (4) contre somme 21 (5) : même famille', () => {
    const game = arbitrated([
      ['COEUR-4', 'COEUR-8', 'COEUR-10'],
      ['TREFLE-7', 'PIQUE-8', 'CARREAU-6'],
    ]);
    expect(game.result).toMatchObject({ winnerId: A, garamCondition: 'SAME_SUIT' });
  });

  it('somme 10 contre deux As : les deux As ne concourent pas ; la somme 10 reste à déclarer', () => {
    const game = arbitrated([
      ['COEUR-11', 'TREFLE-11', 'PIQUE-10'],
      ['COEUR-3', 'TREFLE-3', 'PIQUE-4'],
    ], ['PIQUE-9', 'COEUR-9', 'TREFLE-9']);
    expect(game.status).toBe('in_progress');
    expect(canDeclareGaramWin(game, A)).toBe(false);
    declareGaramWin(game, B, ctx);
    expect(game.result).toMatchObject({ winnerId: B, garamCondition: 'SUM_TEN', automatic: false });
  });

  it('priorités 3, 5 et 4 : la 3', () => {
    const game = arbitrated([
      ['COEUR-3', 'TREFLE-3', 'PIQUE-4'],
      ['TREFLE-7', 'PIQUE-8', 'CARREAU-6'],
      ['COEUR-4', 'COEUR-8', 'COEUR-10'],
    ], ['PIQUE-10', 'COEUR-9', 'TREFLE-9', 'CARREAU-9']);
    expect(game.result).toMatchObject({ winnerId: A, garamCondition: 'SUM_TEN' });
  });
});

describe('égalité de priorité : manche nulle, AUCUN départage (D-130)', () => {
  it.each([
    [
      'trois identiques',
      [
        ['COEUR-5', 'TREFLE-5', 'PIQUE-5'],
        ['COEUR-9', 'TREFLE-9', 'PIQUE-9'],
      ],
      'THREE_OF_A_KIND',
    ],
    [
      'somme 10',
      [
        ['COEUR-3', 'TREFLE-3', 'PIQUE-4'],
        ['CARREAU-3', 'PIQUE-3', 'COEUR-4'],
      ],
      'SUM_TEN',
    ],
    [
      'même famille',
      [
        ['COEUR-4', 'COEUR-8', 'COEUR-10'],
        ['TREFLE-4', 'TREFLE-8', 'TREFLE-10'],
      ],
      'SAME_SUIT',
    ],
    [
      'somme 21',
      [
        ['TREFLE-7', 'PIQUE-8', 'CARREAU-6'],
        ['COEUR-7', 'CARREAU-8', 'TREFLE-6'],
      ],
      'SUM_TWENTY_ONE',
    ],
  ] as [string, GaramCardId[][], string][])('%s contre %s : manche nulle', (_, hands, condition) => {
    const game = started(hands, ['PIQUE-10', 'COEUR-11', 'TREFLE-11']);
    expect(game.endReason).toBe('GARAM_TIE');
    expect(game.result).toBeUndefined();
    expect(game.garamTie).toMatchObject({ kind: 'SPECIAL', condition, playerIds: [A, B] });
    // Mains reçues révélées avec l'égalité.
    expect(game.garamTie?.hands?.[A]).toEqual(hands[0]);
  });

  it('trois joueurs de même priorité : manche nulle', () => {
    const game = started(
      [
        ['COEUR-5', 'TREFLE-5', 'PIQUE-5'],
        ['COEUR-9', 'TREFLE-9', 'PIQUE-9'],
        ['COEUR-6', 'TREFLE-6', 'PIQUE-6'],
      ],
      ['PIQUE-10', 'COEUR-11', 'TREFLE-11', 'CARREAU-8'],
    );
    expect(game.garamTie).toMatchObject({ kind: 'SPECIAL', playerIds: [A, B, C] });
  });

  it('égalité à la meilleure priorité, une main inférieure à côté : manche nulle quand même', () => {
    const game = started(
      [
        ['COEUR-5', 'TREFLE-5', 'PIQUE-5'],
        ['COEUR-9', 'TREFLE-9', 'PIQUE-9'],
        ['COEUR-3', 'TREFLE-3', 'PIQUE-4'],
      ],
      ['PIQUE-10', 'COEUR-11', 'TREFLE-11', 'CARREAU-8'],
    );
    expect(game.garamTie).toMatchObject({ kind: 'SPECIAL', playerIds: [A, B] });
  });
});

describe('deux As gardés : PAS une main spéciale ; à la fin normale, ils battent tout total (D-130)', () => {
  /** a garde ♥As ♣As (dégage son ♠10) ; b (5 + 8 = 13, pas de pique) tire ensuite au terre. */
  const twoAces = (terre: GaramCardId[]) => {
    const game = started(
      [
        ['COEUR-11', 'TREFLE-11', 'PIQUE-10'],
        ['COEUR-5', 'CARREAU-8', 'TREFLE-10'],
      ],
      terre,
    );
    playGaramCard(game, A, 'PIQUE-10', ctx);
    return game;
  };

  it('rien à déclarer : ni à la distribution, ni à son tour ; le Katika ne déclare jamais', () => {
    const game = twoAces(['PIQUE-5', 'COEUR-6', 'TREFLE-4']);
    expect(canDeclareGaramWin(game, A)).toBe(false);
    expect(toPlayerView(game, A).garam?.mySpecial).toBeUndefined();
    playGaramCard(game, B, 'TREFLE-10', ctx);
    // Contrôle à a (seul pique) ; 22 : rien à tirer, il annonce « Je passe » (D-140), puis son
    // tirage est clos à l'échéance.
    expect(play(game)).toMatchObject({ phase: 'DRAW', nextPlayerId: A });
    passControl(game);
    expect(play(game)).toMatchObject({ phase: 'DRAW', nextPlayerId: B });
    expect(play(game).drawDone).toContain(A);
    expect(() => declareGaramWin(game, A, ctx)).toThrow(/Main non gagnante/);
  });

  it('fin normale : 22 bat même un 21 ; pas de main spéciale déclarée', () => {
    const game = twoAces(['PIQUE-8', 'COEUR-6', 'TREFLE-4']);
    playGaramCard(game, B, 'TREFLE-10', ctx);
    passControl(game);
    drawGaramCard(game, B, ctx); // b : 13 + 8 = 21 ; puis ♥6 → 27 : Impossible
    expect(game.result).toMatchObject({
      winnerId: A,
      method: 'GARAM_BEST_SCORE',
      scores: { a: 22, b: 21 },
      belowThresholdIds: [],
    });
    expect(game.result?.garamCondition).toBeUndefined();
  });

  it('les autres perdants restent soumis au Koraté', () => {
    const game = twoAces(['PIQUE-9', 'COEUR-10', 'TREFLE-4']);
    playGaramCard(game, B, 'TREFLE-10', ctx);
    passControl(game); // b : 13 ; ♠9 → 22 : Impossible, fin
    expect(game.result).toMatchObject({
      winnerId: A,
      scores: { a: 22, b: 13 },
      belowThresholdIds: [B],
      penaltyThreshold: 15,
    });
  });

  it('un seul As gardé (l’autre joué au 1er tour) : total normal', () => {
    const game = started(
      [
        ['COEUR-11', 'TREFLE-11', 'PIQUE-10'],
        ['COEUR-5', 'CARREAU-8', 'TREFLE-10'],
      ],
      ['PIQUE-5', 'COEUR-6', 'TREFLE-4'],
    );
    playGaramCard(game, A, 'COEUR-11', ctx);
    playGaramCard(game, B, 'COEUR-5', ctx);
    // a (♣As + ♠10 = 21) contrôle : il ne peut rien tirer ; b : 18 + 5 = 23 → Impossible.
    passControl(game);
    expect(game.result).toMatchObject({ winnerId: A, scores: { a: 21, b: 18 } });
  });
});

describe('Koraté (D-130) : somme finale STRICTEMENT inférieure à X', () => {
  it.each([
    [15, 14, true],
    [15, 15, false],
    [15, 16, false],
    [16, 15, true],
    [17, 16, true],
    [18, 17, true],
  ] as [GaramVariant, number, boolean][])('GARAM %i, somme %i : Koraté = %s', (x, total, korate) => {
    expect(isBelowGaramThreshold(total, x)).toBe(korate);
  });

  it('mise 250 : pénalité = 250 (perte 500) au gagnant ; UNE commission, sur les 500', () => {
    const plan = planGaramSettlement({
      stake: 250,
      commissionBps: 1_000, // barème de la plateforme (exemple : 10 %)
      winnerId: A,
      participants: [A, B],
      belowThresholdIds: [B],
    });
    expect(plan.lossOf).toEqual({ b: 500 });
    expect(plan.penaltyAmount).toBe(250);
    expect(plan.grossAmount).toBe(250); // mises seules (contrainte game_settlements)
    expect(plan.commissionAmount).toBe(50);
    expect(plan.netGain).toBe(450);
    // Cohérence : mises + pénalités = gain net + commission (rien créé, rien perdu).
    expect(plan.grossAmount + plan.penaltyAmount).toBe(plan.netGain + plan.commissionAmount);
  });
});

/** Manche à 3 joueurs sans condition spéciale. */
function threePlayers(terre: GaramCardId[] = ['PIQUE-5', 'COEUR-6', 'TREFLE-4', 'CARREAU-3']) {
  return started(
    [
      ['COEUR-9', 'TREFLE-7', 'PIQUE-10'], // a : dégageur
      ['COEUR-5', 'CARREAU-8', 'TREFLE-10'], // b
      ['TREFLE-8', 'PIQUE-9', 'CARREAU-10'], // c : pas de cœur
    ],
    terre,
  );
}

describe('premier tour (§3.5-3.7)', () => {
  it('le dégageur joue en premier, puis sens antihoraire ; même signe obligatoire', () => {
    const game = threePlayers();
    expect(garamPlayableCards(game, A)).toHaveLength(3);
    expect(() => playGaramCard(game, B, 'COEUR-5', ctx)).toThrow(/pas au tour/);
    playGaramCard(game, A, 'COEUR-9', ctx);
    expect(play(game).leadSuit).toBe('COEUR');
    expect(play(game).nextPlayerId).toBe(B);
    expect(garamPlayableCards(game, B)).toEqual(['COEUR-5']);
    expect(() => playGaramCard(game, B, 'TREFLE-10', ctx)).toThrow(/non jouable/);
    expect(() => playGaramCard(game, B, 'COEUR-11', ctx)).toThrow(/n'est pas dans la main/);
    playGaramCard(game, B, 'COEUR-5', ctx);
    // c n'a pas de cœur : carte libre.
    expect(garamPlayableCards(game, C)).toHaveLength(3);
  });

  it('la plus grande carte du signe dégagé prend le contrôle et tire en premier', () => {
    const game = threePlayers(['TREFLE-4', 'PIQUE-5', 'CARREAU-3', 'COEUR-6']);
    playGaramCard(game, A, 'COEUR-9', ctx);
    playGaramCard(game, B, 'COEUR-5', ctx);
    playGaramCard(game, C, 'CARREAU-10', ctx); // plus forte, mais pas du signe dégagé
    expect(play(game).controllerId).toBe(A);
    expect(play(game).phase).toBe('DRAW');
    expect(play(game).drawOrder).toEqual([A, B, C]);
    expect(play(game).nextPlayerId).toBe(A);
  });
});

describe('tirage (§3.8-3.10) et fin normale (§3.14)', () => {
  it('tirage à la tête, une carte à la fois, jamais au-delà de 21, « Impossible » puis reprise', () => {
    // a garde T7 + P10 = 17 ; b garde C8 + T10 = 18 ; c garde P9 + C10 = 19.
    const game = threePlayers(['TREFLE-4', 'PIQUE-5', 'CARREAU-3', 'COEUR-6']);
    playGaramCard(game, A, 'COEUR-9', ctx);
    playGaramCard(game, B, 'COEUR-5', ctx);
    playGaramCard(game, C, 'TREFLE-8', ctx);
    expect(() => playGaramCard(game, A, 'TREFLE-7', ctx)).toThrow(/premier tour est terminé/);
    expect(() => drawGaramCard(game, B, ctx)).toThrow(/pas au tour/);
    drawGaramCard(game, A, ctx); // a : 17 + 4 = 21 ; tête suivante P5 → « Impossible »
    expect(play(game).drawn[A]).toEqual(['TREFLE-4']);
    expect(play(game).drawDone).toEqual([A, B, C]);
    expect(play(game).drawn).toEqual({ a: ['TREFLE-4'], b: [], c: [] });
    expect(play(game).lastRefusal).toEqual({ playerId: C, cardId: 'PIQUE-5' });
    // b reprend à la carte refusée : 18 + 5 = 23 > 21 → Impossible aussitôt, sans tirer.
    // c : 19 + 5 > 21 → Impossible. Fin de manche.
    expect(play(game).terre).toEqual(['PIQUE-5', 'CARREAU-3', 'COEUR-6']);
    expect(game.status).toBe('finished');
    expect(game.result).toMatchObject({
      winnerId: A,
      method: 'GARAM_BEST_SCORE',
      scores: { a: 21, b: 18, c: 19 },
      belowThresholdIds: [],
      penaltyThreshold: 15,
    });
  });

  it('terre vide : le joueur ne tire rien, son score est celui de ses cartes', () => {
    const game = started(
      [
        ['COEUR-3', 'TREFLE-4', 'PIQUE-5'], // a garde 9
        ['COEUR-4', 'CARREAU-5', 'TREFLE-6'], // b garde 11
      ],
      ['PIQUE-6', 'COEUR-5', 'TREFLE-3'],
    );
    playGaramCard(game, A, 'COEUR-3', ctx);
    playGaramCard(game, B, 'COEUR-4', ctx);
    expect(play(game).controllerId).toBe(B); // 4 > 3 : b tire en premier
    drawGaramCard(game, B, ctx); // 11 + 6 = 17 ; C5 ferait 22 → Impossible
    expect(play(game).drawDone).toEqual([B]);
    expect(play(game).nextPlayerId).toBe(A);
    drawGaramCard(game, A, ctx); // 9 + 5 = 14
    drawGaramCard(game, A, ctx); // 14 + 3 = 17 ; terre vide : fin
    expect(play(game).terre).toEqual([]);
    expect(play(game).lastRefusal).toEqual({ playerId: A });
    expect(game.garamTie).toMatchObject({ kind: 'SCORE', scores: { a: 17, b: 17 } });
  });

  it('contrôleur qui ne peut rien tirer : « Je passe » annoncé à la table, puis main au suivant (D-140)', () => {
    // a garde T10 + CA10 = 20 et contrôle ; tête P3 → 23 : rien à tirer. b garde 9.
    const game = started(
      [
        ['COEUR-9', 'TREFLE-10', 'CARREAU-10'],
        ['COEUR-3', 'CARREAU-4', 'TREFLE-5'],
      ],
      ['PIQUE-3', 'CARREAU-5', 'TREFLE-7'],
    );
    playGaramCard(game, A, 'COEUR-9', ctx);
    const events = playGaramCard(game, B, 'COEUR-3', ctx);
    // Le tour du contrôleur reste ouvert : annonce publique, aucune carte prise, b attend.
    expect(events.map((e) => e.type)).toContain('game:player_passed');
    expect(events.find((e) => e.type === 'game:player_passed')?.payload).toEqual({
      playerId: A,
      cardId: 'PIQUE-3',
    });
    expect(play(game)).toMatchObject({ nextPlayerId: A, drawDone: [], passing: { playerId: A } });
    expect(game.turnDeadlineAt).toEqual(
      new Date(NOW.getTime() + GARAM_AUTO_DRAW_AFTER_FIRST_ROUND_MS + GARAM_PASS_NOTICE_MS),
    );
    expect(toPlayerView(game, B).garam).toMatchObject({ passingPlayerId: A, canDraw: false });
    expect(() => drawGaramCard(game, A, ctx)).toThrow(/aucune carte ne peut être tirée/);
    expect(() => playGaramAutomatically(game, B, ctx)).toThrow(/pas au tour/);
    // Échéance : tirage du contrôleur clos (« Je passe », pas « Impossible »), main à b.
    const after = passControl(game);
    expect(after[0]).toMatchObject({
      type: 'game:draw_impossible',
      payload: { playerId: A, passed: true, drawnCount: 0 },
    });
    expect(play(game)).toMatchObject({ nextPlayerId: B, drawDone: [A] });
    expect(play(game).passing).toBeUndefined();
    expect(play(game).lastRefusal).toEqual({ playerId: A, cardId: 'PIQUE-3', passed: true });
    expect(play(game).terre[0]).toBe('PIQUE-3');
    expect(toPlayerView(game, B).garam?.passingPlayerId).toBeUndefined();
  });

  it('égalité au plus grand total : manche nulle avec révélation (§3.15)', () => {
    const game = started(
      [
        ['COEUR-5', 'TREFLE-8', 'PIQUE-10'], // a garde 18
        ['COEUR-4', 'CARREAU-8', 'TREFLE-10'], // b garde 18
      ],
      ['PIQUE-9', 'COEUR-10', 'TREFLE-9'],
    );
    playGaramCard(game, A, 'COEUR-5', ctx);
    playGaramCard(game, B, 'COEUR-4', ctx);
    passControl(game);
    expect(game.endReason).toBe('GARAM_TIE');
    expect(game.garamTie).toMatchObject({ kind: 'SCORE', playerIds: [A, B] });
  });

  it('règle « moins de 15 » : chaque perdant sous 15 est noté (fin normale)', () => {
    const game = started(
      [
        ['COEUR-9', 'TREFLE-10', 'PIQUE-10'], // a garde 20
        ['COEUR-3', 'CARREAU-4', 'TREFLE-5'], // b garde 9
      ],
      ['PIQUE-3', 'CARREAU-11', 'TREFLE-7'],
    );
    playGaramCard(game, A, 'COEUR-9', ctx);
    playGaramCard(game, B, 'COEUR-3', ctx); // a contrôle ; 20 + 3 > 21 : « Je passe »
    passControl(game);
    drawGaramCard(game, B, ctx); // 9 + 3 = 12 ; As (11) ferait 23 → Impossible
    expect(game.result).toMatchObject({
      winnerId: A,
      scores: { a: 20, b: 12 },
      belowThresholdIds: [B],
      penaltyThreshold: 15,
    });
  });
});

describe('action automatique du Katika après l’échéance (§3.11, §7.11, D-127)', () => {
  it('premier tour : la carte LÉGALE la plus basse, déterministe ; même signe obligatoire', () => {
    const game = threePlayers(['TREFLE-4', 'PIQUE-5', 'CARREAU-3', 'COEUR-6']);
    // Dégageur (toutes ses cartes jouables) : la plus basse, T7.
    expect(garamAutomaticCard(game, A)).toBe('TREFLE-7');
    playGaramCard(game, A, 'COEUR-9', ctx);
    // b a un cœur : seule carte légale, même si T10 / CA8 sont dans sa main.
    playGaramAutomatically(game, B, ctx);
    expect(play(game).firstCards[1]).toEqual({ playerId: B, cardId: 'COEUR-5' });
    // c n'a pas de cœur : la plus basse de sa main (T8 < P9 < CA10).
    expect(garamAutomaticCard(game, C)).toBe('TREFLE-8');
    const events = playGaramAutomatically(game, C, ctx);
    expect(events[0]).toMatchObject({ payload: { cardId: 'TREFLE-8', automatic: true } });
  });

  it('même situation, même carte : jamais de hasard', () => {
    const picks = new Set(
      Array.from({ length: 5 }, () => {
        const game = threePlayers();
        playGaramCard(game, A, 'COEUR-9', ctx);
        playGaramCard(game, B, 'COEUR-5', ctx);
        return garamAutomaticCard(game, C);
      }),
    );
    expect([...picks]).toEqual(['TREFLE-8']);
  });

  it('tirage : UNE carte par échéance, dans la limite de 21, par le moteur (même validation)', () => {
    // a garde T7 + P10 = 17 ; terre T3 puis P4 : 17 + 3 = 20, puis 4 ferait 24.
    const game = threePlayers(['TREFLE-3', 'PIQUE-4', 'CARREAU-3', 'COEUR-6']);
    playGaramCard(game, A, 'COEUR-9', ctx);
    playGaramCard(game, B, 'COEUR-5', ctx);
    playGaramCard(game, C, 'TREFLE-8', ctx);
    const events = playGaramAutomatically(game, A, ctx);
    const drawn = events.filter((e) => e.type === 'game:card_drawn');
    expect(drawn).toHaveLength(1);
    expect(drawn[0]).toMatchObject({ payload: { cardId: 'TREFLE-3', automatic: true } });
    expect(play(game).drawn[A]).toEqual(['TREFLE-3']);
    // 20 + 4 > 21 : tour de a clos par le moteur, la carte reste au terre (b la reprend).
    expect(play(game).drawDone).toContain(A);
    expect(play(game).drawn[A]).not.toContain('PIQUE-4');
  });

  it('tirage resté ouvert : prochaine carte après le délai du tirage automatique (D-136)', () => {
    // a garde T4 + P3 = 7 ; b garde CA8 + T10 = 18 ; terre T3, P5, CA4.
    const game = started(
      [
        ['COEUR-9', 'TREFLE-4', 'PIQUE-3'],
        ['COEUR-5', 'CARREAU-8', 'TREFLE-10'],
      ],
      ['TREFLE-3', 'PIQUE-5', 'CARREAU-4'],
    );
    playGaramCard(game, A, 'COEUR-9', ctx);
    playGaramCard(game, B, 'COEUR-5', ctx);
    const later = new Date(NOW.getTime() + 20_000);
    playGaramAutomatically(game, A, { now: later }); // 7 + 3 = 10
    expect(play(game).drawn[A]).toEqual(['TREFLE-3']);
    expect(play(game).nextPlayerId).toBe(A);
    expect(game.turnDeadlineAt).toEqual(new Date(later.getTime() + GARAM_AUTO_DRAW_STEP_MS));
    playGaramAutomatically(game, A, { now: later }); // 10 + 5 = 15
    expect(play(game).drawn[A]).toEqual(['TREFLE-3', 'PIQUE-5']);
  });
});

describe('variantes GARAM 15 / 16 / 17 / 18 (D-127)', () => {
  it('quatre variantes, seuil STRICTEMENT inférieur', () => {
    expect(GARAM_VARIANTS).toEqual([15, 16, 17, 18]);
    for (const v of GARAM_VARIANTS) {
      expect(isBelowGaramThreshold(v - 1, v)).toBe(true);
      expect(isBelowGaramThreshold(v, v)).toBe(false);
      expect(isBelowGaramThreshold(v + 1, v)).toBe(false);
    }
  });

  /**
   * a garde 20 et gagne ; b dégage un petit cœur puis garde P10 + T(total − 10). Terre d'As :
   * personne ne peut tirer (tout total + 11 > 21) : « Je passe » du contrôleur, puis fin normale.
   */
  function finishedWith(variant: GaramVariant, bKeeps: number): Game {
    const game = started(
      [
        ['COEUR-9', 'TREFLE-10', 'CARREAU-10'],
        ['COEUR-8', 'PIQUE-10', `TREFLE-${bKeeps - 10}` as GaramCardId],
      ],
      ['CARREAU-11', 'TREFLE-11', 'COEUR-11'],
      variant,
    );
    playGaramCard(game, A, 'COEUR-9', ctx);
    playGaramCard(game, B, 'COEUR-8', ctx);
    passControl(game);
    return game;
  }

  it.each(GARAM_VARIANTS)('GARAM %i : perdant à X − 1 pénalisé, à X non pénalisé', (variant) => {
    const below = finishedWith(variant, variant - 1);
    expect(below.result).toMatchObject({
      winnerId: A,
      scores: { b: variant - 1 },
      belowThresholdIds: [B],
      penaltyThreshold: variant,
    });
    const at = finishedWith(variant, variant);
    expect(at.result).toMatchObject({
      winnerId: A,
      scores: { b: variant },
      belowThresholdIds: [],
      penaltyThreshold: variant,
    });
  });

  it('la variante ne change jamais le gagnant ni la limite de 21', () => {
    for (const variant of GARAM_VARIANTS) {
      const game = finishedWith(variant, 14);
      expect(game.result?.winnerId).toBe(A);
      expect(Object.values(game.result?.scores ?? {}).every((t) => t <= 21)).toBe(true);
    }
  });

  it('manche GARAM sans variante valide : démarrage refusé, aucune valeur implicite', () => {
    for (const bad of [undefined, 14, 19, 0, '15']) {
      const game = { ...garamWaiting(['a', 'b']), garamVariant: bad as GaramVariant | undefined };
      expect(() =>
        startGaramGame(game, { ...ctx, random: seededRandom(1), dealDurationMs: () => 0 }),
      ).toThrow(/Variante GARAM TIA invalide/);
      expect(game.status).toBe('waiting');
    }
  });
});

describe('distribution présentée (D-102)', () => {
  it('aucune action avant la confirmation de la distribution', () => {
    const game = garamWaiting(['a', 'b']);
    startGaramGame(game, {
      ...ctx,
      random: garamDeckRandom(['COEUR-9', 'TREFLE-7', 'PIQUE-10', 'COEUR-5', 'CARREAU-8', 'TREFLE-10', 'PIQUE-5', 'COEUR-6', 'TREFLE-4']),
    });
    expect(game.dealEndsAt).toBeDefined();
    expect(() => playGaramCard(game, A, 'COEUR-9', ctx)).toThrow(/distribution/);
    completeGaramDeal(game, ctx);
    expect(game.turnDeadlineAt).toBeDefined();
    playGaramCard(game, A, 'COEUR-9', ctx);
  });
});

describe('présentation de la distribution (D-123)', () => {
  it.each([
    [2, 3],
    [3, 4],
    [4, 5],
  ])('%i joueurs : 2 cartes ensemble puis la 3e, ordre de la table, terre de %i cartes', (n, terreSize) => {
    const order = (['a', 'b', 'c', 'd'] as PlayerId[]).slice(0, n);
    const sequence = garamDealSequence(order);
    expect(sequence.map((b) => `${b.pass}:${b.playerId}×${b.count}`)).toEqual([
      ...order.map((id) => `1:${id}×2`),
      ...order.map((id) => `2:${id}×1`),
    ]);
    const game = garamWaiting(order);
    startGaramGame(game, { ...ctx, random: seededRandom(n), dealDurationMs: () => 0 });
    expect(Object.values(play(game).hands).map((h) => h.length)).toEqual(order.map(() => 3));
    expect(play(game).terre).toHaveLength(terreSize);
  });

  it('phase serveur = calendrier visuel (600 ms entre joueurs et passages, terre 700 ms) + pose + marge', () => {
    // Dernier lot des mains : 250 + 2 × (n − 1) × 600 + 600 ; terre : + 700, puis 700 par
    // carte ; fin : + 510 (pose) + 500 (marge de réception), comme le Ter (D-102).
    expect(garamDealPhaseMs(2, 3)).toBe(5_160);
    expect(garamDealPhaseMs(3, 4)).toBe(7_060);
    expect(garamDealPhaseMs(4, 5)).toBe(8_960);
    expect(garamDealPhaseMs(2, 3) - garamDealPhaseMs(2, 2)).toBe(700);
  });

  it('production : la phase de distribution est persistée, aucun tour avant sa confirmation', () => {
    const game = garamWaiting(['a', 'b', 'c']);
    startGaramGame(game, {
      ...ctx,
      random: garamDeckRandom([
        'COEUR-9', 'TREFLE-7', 'PIQUE-10',
        'COEUR-5', 'CARREAU-8', 'TREFLE-10',
        'CARREAU-9', 'PIQUE-8', 'COEUR-10',
        'TREFLE-4', 'PIQUE-5', 'CARREAU-3', 'COEUR-6',
      ]),
    });
    expect(game.dealEndsAt).toEqual(new Date(NOW.getTime() + garamDealPhaseMs(3, 4)));
    expect(game.turnDeadlineAt).toBeUndefined();
    const confirmedAt = game.dealEndsAt as Date;
    completeGaramDeal(game, { now: confirmedAt });
    expect(game.turnStartedAt).toEqual(confirmedAt);
    // 15 s affichées + 3 s de marge invisible (D-127) ; le temps de Fap-Fap est inchangé.
    expect(game.turnDeadlineAt!.getTime() - confirmedAt.getTime()).toBe(GARAM_TURN_DURATION_MS);
    expect(GARAM_TURN_DURATION_MS - GARAM_DISPLAYED_TURN_MS).toBe(3_000);
    expect(GARAM_DISPLAYED_TURN_MS).toBe(15_000);
    expect(TURN_DURATION_MS).toBe(13_000);
  });
});

describe('proposition de doubler la mise (§3.15)', () => {
  const voting = () => {
    const game = garamWaiting(['a', 'b']);
    game.garamStakeVote = {
      previousStake: 100,
      proposedStake: 200,
      deadlineAt: new Date(NOW.getTime() + 10_000),
      votes: {},
    };
    return game;
  };

  it('doublée seulement si TOUS répondent oui', () => {
    const game = voting();
    voteGaramStake(game, A, true, NOW);
    expect(stakeVoteComplete(game)).toBe(false);
    voteGaramStake(game, B, true, NOW);
    expect(stakeVoteComplete(game)).toBe(true);
    expect(stakeVoteAccepted(game)).toBe(true);
  });

  it('un seul non : même mise ; la première réponse est définitive', () => {
    const game = voting();
    voteGaramStake(game, A, false, NOW);
    expect(voteGaramStake(game, A, true, NOW)).toBeNull();
    voteGaramStake(game, B, true, NOW);
    expect(stakeVoteAccepted(game)).toBe(false);
  });

  it('refusée après l’échéance ; un non-joueur ne vote pas', () => {
    const game = voting();
    expect(() => voteGaramStake(game, A, true, new Date(NOW.getTime() + 10_000))).toThrow();
    expect(() => voteGaramStake(game, 'z' as PlayerId, true, NOW)).toThrow();
  });
});

describe('règlement GARAM TIA (§1.4, §1.5, §6.5)', () => {
  it('commission du barème sur toutes les pertes, pénalités Koraté comprises (D-130)', () => {
    // 4 joueurs à 1000, commission 10 %, deux adversaires Koraté.
    const plan = planGaramSettlement({
      stake: 1_000,
      commissionBps: 1_000,
      winnerId: A,
      participants: [A, B, C, 'd' as PlayerId],
      belowThresholdIds: [B, C],
    });
    expect(plan.grossAmount).toBe(3_000);
    expect(plan.commissionAmount).toBe(500);
    expect(plan.penaltyAmount).toBe(2_000);
    expect(plan.netGain).toBe(4_500);
    expect(plan.lossOf).toEqual({ b: 2_000, c: 2_000, d: 1_000 });
  });

  it('sans Koraté : identique au règlement simple', () => {
    const plan = planGaramSettlement({
      stake: 1_000,
      commissionBps: 1_000,
      winnerId: A,
      participants: [A, B, C, 'd' as PlayerId],
      belowThresholdIds: [],
    });
    expect(plan.netGain).toBe(2_700);
  });
});

describe('règles officielles (D-121)', () => {
  it('paquet : aucune carte 2, J, Q, K ; valeurs 3-10 et As = 11 seulement', () => {
    const values = new Set(createGaramDeck().map((c) => Number(c.split('-')[1])));
    expect([...values].sort((x, y) => x - y)).toEqual([3, 4, 5, 6, 7, 8, 9, 10, 11]);
    for (const bad of ['COEUR-2', 'COEUR-1', 'COEUR-12', 'COEUR-J', 'PIQUE-11']) {
      expect(() => parseGaramCardId(bad)).toThrow();
    }
  });

  it('tour : 15 s affichées par décision au premier tour (D-127) ; tirage automatique (D-136)', () => {
    const game = threePlayers(['TREFLE-3', 'PIQUE-4', 'CARREAU-3', 'COEUR-6']);
    const turn = () => game.turnDeadlineAt!.getTime() - game.turnStartedAt!.getTime();
    expect(turn()).toBe(GARAM_TURN_DURATION_MS);
    playGaramCard(game, A, 'COEUR-9', ctx);
    expect(turn()).toBe(GARAM_TURN_DURATION_MS);
    playGaramCard(game, B, 'COEUR-5', ctx);
    playGaramCard(game, C, 'TREFLE-8', ctx);
    // Tirage : aucune décision (§3.8), la 1re carte part après le délai du tirage automatique.
    expect(game.garam?.phase).toBe('DRAW');
    expect(turn()).toBe(GARAM_AUTO_DRAW_AFTER_FIRST_ROUND_MS);
  });

  it('exemple du §16 : 14 + 6 = 20 pris ; 20 + 3 = 23 « Impossible », le 3 reste en tête', () => {
    const game = started(
      [
        ['COEUR-9', 'TREFLE-8', 'PIQUE-6'], // a garde 14
        ['COEUR-4', 'CARREAU-10', 'TREFLE-6'],
      ],
      ['CARREAU-6', 'TREFLE-3', 'PIQUE-5'],
    );
    playGaramCard(game, A, 'COEUR-9', ctx);
    playGaramCard(game, B, 'COEUR-4', ctx);
    drawGaramCard(game, A, ctx);
    expect(play(game).drawn[A]).toEqual(['CARREAU-6']);
    expect(play(game).lastRefusal).toEqual({ playerId: A, cardId: 'TREFLE-3' });
    expect(play(game).terre[0]).toBe('TREFLE-3');
    expect(play(game).nextPlayerId).toBe(B);
  });
});

describe('visibilité des cartes pendant la manche (D-128)', () => {
  it('tirage : la carte tirée est publique, les 2 cartes gardées restent secrètes jusqu’à la fin', () => {
    // a garde T7 + P10 ; b garde CA8 + T10 ; terre T3, P3… : b pourra encore tirer.
    const game = threePlayers(['TREFLE-3', 'PIQUE-3', 'CARREAU-3', 'COEUR-6']);
    playGaramCard(game, A, 'COEUR-9', ctx);
    playGaramCard(game, B, 'COEUR-5', ctx);
    playGaramCard(game, C, 'TREFLE-8', ctx);
    drawGaramCard(game, A, ctx); // a : 17 + 3 = 20, tête suivante P3 → « Impossible »
    expect(game.status).toBe('in_progress');
    const seenByB = toPlayerView(game, B);
    expect(seenByB.garam?.drawn[A]).toEqual(['TREFLE-3']); // tirée : visible de tous
    expect(seenByB.garam?.handCounts[A]).toBe(2); // gardées : seulement leur nombre
    const raw = JSON.stringify(seenByB);
    expect(raw).not.toContain('TREFLE-7');
    expect(raw).not.toContain('PIQUE-10');
    expect(seenByB.result).toBeUndefined();
  });

  it('fin de manche : toutes les mains révélées dans le résultat, totaux du serveur', () => {
    const game = threePlayers(['TREFLE-4', 'PIQUE-5', 'CARREAU-3', 'COEUR-6']);
    playGaramCard(game, A, 'COEUR-9', ctx);
    playGaramCard(game, B, 'COEUR-5', ctx);
    playGaramCard(game, C, 'TREFLE-8', ctx);
    drawGaramCard(game, A, ctx);
    expect(game.status).toBe('finished');
    const seenByB = toPlayerView(game, B);
    expect(seenByB.result?.garamHands?.[A]).toEqual(['TREFLE-7', 'PIQUE-10']);
    expect(seenByB.result?.scores).toEqual({ a: 21, b: 18, c: 19 });
  });
});

describe('tirage automatique (D-136)', () => {
  // a garde T4 + P3 = 7 ; b garde CA8 + T10 = 18 ; terre T3, P5, CA4 : a contrôle (♥9).
  const drawRound = () => {
    const game = started(
      [
        ['COEUR-9', 'TREFLE-4', 'PIQUE-3'],
        ['COEUR-5', 'CARREAU-8', 'TREFLE-10'],
      ],
      ['TREFLE-3', 'PIQUE-5', 'CARREAU-4'],
    );
    playGaramCard(game, A, 'COEUR-9', ctx);
    playGaramCard(game, B, 'COEUR-5', ctx);
    return game;
  };
  const at = (ms: number) => ({ now: new Date(NOW.getTime() + ms) });

  it('contrôle obtenu : la 1re carte est due après le court délai, pas après 15 s', () => {
    const game = drawRound();
    expect(play(game).phase).toBe('DRAW');
    expect(play(game).nextPlayerId).toBe(A);
    expect(game.turnDeadlineAt).toEqual(new Date(NOW.getTime() + GARAM_AUTO_DRAW_AFTER_FIRST_ROUND_MS));
    expect(GARAM_AUTO_DRAW_AFTER_FIRST_ROUND_MS).toBeLessThan(GARAM_TURN_DURATION_MS);
  });

  it('plusieurs tirages obligatoires : une carte par échéance, délai entre deux, puis terre vide', () => {
    const game = drawRound();
    let t = GARAM_AUTO_DRAW_AFTER_FIRST_ROUND_MS;
    const drawnAt: string[] = [];
    for (const expected of ['TREFLE-3', 'PIQUE-5', 'CARREAU-4']) {
      expect(play(game).nextPlayerId).toBe(A);
      const events = playGaramAutomatically(game, A, at(t));
      const drawn = events.filter((e) => e.type === 'game:card_drawn');
      // Jamais plusieurs cartes par opération.
      expect(drawn).toHaveLength(1);
      expect(drawn[0]).toMatchObject({ payload: { cardId: expected, automatic: true } });
      drawnAt.push(expected);
      if (play(game).terre.length > 0) {
        expect(game.turnDeadlineAt).toEqual(new Date(NOW.getTime() + t + GARAM_AUTO_DRAW_STEP_MS));
      }
      t += GARAM_AUTO_DRAW_STEP_MS;
    }
    // 7 + 3 + 5 + 4 = 19, terre vide : a terminé ; b n'a rien à tirer ; manche finie.
    expect(play(game).drawn[A]).toEqual(drawnAt);
    expect(play(game).drawn[B]).toEqual([]);
    expect(game.status).toBe('finished');
    expect(game.turnDeadlineAt).toBeUndefined();
  });

  it('terre vide ou « Impossible » : aucune échéance de tirage, aucune carte en plus', () => {
    // a : 7 + 3 = 10, + 10 = 20, puis l'As (11) ferait 31 : « Impossible ».
    const game = started(
      [
        ['COEUR-9', 'TREFLE-4', 'PIQUE-3'],
        ['COEUR-5', 'CARREAU-10', 'TREFLE-10'],
      ],
      ['TREFLE-3', 'PIQUE-10', 'CARREAU-11'],
    );
    playGaramCard(game, A, 'COEUR-9', ctx);
    playGaramCard(game, B, 'COEUR-5', ctx);
    playGaramAutomatically(game, A, at(GARAM_AUTO_DRAW_AFTER_FIRST_ROUND_MS));
    playGaramAutomatically(game, A, at(GARAM_AUTO_DRAW_AFTER_FIRST_ROUND_MS + GARAM_AUTO_DRAW_STEP_MS));
    expect(play(game).drawn[A]).toEqual(['TREFLE-3', 'PIQUE-10']);
    expect(play(game).drawDone).toEqual([A, B]);
    // b (20) : l'As ferait 31 → clos aussitôt, sans échéance : la manche se termine.
    expect(play(game).lastRefusal).toEqual({ playerId: B, cardId: 'CARREAU-11' });
    expect(play(game).drawn[B]).toEqual([]);
    expect(play(game).terre).toEqual(['CARREAU-11']);
    expect(game.status).toBe('finished');
    expect(() => drawGaramCard(game, A, ctx)).toThrow();
  });

  it('un joueur qui n’a pas la main ne tire jamais : refus et aucune carte prise', () => {
    const game = drawRound();
    expect(() => drawGaramCard(game, B, ctx)).toThrow(/pas au tour/);
    expect(toPlayerView(game, B).garam?.canDraw).toBe(false);
    expect(play(game).terre).toEqual(['TREFLE-3', 'PIQUE-5', 'CARREAU-4']);
  });

  it('visibilité inchangée : carte tirée publique, mains gardées secrètes', () => {
    const game = drawRound();
    playGaramAutomatically(game, A, at(GARAM_AUTO_DRAW_AFTER_FIRST_ROUND_MS));
    const seenByB = toPlayerView(game, B);
    expect(seenByB.garam?.drawn[A]).toEqual(['TREFLE-3']);
    expect(seenByB.garam?.handCounts[A]).toBe(2);
    const raw = JSON.stringify(seenByB);
    expect(raw).not.toContain('TREFLE-4');
    expect(raw).not.toContain('PIQUE-3');
  });
});
