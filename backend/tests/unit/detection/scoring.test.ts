import {
  aggregateSubjectScore,
  alertFor,
  computeScores,
  riskLevelOf,
  type ScorableSignal,
  type SuspicionScore,
} from '../../../src/domain/detection/detection';
import {
  ALERT_CONFIG,
  BEHAVIOR_CONTRIBUTIONS,
  DETECTION_ALGORITHM_VERSION,
  GEOLOCATION_CONFIG,
  RISK_LEVELS,
  SCORING_CONFIG,
  SUSPICION_SCORING_ENABLED,
} from '../../../src/domain/detection/detection-config';
import type { GameId, PlayerId } from '../../../src/domain/game/game-id';

/** Score V2 et alertes internes (R-36, étape 4, D-048) : fonctions pures. */

const GAME = 'game-a' as GameId;
const OTHER_GAME = 'game-b' as GameId;
const [A, B, C] = ['a', 'b', 'c'] as [PlayerId, PlayerId, PlayerId];
const NOW = new Date('2026-10-08T12:00:00Z');
const V = DETECTION_ALGORITHM_VERSION;

let n = 0;
const signal = (overrides: Partial<ScorableSignal> = {}): ScorableSignal => ({
  id: `s-${(n += 1).toString().padStart(3, '0')}`,
  gameId: GAME,
  type: 'CONNECTION_PATTERN',
  severity: 'low',
  contribution: BEHAVIOR_CONTRIBUTIONS.CONNECTION_PATTERN,
  playerIds: [A, B],
  createdAt: NOW,
  algorithmVersion: 1,
  ...overrides,
});
const score = (signals: ScorableSignal[]) =>
  aggregateSubjectScore(GAME, signals, { algorithmVersion: V, computedAt: NOW });

describe('Configuration', () => {
  it('score activé (V2), niveaux 0/25/50/75 réutilisés, alertes HIGH/VERY_HIGH', () => {
    expect(SUSPICION_SCORING_ENABLED).toBe(true);
    expect(V).toBe(2);
    expect(RISK_LEVELS.map((l) => l.min)).toEqual([0, 25, 50, 75]);
    expect(ALERT_CONFIG.levels).toEqual({ high: 'NORMAL', very_high: 'PRIORITY' });
    expect(SCORING_CONFIG.signalValidityDays).toBe(30);
  });
});

describe('Score', () => {
  it('aucun signal : 0, faible', () => {
    expect(score([])).toMatchObject({ score: 0, level: 'low', components: [], signalCount: 0 });
    expect(computeScores(GAME, [], V, NOW)).toEqual([]);
  });

  it('un signal faible (CONNECTION_PATTERN 10) ; un signal moyen (CARD_CHOICE_ANOMALY 20)', () => {
    expect(score([signal()])).toMatchObject({ score: 10, level: 'low', scope: 'PAIR' });
    expect(
      score([signal({ type: 'CARD_CHOICE_ANOMALY', contribution: 20, severity: 'medium' })]),
    ).toMatchObject({ score: 20, level: 'low' });
  });

  it('plusieurs signaux : somme des contributions retenues, chacune expliquée', () => {
    const result = score([
      signal({
        type: 'PROXIMITY',
        contribution: GEOLOCATION_CONFIG.contributions.PROXIMITY.strong,
      }),
      signal({ type: 'CARD_CHOICE_ANOMALY', contribution: 20, gameId: OTHER_GAME }),
      signal({ type: 'CORRELATED_WINS', contribution: 15 }),
    ]);
    expect(result).toMatchObject({ score: 55, level: 'high', signalCount: 3 });
    expect(result.components).toEqual([
      expect.objectContaining({
        type: 'CARD_CHOICE_ANOMALY',
        contribution: 20,
        sourceGameId: OTHER_GAME,
      }),
      expect.objectContaining({ type: 'CORRELATED_WINS', contribution: 15, sourceGameId: GAME }),
      expect.objectContaining({ type: 'PROXIMITY', contribution: 20 }),
    ]);
  });

  it('plafond à 100 (et plafond par type)', () => {
    const all = (
      [
        'PROXIMITY',
        'REPEATED_PROXIMITY',
        'IMPOSSIBLE_TRAVEL',
        'INCOHERENT_LOCATION',
        'FREQUENT_COPLAY',
        'CARD_CHOICE_ANOMALY',
        'CORRELATED_WINS',
        'CONNECTION_PATTERN',
      ] as const
    ).map((type) => signal({ type, contribution: 100 }));
    expect(score(all)).toMatchObject({ score: 100, level: 'very_high' });
    expect(score([signal({ type: 'PROXIMITY', contribution: 100 })]).score).toBe(35);
  });

  it('déterministe : même entrée, dans n’importe quel ordre → même score et mêmes composantes', () => {
    const input = [
      signal({ type: 'PROXIMITY', contribution: 20 }),
      signal({ type: 'PROXIMITY', contribution: 20, createdAt: new Date(NOW.getTime() - 1) }),
      signal({ type: 'CORRELATED_WINS', contribution: 15 }),
    ];
    const first = score(input);
    expect(score([...input].reverse())).toEqual(first);
    expect(score(input)).toEqual(first);
    // À contribution égale : le signal le plus récent est retenu.
    expect(first.components.find((c) => c.type === 'PROXIMITY')!.signalId).toBe(input[0]!.id);
  });
});

describe('Niveaux', () => {
  it.each([
    [0, 'low'],
    [24, 'low'],
    [25, 'moderate'],
    [49, 'moderate'],
    [50, 'high'],
    [74, 'high'],
    [75, 'very_high'],
    [100, 'very_high'],
  ])('%p → %p', (value, level) => {
    expect(riskLevelOf(value)).toBe(level);
  });
});

describe('Agrégation', () => {
  it('signaux d’un même joueur : sujet individuel (PLAYER)', () => {
    const [result] = computeScores(
      GAME,
      [
        signal({ type: 'IMPOSSIBLE_TRAVEL', contribution: 15, playerIds: [A] }),
        signal({ type: 'INCOHERENT_LOCATION', contribution: 10, playerIds: [A] }),
      ],
      V,
      NOW,
    );
    expect(result).toMatchObject({ subjectKey: 'a', scope: 'PLAYER', score: 25 });
  });

  it('paire : l’ordre des joueurs (signal orienté) ne crée pas un second sujet', () => {
    const scores = computeScores(
      GAME,
      [
        signal({ type: 'CARD_CHOICE_ANOMALY', contribution: 20, playerIds: [A, B] }),
        signal({ type: 'CARD_CHOICE_ANOMALY', contribution: 20, playerIds: [B, A] }),
      ],
      V,
      NOW,
    );
    expect(scores).toHaveLength(1);
    expect(scores[0]).toMatchObject({ subjectKey: 'a|b', score: 20 });
  });

  it('joueurs différents : sujets séparés (A, A|B, A|C)', () => {
    const scores = computeScores(
      GAME,
      [
        signal({ playerIds: [A, B] }),
        signal({ playerIds: [A, C], contribution: 5 }),
        signal({ type: 'IMPOSSIBLE_TRAVEL', playerIds: [A], contribution: 15 }),
      ],
      V,
      NOW,
    );
    expect(scores.map((s) => [s.subjectKey, s.score]).sort()).toEqual([
      ['a', 15],
      ['a|b', 10],
      ['a|c', 5],
    ]);
  });

  it('aucun double comptage : même signal, ou même constat répété dans plusieurs parties', () => {
    const once = signal({ type: 'FREQUENT_COPLAY', contribution: 10 });
    expect(score([once, once]).score).toBe(10);
    const repeated = [GAME, OTHER_GAME].map((gameId) =>
      signal({ type: 'FREQUENT_COPLAY', contribution: 10, gameId }),
    );
    expect(score(repeated)).toMatchObject({ score: 10, signalCount: 2 });
  });
});

describe('Alertes internes', () => {
  const withLevel = (value: number, types: number): SuspicionScore => ({
    ...score([]),
    subjectKey: 'a|b',
    playerIds: [A, B],
    scope: 'PAIR',
    score: value,
    level: riskLevelOf(value),
    components: (['PROXIMITY', 'CORRELATED_WINS', 'CARD_CHOICE_ANOMALY'] as const)
      .slice(0, types)
      .map((type) => ({ type, contribution: 10 })),
  });

  it('LOW et MODERATE : aucune alerte', () => {
    expect(alertFor(withLevel(10, 2), 'id')).toBeNull();
    expect(alertFor(withLevel(40, 3), 'id')).toBeNull();
  });

  it('HIGH : alerte NORMAL ; VERY_HIGH : alerte PRIORITY', () => {
    expect(alertFor(withLevel(55, 2), 'id')).toMatchObject({
      type: 'SUSPICION_LEVEL',
      level: 'high',
      priority: 'NORMAL',
      score: 55,
      scope: 'PAIR',
      signalTypes: ['PROXIMITY', 'CORRELATED_WINS'],
    });
    expect(alertFor(withLevel(80, 3), 'id')).toMatchObject({
      level: 'very_high',
      priority: 'PRIORITY',
    });
  });

  it('un seul type de signal ne crée jamais d’alerte, même à un niveau élevé', () => {
    expect(alertFor(withLevel(60, 1), 'id')).toBeNull();
  });

  it('clé de déduplication déterministe : sujet, niveau, version, période', () => {
    const a = alertFor(withLevel(55, 2), 'x')!;
    const b = alertFor(withLevel(58, 3), 'y')!;
    expect(a.dedupeKey).toBe(b.dedupeKey);
    expect(a.dedupeKey).toBe(
      `SUSPICION_LEVEL|a|b|high|v2|${a.periodStart.toISOString().slice(0, 10)}`,
    );
    expect(alertFor(withLevel(80, 2), 'z')!.dedupeKey).not.toBe(a.dedupeKey);
    expect(alertFor({ ...withLevel(55, 2), subjectKey: 'a|c' }, 'w')!.dedupeKey).not.toBe(
      a.dedupeKey,
    );
  });
});
