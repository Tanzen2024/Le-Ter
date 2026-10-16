import {
  capitalRatioGamesReference,
  DEFAULT_RANKING_WEIGHTS,
  rankAccounts,
  rankingReferences,
  rankTournamentAccounts,
  scoreBreakdown,
  tournamentRankingRules,
  type RankingRules,
} from '../../../src/domain/tournaments/tournament';
import type { UserId } from '../../../src/domain/users/user';

/**
 * Classement D-106 : `100 × (poids_jetons × jetons/capital + poids_parties × min(parties,
 * référence)/référence)`, règles figées au démarrage, départage déterministe enregistré.
 */
const at = (iso: string) => new Date(iso);
const PERIOD = { startsAt: at('2026-10-12T18:00:00Z'), endsAt: at('2026-10-12T20:00:00Z') };
const RULES: RankingRules = {
  method: 'D106_CAPITAL_RATIO',
  weights: DEFAULT_RANKING_WEIGHTS,
  tokensReference: 1000,
  gamesReference: 42,
};

const acc = (
  playerId: string,
  o: { currentTokens: number; gamesPlayed?: number; gamesWon?: number; registeredAt?: Date },
) => ({
  playerId: playerId as UserId,
  initialTokens: 1000,
  gamesPlayed: 0,
  gamesWon: 0,
  registeredAt: at('2026-10-10T10:00:00Z'),
  ...o,
});

describe('références et règles figées', () => {
  it('parties de référence : durée / 170 s, au moins 1', () => {
    expect(capitalRatioGamesReference(PERIOD)).toBe(42);
    expect(
      capitalRatioGamesReference({
        startsAt: at('2026-10-12T18:00:00Z'),
        endsAt: at('2026-10-12T18:01:00Z'),
      }),
    ).toBe(1);
  });

  it('méthode et références FIGÉES sur le tournoi priment ; démarré sans méthode → D-062', () => {
    const base = { ...PERIOD, initialTournamentTokens: 1000 };
    expect(
      tournamentRankingRules({
        ...base,
        startedAt: PERIOD.startsAt,
        rankingMethod: 'D106_CAPITAL_RATIO',
        rankingGamesReference: 7,
        rankingWeights: { tokensBps: 6000, gamesBps: 4000 },
      }),
    ).toEqual({
      method: 'D106_CAPITAL_RATIO',
      weights: { tokensBps: 6000, gamesBps: 4000 },
      tokensReference: 1000,
      gamesReference: 7,
    });
    expect(tournamentRankingRules({ ...base, startedAt: PERIOD.startsAt }).method).toBe(
      'D062_SATURATING',
    );
  });
});

describe('score D-106', () => {
  it('formule exacte, poids 50 / 50 et 60 / 40', () => {
    const s = (tokens: number, games: number, rules = RULES) =>
      scoreBreakdown({ tokens, initialTokens: 1000, gamesPlayed: games }, rules);
    expect(s(1000, 42)).toMatchObject({ score: 100, tokensRatio: 1, gamesRatio: 1 });
    expect(s(1100, 1)).toMatchObject({ score: 56.1905, tokensPoints: 55, gamesPoints: 1.1905 });
    expect(s(0, 0)).toMatchObject({ score: 0, tokensRatio: 0, gamesRatio: 0 });
    const sixtyForty = { ...RULES, weights: { tokensBps: 6000, gamesBps: 4000 } };
    expect(s(500, 21, sixtyForty).score).toBe(50); // 60 × 0,5 + 40 × 0,5
  });

  it('parties plafonnées à la référence : jouer plus ne rapporte plus', () => {
    const s = (games: number) =>
      scoreBreakdown({ tokens: 1000, initialTokens: 1000, gamesPlayed: games }, RULES).score;
    expect(s(42)).toBe(s(80));
    expect(s(41)).toBeLessThan(s(42));
  });

  it('plus de jetons que le capital : ratio > 1, score au-delà de 100 possible', () => {
    const r = scoreBreakdown({ tokens: 3000, initialTokens: 1000, gamesPlayed: 42 }, RULES);
    expect(r.tokensRatio).toBe(3);
    expect(r.score).toBe(200);
  });
});

describe('classement et départage', () => {
  it('ordre par score exact ; égalité : parties gagnées, inscription, identifiant ; critère enregistré', () => {
    const ranked = rankTournamentAccounts(
      [
        acc('d', { currentTokens: 1000 }),
        acc('a', { currentTokens: 1100, gamesPlayed: 1, gamesWon: 1 }),
        acc('c', { currentTokens: 1000, registeredAt: at('2026-10-09T10:00:00Z') }),
        acc('b', { currentTokens: 900, gamesPlayed: 1 }),
        acc('e', { currentTokens: 1000 }),
      ],
      RULES,
    );
    expect(ranked.map((r) => r.playerId)).toEqual(['a', 'c', 'd', 'e', 'b']);
    expect(ranked.map((r) => r.tieBreak)).toEqual([
      undefined,
      'REGISTRATION_ORDER',
      'REGISTRATION_ORDER', // d, séparé de c (au-dessus) par l'inscription
      'PLAYER_ID', // e, séparé de d par l'identifiant
      undefined,
    ]);
    // Éliminé (0 jeton) et sans partie : toujours classé.
    const withZero = rankTournamentAccounts(
      [acc('z', { currentTokens: 0, gamesPlayed: 3 }), acc('y', { currentTokens: 1000 })],
      RULES,
    );
    expect(withZero.map((r) => [r.playerId, r.score])).toEqual([
      ['y', 50],
      ['z', 3.5714],
    ]);
  });

  it('déterministe : l’ordre d’entrée ne change rien', () => {
    const list = [
      acc('a', { currentTokens: 1200, gamesPlayed: 3 }),
      acc('b', { currentTokens: 1200, gamesPlayed: 3, gamesWon: 2 }),
      acc('c', { currentTokens: 800, gamesPlayed: 10 }),
    ];
    const ids = (l: typeof list) => rankTournamentAccounts(l, RULES).map((r) => r.playerId);
    expect(ids([...list].reverse())).toEqual(ids(list));
    expect(rankTournamentAccounts(list, RULES)[0]).toMatchObject({
      playerId: 'b',
      tieBreak: 'GAMES_WON',
    });
  });

  it('méthode D-062 conservée à l’identique pour les tournois démarrés avant D-106', () => {
    const list = [
      acc('a', { currentTokens: 1200, gamesPlayed: 1 }),
      acc('b', { currentTokens: 1000 }),
      acc('c', { currentTokens: 900, gamesPlayed: 5 }),
    ];
    const refs = rankingReferences({ initialTournamentTokens: 1000, ...PERIOD });
    const legacy = rankAccounts(list, refs, DEFAULT_RANKING_WEIGHTS);
    const viaRules = rankTournamentAccounts(list, {
      method: 'D062_SATURATING',
      weights: DEFAULT_RANKING_WEIGHTS,
      tokensReference: refs.tokens,
      gamesReference: refs.games,
    });
    expect(viaRules.map((r) => [r.playerId, r.score])).toEqual(
      legacy.map((r) => [r.playerId, r.score]),
    );
  });
});
