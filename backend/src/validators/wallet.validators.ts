import {
  isDirectPayOperator,
  PAYMENT_CURRENCY,
  type DirectPayOperator,
} from '../domain/payments/payment';
import { isValidTokenAmount, MAX_TOKENS_PER_OPERATION } from '../domain/wallet/wallet';
import { ValidationError } from './validation-error';

/**
 * Montant d'un achat ou d'un retrait : un entier de jetons strictement positif. Refusés :
 * 0, négatifs, décimaux, chaînes. Les minimums métier (R-16) ne sont pas définis.
 */
export function parseTokenAmountInput(body: unknown): { tokens: number } {
  const tokens =
    typeof body === 'object' && body !== null
      ? (body as Record<string, unknown>).tokens
      : undefined;
  if (!isValidTokenAmount(tokens)) {
    throw new ValidationError({
      tokens: `Le nombre de jetons doit être un entier entre 1 et ${MAX_TOKENS_PER_OPERATION}.`,
    });
  }
  return { tokens };
}

/**
 * Achat (D-050) : `{ tokens }` comme tout achat, et `currency` facultative qui, si elle est
 * envoyée, doit être XAF (la devise est fixée par le serveur). Tout autre champ (`playerId`,
 * `amount`…) est ignoré : l'identité vient du JWT, le montant payé est calculé par le serveur.
 */
export function parseDepositInput(body: unknown): {
  tokens: number;
  directOperator?: DirectPayOperator;
  pageOperator?: DirectPayOperator;
} {
  const source =
    typeof body === 'object' && body !== null ? (body as Record<string, unknown>) : {};
  if (source.currency !== undefined && source.currency !== PAYMENT_CURRENCY) {
    throw new ValidationError({ currency: `Seule la devise ${PAYMENT_CURRENCY} est acceptée.` });
  }
  // `method` (paiement direct, D-083) : opérateur seulement ; le numéro est celui du compte,
  // le montant est calculé par le serveur. Absent ou null : page de paiement CinetPay.
  const method = source.method;
  if (method !== undefined && method !== null && !isDirectPayOperator(method)) {
    throw new ValidationError({ method: 'Opérateur de paiement inconnu.' });
  }
  // `operator` (D-087) : opérateur souhaité sur la page CinetPay hébergée (Orange Money, repli
  // MTN). Exclusif de `method` : un paiement est direct OU par page.
  const operator = source.operator;
  if (operator !== undefined && operator !== null && !isDirectPayOperator(operator)) {
    throw new ValidationError({ operator: 'Opérateur de paiement inconnu.' });
  }
  if (isDirectPayOperator(method) && operator !== undefined && operator !== null) {
    throw new ValidationError({ operator: 'Choisissez un paiement direct OU la page CinetPay.' });
  }
  const { tokens } = parseTokenAmountInput(body);
  return {
    tokens,
    ...(isDirectPayOperator(method) && { directOperator: method }),
    ...(isDirectPayOperator(operator) && { pageOperator: operator }),
  };
}
