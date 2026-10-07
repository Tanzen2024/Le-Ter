import { cardFromId } from '../../../src/domain/cards/card';
import { toPlayerId } from '../../../src/domain/game/game-id';
import {
  dealOrderBySeat,
  dealOrderRandom,
  fleeBeforeSecondTrick,
  fleeIfAtMostOneCardPlayed,
  mustFollowLeadColorWhenPossible,
  playOrderFollowingDealOrder,
  sameSuit,
} from '../../../src/domain/rules/rule-candidates';
import { assertValidStake, stakeTransfers } from '../../../src/domain/rules/stake';
import { UnresolvedRuleError } from '../../../src/domain/rules/unresolved-rule';
import { seededRandom } from '../../fixtures/random';

const [a, b, c, d] = ['a', 'b', 'c', 'd'].map(toPlayerId) as [
  ReturnType<typeof toPlayerId>,
  ReturnType<typeof toPlayerId>,
  ReturnType<typeof toPlayerId>,
  ReturnType<typeof toPlayerId>,
];

describe('Interprétations candidates (non retenues comme règles officielles)', () => {
  it('fuite : les deux formulations des documents divergent (R-05)', () => {
    const secondTrickOneCard = { cardsPlayed: 1, trickNumber: 2 };
    expect(fleeIfAtMostOneCardPlayed(secondTrickOneCard)).toBe(true);
    expect(fleeBeforeSecondTrick(secondTrickOneCard)).toBe(false);
  });

  it("ordre de jeu : suit l'ordre de distribution à partir du meneur", () => {
    expect(playOrderFollowingDealOrder([a, b, c, d], c)).toEqual([c, d, a, b]);
  });

  it('ordre de distribution : par siège, ou tiré au sort (permutation complète)', () => {
    expect(dealOrderBySeat([a, b, c], seededRandom(0))).toEqual([a, b, c]);
    expect([...dealOrderRandom([a, b, c, d], seededRandom(3))].sort()).toEqual([a, b, c, d]);
  });

  it('obligation de suivre : refuse une autre famille seulement si le joueur en possède', () => {
    const lead = cardFromId('COEUR-5');
    const hand = (['COEUR-8', 'PIQUE-9'] as const).map((id) => cardFromId(id));
    const ctx = { hand, leadCard: lead, sameColor: sameSuit };
    expect(mustFollowLeadColorWhenPossible({ ...ctx, card: cardFromId('PIQUE-9') })).toBe(false);
    expect(mustFollowLeadColorWhenPossible({ ...ctx, card: cardFromId('COEUR-8') })).toBe(true);
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
