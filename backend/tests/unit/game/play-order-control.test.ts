import type { CardId } from '../../../src/domain/cards/card';
import type { Game } from '../../../src/domain/game/game';
import { FirstPlayerNotInGameError } from '../../../src/domain/game/game-errors';
import { toPlayerId, type PlayerId } from '../../../src/domain/game/game-id';
import { playCard, startGame } from '../../../src/domain/game/ter-engine';
import { createDeck } from '../../../src/domain/cards/deck';
import { NOW, waitingGame } from '../../fixtures/game-builders';
import { identityRandom } from '../../fixtures/random';
import { testRules } from '../../fixtures/rules';

/**
 * Ordre antihoraire, J1 et contrôle (D-033). Places de la session : A=0, B=1, C=2, D=3.
 * « Couleur » = famille dans ces tests (testRules) : le sens réel de « même couleur »
 * reste la règle R-08, non tranchée ; le MÉCANISME de prise de contrôle est testé ici.
 */
const [A, B, C, D] = ['A', 'B', 'C', 'D'].map((n) => toPlayerId(n)) as [
  PlayerId,
  PlayerId,
  PlayerId,
  PlayerId,
];

function table(players: PlayerId[], firstPlayerId: PlayerId): Game {
  const game = waitingGame(players, 4);
  game.firstPlayerId = firstPlayerId;
  return game;
}

/** Démarre puis impose des mains choisies (le moteur a déjà fixé ordre, J1 et contrôle). */
function started(players: PlayerId[], firstPlayerId: PlayerId, hands: Record<string, CardId[]>) {
  const game = table(players, firstPlayerId);
  // Distribution confirmée au démarrage (D-102 : phase testée dans deal-phase.test.ts).
  startGame(game, { rules: testRules, random: identityRandom, now: NOW, dealDurationMs: () => 0 });
  const dealt = new Set(Object.values(hands).flat());
  game.play!.hands = structuredClone(hands);
  game.play!.stock = createDeck().filter((c) => !dealt.has(c));
  return game;
}

const play = (game: Game, player: PlayerId, card: CardId) =>
  playCard(game, player, card, { rules: testRules, now: NOW });

describe('Distribution et ordre à partir de J1 (sens antihoraire)', () => {
  it('J1 = C parmi A, B, C, D : ordre C → D → A → B pour la distribution et le 1er tour', () => {
    const game = table([A, B, C, D], C);
    const events = startGame(game, { now: NOW, random: identityRandom });
    const p = game.play!;

    expect(p.dealOrder).toEqual([C, D, A, B]);
    expect(p.trickOrder).toEqual([C, D, A, B]);
    expect(p.control).toEqual({ playerId: C });
    expect(p.nextPlayerId).toBe(C);
    // C reçoit les cartes en premier : lots C←3, D←3, A←3, B←3, puis C←2, D←2, A←2, B←2.
    expect(events[0]?.payload).toMatchObject({
      firstPlayerId: C,
      controllerId: C,
      dealSequence: [
        ...[C, D, A, B].map((playerId) => ({ pass: 1, playerId, count: 3 })),
        ...[C, D, A, B].map((playerId) => ({ pass: 2, playerId, count: 2 })),
      ],
    });
    expect(p.hands[C]?.slice(0, 3)).toEqual(['COEUR-3', 'COEUR-4', 'COEUR-5']);
  });

  it('participants non contigus (A, C, D ; J1 = D) : D → A → C', () => {
    const game = table([A, C, D], D);
    startGame(game, { now: NOW, random: identityRandom });
    expect(game.play!.dealOrder).toEqual([D, A, C]);
  });

  it('J1 absent de la partie : démarrage refusé (aucun remplaçant inventé)', () => {
    expect(() => startGame(table([A, C], B), { now: NOW, random: identityRandom })).toThrow(
      FirstPlayerNotInGameError,
    );
  });
});

describe('Ordre de jeu (R-28) : circulaire, antihoraire', () => {
  it.each([
    [[A, B], A],
    [[A, B, C], B],
    [[A, B, C, D], D],
  ])(
    'à %j joueurs depuis J1 = %s, chacun joue dans l’ordre puis le tour se clôt',
    (players, first) => {
      const order = [
        ...players.slice(players.indexOf(first)),
        ...players.slice(0, players.indexOf(first)),
      ];
      // Mains : seul J1 a des cœurs, les autres des étoiles → J1 garde le contrôle.
      const suits: Record<string, CardId[]> = {};
      order.forEach((id, i) => {
        suits[id] =
          i === 0
            ? ['COEUR-10', 'COEUR-9', 'COEUR-8', 'COEUR-7', 'COEUR-6']
            : ['ETOILE', 'TREFLE', 'PIQUE'][i - 1] === 'PIQUE'
              ? ['PIQUE-3', 'PIQUE-4', 'PIQUE-5', 'PIQUE-6', 'PIQUE-7']
              : [3, 4, 5, 6, 7].map(
                  (v) => `${['ETOILE', 'TREFLE', 'PIQUE'][i - 1]}-${v}` as CardId,
                );
      });
      const game = started(players, first, suits);

      const seen: PlayerId[] = [];
      for (const id of order) {
        expect(game.play!.nextPlayerId).toBe(id);
        seen.push(id);
        play(game, id, suits[id]![0]!);
      }
      expect(seen).toEqual(order);
      // Tour suivant : le contrôleur (J1, toujours) rouvre, l'ordre reboucle (dernier → J1).
      expect(game.play!.trickNumber).toBe(2);
      expect(game.play!.nextPlayerId).toBe(first);
    },
  );
});

describe('Prise de contrôle (spec §2.4)', () => {
  const hands = {
    [A]: ['COEUR-5', 'COEUR-3', 'ETOILE-3', 'ETOILE-4', 'ETOILE-5'] as CardId[],
    [B]: ['COEUR-8', 'COEUR-4', 'TREFLE-9', 'TREFLE-3', 'TREFLE-4'] as CardId[],
    [C]: ['COEUR-9', 'PIQUE-5', 'TREFLE-5', 'TREFLE-6', 'TREFLE-7'] as CardId[],
  };

  it('même couleur et valeur supérieure : nouveau contrôleur, qui ouvre le tour suivant', () => {
    const game = started([A, B, C], A, hands);
    play(game, A, 'COEUR-5');
    play(game, B, 'COEUR-8'); // 8 > 5, même famille → B prend le contrôle
    expect(game.play!.control).toEqual({ playerId: B, cardId: 'COEUR-8' });
    // Le tour continue dans l'ordre : C joue encore, et se compare à la carte de B.
    expect(game.play!.nextPlayerId).toBe(C);
    play(game, C, 'COEUR-9'); // 9 > 8 → C prend le contrôle
    expect(game.play!.control.playerId).toBe(C);
    // Tour suivant ouvert par le nouveau contrôleur, ordre antihoraire C → A → B.
    expect(game.play!.trickNumber).toBe(2);
    expect(game.play!.trickOrder).toEqual([C, A, B]);
    expect(game.play!.nextPlayerId).toBe(C);
  });

  it('même couleur et valeur inférieure : contrôle inchangé', () => {
    const game = started([A, B, C], A, hands);
    play(game, A, 'COEUR-5');
    play(game, B, 'COEUR-4');
    expect(game.play!.control).toEqual({ playerId: A, cardId: 'COEUR-5' });
  });

  // B et C n'ont aucun cœur : ils peuvent jouer une autre famille (décision 47).
  const noHearts = {
    [A]: hands[A] as CardId[],
    [B]: ['TREFLE-9', 'TREFLE-3', 'TREFLE-4', 'TREFLE-10', 'ETOILE-6'] as CardId[],
    [C]: ['PIQUE-5', 'PIQUE-6', 'TREFLE-5', 'TREFLE-6', 'TREFLE-7'] as CardId[],
  };

  it('autre couleur, même valeur : contrôle inchangé (une même valeur n’existe qu’une fois par famille)', () => {
    const game = started([A, B, C], A, noHearts);
    play(game, A, 'COEUR-5');
    play(game, B, 'TREFLE-4');
    play(game, C, 'PIQUE-5');
    // Tour clos : A l'a conservé jusqu'au bout et ouvre le suivant.
    expect(game.play!.completedTricks[0]?.controllerId).toBe(A);
    expect(game.play!.control.playerId).toBe(A);
  });

  it('autre couleur, valeur supérieure : contrôle inchangé', () => {
    const game = started([A, B, C], A, noHearts);
    play(game, A, 'COEUR-5');
    play(game, B, 'TREFLE-9');
    expect(game.play!.control.playerId).toBe(A);
  });

  it('aucune pioche : chaque coup retire une carte, rien n’est ajouté', () => {
    const game = started([A, B, C], A, hands);
    const stock = [...game.play!.stock];
    play(game, A, 'COEUR-5');
    expect(game.play!.hands[A]).toHaveLength(4);
    expect(game.play!.stock).toEqual(stock);
  });
});
