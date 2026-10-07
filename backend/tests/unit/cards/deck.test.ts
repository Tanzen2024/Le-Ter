import {
  DECK_COMPOSITION,
  DECK_SIZE,
  InvalidCardError,
  SUITS,
  parseCardId,
  type CardId,
} from '../../../src/domain/cards/card';
import {
  NotEnoughCardsError,
  createDeck,
  dealCards,
  shuffleDeck,
} from '../../../src/domain/cards/deck';
import { identityRandom, scriptedRandom, seededRandom } from '../../fixtures/random';

const EXPECTED_CARDS: CardId[] = [
  'COEUR-3',
  'COEUR-4',
  'COEUR-5',
  'COEUR-6',
  'COEUR-7',
  'COEUR-8',
  'COEUR-9',
  'COEUR-10',
  'PIQUE-3',
  'PIQUE-4',
  'PIQUE-5',
  'PIQUE-6',
  'PIQUE-7',
  'PIQUE-8',
  'PIQUE-9',
  'TREFLE-3',
  'TREFLE-4',
  'TREFLE-5',
  'TREFLE-6',
  'TREFLE-7',
  'TREFLE-8',
  'TREFLE-9',
  'TREFLE-10',
  'ETOILE-3',
  'ETOILE-4',
  'ETOILE-5',
  'ETOILE-6',
  'ETOILE-7',
  'ETOILE-8',
  'ETOILE-9',
  'ETOILE-10',
];

describe('Paquet (spec §2.1)', () => {
  it('contient exactement 31 cartes', () => {
    expect(createDeck()).toHaveLength(31);
    expect(DECK_SIZE).toBe(31);
  });

  it('respecte la composition par famille : 8 cœurs, 7 piques, 8 trèfles, 8 étoiles', () => {
    const deck = createDeck();
    const countBySuit = Object.fromEntries(
      SUITS.map((suit) => [suit, deck.filter((c) => c.startsWith(`${suit}-`)).length]),
    );
    expect(countBySuit).toEqual({ COEUR: 8, PIQUE: 7, TREFLE: 8, ETOILE: 8 });
    expect(Object.values(DECK_COMPOSITION).flat()).toHaveLength(31);
  });

  it('contient toutes les cartes attendues, sans doublon', () => {
    const deck = createDeck();
    expect(new Set(deck).size).toBe(deck.length);
    expect([...deck].sort()).toEqual([...EXPECTED_CARDS].sort());
  });

  it("n'a ni 10 de pique ni figures (valet, dame, roi, as)", () => {
    expect(createDeck()).not.toContain('PIQUE-10');
    expect(() => parseCardId('PIQUE-10')).toThrow(InvalidCardError);
    for (const value of ['COEUR-1', 'COEUR-2', 'COEUR-11', 'TREFLE-12', 'ETOILE-13', 'COEUR-14']) {
      expect(() => parseCardId(value)).toThrow(InvalidCardError);
    }
  });

  it.each([42, null, {}, '', 'coeur-3', 'CARREAU-5', 'COEUR-3 '])(
    'rejette une carte invalide : %p',
    (value) => expect(() => parseCardId(value)).toThrow(InvalidCardError),
  );

  it('lit une carte valide', () => {
    expect(parseCardId('ETOILE-10')).toEqual({ id: 'ETOILE-10', suit: 'ETOILE', value: 10 });
  });
});

describe('Mélange de Fisher-Yates', () => {
  it('conserve les 31 cartes et ne modifie pas le paquet reçu', () => {
    const deck = createDeck();
    const before = [...deck];
    const shuffled = shuffleDeck(deck, seededRandom(1));

    expect(deck).toEqual(before);
    expect([...shuffled].sort()).toEqual([...deck].sort());
    expect(shuffled).not.toEqual(deck);
  });

  it('parcourt le tableau de la fin vers le début avec un index dans [0, i]', () => {
    const random = scriptedRandom([0]);
    const result = shuffleDeck(['COEUR-3', 'COEUR-4', 'COEUR-5', 'COEUR-6'], random);

    // i=3 ↔ 0, puis i=2 ↔ 0, puis i=1 ↔ 0
    expect(result).toEqual(['COEUR-4', 'COEUR-5', 'COEUR-6', 'COEUR-3']);
    expect(random.bounds).toEqual([4, 3, 2]);
  });

  it('est déterministe à graine égale', () => {
    expect(shuffleDeck(createDeck(), seededRandom(7))).toEqual(
      shuffleDeck(createDeck(), seededRandom(7)),
    );
  });

  it('produit les 6 permutations de 3 cartes de façon équilibrée', () => {
    const random = seededRandom(2026);
    const counts = new Map<string, number>();
    const draws = 6000;
    for (let i = 0; i < draws; i++) {
      const key = shuffleDeck(['COEUR-3', 'COEUR-4', 'COEUR-5'], random).join(',');
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    expect(counts.size).toBe(6);
    for (const n of counts.values()) {
      expect(n).toBeGreaterThan(850);
      expect(n).toBeLessThan(1150);
    }
  });
});

describe('Distribution (spec §2.2 : 5 cartes par joueur)', () => {
  it.each([
    [2, 21],
    [3, 16],
    [4, 11],
  ])('à %i joueurs : 5 cartes chacun, %i au talon, ni doublon ni perte', (count, stockSize) => {
    const players = ['p1', 'p2', 'p3', 'p4'].slice(0, count);
    const deck = shuffleDeck(createDeck(), seededRandom(count));
    const { hands, stock } = dealCards(deck, players, 5);

    for (const p of players) {
      expect(hands[p]).toHaveLength(5);
    }
    expect(stock).toHaveLength(stockSize);
    const all = [...Object.values<CardId[]>(hands).flat(), ...stock];
    expect(new Set(all).size).toBe(31);
    expect([...all].sort()).toEqual([...deck].sort());
  });

  it("sert une carte à la fois, en commençant par le premier de l'ordre de distribution", () => {
    const deck = shuffleDeck(createDeck(), identityRandom);
    const { hands } = dealCards(deck, ['p1', 'p2'], 5);

    expect(hands.p1).toEqual(['COEUR-3', 'COEUR-5', 'COEUR-7', 'COEUR-9', 'PIQUE-3']);
    expect(hands.p2).toEqual(['COEUR-4', 'COEUR-6', 'COEUR-8', 'COEUR-10', 'PIQUE-4']);
  });

  it('refuse une distribution impossible', () => {
    expect(() => dealCards(createDeck(), ['a', 'b', 'c', 'd', 'e', 'f', 'g'], 5)).toThrow(
      NotEnoughCardsError,
    );
  });
});
