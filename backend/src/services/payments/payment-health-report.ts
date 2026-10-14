import type { CinetPayEnv } from '../../config/env';
import { publicUrlProblems, type PublicUrlProblem } from '../../config/public-url';
import type { PaymentRepository } from '../../repositories/payment.repository';
import {
  STUCK_PAYMENT_AGE_MS,
  type PaymentHealthMonitor,
  type PaymentHealthSnapshot,
} from './payment-health';

/**
 * Santé des paiements pour l'administration (`GET /api/admin/system`, D-100), en niveaux
 * DISTINCTS : configuration locale, URL joignables depuis Internet, état du fournisseur déduit
 * des appels réels (authentification, réseau), réconciliateur, paiements en attente. Aucun
 * paiement n'est créé, aucun secret ni URL n'est renvoyé, aucune donnée de payeur.
 *
 * `status` : `OK`, `DEGRADED` (alerte sans panne d'accès) ou `DOWN` (fournisseur inaccessible,
 * IP refusée, configuration absente). Un paiement individuel refusé ne compte jamais.
 */
export interface PaymentHealthReport extends PaymentHealthSnapshot {
  status: 'OK' | 'DEGRADED' | 'DOWN';
  configured: boolean;
  environment?: CinetPayEnv['environment'];
  urls?: { notify: PublicUrlProblem[]; return: PublicUrlProblem[] };
  pending?: {
    pending: number;
    uncertain: number;
    stuck: number;
    stuckAfterMinutes: number;
    oldestPendingAt?: string;
  };
}

export function createPaymentHealthReport(deps: {
  health: PaymentHealthMonitor;
  repository: Pick<PaymentRepository, 'summarizePending'>;
  cinetpay?: CinetPayEnv;
  clock?: () => Date;
}): () => Promise<PaymentHealthReport> {
  return async () => {
    const now = (deps.clock ?? (() => new Date()))();
    const snapshot = deps.health.snapshot();
    const summary = await deps.repository
      .summarizePending(new Date(now.getTime() - STUCK_PAYMENT_AGE_MS))
      .catch(() => undefined);
    const urls = deps.cinetpay && {
      notify: publicUrlProblems(deps.cinetpay.notifyUrl),
      return: publicUrlProblems(deps.cinetpay.returnUrl),
    };
    // En développement, http seul n'empêche pas CinetPay de joindre une URL publique.
    const unreachableUrl = (problems: PublicUrlProblem[]) =>
      problems.some((p) => p !== 'NOT_HTTPS');
    const alerts = [
      ...snapshot.alerts,
      ...(!deps.cinetpay ? ['PROVIDER_NOT_CONFIGURED'] : []),
      ...(urls && unreachableUrl(urls.notify) ? ['NOTIFY_URL_NOT_PUBLIC'] : []),
      ...(urls && unreachableUrl(urls.return) ? ['RETURN_URL_NOT_PUBLIC'] : []),
      ...(summary && summary.stuck > 0 ? ['PAYMENTS_STUCK'] : []),
      ...(!summary ? ['PENDING_SUMMARY_UNAVAILABLE'] : []),
    ];
    const down =
      !deps.cinetpay ||
      ['IP_NOT_ALLOWED', 'AUTH_REFUSED', 'UNREACHABLE'].includes(snapshot.provider.state);
    return {
      status: down ? 'DOWN' : alerts.length > 0 ? 'DEGRADED' : 'OK',
      configured: Boolean(deps.cinetpay),
      ...(deps.cinetpay && { environment: deps.cinetpay.environment }),
      ...(urls && { urls }),
      ...snapshot,
      alerts,
      ...(summary && {
        pending: {
          pending: summary.pending,
          uncertain: summary.uncertain,
          stuck: summary.stuck,
          stuckAfterMinutes: STUCK_PAYMENT_AGE_MS / 60_000,
          ...(summary.oldestPendingAt && {
            oldestPendingAt: summary.oldestPendingAt.toISOString(),
          }),
        },
      }),
    };
  };
}
