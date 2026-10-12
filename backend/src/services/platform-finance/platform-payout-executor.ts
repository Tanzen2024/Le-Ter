import type { PlatformFinanceRepository } from '../../repositories/platform-finance.repository';
import { BackgroundTasks } from '../../utils/background-tasks';
import type { Logger } from '../../utils/logger';
import type { PlatformPayoutService } from './platform-payout.service';

export const DEFAULT_PLATFORM_PAYOUT_TICK_MS = 30_000;
/** Délai minimal entre deux relectures d'un même retrait. */
const RECHECK_MS = 60_000;

/**
 * Exécuteur des retraits de la plateforme (D-078), relu dans PostgreSQL à chaque passage
 * (reprise après redémarrage, plusieurs instances) :
 * 1. envois revendiqués sans résultat (arrêt pendant l'appel) → UNCERTAIN, jamais renvoyés ;
 * 2. retraits READY envoyés, SEULEMENT si l'exécution est activée (sinon rien) ;
 * 3. retraits envoyés ou incertains relus chez CinetPay (même chemin que la notification).
 * Une erreur ne décide rien : le passage suivant reprend.
 */
export class PlatformPayoutExecutor {
  private handle?: NodeJS.Timeout;
  private running = false;
  private readonly background = new BackgroundTasks();

  constructor(
    private readonly deps: {
      payouts: PlatformPayoutService;
      repository: Pick<PlatformFinanceRepository, 'findForLookup'>;
      logger: Logger;
      clock?: () => Date;
      tickMs?: number;
    },
  ) {}

  start(): void {
    if (this.handle) return;
    this.handle = setInterval(
      () => this.background.run(() => this.tick()),
      this.deps.tickMs ?? DEFAULT_PLATFORM_PAYOUT_TICK_MS,
    );
    this.handle.unref();
    this.background.run(() => this.tick());
  }

  stop(): void {
    if (this.handle) clearInterval(this.handle);
    this.handle = undefined;
  }

  idle(): Promise<void> {
    return this.background.idle();
  }

  async tick() {
    const report = { recovered: 0, submitted: 0, deferred: 0, checked: 0, failed: 0 };
    if (this.running) return report;
    this.running = true;
    try {
      report.recovered = await this.deps.payouts.recoverStaleSubmissions();
      const executed = await this.deps.payouts.executeReady();
      report.submitted = executed.submitted;
      report.deferred = executed.deferred;
      if (this.deps.payouts.canLookup) {
        const now = (this.deps.clock?.() ?? new Date()).getTime();
        const open = await this.deps.repository.findForLookup({
          limit: 20,
          checkedBefore: new Date(now - RECHECK_MS),
        });
        for (const payout of open) {
          report.checked += 1;
          try {
            await this.deps.payouts.check(payout.id);
          } catch (err) {
            report.failed += 1;
            this.deps.logger.warn('platform payout check failed', {
              payoutId: payout.id,
              errorName: err instanceof Error ? err.name : typeof err,
            });
          }
        }
      }
      if (report.recovered + report.submitted + report.deferred + report.checked > 0) {
        this.deps.logger.info('platform payout tick', { ...report });
      }
    } catch (err) {
      this.deps.logger.error('platform payout tick failed', {
        errorName: err instanceof Error ? err.name : typeof err,
      });
    } finally {
      this.running = false;
    }
    return report;
  }
}
