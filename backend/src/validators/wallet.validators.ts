import { PAYMENT_CURRENCY } from '../domain/payments/payment';
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
export function parseDepositInput(body: unknown): { tokens: number } {
  const currency =
    typeof body === 'object' && body !== null
      ? (body as Record<string, unknown>).currency
      : undefined;
  if (currency !== undefined && currency !== PAYMENT_CURRENCY) {
    throw new ValidationError({ currency: `Seule la devise ${PAYMENT_CURRENCY} est acceptée.` });
  }
  return parseTokenAmountInput(body);
}
