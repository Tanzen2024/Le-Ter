import { formatFcfa as formatXafAmount } from '../../lib/money';
import type { DepositLimits, DirectPayOperator, PaymentView } from '../../types/wallet';

/**
 * Limites du montant d'achat saisi (D-085) quand le serveur ne les a pas (encore) annoncées :
 * celles du contrat de l'API CinetPay v1. Le serveur revalide TOUJOURS le montant.
 */
export const DEFAULT_DEPOSIT_LIMITS: DepositLimits = { min: 100, max: 2_500_000, currency: 'XAF' };

export type DepositAmountCheck =
  | { ok: true; amount: number }
  | { ok: false; reason: 'empty' | 'format' | 'min' | 'max'; message?: string };

/**
 * Montant saisi : chiffres seulement (entier en FCFA, sans décimale ni signe), dans les
 * limites. Pré-validation d'affichage : le serveur reste seul juge.
 */
export function checkDepositAmount(
  input: string,
  limits: Pick<DepositLimits, 'min' | 'max'> = DEFAULT_DEPOSIT_LIMITS,
): DepositAmountCheck {
  const raw = input.replace(/\s/g, '');
  if (raw === '') return { ok: false, reason: 'empty' };
  if (!/^\d+$/.test(raw)) {
    return { ok: false, reason: 'format', message: 'Saisissez un nombre entier de FCFA.' };
  }
  const amount = Number(raw);
  if (!Number.isSafeInteger(amount) || amount < limits.min) {
    return { ok: false, reason: 'min', message: `Minimum ${formatFcfa(limits.min)}.` };
  }
  if (amount > limits.max) {
    return { ok: false, reason: 'max', message: `Maximum ${formatFcfa(limits.max)}.` };
  }
  return { ok: true, amount };
}

/** Conversion validée (D-050) : 1 FCFA = 1 jeton. */
export const tokensForAmount = (amountFcfa: number) => amountFcfa;

/** Groupes de milliers séparés par une espace insécable : « 1 000 ». */
export function formatNumber(value: number): string {
  return String(value).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
}

export const formatFcfa = (amount: number) => formatXafAmount(amount);

export const formatTokens = (tokens: number) =>
  `${formatNumber(tokens)} jeton${tokens > 1 ? 's' : ''}`;

/** Libellés des opérateurs du paiement direct. */
export const DIRECT_PAY_OPERATOR_LABELS: Record<DirectPayOperator, string> = {
  MTN_CM: 'MTN Mobile Money',
  OM_CM: 'Orange Money',
};

export interface PaymentDisplay {
  tone: 'pending' | 'success' | 'error';
  title: string;
  detail?: string;
}

/**
 * Ce que l'écran affiche d'un paiement : TOUJOURS d'après le statut renvoyé par le serveur,
 * jamais d'après le retour de la page de paiement.
 */
export function paymentDisplay(
  payment: Pick<PaymentView, 'status' | 'amount' | 'mode' | 'operator'>,
): PaymentDisplay {
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
      // Paiement direct : la demande est sur le téléphone du joueur, aucune page à ouvrir.
      if (payment.mode === 'DIRECT') {
        const operator = payment.operator ? DIRECT_PAY_OPERATOR_LABELS[payment.operator] : undefined;
        return {
          tone: 'pending',
          title: 'En attente de confirmation sur votre téléphone',
          detail: `Validez la demande ${operator ? `${operator} ` : ''}de ${formatFcfa(payment.amount)} reçue sur votre téléphone. ${formatTokens(tokensForAmount(payment.amount))} seront crédités dès la confirmation.`,
        };
      }
      return {
        tone: 'pending',
        title: 'Paiement en cours...',
        detail: `${formatTokens(tokensForAmount(payment.amount))} seront crédités dès la confirmation.`,
      };
  }
}
