import type { Logger } from '../../utils/logger';
import type { CinetPayCallOutcome } from './cinetpay/cinetpay-client';
import {
  PROVIDER_OUTAGE_CATEGORIES,
  type PaymentFailureCategory,
  type PaymentFailureInfo,
} from './payment-failure';
import type { ReconcileReport } from './payment-reconciler';

/**
 * État du fournisseur VU PAR CE SERVEUR, déduit des appels réels (D-100) :
 * - `OK` : dernière authentification acceptée et dernier appel abouti ;
 * - `IP_NOT_ALLOWED` / `AUTH_REFUSED` : CinetPay refuse l'accès (action sur le compte marchand) ;
 * - `UNREACHABLE` : réseau, DNS, délai ou 5xx sur les derniers appels ;
 * - `UNKNOWN` : aucun appel depuis le démarrage.
 * Un paiement individuel refusé (montant, opérateur) ne rend jamais le fournisseur indisponible.
 */
export type ProviderState = 'OK' | 'IP_NOT_ALLOWED' | 'AUTH_REFUSED' | 'UNREACHABLE' | 'UNKNOWN';

/** Fenêtre et seuil d'alerte sur les échecs d'initialisation imputables au fournisseur. */
export const INIT_FAILURE_WINDOW_MS = 15 * 60_000;
export const INIT_FAILURE_ALERT_THRESHOLD = 5;
/** Un paiement en attente depuis plus longtemps est signalé comme bloqué. */
export const STUCK_PAYMENT_AGE_MS = 60 * 60_000;
/** Réconciliateur considéré à l'arrêt sans passage réussi depuis ce délai. */
export const RECONCILER_STALE_MS = 5 * 60_000;

export interface PendingPaymentsSummary {
  pending: number;
  /** Paiements directs à l'issue d'initialisation inconnue (recherchés chez CinetPay). */
  uncertain: number;
  /** En attente depuis plus de `STUCK_PAYMENT_AGE_MS`. */
  stuck: number;
  oldestPendingAt?: Date;
}

export interface PaymentHealthSnapshot {
  provider: {
    state: ProviderState;
    since?: string;
    lastAuthentication?: { at: string; accepted: boolean; httpStatus?: number; apiCode?: number };
    lastCall?: { at: string; outcome: CinetPayCallOutcome['type'] };
  };
  initializationFailures: {
    windowMinutes: number;
    byCategory: Partial<Record<PaymentFailureCategory, number>>;
    providerFailures: number;
    alert: boolean;
  };
  reconciler: {
    running: boolean;
    lastTickAt?: string;
    lastSuccessAt?: string;
    lastReport?: ReconcileReport;
    consecutiveLookupFailures: number;
    stale: boolean;
  };
  alerts: string[];
}

/**
 * Surveillance des paiements (D-100), en mémoire de CETTE instance : aucune donnée de payeur,
 * aucun secret, aucune référence de paiement. Les transitions d'état du fournisseur sont
 * journalisées UNE fois (`PAYMENT_PROVIDER_ALERT` en `error`, `PAYMENT_PROVIDER_RECOVERED`).
 */
export class PaymentHealthMonitor {
  private state: ProviderState = 'UNKNOWN';
  private since?: Date;
  private lastAuth?: { at: Date; accepted: boolean; httpStatus?: number; apiCode?: number };
  private lastCall?: { at: Date; outcome: CinetPayCallOutcome['type'] };
  private initFailures: { at: number; category: PaymentFailureCategory }[] = [];
  private initAlertRaised = false;
  private reconciler = {
    running: false,
    lastTickAt: undefined as Date | undefined,
    lastSuccessAt: undefined as Date | undefined,
    lastReport: undefined as ReconcileReport | undefined,
    consecutiveLookupFailures: 0,
  };

  constructor(
    private readonly logger: Logger,
    private readonly clock: () => Date = () => new Date(),
  ) {}

  /** Résultat d'un appel HTTP à CinetPay (branché sur le client). */
  recordCall(outcome: CinetPayCallOutcome): void {
    const now = this.clock();
    this.lastCall = { at: now, outcome: outcome.type };
    switch (outcome.type) {
      case 'auth_accepted':
        this.lastAuth = { at: now, accepted: true };
        this.transition('OK');
        return;
      case 'auth_refused':
        this.lastAuth = {
          at: now,
          accepted: false,
          ...(outcome.httpStatus !== undefined && { httpStatus: outcome.httpStatus }),
          ...(outcome.apiCode !== undefined && { apiCode: outcome.apiCode }),
        };
        this.transition(outcome.ipNotAllowed ? 'IP_NOT_ALLOWED' : 'AUTH_REFUSED', {
          httpStatus: outcome.httpStatus,
          apiCode: outcome.apiCode,
        });
        return;
      case 'unreachable':
      case 'timeout':
      case 'server_error':
        this.transition('UNREACHABLE', { cause: outcome.type });
        return;
      case 'response':
        // Une réponse lisible prouve que le fournisseur répond et que le jeton est accepté.
        if (this.state === 'UNREACHABLE' || this.state === 'UNKNOWN') this.transition('OK');
        return;
    }
  }

  /** Échec d'une demande de paiement (après classification). */
  recordInitializationFailure(info: PaymentFailureInfo): void {
    const now = this.clock().getTime();
    this.initFailures.push({ at: now, category: info.category });
    this.prune(now);
    const providerFailures = this.providerFailureCount();
    if (providerFailures >= INIT_FAILURE_ALERT_THRESHOLD && !this.initAlertRaised) {
      this.initAlertRaised = true;
      this.logger.error('PAYMENT_PROVIDER_ALERT', {
        alert: 'INITIALIZATION_FAILURES',
        providerFailures,
        windowMinutes: INIT_FAILURE_WINDOW_MS / 60_000,
        lastCategory: info.category,
      });
    }
  }

  reconcileStarted(): void {
    this.reconciler.running = true;
  }

  reconcileStopped(): void {
    this.reconciler.running = false;
  }

  /** Passage du réconciliateur ; `lookupFailed` : la base n'a pas pu être lue. */
  recordReconcileTick(report: ReconcileReport, lookupFailed: boolean): void {
    const now = this.clock();
    this.reconciler.lastTickAt = now;
    this.reconciler.lastReport = report;
    if (lookupFailed) {
      this.reconciler.consecutiveLookupFailures += 1;
      return;
    }
    this.reconciler.consecutiveLookupFailures = 0;
    this.reconciler.lastSuccessAt = now;
  }

  snapshot(): PaymentHealthSnapshot {
    const now = this.clock();
    this.prune(now.getTime());
    const byCategory: Partial<Record<PaymentFailureCategory, number>> = {};
    for (const { category } of this.initFailures) {
      byCategory[category] = (byCategory[category] ?? 0) + 1;
    }
    const providerFailures = this.providerFailureCount();
    const r = this.reconciler;
    const stale =
      r.running &&
      (!r.lastSuccessAt || now.getTime() - r.lastSuccessAt.getTime() > RECONCILER_STALE_MS);
    const alerts = [
      ...(this.state === 'IP_NOT_ALLOWED' ? ['PROVIDER_IP_NOT_ALLOWED'] : []),
      ...(this.state === 'AUTH_REFUSED' ? ['PROVIDER_AUTH_REFUSED'] : []),
      ...(this.state === 'UNREACHABLE' ? ['PROVIDER_UNREACHABLE'] : []),
      ...(providerFailures >= INIT_FAILURE_ALERT_THRESHOLD ? ['INITIALIZATION_FAILURES'] : []),
      ...(stale ? ['RECONCILER_STALE'] : []),
    ];
    return {
      provider: {
        state: this.state,
        ...(this.since && { since: this.since.toISOString() }),
        ...(this.lastAuth && {
          lastAuthentication: {
            at: this.lastAuth.at.toISOString(),
            accepted: this.lastAuth.accepted,
            ...(this.lastAuth.httpStatus !== undefined && { httpStatus: this.lastAuth.httpStatus }),
            ...(this.lastAuth.apiCode !== undefined && { apiCode: this.lastAuth.apiCode }),
          },
        }),
        ...(this.lastCall && {
          lastCall: { at: this.lastCall.at.toISOString(), outcome: this.lastCall.outcome },
        }),
      },
      initializationFailures: {
        windowMinutes: INIT_FAILURE_WINDOW_MS / 60_000,
        byCategory,
        providerFailures,
        alert: providerFailures >= INIT_FAILURE_ALERT_THRESHOLD,
      },
      reconciler: {
        running: r.running,
        ...(r.lastTickAt && { lastTickAt: r.lastTickAt.toISOString() }),
        ...(r.lastSuccessAt && { lastSuccessAt: r.lastSuccessAt.toISOString() }),
        ...(r.lastReport && { lastReport: r.lastReport }),
        consecutiveLookupFailures: r.consecutiveLookupFailures,
        stale,
      },
      alerts,
    };
  }

  private transition(next: ProviderState, context: Record<string, unknown> = {}): void {
    if (next === this.state) return;
    const previous = this.state;
    this.state = next;
    this.since = this.clock();
    if (next === 'OK') {
      if (previous !== 'UNKNOWN') {
        this.logger.info('PAYMENT_PROVIDER_RECOVERED', { previous });
      }
      return;
    }
    this.logger.error('PAYMENT_PROVIDER_ALERT', {
      alert: `PROVIDER_${next}`,
      previous,
      ...Object.fromEntries(Object.entries(context).filter(([, v]) => v !== undefined)),
    });
  }

  private providerFailureCount(): number {
    return this.initFailures.filter((f) => PROVIDER_OUTAGE_CATEGORIES.has(f.category)).length;
  }

  private prune(now: number): void {
    this.initFailures = this.initFailures.filter((f) => now - f.at <= INIT_FAILURE_WINDOW_MS);
    if (this.providerFailureCount() < INIT_FAILURE_ALERT_THRESHOLD) this.initAlertRaised = false;
    if (this.initFailures.length > 1_000) this.initFailures = this.initFailures.slice(-1_000);
  }
}
