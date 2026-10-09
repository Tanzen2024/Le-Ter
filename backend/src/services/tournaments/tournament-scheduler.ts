import type { TournamentId } from '../../domain/tournaments/tournament';
import type { TournamentRepository } from '../../repositories/tournament.repository';
import { BackgroundTasks } from '../../utils/background-tasks';
import type { Logger } from '../../utils/logger';
import type { TournamentService } from './tournament.service';

/** Intervalle du balayage des échéances de tournoi. */
export const DEFAULT_TOURNAMENT_TICK_MS = 15_000;

/**
 * Horloge des tournois (D-054). Les échéances (ouverture et fermeture des inscriptions,
 * début, fin) et les étapes de clôture vivent dans PostgreSQL ; ce planificateur ne fait
 * que DÉCLENCHER, à chaque tick, les commandes idempotentes de TournamentService :
 *
 *   1. reprise : parties terminées d'une table de tournoi pas encore réglées ;
 *   2. `advance` de chaque tournoi dont une transition est due.
 *
 * Aucun état en mémoire : un redémarrage, ou plusieurs instances, ne perdent ni ne
 * doublent rien (chaque transition relit et verrouille la ligne du tournoi).
 */
export class TournamentScheduler {
  private handle?: NodeJS.Timeout;
  private running = false;
  private readonly background = new BackgroundTasks();

  constructor(
    private readonly deps: {
      tournaments: TournamentService;
      repository: TournamentRepository;
      logger: Logger;
      clock?: () => Date;
      tickMs?: number;
    },
  ) {}

  start(): void {
    if (this.handle) return;
    this.handle = setInterval(
      () => this.background.run(() => this.tick()),
      this.deps.tickMs ?? DEFAULT_TOURNAMENT_TICK_MS,
    );
    this.handle.unref();
    this.background.run(() => this.tick());
  }

  stop(): void {
    if (this.handle) clearInterval(this.handle);
    this.handle = undefined;
  }

  /** Attend la fin du tick en cours (arrêt propre, tests). */
  idle(): Promise<void> {
    return this.background.idle();
  }

  /**
   * Un passage complet ; sans effet si un passage est déjà en cours. Ne rejette jamais :
   * lancé en arrière-plan, un rejet non géré arrêterait le processus Node. Une base
   * indisponible (délai dépassé, connexion perdue) est journalisée et le tick suivant
   * réessaie, sans nouvelle tentative immédiate.
   */
  async tick(): Promise<{ settled: number; advanced: number }> {
    if (this.running) return { settled: 0, advanced: 0 };
    this.running = true;
    try {
      const settled = await this.step('tournament games recovery failed', () =>
        this.deps.tournaments.settlePendingGames(),
      );
      let advanced = 0;
      const now = this.deps.clock?.() ?? new Date();
      const due = await this.step('tournament due lookup failed', () =>
        this.deps.repository.findDue(now),
      );
      for (const id of due ?? []) {
        await this.advance(id);
        advanced += 1;
      }
      return { settled: settled ?? 0, advanced };
    } finally {
      this.running = false;
    }
  }

  /** Exécute une étape du tick ; en cas d'échec, journalise et renvoie `undefined`. */
  private async step<T>(message: string, work: () => Promise<T>): Promise<T | undefined> {
    const startedAt = Date.now();
    try {
      return await work();
    } catch (err) {
      this.fail(message, err, { durationMs: Date.now() - startedAt });
      return undefined;
    }
  }

  private async advance(id: TournamentId): Promise<void> {
    try {
      await this.deps.tournaments.advance(id);
    } catch (err) {
      this.fail('tournament advance failed', err, { tournamentId: id });
    }
  }

  private fail(message: string, err: unknown, context: Record<string, unknown> = {}): void {
    // `cause` : pg-pool enveloppe l'erreur réseau d'origine (ex. délai de connexion).
    const cause = err instanceof Error && err.cause instanceof Error ? err.cause.message : undefined;
    this.deps.logger.error(message, {
      ...context,
      error: err instanceof Error ? err.message : String(err),
      ...(cause && { cause }),
    });
  }
}
