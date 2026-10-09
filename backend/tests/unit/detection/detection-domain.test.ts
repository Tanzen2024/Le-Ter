import {
  assertValidSignal,
  clampScore,
  computeScores,
  InvalidSignalError,
  riskLevelOf,
  subjectKeyOf,
  type SignalDraft,
} from '../../../src/domain/detection/detection';
import {
  DETECTION_ALGORITHM_VERSION,
  MAX_SUSPICION_SCORE,
  RISK_LEVELS,
  SIGNAL_RULES,
  SIGNAL_TYPES,
} from '../../../src/domain/detection/detection-config';
import type { GameId, PlayerId } from '../../../src/domain/game/game-id';

/** Socle de la détection de potentielle collusion (R-36, D-044) : règles pures. */

const GAME = 'game-a' as GameId;
const [A, B, C] = ['a', 'b', 'c'] as PlayerId[];
const NOW = new Date('2026-10-08T12:00:00Z');

const signal = (overrides: Partial<SignalDraft> = {}): SignalDraft => ({
  type: 'PROXIMITY',
  severity: 'medium',
  contribution: 10,
  playerIds: [A!, B!],
  ...overrides,
});

describe('Configuration centralisée', () => {
  it('score maximal 100, niveaux 0 / 25 / 50 / 75 dans l’ordre', () => {
    expect(MAX_SUSPICION_SCORE).toBe(100);
    expect(RISK_LEVELS.map((l) => [l.level, l.min])).toEqual([
      ['low', 0],
      ['moderate', 25],
      ['high', 50],
      ['very_high', 75],
    ]);
  });

  it('les 9 types de signaux autorisés, et seulement eux ; SHARED_IP désactivé', () => {
    expect([...SIGNAL_TYPES].sort()).toEqual(
      [
        'CARD_CHOICE_ANOMALY',
        'CONNECTION_PATTERN',
        'CORRELATED_WINS',
        'FREQUENT_COPLAY',
        'IMPOSSIBLE_TRAVEL',
        'INCOHERENT_LOCATION',
        'PROXIMITY',
        'REPEATED_PROXIMITY',
        'SHARED_IP',
      ].sort(),
    );
    expect(SIGNAL_RULES.SHARED_IP).toEqual({ enabled: false, maxContribution: 0 });
  });
});

describe('Niveaux de risque', () => {
  it.each([
    [0, 'low'],
    [24, 'low'],
    [25, 'moderate'],
    [49, 'moderate'],
    [50, 'high'],
    [74, 'high'],
    [75, 'very_high'],
    [100, 'very_high'],
    [250, 'very_high'],
  ])('score %p → %p', (score, level) => {
    expect(riskLevelOf(score)).toBe(level);
  });

  it('score toujours entre 0 et 100 (plafond, négatif, non fini)', () => {
    expect(clampScore(140)).toBe(100);
    expect(clampScore(-5)).toBe(0);
    expect(clampScore(Number.NaN)).toBe(0);
    expect(clampScore(42.4)).toBe(42);
  });
});

describe('Signaux', () => {
  it.each<[string, Partial<SignalDraft>]>([
    ['type inconnu', { type: 'GPS_SPOOF' as never }],
    ['SHARED_IP désactivé', { type: 'SHARED_IP' }],
    ['gravité inconnue', { severity: 'critical' as never }],
    ['contribution négative', { contribution: -1 }],
    ['contribution > 100', { contribution: 101 }],
    ['contribution non finie', { contribution: Number.POSITIVE_INFINITY }],
    ['aucun joueur', { playerIds: [] }],
    ['joueur en double', { playerIds: [A!, A!] }],
  ])('rejeté : %s', (_label, overrides) => {
    expect(() => assertValidSignal(signal(overrides))).toThrow(InvalidSignalError);
  });

  it('valide : PROXIMITY entre deux joueurs', () => {
    expect(() => assertValidSignal(signal())).not.toThrow();
  });

  it('clé de sujet stable, indépendante de l’ordre', () => {
    expect(subjectKeyOf([B!, A!])).toBe(subjectKeyOf([A!, B!]));
    expect(subjectKeyOf([A!])).toBe('a');
  });
});

describe('Score par sujet', () => {
  it('somme des contributions par paire, traçable par type', () => {
    const scores = computeScores(
      GAME,
      [signal({ contribution: 10 }), signal({ type: 'FREQUENT_COPLAY', contribution: 12 })],
      DETECTION_ALGORITHM_VERSION,
      NOW,
    );
    expect(scores).toEqual([
      {
        gameId: GAME,
        subjectKey: 'a|b',
        playerIds: [A, B],
        scope: 'PAIR',
        score: 22,
        level: 'low',
        previousScore: null,
        signalCount: 2,
        components: [
          { type: 'FREQUENT_COPLAY', contribution: 12 },
          { type: 'PROXIMITY', contribution: 10 },
        ],
        signalsSince: null,
        algorithmVersion: DETECTION_ALGORITHM_VERSION,
        computedAt: NOW,
      },
    ]);
  });

  it('chaque type est plafonné, le total est plafonné à 100', () => {
    // Score V2 (D-048) : un même type répété ne compte qu'une fois (sa plus forte contribution).
    const many = Array.from({ length: 10 }, () => signal({ contribution: 20 }));
    expect(computeScores(GAME, many, 2, NOW)[0]).toMatchObject({ score: 20, signalCount: 10 });
    // Contribution au-delà du plafond du type : plafonnée (PROXIMITY ≤ 35).
    expect(computeScores(GAME, [signal({ contribution: 80 })], 2, NOW)[0]).toMatchObject({
      score: 35,
      level: 'moderate',
    });

    const all = (Object.keys(SIGNAL_RULES) as (keyof typeof SIGNAL_RULES)[])
      .filter((type) => SIGNAL_RULES[type].enabled)
      .map((type) => signal({ type, contribution: 100 }));
    expect(computeScores(GAME, all, 1, NOW)[0]).toMatchObject({
      score: 100,
      level: 'very_high',
    });
  });

  it('sujets distincts : paire A-B, paire A-C, joueur seul', () => {
    const scores = computeScores(
      GAME,
      [signal(), signal({ playerIds: [C!, A!] }), signal({ playerIds: [C!], contribution: 5 })],
      1,
      NOW,
    );
    expect(scores.map((s) => [s.subjectKey, s.score]).sort()).toEqual([
      ['a|b', 10],
      ['a|c', 10],
      ['c', 5],
    ]);
  });
});
