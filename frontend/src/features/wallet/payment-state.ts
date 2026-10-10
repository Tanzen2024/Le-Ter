import { formatFcfa as formatXafAmount } from '../../lib/money';
import type { PaymentView } from '../../types/wallet';

/** Montants d'achat proposés (D-050), en FCFA ; identiques à ceux acceptés par le serveur. */
export const DEPOSIT_AMOUNTS = [500, 1000, 2000, 5000] as const;

/** Conversion validée (D-050) : 1 FCFA = 1 jeton. */
export const tokensForAmount = (amountFcfa: number) => amountFcfa;

/** Groupes de milliers séparés par une espace insécable : « 1 000 ». */
export function formatNumber(value: number): string {
  return String(value).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
}

export const formatFcfa = (amount: number) => formatXafAmount(amount);

export const formatTokens = (tokens: number) =>
  `${formatNumber(tokens)} jeton${tokens > 1 ? 's' : ''}`;

export interface PaymentDisplay {
  tone: 'pending' | 'success' | 'error';
  title: string;
  detail?: string;
}

/**
 * Ce que l'écran affiche d'un paiement : TOUJOURS d'après le statut renvoyé par le serveur,
 * jamais d'après le retour de la page de paiement.
 */
export function paymentDisplay(payment: Pick<PaymentView, 'status' | 'amount'>): PaymentDisplay {
  switch (payment.status) {
    case 'SUCCESS':
      return {
        tone: 'success',
        title: 'Paiement confirmé',
        detail: `+${formatTokens(tokensForAmount(payment.amount))}`,
      };
    case 'FAILED':
      return { tone: 'error', title: 'Paiement échoué', detail: 'Aucun jeton n’a été débité.' };
    case 'EXPIRED':
      return { tone: 'error', title: 'Paiement expiré', detail: 'Aucun jeton n’a été débité.' };
    default:
      return {
        tone: 'pending',
        title: 'Paiement en cours...',
        detail: `${formatTokens(tokensForAmount(payment.amount))} seront crédités dès la confirmation.`,
      };
  }
}
