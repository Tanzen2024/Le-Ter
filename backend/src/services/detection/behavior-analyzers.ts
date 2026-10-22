import {
  controlDecisions,
  evaluateCardChoice,
  evaluateConnectionPattern,
  evaluateCoplay,
  evaluateCorrelatedWins,
  type ControlDecision,
  type GameExclusion,
} from '../../domain/detection/behavior-analysis';
import type { SignalDraft } from '../../domain/detection/detection';
import {
  algorithmIdOf,
  BEHAVIOR_CONTRIBUTIONS,
  DETECTION_THRESHOLDS,
  type SignalType,
} from '../../domain/detection/detection-config';
import { playerPairs } from '../../domain/detection/geo';
import type { GameType } from '../../domain/game/game';
import type { GameId, PlayerId } from '../../domain/game/game-id';
import type {
  AnalysisPeriod,
  BehaviorHistoryRepository,
} from '../../repositories/behavior-history.repository';
import type { GameRepository } from '../../repositories/game.repository';
import type { DetectionAnalyzer, DetectionContext } from './detection.service';

/**
 * Analyseurs comportementaux (R-36, étape 3, D-047), branchés sur le socle (D-044).
 *
 * Analyses LONGITUDINALES : le signal est rattaché à la partie OBSERVÉE (celle qui vient de
 * se terminer, `context.gameId`) et ne cite que ses joueurs ; l'historique utilisé est
 * décrit séparément (`history`) et ne contient que des parties SURVEILLÉES terminées. Un
 * signal décrit une observation statistique, jamais une triche ni une intention.
 *
 * Éléments justificatifs minimisés : compteurs, taux, période. Jamais d'IP (aucune n'est
 * conservée), de coordonnées, de main d'un joueur ni d'identifiant d'une autre partie.
 *
 * Communs à Fap-Fap et à GARAM TIA (D-125) : l'historique est celui du JEU de la partie
 * observée (`gameTypeOf`), jamais un mélange des deux. CARD_CHOICE_ANOMALY ne lit que des
 * parties jouées jusqu'au 5e tour du Ter (`CONTROL_AFTER_LAST_TRICK`) : une manche GARAM n'en
 * produit donc aucune (décision de contrôle non définie pour GARAM), sans cas particulier.
 */

const DAY_MS = 24 * 60 * 60 * 1000;
const sortedPair = ([a, b]: [PlayerId, PlayerId]): [PlayerId, PlayerId] =>
  a < b ? [a, b] : [b, a];

function periodOf(context: DetectionContext, windowDays: number): AnalysisPeriod {
  return { since: new Date(context.now.getTime() - windowDays * DAY_MS), until: context.now };
}

/** En-tête commun : algorithme, partie observée, historique utilisé. */
function evidenceOf(
  type: SignalType,
  context: DetectionContext,
  period: AnalysisPeriod,
  windowDays: number,
  metrics: Record<string, unknown>,
): Record<string, unknown> {
  return {
    algorithm: algorithmIdOf(type),
    scope: 'LONGITUDINAL',
    observedGameId: context.gameId,
    history: {
      from: period.since.toISOString(),
      to: period.until.toISOString(),
      windowDays,
      source: 'MONITORED_FINISHED_GAMES',
    },
    metrics,
  };
}

const uniquePlayers = (context: DetectionContext) => [...new Set(context.playerIds)];
/** Jeu de la partie observée (absent : Le Ter, D-119). */
const gameTypeOf = (context: DetectionContext): GameType => context.game.gameType ?? 'TER';

export class FrequentCoplayAnalyzer implements DetectionAnalyzer {
  readonly name = 'frequent-coplay';
  constructor(private readonly history: BehaviorHistoryRepository) {}

  async analyze(context: DetectionContext): Promise<SignalDraft[]> {
    const { windowDays } = DETECTION_THRESHOLDS.coplay;
    const period = periodOf(context, windowDays);
    const drafts: SignalDraft[] = [];
    for (const pair of playerPairs(uniquePlayers(context)).map(sortedPair)) {
      const found = evaluateCoplay(
        await this.history.coplayStats(pair, period, gameTypeOf(context)),
      );
      if (!found) continue;
      drafts.push({
        type: 'FREQUENT_COPLAY',
        severity: 'low',
        contribution: BEHAVIOR_CONTRIBUTIONS.FREQUENT_COPLAY,
        playerIds: pair,
        evidence: evidenceOf('FREQUENT_COPLAY', context, period, windowDays, { ...found }),
      });
    }
    return drafts;
  }
}

export class CardChoiceAnomalyAnalyzer implements DetectionAnalyzer {
  readonly name = 'card-choice-anomaly';
  constructor(
    private readonly history: BehaviorHistoryRepository,
    private readonly games: GameRepository,
  ) {}

  async analyze(context: DetectionContext): Promise<SignalDraft[]> {
    const { windowDays, maxGamesPerPlayer } = DETECTION_THRESHOLDS.cardBehavior;
    const period = periodOf(context, windowDays);
    const players = uniquePlayers(context);
    const loaded = new Map<
      GameId,
      { decisions: ControlDecision[] } | { excluded: GameExclusion }
    >();
    const drafts: SignalDraft[] = [];

    for (const deciderId of players) {
      const ids = await this.history.playedToTheEndGameIds(
        deciderId,
        period,
        maxGamesPerPlayer,
        gameTypeOf(context),
      );
      const decisions: ControlDecision[] = [];
      const excluded: Partial<Record<GameExclusion, number>> = {};
      for (const id of ids) {
        let analysis = loaded.get(id);
        if (!analysis) {
          const game = await this.games.findById(id);
          analysis = game ? controlDecisions(game) : { excluded: 'NOT_FINISHED' };
          loaded.set(id, analysis);
        }
        if ('excluded' in analysis) {
          excluded[analysis.excluded] = (excluded[analysis.excluded] ?? 0) + 1;
        } else {
          decisions.push(...analysis.decisions.filter((d) => d.deciderId === deciderId));
        }
      }
      for (const controllerId of players) {
        if (controllerId === deciderId) continue;
        const found = evaluateCardChoice(decisions, deciderId, controllerId);
        if (!found) continue;
        drafts.push({
          type: 'CARD_CHOICE_ANOMALY',
          severity: 'medium',
          contribution: BEHAVIOR_CONTRIBUTIONS.CARD_CHOICE_ANOMALY,
          // Signal orienté : [joueur qui décide, contrôleur au moment du choix].
          playerIds: [deciderId, controllerId],
          evidence: evidenceOf('CARD_CHOICE_ANOMALY', context, period, windowDays, {
            ...found,
            gamesRead: ids.length,
            gamesExcluded: excluded,
          }),
        });
      }
    }
    return drafts;
  }
}

export class CorrelatedWinsAnalyzer implements DetectionAnalyzer {
  readonly name = 'correlated-wins';
  constructor(private readonly history: BehaviorHistoryRepository) {}

  async analyze(context: DetectionContext): Promise<SignalDraft[]> {
    const { windowDays } = DETECTION_THRESHOLDS.correlatedWins;
    const period = periodOf(context, windowDays);
    const players = uniquePlayers(context);
    const outcomes = await this.history.outcomes(players, period, gameTypeOf(context));
    const drafts: SignalDraft[] = [];
    for (const pair of playerPairs(players).map(sortedPair)) {
      const found = evaluateCorrelatedWins(outcomes, pair);
      if (!found) continue;
      drafts.push({
        type: 'CORRELATED_WINS',
        severity: 'medium',
        contribution: BEHAVIOR_CONTRIBUTIONS.CORRELATED_WINS,
        playerIds: pair,
        evidence: evidenceOf('CORRELATED_WINS', context, period, windowDays, { ...found }),
      });
    }
    return drafts;
  }
}

export class ConnectionPatternAnalyzer implements DetectionAnalyzer {
  readonly name = 'connection-pattern';
  constructor(private readonly history: BehaviorHistoryRepository) {}

  async analyze(context: DetectionContext): Promise<SignalDraft[]> {
    const { windowDays } = DETECTION_THRESHOLDS.connection;
    const period = periodOf(context, windowDays);
    const drafts: SignalDraft[] = [];
    for (const pair of playerPairs(uniquePlayers(context)).map(sortedPair)) {
      const found = evaluateConnectionPattern(
        await this.history.sharedTables(pair, period, gameTypeOf(context)),
      );
      if (!found) continue;
      drafts.push({
        type: 'CONNECTION_PATTERN',
        severity: 'low',
        contribution: BEHAVIOR_CONTRIBUTIONS.CONNECTION_PATTERN,
        playerIds: pair,
        evidence: evidenceOf('CONNECTION_PATTERN', context, period, windowDays, {
          ...found,
          // Donnée réseau : aucune (aucune IP n'est conservée par l'application).
          networkData: 'NOT_AVAILABLE',
        }),
      });
    }
    return drafts;
  }
}

/** Les quatre analyseurs comportementaux (lecture seule de l'historique surveillé). */
export function createBehaviorAnalyzers(
  history: BehaviorHistoryRepository,
  games: GameRepository,
): DetectionAnalyzer[] {
  return [
    new FrequentCoplayAnalyzer(history),
    new CardChoiceAnomalyAnalyzer(history, games),
    new CorrelatedWinsAnalyzer(history),
    new ConnectionPatternAnalyzer(history),
  ];
}
