import { cardFromId } from '../../../src/domain/cards/card';
import { toPlayerId } from '../../../src/domain/game/game-id';
import {
  declareBeforeFirstCard,
  fleeBeforeSecondCard,
  mustFollowLeadColorWhenPossible,
  sameSuit,
} from '../../../src/domain/rules/official-rules';
import { assertValidStake, stakeTransfers } from '../../../src/domain/rules/stake';
import { UnresolvedRuleError } from '../../../src/domain/rules/unresolved-rule';

const [a, b, c] = ['a', 'b', 'c'].map(toPlayerId) as [
  ReturnType<typeof toPlayerId>,
  ReturnType<typeof toPlayerId>,
  ReturnType<typeof toPlayerId>,
];

describe('Règles officielles (D-035)', () => {
  it('déclarer : seulement au tour 1, avant sa première carte', () => {
    expect(declareBeforeFirstCard({ cardsPlayed: 0, trickNumber: 1 })).toBe(true);
    expect(declareBeforeFirstCard({ cardsPlayed: 1, trickNumber: 1 })).toBe(false);
    expect(declareBeforeFirstCard({ cardsPlayed: 1, trickNumber: 2 })).toBe(false);
  });

  it('se coucher (D-089) : tant que le joueur n’a pas joué sa deuxième carte (tours 1 et 2)', () => {
    expect(fleeBeforeSecondCard({ cardsPlayed: 0, trickNumber: 1 })).toBe(true);
    expect(fleeBeforeSecondCard({ cardsPlayed: 1, trickNumber: 1 })).toBe(true);
    expect(fleeBeforeSecondCard({ cardsPlayed: 1, trickNumber: 2 })).toBe(true);
    expect(fleeBeforeSecondCard({ cardsPlayed: 2, trickNumber: 2 })).toBe(false);
    expect(fleeBeforeSecondCard({ cardsPlayed: 2, trickNumber: 3 })).toBe(false);
  });

  it('« même couleur » = même famille', () => {
    expect(sameSuit(cardFromId('COEUR-3'), cardFromId('COEUR-10'))).toBe(true);
    expect(sameSuit(cardFromId('COEUR-3'), cardFromId('ETOILE-3'))).toBe(false);
  });

  it('obligation de suivre : refuse une autre famille seulement si le joueur en possède', () => {
    const lead = cardFromId('COEUR-5');
    const hand = (['COEUR-4', 'PIQUE-9'] as const).map((id) => cardFromId(id));
    const ctx = { hand, leadCard: lead, sameColor: sameSuit };
    expect(mustFollowLeadColorWhenPossible({ ...ctx, card: cardFromId('PIQUE-9') })).toBe(false);
    expect(mustFollowLeadColorWhenPossible({ ...ctx, card: cardFromId('COEUR-4') })).toBe(true);
    expect(
      mustFollowLeadColorWhenPossible({
        ...ctx,
        hand: [cardFromId('PIQUE-9')],
        card: cardFromId('PIQUE-9'),
      }),
    ).toBe(true);
  });
});

describe('Mises (spec §5)', () => {
  it('gagné simple : chaque perdant verse la mise au gagnant (§5.1)', () => {
    expect(stakeTransfers('SIMPLE', 100, a, [b, c])).toEqual([
      { from: b, to: a, amount: 100 },
      { from: c, to: a, amount: 100 },
    ]);
  });

  it('Kora et Double Kora : montant non défini (R-02)', () => {
    expect(() => stakeTransfers('KORA', 100, a, [b])).toThrow(UnresolvedRuleError);
    expect(() => stakeTransfers('DOUBLE_KORA', 100, a, [b])).toThrow(UnresolvedRuleError);
  });

  it('refuse une mise négative ou non entière', () => {
    expect(() => assertValidStake(-1)).toThrow(RangeError);
    expect(() => assertValidStake(10.5)).toThrow(RangeError);
    expect(() => assertValidStake(0)).not.toThrow();
  });
});
