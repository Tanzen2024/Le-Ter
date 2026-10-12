import {
  normalizeCameroonMobile,
  PLATFORM_PAYOUT_MAX_AMOUNT,
  PLATFORM_PAYOUT_MIN_AMOUNT,
  PLATFORM_PAYOUT_STATUSES,
  type PlatformPayoutStatus,
} from '../domain/platform-finance/platform-finance';
import type { PlatformPayoutListQuery } from '../repositories/platform-finance.repository';
import { ADMIN_PAGE, parseUuid } from './admin.validators';
import { ValidationError } from './validation-error';

/**
 * Entrées des retraits de la plateforme (D-078). Seuls les champs listés sont lus : un statut,
 * des frais, un initiateur, un approbateur ou un solde envoyés par l'interface sont IGNORÉS.
 */
const field = (body: unknown, key: string): unknown =>
  typeof body === 'object' && body !== null && !Array.isArray(body)
    ? (body as Record<string, unknown>)[key]
    : undefined;

/** Suite de 8 chiffres ou plus : ressemble à un numéro (interdit dans les textes libres). */
const PHONE_LIKE = /(?:\+?\d[\s.-]?){8,}/;

function text(
  fields: Record<string, string>,
  key: string,
  value: unknown,
  { min, max, label }: { min: number; max: number; label: string },
): string | undefined {
  const t = typeof value === 'string' ? value.trim() : '';
  if (t.length < min || t.length > max) {
    fields[key] = `${label} : ${min} à ${max} caractères.`;
    return undefined;
  }
  if (PHONE_LIKE.test(t)) {
    fields[key] = `${label} : ne recopiez aucun numéro de téléphone.`;
    return undefined;
  }
  return t;
}

const done = (fields: Record<string, string>) => {
  if (Object.keys(fields).length > 0) throw new ValidationError(fields);
};

export function parseBeneficiaryInput(body: unknown): { label: string; msisdn: string } {
  const fields: Record<string, string> = {};
  const label = text(fields, 'label', field(body, 'label'), { min: 3, max: 80, label: 'Libellé' });
  const raw = field(body, 'msisdn');
  const msisdn = typeof raw === 'string' ? normalizeCameroonMobile(raw) : null;
  if (!msisdn) fields.msisdn = 'Numéro mobile camerounais attendu (+237 6XX XX XX XX).';
  done(fields);
  return { label: label!, msisdn: msisdn! };
}

/** Attestation de vérification du bénéficiaire (obligatoire). */
export function parseVerificationNote(body: unknown): { note: string } {
  const fields: Record<string, string> = {};
  const note = text(fields, 'note', field(body, 'note'), {
    min: 10,
    max: 500,
    label: 'Vérification effectuée',
  });
  done(fields);
  return { note: note! };
}

export function parsePayoutInput(body: unknown): {
  beneficiaryId: string;
  amount: number;
  purpose: string;
} {
  const fields: Record<string, string> = {};
  let beneficiaryId: string | undefined;
  try {
    beneficiaryId = parseUuid(field(body, 'beneficiaryId'), 'beneficiaryId');
  } catch {
    fields.beneficiaryId = 'Bénéficiaire invalide.';
  }
  // Nombre entier de FCFA : une chaîne, un décimal, NaN, Infinity ou un négatif sont refusés.
  const amount = field(body, 'amount');
  if (typeof amount !== 'number' || !Number.isSafeInteger(amount)) {
    fields.amount = 'Montant invalide : nombre entier de FCFA attendu.';
  } else if (amount < PLATFORM_PAYOUT_MIN_AMOUNT || amount > PLATFORM_PAYOUT_MAX_AMOUNT) {
    fields.amount = `Montant entre ${PLATFORM_PAYOUT_MIN_AMOUNT} et ${PLATFORM_PAYOUT_MAX_AMOUNT} FCFA.`;
  }
  const purpose = text(fields, 'purpose', field(body, 'purpose'), {
    min: 5,
    max: 200,
    label: 'Motif',
  });
  done(fields);
  return { beneficiaryId: beneficiaryId!, amount: amount as number, purpose: purpose! };
}

/** Note de décision : obligatoire (rejet, annulation) ou facultative (approbation). */
export function parseDecisionNote(body: unknown, required: boolean): { note?: string } {
  const raw = field(body, 'note');
  if (raw === undefined || raw === null || raw === '') {
    if (required) throw new ValidationError({ note: 'Motif requis.' });
    return {};
  }
  const fields: Record<string, string> = {};
  const note = text(fields, 'note', raw, { min: 5, max: 500, label: 'Motif' });
  done(fields);
  return { note: note! };
}

export function parsePlatformPayoutQuery(query: Record<string, unknown>): PlatformPayoutListQuery {
  const fields: Record<string, string> = {};
  for (const key of Object.keys(query)) {
    if (!['page', 'limit', 'status'].includes(key)) fields[key] = 'Paramètre inconnu.';
  }
  const int = (key: string, min: number, max: number, fallback: number) => {
    const raw = query[key];
    if (raw === undefined || raw === '') return fallback;
    if (typeof raw !== 'string' || !/^\d+$/.test(raw) || Number(raw) < min || Number(raw) > max) {
      fields[key] = `Entier attendu entre ${min} et ${max}.`;
      return fallback;
    }
    return Number(raw);
  };
  const page = int('page', 1, ADMIN_PAGE.maxPage, 1);
  const limit = int('limit', 1, ADMIN_PAGE.maxLimit, ADMIN_PAGE.defaultLimit);
  const status = query.status;
  if (
    status !== undefined &&
    status !== '' &&
    !(PLATFORM_PAYOUT_STATUSES as readonly unknown[]).includes(status)
  ) {
    fields.status = 'Valeur non autorisée.';
  }
  done(fields);
  return {
    page,
    limit,
    ...(typeof status === 'string' && status !== '' && { status: status as PlatformPayoutStatus }),
  };
}
