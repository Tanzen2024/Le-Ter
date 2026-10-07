import { createDeck } from '../../../src/domain/cards/deck';
import { cardFromId, type CardId } from '../../../src/domain/cards/card';
import { sameSuit } from '../../../src/domain/rules/rule-candidates';
import { UnresolvedRuleError } from '../../../src/domain/rules/unresolved-rule';
import {
  fiveSameColor,
  fourOfAValue,
  matchingWinConditions,
  sumThreshold,
  threeAndTwo,
  threeSevens,
  threeThrees,
  twoSevensFourThree,
} from '../../../src/domain/rules/win-conditions';

const hand = (...ids: CardId[]) => ids.map(cardFromId);

describe('Conditions de gain instantané (spec §4)', () => {
  describe('3 cartes de valeur 3', () => {
    it('gagne avec trois 3 (exemple de la spec)', () => {
      expect(
        threeThrees().isSatisfiedBy(hand('PIQUE-3', 'TREFLE-3', 'ETOILE-3', 'COEUR-8', 'PIQUE-9')),
      ).toBe(true);
    });
    it('ne gagne pas avec deux 3', () => {
      expect(
        threeThrees().isSatisfiedBy(hand('PIQUE-3', 'TREFLE-3', 'ETOILE-4', 'COEUR-8', 'PIQUE-9')),
      ).toBe(false);
    });
  });

  describe('4 cartes de même valeur', () => {
    it('gagne avec quatre 9 (exemple de la spec)', () => {
      expect(
        fourOfAValue().isSatisfiedBy(hand('PIQUE-9', 'TREFLE-9', 'ETOILE-9', 'COEUR-9', 'COEUR-3')),
      ).toBe(true);
    });
    it('ne gagne pas avec trois cartes de même valeur', () => {
      expect(
        fourOfAValue().isSatisfiedBy(hand('PIQUE-9', 'TREFLE-9', 'ETOILE-9', 'COEUR-4', 'COEUR-3')),
      ).toBe(false);
    });
    it("est impossible avec des 10 : le paquet n'en contient que 3 (pas de 10 de pique)", () => {
      const tens = createDeck().filter((c) => c.endsWith('-10'));
      expect(tens).toEqual(['COEUR-10', 'TREFLE-10', 'ETOILE-10']);
      expect(fourOfAValue().isSatisfiedBy(hand(...tens, 'COEUR-3', 'PIQUE-4'))).toBe(false);
    });
    it('est possible pour toutes les valeurs de 3 à 9', () => {
      const deck = createDeck();
      for (const value of [3, 4, 5, 6, 7, 8, 9]) {
        expect(deck.filter((c) => c.endsWith(`-${value}`))).toHaveLength(4);
      }
    });
  });

  describe('5 cartes de même couleur', () => {
    it('avec « couleur » = famille : cinq cœurs gagnent', () => {
      const condition = fiveSameColor(sameSuit);
      expect(
        condition.isSatisfiedBy(hand('COEUR-3', 'COEUR-5', 'COEUR-7', 'COEUR-9', 'COEUR-10')),
      ).toBe(true);
      expect(
        condition.isSatisfiedBy(hand('COEUR-3', 'COEUR-5', 'COEUR-7', 'COEUR-9', 'PIQUE-3')),
      ).toBe(false);
    });
    it('utilise la définition de « couleur » injectée (R-08 non tranché)', () => {
      const everythingSameColor = () => true;
      expect(
        fiveSameColor(everythingSameColor).isSatisfiedBy(
          hand('COEUR-3', 'PIQUE-4', 'TREFLE-5', 'ETOILE-6', 'COEUR-7'),
        ),
      ).toBe(true);
    });
    it('exige 5 cartes', () => {
      expect(
        fiveSameColor(sameSuit).isSatisfiedBy(hand('COEUR-3', 'COEUR-5', 'COEUR-7', 'COEUR-9')),
      ).toBe(false);
    });
  });

  describe("3 cartes d'une valeur et 2 d'une autre", () => {
    it('gagne avec trois 5 et deux 8 (exemple de la spec)', () => {
      expect(
        threeAndTwo().isSatisfiedBy(hand('COEUR-5', 'PIQUE-5', 'TREFLE-5', 'COEUR-8', 'ETOILE-8')),
      ).toBe(true);
    });
    it('ne gagne pas avec quatre + une, ni avec trois + deux différentes', () => {
      expect(
        threeAndTwo().isSatisfiedBy(hand('COEUR-5', 'PIQUE-5', 'TREFLE-5', 'ETOILE-5', 'ETOILE-8')),
      ).toBe(false);
      expect(
        threeAndTwo().isSatisfiedBy(hand('COEUR-5', 'PIQUE-5', 'TREFLE-5', 'COEUR-8', 'ETOILE-9')),
      ).toBe(false);
    });
  });

  describe('3 cartes de valeur 7', () => {
    it('gagne avec trois 7 (exemple de la spec)', () => {
      expect(
        threeSevens().isSatisfiedBy(hand('PIQUE-7', 'ETOILE-7', 'COEUR-7', 'COEUR-3', 'TREFLE-9')),
      ).toBe(true);
    });
    it('ne gagne pas avec deux 7', () => {
      expect(
        threeSevens().isSatisfiedBy(hand('PIQUE-7', 'ETOILE-7', 'COEUR-4', 'COEUR-3', 'TREFLE-9')),
      ).toBe(false);
    });
  });

  describe('Condition de somme — AMBIGUË (R-01)', () => {
    it('applique exactement le seuil et l’opérateur configurés, sans valeur par défaut', () => {
      const lowHand = hand('COEUR-3', 'PIQUE-3', 'TREFLE-4', 'ETOILE-4', 'COEUR-5'); // 19
      const highHand = hand('COEUR-10', 'TREFLE-10', 'ETOILE-9', 'PIQUE-9', 'COEUR-8'); // 46
      expect(sumThreshold({ operator: '<=', threshold: 21 }).isSatisfiedBy(lowHand)).toBe(true);
      expect(sumThreshold({ operator: '<=', threshold: 21 }).isSatisfiedBy(highHand)).toBe(false);
      expect(sumThreshold({ operator: '>=', threshold: 30 }).isSatisfiedBy(highHand)).toBe(true);
      expect(sumThreshold({ operator: '>=', threshold: 30 }).isSatisfiedBy(lowHand)).toBe(false);
    });
    it('les deux lectures des documents donnent des résultats opposés sur la même main', () => {
      const lowHand = hand('COEUR-3', 'PIQUE-3', 'TREFLE-4', 'ETOILE-4', 'COEUR-5');
      expect(sumThreshold({ operator: '<=', threshold: 21 }).isSatisfiedBy(lowHand)).not.toBe(
        sumThreshold({ operator: '>=', threshold: 30 }).isSatisfiedBy(lowHand),
      );
    });
  });

  describe('Combinaison 7 + 7 + 4 + 3 — AMBIGUË (R-04)', () => {
    it("ne peut pas être activée : la 5e carte n'est pas définie", () => {
      expect(() => twoSevensFourThree()).toThrow(UnresolvedRuleError);
      expect(() => twoSevensFourThree()).toThrow(/R-04/);
    });
    it("n'est pas couverte par la lecture « somme ≤ 21 » : 7+7+4+3 vaut déjà 21", () => {
      const withFifth = hand('COEUR-7', 'PIQUE-7', 'TREFLE-4', 'ETOILE-3', 'COEUR-5');
      expect(sumThreshold({ operator: '<=', threshold: 21 }).isSatisfiedBy(withFifth)).toBe(false);
    });
  });

  it('renvoie toutes les conditions satisfaites, sans priorité', () => {
    const conditions = [threeThrees(), fourOfAValue(), threeSevens()];
    expect(
      matchingWinConditions(
        hand('COEUR-3', 'PIQUE-3', 'TREFLE-3', 'ETOILE-3', 'COEUR-7'),
        conditions,
      ),
    ).toEqual(['THREE_THREES', 'FOUR_OF_A_VALUE']);
    expect(
      matchingWinConditions(
        hand('COEUR-4', 'PIQUE-5', 'TREFLE-6', 'ETOILE-8', 'COEUR-9'),
        conditions,
      ),
    ).toEqual([]);
  });
});
