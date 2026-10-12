import {
  isWithdrawalOperator,
  MAX_WITHDRAWAL_TOKENS,
  MIN_WITHDRAWAL_TOKENS,
  WITHDRAWAL_LIMIT_MAX_COUNT,
  WITHDRAWAL_LIMIT_MAX_PERIOD_MINUTES,
  type WithdrawalLimit,
  type WithdrawalOperator,
} from '../domain/wallet/withdrawal';
import { ValidationError } from './validation-error';

const field = (body: unknown, key: string): unknown =>
  typeof body === 'object' && body !== null && !Array.isArray(body)
    ? (body as Record<string, unknown>)[key]
    : undefined;

/**
 * Demande de retrait (D-075) : `{ tokens, operator }`. `tokens` est un NOMBRE entier (une
 * chaîne, `null`, une valeur absente, décimale, non finie ou hors bornes est refusée, jamais
 * convertie) d'au moins 1 000 jetons. Tout autre champ (`phone`, `userId`, `balance`…) est
 * ignoré : le destinataire est le numéro d'inscription, l'identité vient du JWT.
 */
export function parseWithdrawalInput(body: unknown): {
  tokens: number;
  operator: WithdrawalOperator;
} {
  const fields: Record<string, string> = {};
  const tokens = field(body, 'tokens');
  if (typeof tokens !== 'number' || !Number.isSafeInteger(tokens)) {
    fields.tokens = 'Montant invalide : indiquez un nombre entier de jetons.';
  } else if (tokens < MIN_WITHDRAWAL_TOKENS) {
    fields.tokens = `Le retrait minimum est de ${MIN_WITHDRAWAL_TOKENS} jetons.`;
  } else if (tokens > MAX_WITHDRAWAL_TOKENS) {
    fields.tokens = `Le retrait maximum est de ${MAX_WITHDRAWAL_TOKENS} jetons.`;
  }
  const operator = field(body, 'operator');
  if (!isWithdrawalOperator(operator)) {
    fields.operator = 'Opérateur Mobile Money non pris en charge.';
  }
  if (Object.keys(fields).length > 0) throw new ValidationError(fields);
  return { tokens: tokens as number, operator: operator as WithdrawalOperator };
}

/**
 * Quota de retraits (administration) : `{ count, periodMinutes }`, les deux OBLIGATOIRES ;
 * `null` = illimité (∞), sinon un entier dans les bornes. Aucune chaîne, aucun `Infinity`.
 */
export function parseWithdrawalLimitChange(body: unknown): WithdrawalLimit {
  const fields: Record<string, string> = {};
  const read = (key: 'count' | 'periodMinutes', max: number, label: string) => {
    const value = field(body, key);
    if (value === null) return null;
    if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1 || value > max) {
      fields[key] = `${label} : entier entre 1 et ${max}, ou null (illimité).`;
      return null;
    }
    return value;
  };
  const count = read('count', WITHDRAWAL_LIMIT_MAX_COUNT, 'Nombre maximal de retraits');
  const periodMinutes = read(
    'periodMinutes',
    WITHDRAWAL_LIMIT_MAX_PERIOD_MINUTES,
    'Période (minutes)',
  );
  if (Object.keys(fields).length > 0) throw new ValidationError(fields);
  return { count, periodMinutes };
}

/** Suite de 8 chiffres ou plus (espaces, points, tirets tolérés) : ressemble à un numéro. */
const PHONE_LIKE = /(?:\+?\d[\s.-]?){8,}/;
const TICKET = /^[A-Za-z0-9][A-Za-z0-9._#/-]{2,99}$/;

function freeText(
  fields: Record<string, string>,
  key: string,
  value: unknown,
  { min, max, label }: { min: number; max: number; label: string },
): string | undefined {
  const text = typeof value === 'string' ? value.trim() : '';
  if (text.length < min || text.length > max) {
    fields[key] = `${label} : ${min} à ${max} caractères.`;
    return undefined;
  }
  // Journal d'audit : jamais de numéro de téléphone ni de donnée personnelle recopiée.
  if (PHONE_LIKE.test(text)) {
    fields[key] = `${label} : ne recopiez aucun numéro de téléphone.`;
    return undefined;
  }
  return text;
}

/**
 * Proposition de remboursement manuel (D-076) : référence de la confirmation ÉCRITE du
 * fournisseur (ticket, courriel) et justification. Obligatoires.
 */
export function parseRefundProposal(body: unknown): {
  providerTicket: string;
  justification: string;
} {
  const fields: Record<string, string> = {};
  const ticket = field(body, 'providerTicket');
  const providerTicket = typeof ticket === 'string' ? ticket.trim() : '';
  if (!TICKET.test(providerTicket)) {
    fields.providerTicket =
      'Référence de la confirmation CinetPay requise (3 à 100 caractères : lettres, chiffres, . _ # / -).';
  }
  const justification = freeText(fields, 'justification', field(body, 'justification'), {
    min: 20,
    max: 1000,
    label: 'Justification',
  });
  if (Object.keys(fields).length > 0 || !justification) throw new ValidationError(fields);
  return { providerTicket, justification };
}

/** Décision : note facultative pour une approbation, obligatoire (5 caractères) pour un rejet. */
export function parseRefundDecision(body: unknown, approve: boolean): { note?: string } {
  const fields: Record<string, string> = {};
  const raw = field(body, 'note');
  if (raw === undefined || raw === null || raw === '') {
    if (!approve) throw new ValidationError({ note: 'Motif du rejet requis.' });
    return {};
  }
  const note = freeText(fields, 'note', raw, { min: 5, max: 1000, label: 'Note' });
  if (!note) throw new ValidationError(fields);
  return { note };
}

/** Escalade vers le fournisseur : note obligatoire, référence de ticket facultative. */
export function parseEscalation(body: unknown): { providerTicket?: string; note: string } {
  const fields: Record<string, string> = {};
  const ticket = field(body, 'providerTicket');
  let providerTicket: string | undefined;
  if (ticket !== undefined && ticket !== null && ticket !== '') {
    providerTicket = typeof ticket === 'string' ? ticket.trim() : '';
    if (!TICKET.test(providerTicket)) fields.providerTicket = 'Référence de ticket invalide.';
  }
  const note = freeText(fields, 'note', field(body, 'note'), { min: 5, max: 1000, label: 'Note' });
  if (Object.keys(fields).length > 0 || !note) throw new ValidationError(fields);
  return { ...(providerTicket && { providerTicket }), note };
}
