import {
  compareRankingScores,
  DEFAULT_RANKING_WEIGHTS,
  DEFAULT_TOURNAMENT_SETTINGS,
  exactRankingScore,
  normalizedRatio,
  RANKING_REFERENCE_GAME_MS,
  rankAccounts,
  rankingReferences,
  rankingScore,
  rankingWeightsError,
  rankingWeightsOf,
  tournamentRankingWeights,
  type RankingWeights,
} from '../../../src/domain/tournaments/tournament';
import type { UserId } from '../../../src/domain/users/user';

/** Classement pondéré des tournois (D-062). */
const at = (iso: string) => new Date(iso);
const HALF: RankingWeights = DEFAULT_RANKING_WEIGHTS;
/** Tournoi de 30 min, 1 000 jetons initiaux : références 1 000 jetons et 10 parties. */
const REFS = rankingReferences({
  initialTournamentTokens: 1000,
  startsAt: at('2026-10-12T18:00:00Z'),
  endsAt: at('2026-10-12T18:30:00Z'),
});

const score = (tokens: number, gamesPlayed: number, weights = HALF, refs = REFS) =>
  rankingScore({ tokens, gamesPlayed }, refs, weights);

/** Comparaison EXACTE (celle du classement), insensible à l'arrondi d'affichage. */
const higher = (a: [number, number], b: [number, number], weights = HALF) =>
  compareRankingScores(
    exactRankingScore({ tokens: a[0], gamesPlayed: a[1] }, REFS, weights),
    exactRankingScore({ tokens: b[0], gamesPlayed: b[1] }, REFS, weights),
  ) > 0;

const base = { gamesPlayed: 0, gamesWon: 0, registeredAt: at('2026-10-10T10:00:00Z') };
const acc = (playerId: string, o: Partial<typeof base> & { currentTokens: number }) => ({
  ...base,
  playerId: playerId as UserId,
  ...o,
});
const order = (accounts: ReturnType<typeof acc>[], weights = HALF) =>
  rankAccounts(accounts, REFS, weights).map((a) => a.playerId);

describe('poids', () => {
  it('tournoi sans poids copiés : 50 % / 50 %, aucun critère privilégié', () => {
    expect(DEFAULT_RANKING_WEIGHTS).toEqual({ tokensBps: 5000, gamesBps: 5000 });
    expect(rankingWeightsError(DEFAULT_RANKING_WEIGHTS)).toBeUndefined();
  });

  it('paramètres jamais enregistrés : 60 % / 40 % pour les prochains publiés (D-071)', () => {
    expect(rankingWeightsOf(DEFAULT_TOURNAMENT_SETTINGS)).toEqual({
      tokensBps: 6000,
      gamesBps: 4000,
    });
    expect(rankingWeightsError(rankingWeightsOf(DEFAULT_TOURNAMENT_SETTINGS))).toBeUndefined();
  });

  it.each([
    [{ tokensBps: 7000, gamesBps: 3000 }],
    [{ tokensBps: 10_000, gamesBps: 0 }],
    [{ tokensBps: 0, gamesBps: 10_000 }],
  ])('somme exactement 1 : %j valide', (w) => {
    expect(rankingWeightsError(w)).toBeUndefined();
  });

  it.each([
    [{ tokensBps: 6000, gamesBps: 5000 }, 'somme'],
    [{ tokensBps: 4000, gamesBps: 5000 }, 'somme'],
    [{ tokensBps: -1000, gamesBps: 11_000 }, 'entre 0 et 100'],
    [{ tokensBps: 5000.5, gamesBps: 4999.5 }, 'entre 0 et 100'],
    [{ tokensBps: Number.NaN, gamesBps: 10_000 }, 'entre 0 et 100'],
  ])('%j refusé (%s)', (w, message) => {
    expect(rankingWeightsError(w)).toMatch(new RegExp(message));
  });

  it('tournoi publié avant D-062 (poids absents) : configuration initiale', () => {
    expect(tournamentRankingWeights({})).toEqual(DEFAULT_RANKING_WEIGHTS);
    const frozen = { tokensBps: 8000, gamesBps: 2000 };
    expect(tournamentRankingWeights({ rankingWeights: frozen })).toBe(frozen);
  });
});

describe('normalisation', () => {
  it('références issues des seuls paramètres du tournoi (capital initial, durée)', () => {
    expect(RANKING_REFERENCE_GAME_MS).toBe(170_000);
    expect(REFS).toEqual({ tokens: 1000, games: 10 });
    const twoHours = rankingReferences({
      initialTournamentTokens: 5000,
      startsAt: at('2026-10-12T18:00:00Z'),
      endsAt: at('2026-10-12T20:00:00Z'),
    });
    expect(twoHours).toEqual({ tokens: 5000, games: 42 });
  });

  it('ratio dans [0, 1[ : 0 sans rien, 0,5 à la référence, strictement croissant', () => {
    expect(normalizedRatio(0, 1000)).toBe(0);
    expect(normalizedRatio(1000, 1000)).toBe(0.5);
    let previous = 0;
    for (let x = 1; x <= 100_000; x *= 3) {
      const r = normalizedRatio(x, 1000);
      expect(r).toBeGreaterThan(previous);
      expect(r).toBeLessThan(1);
      previous = r;
    }
  });

  it('cas limites : valeur négative, NaN, référence nulle ou invalide', () => {
    expect(normalizedRatio(-5, 10)).toBe(0);
    expect(normalizedRatio(Number.NaN, 10)).toBe(0);
    expect(normalizedRatio(0, 0)).toBe(0);
    expect(normalizedRatio(3, 0)).toBe(1);
    expect(normalizedRatio(3, Number.NaN)).toBe(1);
    const tooShort = rankingReferences({
      initialTournamentTokens: 1000,
      startsAt: at('2026-10-12T18:00:00Z'),
      endsAt: at('2026-10-12T18:01:00Z'),
    });
    expect(tooShort.games).toBe(0);
    expect(score(1000, 0, HALF, tooShort)).toBe(25);
    expect(score(1000, 1, HALF, tooShort)).toBe(75);
  });

  it('score borné à [0, 100], arrondi à 4 décimales', () => {
    expect(score(0, 0)).toBe(0);
    expect(score(1000, 10)).toBe(50);
    expect(score(Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER)).toBeLessThanOrEqual(100);
    expect(score(1300, 3)).toBe(39.7993);
    expect(Number.isInteger(score(1234, 7) * 10_000)).toBe(true);
  });
});

describe('les deux critères contribuent au score', () => {
  it('chaque critère compte, aucun n’est ignoré à 50 / 50', () => {
    expect(score(1500, 4)).toBeGreaterThan(score(1000, 4));
    expect(score(1000, 8)).toBeGreaterThan(score(1000, 4));
  });

  it.each([[HALF], [{ tokensBps: 2000, gamesBps: 8000 }], [{ tokensBps: 8000, gamesBps: 2000 }]])(
    'plus de jetons → score plus élevé, toutes choses égales par ailleurs (%j)',
    (weights) => {
      for (const games of [0, 3, 10, 30]) {
        for (const tokens of [0, 50, 999, 1000, 2500, 20_000, 1_000_000]) {
          expect(higher([tokens + 1, games], [tokens, games], weights)).toBe(true);
        }
        // Score affiché : hausse visible dès un écart d'une mise.
        expect(score(1100, games, weights)).toBeGreaterThan(score(1000, games, weights));
      }
    },
  );

  it.each([[HALF], [{ tokensBps: 2000, gamesBps: 8000 }], [{ tokensBps: 8000, gamesBps: 2000 }]])(
    'plus de parties → score plus élevé, toutes choses égales par ailleurs (%j)',
    (weights) => {
      for (const tokens of [0, 50, 1000, 4000]) {
        for (const games of [0, 1, 9, 10, 40, 200, 10_000]) {
          expect(higher([tokens, games + 1], [tokens, games], weights)).toBe(true);
          if (games <= 200) {
            expect(score(tokens, games + 1, weights)).toBeGreaterThan(
              score(tokens, games, weights),
            );
          }
        }
      }
    },
  );

  it('un poids nul neutralise son critère (configuration extrême, mais valide)', () => {
    const tokensOnly = { tokensBps: 10_000, gamesBps: 0 };
    expect(score(1000, 2, tokensOnly)).toBe(score(1000, 30, tokensOnly));
  });
});

describe('classement', () => {
  it('peut favoriser moins de jetons mais davantage de parties', () => {
    // A : 1 300 jetons, 3 parties → 39,7993 ; B : 1 100 jetons, 8 parties → 48,4127.
    const ranked = rankAccounts(
      [
        acc('A', { currentTokens: 1300, gamesPlayed: 3 }),
        acc('B', { currentTokens: 1100, gamesPlayed: 8 }),
      ],
      REFS,
      HALF,
    );
    expect(ranked.map((a) => [a.playerId, a.score])).toEqual([
      ['B', 48.4127],
      ['A', 39.7993],
    ]);
  });

  it('peut aussi favoriser davantage de jetons mais moins de parties', () => {
    // C : 2 000 jetons, 5 parties → 50 ; D : 1 000 jetons, 7 parties → 45,5882.
    expect(
      order([
        acc('D', { currentTokens: 1000, gamesPlayed: 7 }),
        acc('C', { currentTokens: 2000, gamesPlayed: 5 }),
      ]),
    ).toEqual(['C', 'D']);
  });

  it('les poids décident de l’arbitrage entre les deux critères', () => {
    const players = [
      acc('riche', { currentTokens: 2000, gamesPlayed: 2 }),
      acc('assidu', { currentTokens: 900, gamesPlayed: 12 }),
    ];
    expect(order(players, { tokensBps: 8000, gamesBps: 2000 })).toEqual(['riche', 'assidu']);
    expect(order(players, { tokensBps: 2000, gamesBps: 8000 })).toEqual(['assidu', 'riche']);
  });

  it('inclut tous les participants, même ceux passés sous le seuil de jetons', () => {
    const ranked = order([
      acc('elimine', { currentTokens: 0, gamesPlayed: 6 }),
      acc('actif', { currentTokens: 1400, gamesPlayed: 6 }),
      acc('absent', { currentTokens: 1000, gamesPlayed: 0 }),
    ]);
    expect(ranked).toHaveLength(3);
    expect(ranked).toEqual(['actif', 'absent', 'elimine']);
  });

  it('le score d’un joueur ne dépend pas des autres participants', () => {
    const a = acc('a', { currentTokens: 1250, gamesPlayed: 6 });
    const alone = rankAccounts([a], REFS, HALF)[0]!.score;
    const crowd = rankAccounts(
      [
        a,
        acc('b', { currentTokens: 9000, gamesPlayed: 60 }),
        acc('c', { currentTokens: 0, gamesPlayed: 1 }),
      ],
      REFS,
      HALF,
    ).find((r) => r.playerId === 'a')!.score;
    expect(crowd).toBe(alone);
  });

  describe('égalités exactes : départage déterministe sans privilégier un critère', () => {
    // X (1 000 jetons, 10 parties) et Y (250 jetons, 40 parties) : 50 points chacun.
    const x = (o = {}) => acc('X', { currentTokens: 1000, gamesPlayed: 10, ...o });
    const y = (o = {}) => acc('Y', { currentTokens: 250, gamesPlayed: 40, ...o });

    it('scores EXACTEMENT égaux avec des profils opposés', () => {
      expect(score(1000, 10)).toBe(50);
      expect(score(250, 40)).toBe(50);
      expect(higher([1000, 10], [250, 40]) || higher([250, 40], [1000, 10])).toBe(false);
    });

    it('un écart invisible à 4 décimales n’est PAS une égalité : le score exact classe', () => {
      expect(score(1_000_001, 10)).toBe(score(1_000_000, 10));
      expect(
        order([
          acc('moins', { currentTokens: 1_000_000, gamesPlayed: 10, gamesWon: 9 }),
          acc('plus', { currentTokens: 1_000_001, gamesPlayed: 10, gamesWon: 0 }),
        ]),
      ).toEqual(['plus', 'moins']);
    });

    it('parties gagnées DESC départagent, quel que soit le profil favorisé', () => {
      expect(order([x({ gamesWon: 2 }), y({ gamesWon: 5 })])).toEqual(['Y', 'X']);
      expect(order([x({ gamesWon: 5 }), y({ gamesWon: 2 })])).toEqual(['X', 'Y']);
    });

    it('puis date d’inscription ASC', () => {
      expect(
        order([
          x({ gamesWon: 3, registeredAt: at('2026-10-10T12:00:00Z') }),
          y({ gamesWon: 3, registeredAt: at('2026-10-10T11:00:00Z') }),
        ]),
      ).toEqual(['Y', 'X']);
    });

    it('puis identifiant : même ordre quel que soit l’ordre d’entrée', () => {
      const one = order([acc('y', { currentTokens: 1 }), acc('x', { currentTokens: 1 })]);
      const two = order([acc('x', { currentTokens: 1 }), acc('y', { currentTokens: 1 })]);
      expect(one).toEqual(['x', 'y']);
      expect(two).toEqual(one);
    });
  });
});
