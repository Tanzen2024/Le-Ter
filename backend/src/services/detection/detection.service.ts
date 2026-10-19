import { randomUUID } from 'node:crypto';

import {
  aggregateSubjectScore,
  alertFor,
  assertValidSignal,
  SignalOutsideGameError,
  subjectKeyOf,
  type DetectionSignal,
  type SignalDraft,
  type SuspicionScore,
} from '../../domain/detection/detection';
import {
  DETECTION_ALGORITHM_VERSION,
  SCORING_CONFIG,
  SIGNAL_ALGORITHM_VERSIONS,
  SUSPICION_SCORING_ENABLED,
} from '../../domain/detection/detection-config';
import type { Game } from '../../domain/game/game';
import type { GameId, PlayerId } from '../../domain/game/game-id';
import {
  DetectionDisabledError,
  type DetectionRepository,
} from '../../repositories/detection.repository';
import { BackgroundTasks } from '../../utils/background-tasks';
import { KeyedSerialQueue } from '../../utils/keyed-serial-queue';
import type { Logger } from '../../utils/logger';
import { announceToAdmin, type AdminEventPublisher } from '../../websocket/admin-event-bus';
import type { DetectionGlobalSwitch } from './detection-settings.service';

/** Ce qu'une analyse reçoit : UNE partie, jamais l'état d'une autre. */
export interface DetectionContext {
  gameId: GameId;
  /** Copie de la partie observée (lecture seule pour la détection). */
  game: Game;
  playerIds: readonly PlayerId[];
  now: Date;
}

/**
 * Une analyse branchée sur le socle (étapes 2 et 3 : proximité, parties communes,
 * comportement des cartes…). Elle PROPOSE des signaux ; le service les valide et les
 * enregistre. Aucune analyse n'est branchée à l'étape 1.
 */
export interface DetectionAnalyzer {
  readonly name: string;
  analyze(context: DetectionContext): Promise<SignalDraft[]> | SignalDraft[];
}

export interface DetectionServiceDependencies {
  repository: DetectionRepository;
  /** Interrupteur GLOBAL (D-053), consulté avant tout autre travail. */
  globalSwitch: DetectionGlobalSwitch;
  logger: Logger;
  clock?: () => Date;
  /** Analyses branchées (étape 2 : analyses géographiques). */
  analyzers?: readonly DetectionAnalyzer[];
  /**
   * Calcul et stockage des scores (défaut : `SUSPICION_SCORING_ENABLED`, faux jusqu'à
   * l'étape 4). Désactivé, seuls les signaux sont enregistrés.
   */
  scoringEnabled?: boolean;
  /**
   * Temps réel de l'administration (D-116) : signal après l'enregistrement d'une nouvelle
   * alerte. Facultatif et sans garantie : l'alerte est dans PostgreSQL.
   */
  adminEvents?: AdminEventPublisher;
}

/** Issue d'un enregistrement : `skipped` quand la détection est désactivée pour la partie. */
export type RecordResult =
  | { skipped: true; recorded: 0 }
  | { skipped: false; recorded: number; scores: SuspicionScore[]; alertsCreated?: number };

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Détection de POTENTIELLE collusion (R-36, D-044) : socle.
 *
 * - Indépendant de GameService : il OBSERVE (fin de partie) et n'agit jamais sur l'état du
 *   jeu ; le moteur ne dépend pas de lui. Ses traitements tournent en arrière-plan
 *   (`BackgroundTasks`), en file par partie (`KeyedSerialQueue`), jamais dans une commande.
 * - Unité d'isolation : la partie (`gameId`). Aucun état global de détection.
 * - Source de vérité de l'activation : `suspicionDetectionEnabled` de la table (D-043). Si
 *   elle est désactivée, le service ne lit, ne calcule et n'écrit RIEN pour la partie ; la
 *   base refuse aussi toute ligne (migration 0012).
 * - Produit des signaux et un score de RISQUE, jamais un verdict ; aucune sanction.
 */
export class DetectionService {
  private readonly clock: () => Date;
  private readonly analyzers: readonly DetectionAnalyzer[];
  private readonly scoringEnabled: boolean;
  private readonly queue = new KeyedSerialQueue<GameId>();
  private readonly background = new BackgroundTasks();

  constructor(private readonly deps: DetectionServiceDependencies) {
    this.clock = deps.clock ?? (() => new Date());
    this.analyzers = deps.analyzers ?? [];
    this.scoringEnabled = deps.scoringEnabled ?? SUSPICION_SCORING_ENABLED;
  }

  /**
   * Point de contrôle UNIQUE de l'activation : vrai seulement si l'interrupteur GLOBAL est
   * activé (D-053) ET si la table de la partie a activé la détection (D-043). Global
   * désactivé : sortie immédiate, sans même lire la partie.
   */
  async isEnabled(gameId: GameId): Promise<boolean> {
    if (!(await this.deps.globalSwitch.isGloballyEnabled())) return false;
    return (await this.deps.repository.isEnabledForGame(gameId)) === true;
  }

  /**
   * Point d'observation (fin de partie) : ne bloque jamais l'appelant (GameService) et ne
   * remonte aucune erreur ; l'analyse tourne en arrière-plan, en file pour cette partie.
   */
  observeFinishedGame(game: Game): void {
    this.background.run(() =>
      this.analyzeGame(game).catch((err: unknown) =>
        this.deps.logger.error('detection analysis failed', {
          gameId: game.id,
          error: err instanceof Error ? err.message : String(err),
        }),
      ),
    );
  }

  /** Lance les analyses branchées sur UNE partie (rien si la détection est désactivée). */
  async analyzeGame(game: Game): Promise<RecordResult> {
    const gameId = game.id;
    if (!(await this.isEnabled(gameId))) return { skipped: true, recorded: 0 };
    if (this.analyzers.length === 0) {
      return { skipped: false, recorded: 0, scores: await this.deps.repository.listScores(gameId) };
    }
    const context: DetectionContext = {
      gameId,
      game: structuredClone(game),
      playerIds: game.players.map((p) => p.playerId),
      now: this.clock(),
    };
    const drafts: SignalDraft[] = [];
    for (const analyzer of this.analyzers) {
      drafts.push(...(await analyzer.analyze(context)));
    }
    return this.recordSignals(gameId, drafts);
  }

  /**
   * Enregistre des signaux de la partie puis recalcule les scores de ses sujets (D-048), en
   * file pour cette partie. Détection désactivée : aucune validation, aucune lecture,
   * aucun score, aucune alerte, aucune écriture.
   * IDEMPOTENT : un signal déjà enregistré (même partie, type, joueurs et version
   * d'algorithme) n'est jamais enregistré une seconde fois (`recorded` = signaux nouveaux) ;
   * un instantané de score n'est réécrit que s'il change ; une alerte est dédupliquée.
   * Lève InvalidSignalError (signal invalide) ou SignalOutsideGameError (joueur étranger).
   */
  recordSignals(gameId: GameId, drafts: readonly SignalDraft[]): Promise<RecordResult> {
    return this.queue.run(gameId, async () => {
      if (!(await this.isEnabled(gameId))) return { skipped: true, recorded: 0 };
      drafts.forEach(assertValidSignal);
      const players = new Set(await this.deps.repository.playersOfGame(gameId));
      if (drafts.some((d) => d.playerIds.some((id) => !players.has(id)))) {
        throw new SignalOutsideGameError(gameId);
      }
      const now = this.clock();
      const signals: DetectionSignal[] = drafts.map((d) => ({
        ...d,
        playerIds: [...d.playerIds],
        id: randomUUID(),
        gameId,
        algorithmVersion: SIGNAL_ALGORITHM_VERSIONS[d.type],
        createdAt: now,
      }));
      try {
        const recorded = await this.deps.repository.saveSignals(gameId, signals);
        if (!this.scoringEnabled) return { skipped: false, recorded, scores: [] };
        const { scores, alertsCreated } = await this.scoreGame(gameId, now);
        return { skipped: false, recorded, scores, alertsCreated };
      } catch (err) {
        // Désactivée entre-temps (impossible aujourd'hui : réglage immuable) : rien d'écrit.
        if (err instanceof DetectionDisabledError) return { skipped: true, recorded: 0 };
        throw err;
      }
    });
  }

  /**
   * Score V2 (D-048) de chaque sujet (joueur, paire) cité par les signaux de la partie, à
   * partir de TOUS ses signaux valides (parties surveillées, `signalValidityDays`), puis
   * alertes internes. Lectures groupées : 3 requêtes, quel que soit le nombre de sujets.
   */
  private async scoreGame(
    gameId: GameId,
    now: Date,
  ): Promise<{ scores: SuspicionScore[]; alertsCreated: number }> {
    const gameSignals = await this.deps.repository.listSignals(gameId);
    const subjects = [...new Set(gameSignals.map((s) => subjectKeyOf(s.playerIds)))].sort();
    if (subjects.length === 0) return { scores: [], alertsCreated: 0 };
    const since = new Date(now.getTime() - SCORING_CONFIG.signalValidityDays * DAY_MS);
    const [subjectSignals, previous] = await Promise.all([
      this.deps.repository.listSubjectSignals(subjects, since),
      this.deps.repository.previousScores(subjects, gameId),
    ]);
    const bySubject = new Map<string, DetectionSignal[]>();
    for (const signal of subjectSignals) {
      const key = subjectKeyOf(signal.playerIds);
      bySubject.set(key, [...(bySubject.get(key) ?? []), signal]);
    }
    const scores = subjects
      .filter((key) => bySubject.has(key))
      .map((key) =>
        aggregateSubjectScore(gameId, bySubject.get(key)!, {
          algorithmVersion: DETECTION_ALGORITHM_VERSION,
          computedAt: now,
          previousScore: previous.get(key) ?? null,
          signalsSince: since,
        }),
      );
    const alerts = scores.flatMap((score) => alertFor(score, randomUUID()) ?? []);
    const alertsCreated = await this.deps.repository.saveScoring(gameId, scores, alerts, now);
    if (alertsCreated > 0)
      announceToAdmin(this.deps.adminEvents, 'DETECTION_ALERT', this.deps.logger);
    return { scores, alertsCreated };
  }

  /** Signaux d'UNE partie (usage interne / administration future). */
  listSignals(gameId: GameId): Promise<DetectionSignal[]> {
    return this.deps.repository.listSignals(gameId);
  }

  /** Scores d'UNE partie (usage interne / administration future). */
  listScores(gameId: GameId): Promise<SuspicionScore[]> {
    return this.deps.repository.listScores(gameId);
  }

  /** Historique des scores d'un sujet (administration future, étape 5). */
  listSubjectScores(playerIds: readonly PlayerId[]): Promise<SuspicionScore[]> {
    return this.deps.repository.listSubjectScores(subjectKeyOf(playerIds));
  }

  /** Alertes INTERNES (administration future, étape 5) : jamais exposées aux joueurs. */
  listAlerts(filter?: { playerIds?: readonly PlayerId[]; gameId?: GameId }) {
    return this.deps.repository.listAlerts({
      ...(filter?.playerIds && { subjectKey: subjectKeyOf(filter.playerIds) }),
      ...(filter?.gameId && { gameId: filter.gameId }),
    });
  }

  /** Attend la fin des analyses lancées en arrière-plan (arrêt du serveur, tests). */
  idle(): Promise<void> {
    return this.background.idle();
  }
}
