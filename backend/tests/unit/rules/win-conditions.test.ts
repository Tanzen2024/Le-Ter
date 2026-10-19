import { cardFromId, type CardId } from '../../../src/domain/cards/card';
import {
  bestInstantWin,
  resolveInstantWins,
  type InstantWinRank,
} from '../../../src/domain/rules/win-conditions';

/** Victoire instantanée : rangs et priorités (D-035). Plus le rang est petit, plus il est fort. */
const best = (ids: CardId[]) => bestInstantWin(ids.map(cardFromId));

describe('Combinaisons de victoire instantanée, une par rang', () => {
  it.each<[InstantWinRank, string, CardId[]]>([
    [1, 'THREE_SEVENS', ['COEUR-7', 'PIQUE-7', 'ETOILE-7', 'COEUR-10', 'TREFLE-9']],
    [2, 'SUM_AT_MOST_21', ['COEUR-3', 'PIQUE-4', 'TREFLE-5', 'ETOILE-4', 'COEUR-5']],
    [3, 'FIVE_SAME_SUIT', ['TREFLE-4', 'TREFLE-6', 'TREFLE-8', 'TREFLE-9', 'TREFLE-10']],
    [4, 'FOUR_OF_A_VALUE', ['COEUR-9', 'PIQUE-9', 'TREFLE-9', 'ETOILE-9', 'COEUR-10']],
    [5, 'THREE_AND_TWO', ['COEUR-8', 'PIQUE-8', 'TREFLE-8', 'COEUR-10', 'ETOILE-10']],
    [6, 'COMPOSITION_OF_SEVEN', ['PIQUE-3', 'COEUR-4', 'COEUR-8', 'TREFLE-7', 'ETOILE-7']],
    [7, 'THREE_THREES', ['COEUR-3', 'PIQUE-3', 'TREFLE-3', 'COEUR-10', 'ETOILE-9']],
  ])('rang %i : %s', (rank, combination, hand) => {
    expect(best(hand)).toMatchObject({ rank, combination });
  });

  it('« 3 × 7 » : trois cartes de valeur 7, quelle que soit la famille', () => {
    expect(best(['PIQUE-7', 'TREFLE-7', 'ETOILE-7', 'COEUR-9', 'COEUR-10'])?.rank).toBe(1);
  });

  it('somme exactement 21 : gagnante ; 22 : non', () => {
    expect(best(['COEUR-3', 'PIQUE-4', 'TREFLE-4', 'ETOILE-5', 'COEUR-5'])?.rank).toBe(2);
    expect(best(['COEUR-3', 'PIQUE-4', 'TREFLE-4', 'ETOILE-5', 'COEUR-6'])).toBeNull();
  });

  it('main de la capture 3♠ 5♠ 4♥ 4♣ 4⭐ : 3 + 5 + 4 + 4 + 4 = 20 → SUM_AT_MOST_21', () => {
    expect(best(['PIQUE-3', 'PIQUE-5', 'COEUR-4', 'TREFLE-4', 'ETOILE-4'])).toMatchObject({
      rank: 2,
      combination: 'SUM_AT_MOST_21',
    });
  });

  it.each<[number, CardId[]]>([
    [19, ['COEUR-3', 'PIQUE-3', 'TREFLE-4', 'ETOILE-4', 'COEUR-5']],
    [18, ['COEUR-3', 'PIQUE-3', 'TREFLE-4', 'ETOILE-4', 'COEUR-4']],
  ])('somme %i : SUM_AT_MOST_21', (_sum, hand) => {
    expect(best(hand)?.combination).toBe('SUM_AT_MOST_21');
  });

  it('plusieurs combinaisons : le MEILLEUR rang est retenu (7♥ 7♣ 7♠ 7⭐ 3♥ → rang 1, pas 4)', () => {
    const match = best(['COEUR-7', 'TREFLE-7', 'PIQUE-7', 'ETOILE-7', 'COEUR-3']);
    expect(match).toEqual({
      rank: 1,
      combination: 'THREE_SEVENS',
      matches: ['THREE_SEVENS', 'FOUR_OF_A_VALUE'],
    });
  });

  it('trois 3 et somme ≤ 21 : rang 2 retenu (plus fort que le rang 7)', () => {
    expect(best(['COEUR-3', 'PIQUE-3', 'TREFLE-3', 'COEUR-4', 'PIQUE-4'])).toMatchObject({
      rank: 2,
      matches: ['SUM_AT_MOST_21', 'THREE_AND_TWO', 'THREE_THREES'],
    });
  });

  it('main sans combinaison : null ; main qui n’a pas 5 cartes : jamais évaluée', () => {
    expect(best(['COEUR-8', 'PIQUE-9', 'TREFLE-10', 'ETOILE-4', 'COEUR-6'])).toBeNull();
    expect(best(['COEUR-7', 'PIQUE-7', 'TREFLE-7', 'COEUR-3'])).toBeNull();
  });
});

describe('« Composition de 7 » (D-118) : deux 7, un 4 et un 3', () => {
  it('exemple de la capture : 3♠ 4♥ 8♥ 7♣ 7★ → Composition de 7 (rang 6), le 8 ne gêne pas', () => {
    expect(best(['PIQUE-3', 'COEUR-4', 'COEUR-8', 'TREFLE-7', 'ETOILE-7'])).toEqual({
      rank: 6,
      combination: 'COMPOSITION_OF_SEVEN',
      matches: ['COMPOSITION_OF_SEVEN'],
    });
  });

  it.each<CardId[]>([
    ['TREFLE-7', 'ETOILE-7', 'COEUR-4', 'PIQUE-3', 'COEUR-9'],
    ['PIQUE-7', 'COEUR-7', 'ETOILE-4', 'TREFLE-3', 'TREFLE-10'],
    ['COEUR-7', 'TREFLE-7', 'COEUR-4', 'COEUR-3', 'ETOILE-5'],
  ])('familles indifférentes : %s', (...hand) => {
    expect(best(hand)?.combination).toBe('COMPOSITION_OF_SEVEN');
  });

  it.each<[string, CardId[]]>([
    ['7 + 7 + 4 + 8', ['COEUR-7', 'TREFLE-7', 'COEUR-4', 'COEUR-8', 'ETOILE-9']],
    ['7 + 4 + 3 + 8', ['COEUR-7', 'COEUR-4', 'PIQUE-3', 'COEUR-8', 'ETOILE-9']],
    ['7 + 7 + 3 + 8', ['COEUR-7', 'TREFLE-7', 'PIQUE-3', 'COEUR-8', 'ETOILE-9']],
    ['5 + 5 + 4 + 3', ['COEUR-5', 'TREFLE-5', 'COEUR-4', 'PIQUE-3', 'ETOILE-9']],
  ])('%s : pas de Composition de 7', (_label, hand) => {
    expect(best(hand)?.matches ?? []).not.toContain('COMPOSITION_OF_SEVEN');
  });

  it('trois 7 + 4 + 3 : « Trois 7 » (rang 1) reste retenu, jamais un Full', () => {
    expect(best(['COEUR-7', 'TREFLE-7', 'ETOILE-7', 'COEUR-4', 'PIQUE-3'])).toEqual({
      rank: 1,
      combination: 'THREE_SEVENS',
      matches: ['THREE_SEVENS', 'COMPOSITION_OF_SEVEN'],
    });
  });

  it('7 + 7 + 4 + 4 + 4 : Full (Trois + deux, rang 5), pas Composition de 7 (aucun 3)', () => {
    expect(best(['COEUR-7', 'TREFLE-7', 'COEUR-4', 'PIQUE-4', 'ETOILE-4'])).toMatchObject({
      rank: 5,
      combination: 'THREE_AND_TWO',
      matches: ['THREE_AND_TWO'],
    });
  });

  it('priorité : Composition de 7 (6) bat Trois 3 (7) et perd contre Trois + deux (5)', () => {
    expect(
      resolveInstantWins([
        { playerId: 'J1', rank: 7 },
        { playerId: 'J2', rank: 6 },
      ]),
    ).toEqual({ kind: 'automatic', playerId: 'J2', rank: 6 });
    expect(
      resolveInstantWins([
        { playerId: 'J1', rank: 5 },
        { playerId: 'J2', rank: 6 },
      ]),
    ).toEqual({ kind: 'automatic', playerId: 'J1', rank: 5 });
  });
});

describe('Plusieurs mains gagnantes : priorité', () => {
  it('aucune : partie normale ; une seule : déclaration facultative', () => {
    expect(resolveInstantWins([])).toEqual({ kind: 'none' });
    expect(resolveInstantWins([{ playerId: 'A', rank: 4 }])).toEqual({
      kind: 'optional',
      playerId: 'A',
      rank: 4,
    });
  });

  it('rangs différents : le plus petit rang gagne automatiquement (J1 = 2, J3 = 5 → J1)', () => {
    expect(
      resolveInstantWins([
        { playerId: 'J1', rank: 2 },
        { playerId: 'J3', rank: 5 },
      ]),
    ).toEqual({ kind: 'automatic', playerId: 'J1', rank: 2 });
  });

  it('même meilleur rang : égalité, aucun gagnant', () => {
    expect(
      resolveInstantWins([
        { playerId: 'J1', rank: 3 },
        { playerId: 'J2', rank: 3 },
        { playerId: 'J4', rank: 6 },
      ]),
    ).toEqual({ kind: 'tie', playerIds: ['J1', 'J2'], rank: 3 });
  });
});
