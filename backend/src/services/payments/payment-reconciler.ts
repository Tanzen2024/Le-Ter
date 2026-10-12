import { PaymentVerificationError } from '../../domain/payments/payment';
import type { PaymentRepository } from '../../repositories/payment.repository';
import { BackgroundTasks } from '../../utils/background-tasks';
import type { Logger } from '../../utils/logger';
import { CinetPayError } from './cinetpay/cinetpay-client';
import type { PaymentService } from './payment.service';

/** Intervalle entre deux passages du réconciliateur. */
export const DEFAULT_RECONCILE_TICK_MS = 30_000;
/** Paiements revérifiés au plus par passage. */
export const DEFAULT_RECONCILE_BATCH_SIZE = 20;
/** Âge minimal : laisse au joueur le temps de payer et à la notification le temps d'arriver. */
export const DEFAULT_RECONCILE_MIN_AGE_MS = 30_000;
/** Délai minimal entre deux vérifications d'un même paiement (toutes origines confondues). */
export const DEFAULT_RECONCILE_RECHECK_MS = 60_000;
/** Au-delà, le paiement n'est plus revérifié automatiquement (rapprochement administratif). */
export const DEFAULT_RECONCILE_MAX_AGE_MS = 7 * 24 * 60 * 60_000;
/** Nouvelle tentative après une erreur : base doublée à chaque échec, plafonnée. */
export const DEFAULT_RECONCILE_RETRY_BASE_MS = 60_000;
export const DEFAULT_RECONCILE_RETRY_MAX_MS = 30 * 60_000;

const MAX_TRACKED_FAILURES = 10_000;

export interface PaymentReconcilerOptions {
  tickMs?: number;
  batchSize?: number;
  minAgeMs?: number;
  recheckMs?: number;
  maxAgeMs?: number;
  retryBaseMs?: number;
  retryMaxMs?: number;
}

export interface ReconcileReport {
  /** Paiements sélectionnés pendant ce passage. */
  checked: number;
  /** Réglés par ce passage (SUCCESS crédité, ou FAILED / EXPIRED). */
  settled: number;
  /** Toujours en attente chez le fournisseur (INITIATED, PENDING…). */
  pending: number;
  /** Déjà réglés entre-temps par un autre chemin (notification, lecture, administration). */
  alreadyFinal: number;
  /** Vérification impossible (fournisseur, réponse invalide) : nouvelle tentative différée. */
  failed: number;
}

/**
 * Réconciliation automatique des paiements CinetPay (D-050). Sans notification reçue (URL
 * injoignable, notification perdue) et sans application ouverte, un paiement payé resterait
 * PENDING : ce planificateur relit périodiquement les paiements en attente dans PostgreSQL et
 * déclenche `PaymentService.reconcile`, c'est-à-dire la MÊME vérification serveur à serveur et
 * le MÊME règlement idempotent que la notification et l'administration.
 *
 * Il n'écrit jamais lui-même : le règlement verrouille le paiement puis le compte de jeu, et
 * ne crédite que lors du passage `pending` → `succeeded`. Un double déclenchement (deux
 * passages, deux instances, notification simultanée) ne produit donc qu'un seul crédit. Une
 * erreur du fournisseur ne change rien en base : le paiement reste PENDING et la nouvelle
 * tentative est différée (backoff exponentiel, en mémoire de cette instance).
 */
export class PaymentReconciler {
  private handle?: NodeJS.Timeout;
  private running = false;
  private stopped = false;
  private readonly background = new BackgroundTasks();
  /** Échecs consécutifs par paiement et date de la prochaine tentative autorisée. */
  private readonly failures = new Map<string, { count: number; retryAt: number }>();

  constructor(
    private readonly deps: {
      payments: Pick<PaymentService, 'reconcile'>;
      repository: Pick<PaymentRepository, 'findPendingForReconciliation'>;
      logger: Logger;
      clock?: () => Date;
      options?: PaymentReconcilerOptions;
    },
  ) {}

  start(): void {
    if (this.handle) return;
    this.stopped = false;
    this.handle = setInterval(
      () => this.background.run(() => this.tick()),
      this.deps.options?.tickMs ?? DEFAULT_RECONCILE_TICK_MS,
    );
    this.handle.unref();
    // Reprise au démarrage : paiements restés en attente pendant l'arrêt.
    this.background.run(() => this.tick());
  }

  /** Plus aucun passage ; le passage en cours s'arrête après le paiement en cours. */
  stop(): void {
    this.stopped = true;
    if (this.handle) clearInterval(this.handle);
    this.handle = undefined;
  }

  /** Attend la fin du passage en cours (arrêt propre, tests). */
  idle(): Promise<void> {
    return this.background.idle();
  }

  /**
   * Un passage complet ; sans effet si un passage est déjà en cours. Ne rejette jamais :
   * lancé en arrière-plan, un rejet non géré arrêterait le processus Node.
   */
  async tick(): Promise<ReconcileReport> {
    const report: ReconcileReport = {
      checked: 0,
      settled: 0,
      pending: 0,
      alreadyFinal: 0,
      failed: 0,
    };
    if (this.running) return report;
    this.running = true;
    const startedAt = Date.now();
    try {
      const options = this.deps.options ?? {};
      const now = this.now();
      const candidates = await this.deps.repository.findPendingForReconciliation({
        limit: options.batchSize ?? DEFAULT_RECONCILE_BATCH_SIZE,
        createdBefore: new Date(now - (options.minAgeMs ?? DEFAULT_RECONCILE_MIN_AGE_MS)),
        createdAfter: new Date(now - (options.maxAgeMs ?? DEFAULT_RECONCILE_MAX_AGE_MS)),
        lastCheckedBefore: new Date(now - (options.recheckMs ?? DEFAULT_RECONCILE_RECHECK_MS)),
        excludeIds: this.deferred(now),
      });
      for (const payment of candidates) {
        if (this.stopped) break;
        report.checked += 1;
        await this.reconcileOne(payment.id, report);
      }
      if (report.checked > 0) {
        this.deps.logger.info('payment reconciliation tick', {
          ...report,
          durationMs: Date.now() - startedAt,
        });
      }
    } catch (err) {
      // Base indisponible : journalisé, le passage suivant réessaie.
      this.deps.logger.error('payment reconciliation lookup failed', {
        errorName: err instanceof Error ? err.name : typeof err,
        durationMs: Date.now() - startedAt,
      });
    } finally {
      this.running = false;
    }
    return report;
  }

  private async reconcileOne(paymentId: string, report: ReconcileReport): Promise<void> {
    try {
      const { outcome } = await this.deps.payments.reconcile(paymentId);
      this.failures.delete(paymentId);
      if (outcome === 'settled') report.settled += 1;
      else if (outcome === 'pending') report.pending += 1;
      else report.alreadyFinal += 1;
    } catch (err) {
      report.failed += 1;
      const count = (this.failures.get(paymentId)?.count ?? 0) + 1;
      const options = this.deps.options ?? {};
      const retryInMs = Math.min(
        (options.retryBaseMs ?? DEFAULT_RECONCILE_RETRY_BASE_MS) * 2 ** (count - 1),
        options.retryMaxMs ?? DEFAULT_RECONCILE_RETRY_MAX_MS,
      );
      if (this.failures.size >= MAX_TRACKED_FAILURES) this.failures.clear();
      this.failures.set(paymentId, { count, retryAt: this.now() + retryInMs });
      // Seulement des noms, codes et statuts : jamais de secret, de jeton ni de donnée payeur.
      this.deps.logger.warn('payment reconciliation failed', {
        paymentId,
        errorName: err instanceof Error ? err.name : typeof err,
        ...(err instanceof CinetPayError && { kind: err.kind, ...err.details }),
        ...(err instanceof PaymentVerificationError && { reason: err.reason }),
        attempt: count,
        retryInMs,
      });
    }
  }

  /** Paiements dont la nouvelle tentative n'est pas encore due. */
  private deferred(now: number): string[] {
    const ids: string[] = [];
    for (const [id, { retryAt }] of this.failures) {
      if (retryAt > now) ids.push(id);
    }
    return ids;
  }

  private now(): number {
    return (this.deps.clock?.() ?? new Date()).getTime();
  }
}
