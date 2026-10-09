import type { Request, Response } from 'express';

import { tokensForAmount, type Payment } from '../domain/payments/payment';
import { getAuth } from '../middleware/require-auth';
import type { PaymentService } from '../services/payments/payment.service';
import { toPaymentView } from '../services/wallet/wallet.service';
import { ValidationError } from '../validators/validation-error';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/**
 * Paiements (D-050) :
 *
 * - lecture d'un paiement par SON propriétaire (identité issue du JWT) ;
 * - notification CinetPay (publique) : jamais une preuve, seulement un déclencheur de
 *   vérification serveur à serveur (`PaymentService`) ;
 * - retour du navigateur après paiement : simple redirection vers l'application, sans
 *   aucun effet ni information sur l'issue (l'application relit le statut serveur).
 */
export function createPaymentController(payments: PaymentService, appReturnUrl: string) {
  return {
    async get(req: Request, res: Response): Promise<void> {
      const payment = await payments.getForUser(getAuth(res).userId, String(req.params.id));
      res.json({ payment: toDetailedView(payment) });
    },

    /** 200 seulement après traitement ; 4xx/5xx sinon (CinetPay renverra la notification). */
    async notifyCinetPay(req: Request, res: Response): Promise<void> {
      const result = await payments.handleCinetPayNotification(req.body);
      res.json({ received: true, status: result.status });
    },

    returnToApp(req: Request, res: Response): void {
      const paymentId = String(req.params.paymentId);
      if (!UUID.test(paymentId)) {
        throw new ValidationError({ paymentId: 'Identifiant de paiement invalide.' });
      }
      const target = `${appReturnUrl}?paymentId=${paymentId}`;
      // Page minimale : redirection immédiate vers l'application, lien en secours. Aucun
      // script (CSP inchangée pour les scripts), aucune issue affichée.
      res
        .status(200)
        .setHeader(
          'Content-Security-Policy',
          "default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'none'",
        )
        .type('html')
        .send(
          `<!doctype html><html lang="fr"><head><meta charset="utf-8">` +
            `<meta name="viewport" content="width=device-width, initial-scale=1">` +
            `<meta http-equiv="refresh" content="0;url=${escapeHtml(target)}">` +
            `<title>Le Ter</title></head>` +
            `<body style="font-family:sans-serif;text-align:center;padding:2rem">` +
            `<p>Retour vers Le Ter…</p>` +
            `<p><a href="${escapeHtml(target)}">Ouvrir Le Ter</a></p></body></html>`,
        );
    },
  };
}

function toDetailedView(payment: Payment) {
  return {
    ...toPaymentView(payment),
    tokens: tokensForAmount(payment.amount),
    createdAt: payment.createdAt,
    ...(payment.completedAt && { completedAt: payment.completedAt }),
  };
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}
