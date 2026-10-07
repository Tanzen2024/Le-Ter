import type { Logger } from '../../utils/logger';
import type { GameService } from '../game/game.service';
import type { SessionService } from '../sessions/session.service';

/** Intervalle du balayage des échéances dépassées. */
export const DEFAULT_SWEEP_INTERVAL_MS = 5_000;

export interface RecoveryReport {
  /** Timers de tour réarmés (échéance future). */
  turnTimersScheduled: number;
  /** Tours expirés pendant l'arrêt : TURN_TIMEOUT traité immédiatement. */
  turnTimeoutsProcessed: number;
  /** Coups automatiques en attente repris. */
  autoPlaysRetried: number;
  /** Timers de décision réarmés (échéance future). */
  decisionTimersScheduled: number;
  /** Rondes de décision expirées (AUTO_LEAVE) ou à ouvrir, traitées immédiatement. */
  decisionsProcessed: number;
}

/**
 * Timers PERSISTANTS (D-034). Les deux échéances vivent dans PostgreSQL :
 *
 *   - timer A, décision Poursuivre/Quitter : `session_decision_rounds.deadline_at` → AUTO_LEAVE ;
 *   - timer B, tour de jeu : `games.turn_deadline_at` → TURN_TIMEOUT → coup automatique.
 *
 * Les timers en mémoire n'en sont que des copies. Ce superviseur les RECONSTRUIT au
 * démarrage (échéance future → timer réarmé ; échéance passée → traitée immédiatement),
 * puis BALAIE périodiquement les échéances dépassées : une instance arrêtée ou plantée ne
 * laisse ainsi aucune échéance orpheline, même en multi-instance.
 *
 * Il ne modifie jamais la base lui-même : il déclenche des commandes métier
 * (GameService.handleTurnTimeout, SessionService.syncSession), idempotentes, qui relisent
 * l'état sous verrou ou version. Un double déclenchement (timer + balayage, deux instances)
 * ne produit donc qu'un seul effet.
 */
export class DeadlineSupervisor {
  private sweepHandle?: NodeJS.Timeout;
  private sweeping = false;

  constructor(
    private readonly deps: {
      games: GameService;
      sessions: SessionService;
      logger: Logger;
      clock?: () => Date;
      sweepIntervalMs?: number;
    },
  ) {}

  /** Reconstruction complète des timers depuis PostgreSQL (démarrage). */
  async recover(): Promise<RecoveryReport> {
    const report: RecoveryReport = {
      turnTimersScheduled: 0,
      turnTimeoutsProcessed: 0,
      autoPlaysRetried: 0,
      decisionTimersScheduled: 0,
      decisionsProcessed: 0,
    };
    const now = this.now();
    for (const deadline of await this.deps.games.findTurnDeadlines()) {
      await this.guard('TURN_TIMEOUT', deadline.gameId, async () => {
        if (deadline.timedOut) {
          await this.deps.games.retryAutomaticPlay(deadline.gameId);
          report.autoPlaysRetried += 1;
        } else if (deadline.deadlineAt.getTime() <= now) {
          await this.deps.games.handleTurnTimeout(deadline.gameId);
          report.turnTimeoutsProcessed += 1;
        } else {
          this.deps.games.syncTurnTimer({
            id: deadline.gameId,
            status: 'in_progress',
            turnDeadlineAt: deadline.deadlineAt,
          });
          report.turnTimersScheduled += 1;
        }
      });
    }
    const decisions = await this.deps.sessions.recoverDecisionTimers();
    report.decisionTimersScheduled = decisions.scheduled;
    report.decisionsProcessed = decisions.processed;
    this.deps.logger.info('deadline timers recovered', { ...report });
    return report;
  }

  /**
   * Traite les échéances DÉPASSÉES uniquement (balayage périodique), y compris un coup
   * automatique resté en attente après TURN_TIMEOUT (instance arrêtée entre les deux
   * écritures, panne passagère de PostgreSQL) : sans cela, la partie resterait bloquée
   * jusqu'au prochain redémarrage. La reprise est idempotente (commandId par tour).
   */
  async sweep(): Promise<void> {
    if (this.sweeping) {
      return;
    }
    this.sweeping = true;
    try {
      const now = this.now();
      for (const deadline of await this.deps.games.findTurnDeadlines()) {
        if (deadline.timedOut) {
          await this.guard('AUTO_CARD_PLAY', deadline.gameId, () =>
            this.deps.games.retryAutomaticPlay(deadline.gameId),
          );
        } else if (deadline.deadlineAt.getTime() <= now) {
          await this.guard('TURN_TIMEOUT', deadline.gameId, () =>
            this.deps.games.handleTurnTimeout(deadline.gameId),
          );
        }
      }
      await this.deps.sessions.recoverDecisionTimers();
    } catch (err) {
      this.deps.logger.error('deadline sweep failed', {
        error: err instanceof Error ? err.message : String(err),
      });
    } finally {
      this.sweeping = false;
    }
  }

  /** Reprise au démarrage, puis balayage périodique. */
  async start(): Promise<RecoveryReport> {
    const report = await this.recover();
    const interval = this.deps.sweepIntervalMs ?? DEFAULT_SWEEP_INTERVAL_MS;
    this.sweepHandle = setInterval(() => void this.sweep(), interval);
    this.sweepHandle.unref();
    return report;
  }

  stop(): void {
    if (this.sweepHandle) {
      clearInterval(this.sweepHandle);
      this.sweepHandle = undefined;
    }
  }

  private now(): number {
    return (this.deps.clock?.() ?? new Date()).getTime();
  }

  /** Une échéance en échec n'empêche pas de traiter les suivantes. */
  private async guard(action: string, gameId: string, run: () => Promise<unknown>): Promise<void> {
    try {
      await run();
    } catch (err) {
      this.deps.logger.error('deadline processing failed', {
        action,
        gameId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
}
