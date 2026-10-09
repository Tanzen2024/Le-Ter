import {
  controlDecisions,
  evaluateCardChoice,
  evaluateConnectionPattern,
  evaluateCoplay,
  evaluateCorrelatedWins,
  type ControlDecision,
  type GameOutcome,
  type SharedTable,
} from '../../../src/domain/detection/behavior-analysis';
import {
  algorithmIdOf,
  DETECTION_THRESHOLDS,
  SIGNAL_ALGORITHM_VERSIONS,
} from '../../../src/domain/detection/detection-config';
import type { GameId, PlayerId } from '../../../src/domain/game/game-id';
import { declinesAgainst, finishedGame, takesAgainst } from '../../fixtures/detection-history';

/** Analyses comportementales (R-36, étape 3, D-047) : fonctions pures. */

const [X, Y, Z, W] = ['x', 'y', 'z', 'w'] as [PlayerId, PlayerId, PlayerId, PlayerId];

describe('Versions des algorithmes', () => {
  it('chaque type a une version explicite : FREQUENT_COPLAY_V1…', () => {
    expect(algorithmIdOf('FREQUENT_COPLAY')).toBe('FREQUENT_COPLAY_V1');
    expect(algorithmIdOf('CARD_CHOICE_ANOMALY')).toBe('CARD_CHOICE_ANOMALY_V1');
    expect(algorithmIdOf('CORRELATED_WINS')).toBe('CORRELATED_WINS_V1');
    expect(algorithmIdOf('CONNECTION_PATTERN')).toBe('CONNECTION_PATTERN_V1');
    expect(Object.values(SIGNAL_ALGORITHM_VERSIONS).every((v) => v >= 1)).toBe(true);
  });
});

describe('FREQUENT_COPLAY', () => {
  const stats = (gamesTogether: number, sessionsTogether: number, a: number, b: number) => ({
    gamesTogether,
    sessionsTogether,
    gamesOfFirst: a,
    gamesOfSecond: b,
  });

  it('historique insuffisant : aucun signal', () => {
    expect(evaluateCoplay(stats(4, 4, 4, 4))).toBeNull();
    expect(evaluateCoplay(stats(0, 0, 0, 0))).toBeNull();
  });

  it('paire fréquente : assez de parties, plusieurs tables, grande part pour chacun', () => {
    expect(evaluateCoplay(stats(8, 3, 10, 9))).toEqual({
      gamesTogether: 8,
      sessionsTogether: 3,
      gamesOfFirst: 10,
      gamesOfSecond: 9,
      shareOfFirst: 0.8,
      shareOfSecond: 0.889,
    });
  });

  it('une seule longue table ne suffit pas (répétition sur plusieurs tables)', () => {
    expect(evaluateCoplay(stats(8, 1, 8, 8))).toBeNull();
  });

  it('joueurs très actifs avec d’autres : fréquence normale, aucun signal', () => {
    expect(evaluateCoplay(stats(8, 4, 40, 9))).toBeNull();
  });
});

describe('CARD_CHOICE_ANOMALY : reconstruction des décisions', () => {
  it('ne retient que les vrais choix (jamais le meneur, jamais un choix unique, jamais le 5e tour)', () => {
    const game = finishedGame({ players: [Y, X], tricks: declinesAgainst(X, Y) });
    const result = controlDecisions(game);
    expect(result).toEqual({
      decisions: [
        { gameId: game.id, trickNumber: 1, deciderId: X, controllerId: Y, tookControl: false },
        { gameId: game.id, trickNumber: 2, deciderId: X, controllerId: Y, tookControl: false },
      ],
    });
  });

  it('prise de contrôle reconnue', () => {
    const game = finishedGame({ players: [Z, X], tricks: takesAgainst(X, Z) });
    const result = controlDecisions(game) as { decisions: ControlDecision[] };
    expect(result.decisions.map((d) => [d.trickNumber, d.controllerId, d.tookControl])).toEqual([
      [1, Z, true],
      [3, Z, true],
    ]);
  });

  it('timeout : les coups automatiques (commandId auto-play) sont exclus', () => {
    const game = finishedGame({
      players: [Y, X],
      tricks: declinesAgainst(X, Y),
      recentCommandIds: (id) => [`auto-play:${id}:1:1`, 'client-command-1'],
    });
    const result = controlDecisions(game) as { decisions: ControlDecision[] };
    expect(result.decisions.map((d) => d.trickNumber)).toEqual([2]);
  });

  it('historique des commandes saturé : partie exclue (timeouts non vérifiables)', () => {
    const game = finishedGame({
      players: [Y, X],
      tricks: declinesAgainst(X, Y),
      recentCommandIds: () => Array.from({ length: 50 }, (_, i) => `c-${i}`),
    });
    expect(controlDecisions(game)).toEqual({ excluded: 'COMMAND_HISTORY_INCOMPLETE' });
  });

  it.each(['INSTANT_WIN', 'INSTANT_WIN_TIE', 'ADMIN_STOP'] as const)(
    'partie terminée par %s : exclue',
    (endReason) => {
      const game = finishedGame({ players: [Y, X], tricks: [], endReason });
      expect(controlDecisions(game)).toEqual({ excluded: 'NOT_PLAYED_TO_THE_END' });
    },
  );

  it('le 5e tour automatique n’est jamais une décision', () => {
    // Au 5e tour, X avait encore le choix… mais le tour est joué par le système.
    const tricks = declinesAgainst(X, Y);
    const game = finishedGame({ players: [Y, X], tricks });
    const result = controlDecisions(game) as { decisions: ControlDecision[] };
    expect(result.decisions.every((d) => d.trickNumber < 5)).toBe(true);
  });

  it('fuite : le joueur parti (aucune carte) n’a aucune décision, les autres restent analysés', () => {
    const game = finishedGame({ players: [Y, X, W], tricks: declinesAgainst(X, Y), fled: [W] });
    const result = controlDecisions(game) as { decisions: ControlDecision[] };
    expect(result.decisions).toHaveLength(2);
    expect(result.decisions.some((d) => d.deciderId === W)).toBe(false);
  });
});

describe('CARD_CHOICE_ANOMALY : statistiques', () => {
  const decisions = (controllerId: PlayerId, count: number, declined: number): ControlDecision[] =>
    Array.from({ length: count }, (_, i) => ({
      gameId: `g-${controllerId}-${i}` as GameId,
      trickNumber: 1,
      deciderId: X,
      controllerId,
      tookControl: i >= declined,
    }));

  it('données insuffisantes : aucun signal', () => {
    expect(evaluateCardChoice([...decisions(Y, 7, 7), ...decisions(Z, 20, 0)], X, Y)).toBeNull();
    // Pas de référence personnelle face aux autres : aucun signal non plus.
    expect(evaluateCardChoice([...decisions(Y, 20, 20), ...decisions(Z, 7, 0)], X, Y)).toBeNull();
  });

  it('comportement normal (même taux face à tous) : aucun signal', () => {
    expect(evaluateCardChoice([...decisions(Y, 10, 6), ...decisions(Z, 10, 6)], X, Y)).toBeNull();
  });

  it('comportement atypique face à un même contrôleur : signal documenté', () => {
    expect(
      evaluateCardChoice([...decisions(Y, 10, 9), ...decisions(Z, 10, 2)], X, Y),
    ).toMatchObject({
      deciderId: X,
      controllerId: Y,
      opportunitiesWithController: 10,
      declinedWithController: 9,
      declineRateWithController: 0.9,
      declineRateWithOthers: 0.2,
    });
  });

  it('joueur prudent avec tout le monde : aucun signal (écart insuffisant)', () => {
    expect(evaluateCardChoice([...decisions(Y, 10, 9), ...decisions(Z, 10, 8)], X, Y)).toBeNull();
  });
});

describe('CORRELATED_WINS', () => {
  let n = 0;
  const game = (players: PlayerId[], winnerId: PlayerId): GameOutcome => ({
    gameId: `g-${(n += 1)}` as GameId,
    playerIds: players,
    winnerId,
  });
  const repeat = (count: number, make: (i: number) => GameOutcome) =>
    Array.from({ length: count }, (_, i) => make(i));

  it('échantillon insuffisant : aucun signal', () => {
    expect(
      evaluateCorrelatedWins(
        repeat(7, () => game([X, Y, Z], X)),
        [X, Y],
      ),
    ).toBeNull();
  });

  it('parties à 2 joueurs ignorées : la paire gagne toujours, non informatif', () => {
    expect(
      evaluateCorrelatedWins(
        repeat(20, () => game([X, Y], X)),
        [X, Y],
      ),
    ).toBeNull();
  });

  it('corrélation normale (résultats proches du hasard) : aucun signal', () => {
    const outcomes = repeat(12, (i) => game([X, Y, Z], [X, Y, Z][i % 3]!));
    expect(evaluateCorrelatedWins(outcomes, [X, Y])).toBeNull();
  });

  it('corrélation forte : la paire gagne presque toutes ses parties communes à 4', () => {
    const outcomes = repeat(10, (i) => game([X, Y, Z, W], i % 2 ? X : Y));
    const found = evaluateCorrelatedWins(outcomes, [X, Y]);
    expect(found).toMatchObject({
      gamesTogether: 10,
      pairWins: 10,
      winsOfFirst: 5,
      winsOfSecond: 5,
      observedRate: 1,
      expectedRate: 0.5,
    });
    expect(found!.zScore).toBeGreaterThanOrEqual(DETECTION_THRESHOLDS.correlatedWins.minZScore);
  });

  it('pas de faux positif évident : un joueur fort gagne aussi sans l’autre', () => {
    const withY = repeat(10, () => game([X, Y, Z], X));
    const withoutY = repeat(10, () => game([X, Z, W], X));
    expect(evaluateCorrelatedWins([...withY, ...withoutY], [X, Y])).toBeNull();
  });
});

describe('CONNECTION_PATTERN', () => {
  const at = (minutes: number, seconds = 0) => new Date(Date.UTC(2026, 9, 1, 12, minutes, seconds));
  const table = (gapSeconds: number, logins?: [number, number]): SharedTable => ({
    joinedFirst: at(10),
    joinedSecond: at(10, gapSeconds),
    loginFirst: logins ? at(5, logins[0]) : null,
    loginSecond: logins ? at(5, logins[1]) : null,
  });

  it('aucune donnée disponible : aucun signal', () => {
    expect(evaluateConnectionPattern([])).toBeNull();
  });

  it('arrivées synchronisées répétées : signal, sans aucune donnée réseau', () => {
    const found = evaluateConnectionPattern([table(3), table(5), table(8), table(600)]);
    expect(found).toEqual({
      tablesTogether: 4,
      synchronizedTables: 3,
      synchronizedArrivals: 3,
      synchronizedLogins: 0,
      medianArrivalGapSeconds: 7,
    });
    expect(JSON.stringify(found)).not.toMatch(/ip|address/i);
  });

  it('connexions synchronisées juste avant la table comptent aussi', () => {
    const found = evaluateConnectionPattern([
      table(300, [0, 4]),
      table(400, [10, 12]),
      table(500, [20, 30]),
    ]);
    expect(found).toMatchObject({ synchronizedTables: 3, synchronizedLogins: 3 });
  });

  it('arrivées espacées ou occasionnelles : aucun signal', () => {
    expect(evaluateConnectionPattern([table(300), table(400), table(500)])).toBeNull();
    expect(
      evaluateConnectionPattern([table(3), table(5), table(8), ...Array(5).fill(table(900))]),
    ).toBeNull();
  });
});
