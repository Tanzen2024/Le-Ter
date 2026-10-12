import type { WithdrawalRepository } from '../../repositories/withdrawal.repository';
import { BackgroundTasks } from '../../utils/background-tasks';
import type { Logger } from '../../utils/logger';
import { CinetPayError } from '../payments/cinetpay/cinetpay-client';
import type { WithdrawalService } from './withdrawal.service';

export const DEFAULT_WITHDRAWAL_RECONCILE_TICK_MS = 30_000;
const DEFAULT_BATCH_SIZE = 20;
/** Âge minimal : laisse la requête du joueur envoyer elle-même le transfert. */
const DEFAULT_MIN_AGE_MS = 60_000;
/** Délai minimal entre deux relectures d'un même retrait (toutes origines confondues). */
const DEFAULT_RECHECK_MS = 60_000;
const DEFAULT_RETRY_BASE_MS = 60_000;
const DEFAULT_RETRY_MAX_MS = 30 * 60_000;
const MAX_TRACKED_FAILURES = 10_000;

export interface WithdrawalReconcilerOptions {
  tickMs?: number;
  batchSize?: number;
  minAgeMs?: number;
  recheckMs?: number;
  retryBaseMs?: number;
  retryMaxMs?: number;
}

export interface WithdrawalReconcileReport {
  checked: number;
  settled: number;
  processing: number;
  unresolved: number;
  failed: number;
}

/**
 * Réconciliation des retraits ouverts (D-075) : relit périodiquement dans PostgreSQL les
 * retraits CREATED / PROCESSING et appelle `WithdrawalService.check`, c'est-à-dire le MÊME
 * chemin que la notification (statut relu chez CinetPay, règlement idempotent). Au démarrage,
 * un premier passage reprend les retraits restés ouverts pendant l'arrêt (y compris un retrait
 * créé mais jamais envoyé).
 *
 * Il n'écrit jamais lui-même. Une erreur du fournisseur ne décide rien : le retrait reste
 * ouvert et sa prochaine relecture est différée (backoff exponentiel, mémoire de l'instance).
 */
export class WithdrawalReconciler {
  private handle?: NodeJS.Timeout;
  private running = false;
  private stopped = false;
  private readonly background = new BackgroundTasks();
  private readonly failures = new Map<string, { count: number; retryAt: number }>();

  constructor(
    private readonly deps: {
      withdrawals: Pick<WithdrawalService, 'check'>;
      repository: Pick<WithdrawalRepository, 'findOpenForReconciliation'>;
      logger: Logger;
      clock?: () => Date;
      options?: WithdrawalReconcilerOptions;
    },
  ) {}

  start(): void {
    if (this.handle) return;
    this.stopped = false;
    this.handle = setInterval(
      () => this.background.run(() => this.tick()),
      this.deps.options?.tickMs ?? DEFAULT_WITHDRAWAL_RECONCILE_TICK_MS,
    );
    this.handle.unref();
    this.background.run(() => this.tick());
  }

  stop(): void {
    this.stopped = true;
    if (this.handle) clearInterval(this.handle);
    this.handle = undefined;
  }

  idle(): Promise<void> {
    return this.background.idle();
  }

  /** Un passage complet ; ne rejette jamais (lancé en arrière-plan). */
  async tick(): Promise<WithdrawalReconcileReport> {
    const report: WithdrawalReconcileReport = {
      checked: 0,
      settled: 0,
      processing: 0,
      unresolved: 0,
      failed: 0,
    };
    if (this.running) return report;
    this.running = true;
    try {
      const options = this.deps.options ?? {};
      const now = this.now();
      const candidates = await this.deps.repository.findOpenForReconciliation({
        limit: options.batchSize ?? DEFAULT_BATCH_SIZE,
        createdBefore: new Date(now - (options.minAgeMs ?? DEFAULT_MIN_AGE_MS)),
        lastCheckedBefore: new Date(now - (options.recheckMs ?? DEFAULT_RECHECK_MS)),
        excludeIds: this.deferred(now),
      });
      for (const withdrawal of candidates) {
        if (this.stopped) break;
        report.checked += 1;
        await this.checkOne(withdrawal.id, report);
      }
      if (report.checked > 0) this.deps.logger.info('withdrawal reconciliation tick', { ...report });
    } catch (err) {
      this.deps.logger.error('withdrawal reconciliation lookup failed', {
        errorName: err instanceof Error ? err.name : typeof err,
      });
    } finally {
      this.running = false;
    }
    return report;
  }

  private async checkOne(id: string, report: WithdrawalReconcileReport): Promise<void> {
    try {
      const { outcome } = await this.deps.withdrawals.check(id);
      this.failures.delete(id);
      if (outcome === 'settled' || outcome === 'already_final') report.settled += 1;
      else if (outcome === 'processing') report.processing += 1;
      else report.unresolved += 1;
    } catch (err) {
      report.failed += 1;
      const count = (this.failures.get(id)?.count ?? 0) + 1;
      const options = this.deps.options ?? {};
      const retryInMs = Math.min(
        (options.retryBaseMs ?? DEFAULT_RETRY_BASE_MS) * 2 ** (count - 1),
        options.retryMaxMs ?? DEFAULT_RETRY_MAX_MS,
      );
      if (this.failures.size >= MAX_TRACKED_FAILURES) this.failures.clear();
      this.failures.set(id, { count, retryAt: this.now() + retryInMs });
      this.deps.logger.warn('withdrawal reconciliation failed', {
        withdrawalId: id,
        errorName: err instanceof Error ? err.name : typeof err,
        ...(err instanceof CinetPayError && { kind: err.kind, ...err.details }),
        attempt: count,
        retryInMs,
      });
    }
  }

  private deferred(now: number): string[] {
    const ids: string[] = [];
    for (const [id, { retryAt }] of this.failures) if (retryAt > now) ids.push(id);
    return ids;
  }

  private now(): number {
    return (this.deps.clock?.() ?? new Date()).getTime();
  }
}
