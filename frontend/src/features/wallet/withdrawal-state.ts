import { ApiError } from '../../lib/api-client';
import type {
  WithdrawalMode,
  WithdrawalPolicy,
  WithdrawalStatus,
  WithdrawalUnavailableReason,
} from '../../types/wallet';
import { formatNumber, formatTokens } from './payment-state';

/**
 * Retrait Mobile Money (D-075) : règles d'AFFICHAGE seulement. Le serveur revérifie tout
 * (minimum, quota, solde, destinataire) ; ces contrôles évitent seulement une demande
 * vouée au refus.
 */

/** Montant minimal d'un retrait, identique au serveur (D-075). */
export const MIN_WITHDRAWAL_TOKENS = 1_000;

export type AmountCheck =
  | { ok: true; tokens: number }
  | { ok: false; reason: 'empty' | 'invalid' | 'below_min' | 'above_max' | 'insufficient'; message: string };

/**
 * Saisie du montant : chiffres seulement (jamais convertie en 0), entier ≥ minimum,
 * ≤ maximum du fournisseur et ≤ solde DISPONIBLE.
 */
export function checkWithdrawalAmount(
  input: string,
  limits: { minTokens: number; maxTokens: number; available?: number },
): AmountCheck {
  if (input === '') return { ok: false, reason: 'empty', message: '' };
  if (!/^\d+$/.test(input)) {
    return { ok: false, reason: 'invalid', message: 'Entrez un nombre entier de jetons.' };
  }
  const tokens = Number(input);
  if (!Number.isSafeInteger(tokens)) {
    return { ok: false, reason: 'invalid', message: 'Entrez un nombre entier de jetons.' };
  }
  if (tokens < limits.minTokens) {
    return {
      ok: false,
      reason: 'below_min',
      message: `Le retrait minimum est de ${formatTokens(limits.minTokens)}.`,
    };
  }
  if (tokens > limits.maxTokens) {
    return {
      ok: false,
      reason: 'above_max',
      message: `Le retrait maximum est de ${formatTokens(limits.maxTokens)}.`,
    };
  }
  if (limits.available !== undefined && tokens > limits.available) {
    return { ok: false, reason: 'insufficient', message: 'Solde disponible insuffisant.' };
  }
  return { ok: true, tokens };
}

/** Durée lisible d'une période de quota (minutes) : « 24 heures », « 7 jours ». */
export function formatPeriod(minutes: number): string {
  if (minutes % 1440 === 0) {
    const days = minutes / 1440;
    return `${formatNumber(days)} jour${days > 1 ? 's' : ''}`;
  }
  if (minutes % 60 === 0) {
    const hours = minutes / 60;
    return `${formatNumber(hours)} heure${hours > 1 ? 's' : ''}`;
  }
  return `${formatNumber(minutes)} minute${minutes > 1 ? 's' : ''}`;
}

/** Quota tel que configuré par l'administration ; `undefined` s'il est illimité. */
export function quotaText(limit: WithdrawalPolicy['limit']): string | undefined {
  if (limit.count === null) return undefined;
  const scope =
    limit.periodMinutes === null ? 'au total' : `par période de ${formatPeriod(limit.periodMinutes)}`;
  const remaining = limit.remaining ?? 0;
  return `${remaining} retrait${remaining > 1 ? 's' : ''} restant${remaining > 1 ? 's' : ''} sur ${limit.count} ${scope}.`;
}

/** Message d'un refus du serveur, d'après son `code` stable. */
export function withdrawalErrorMessage(error: unknown): string {
  if (!(error instanceof ApiError)) return 'Retrait impossible. Réessayez.';
  if (error.status === 0) {
    // La même clé est réutilisée au nouvel essai : le retrait ne sera jamais exécuté deux fois.
    return 'Connexion impossible. Réessayez : la demande ne sera pas exécutée deux fois.';
  }
  switch (error.code) {
    case 'VALIDATION_ERROR':
      return error.fields.tokens ?? error.fields.operator ?? 'Demande invalide.';
    case 'INSUFFICIENT_BALANCE':
      return 'Solde disponible insuffisant. Aucun jeton n’a été débité.';
    case 'WITHDRAWAL_LIMIT_REACHED':
      return 'Vous avez atteint le nombre maximal de retraits pour la période en cours.';
    case 'MOBILE_MONEY_UNAVAILABLE':
      return 'Le service de retrait est indisponible pour le moment. Aucun jeton n’a été débité.';
    case 'IDEMPOTENCY_KEY_REUSED':
      return 'Cette demande a déjà été utilisée. Modifiez le montant puis recommencez.';
    case 'RATE_LIMITED':
      return 'Trop de demandes. Patientez quelques instants.';
    default:
      return error.message || 'Retrait impossible.';
  }
}

export interface WithdrawalAvailabilityNotice {
  tone: 'unavailable' | 'test';
  message: string;
}

/**
 * Ce que le panneau « Mes jetons » dit de l'état des retraits, TOUJOURS d'après le serveur (D-077) ;
 * `undefined` en production (rien à signaler). Les motifs de configuration ne sont jamais
 * détaillés au joueur.
 */
export function withdrawalAvailabilityNotice(state: {
  available: boolean;
  mode?: WithdrawalMode;
  reason?: WithdrawalUnavailableReason;
}): WithdrawalAvailabilityNotice | undefined {
  // Serveur antérieur à D-077 : seul `available` est connu.
  const mode = state.mode ?? (state.available ? 'live' : 'unavailable');
  if (mode === 'sandbox') {
    return {
      tone: 'test',
      message: 'Mode test : les retraits sont simulés, aucun argent réel n’est envoyé.',
    };
  }
  if (mode === 'live') return undefined;
  switch (state.reason) {
    case 'PROVIDER_NOT_CONFIGURED':
      return {
        tone: 'unavailable',
        message: 'Les retraits Mobile Money ne sont pas encore ouverts. Vos jetons restent disponibles pour jouer.',
      };
    case 'TRANSFERS_DISABLED':
      return {
        tone: 'unavailable',
        message: 'Les retraits Mobile Money sont fermés pour le moment. Vos jetons restent disponibles pour jouer.',
      };
    case undefined:
      return {
        tone: 'unavailable',
        message: 'Les retraits Mobile Money ne sont pas disponibles pour le moment.',
      };
    default:
      return {
        tone: 'unavailable',
        message: 'Les retraits Mobile Money sont momentanément indisponibles (maintenance du service).',
      };
  }
}

export interface WithdrawalDisplay {
  tone: 'pending' | 'success' | 'error';
  label: string;
  detail: string;
}

/** Ce que l'écran dit d'un retrait : TOUJOURS d'après le statut renvoyé par le serveur. */
export function withdrawalDisplay(
  status: WithdrawalStatus,
  tokens: number,
  underReview = false,
  /** Environnement de test (D-077) : une réussite n'est qu'un transfert simulé. */
  sandbox = false,
): WithdrawalDisplay {
  // Issue en cours de vérification (D-076) : jamais présentée comme réussie ni échouée.
  if (underReview && (status === 'CREATED' || status === 'PROCESSING')) {
    return {
      tone: 'pending',
      label: 'Vérification en cours',
      detail: `${formatTokens(tokens)} restent réservés pendant la vérification avec l’opérateur.`,
    };
  }
  switch (status) {
    case 'SUCCEEDED':
      // Statut final relu chez CinetPay et réglé par le serveur : seule voie vers « effectué ».
      return sandbox
        ? {
            tone: 'success',
            label: 'Retrait effectué (test)',
            detail: 'Transfert simulé confirmé en environnement de test : aucun argent réel envoyé.',
          }
        : {
            tone: 'success',
            label: 'Retrait effectué',
            detail: 'Le transfert a été confirmé par l’opérateur.',
          };
    case 'FAILED':
      return {
        tone: 'error',
        label: 'Retrait échoué',
        detail: `${formatTokens(tokens)} ont été recrédités sur votre compte de jeu.`,
      };
    case 'PROCESSING':
      return {
        tone: 'pending',
        label: 'Transfert en cours',
        detail: 'Demande acceptée par l’opérateur, en attente de confirmation.',
      };
    default:
      return {
        tone: 'pending',
        label: 'Demande enregistrée',
        detail: 'Jetons réservés, envoi du transfert en cours.',
      };
  }
}

export const isOpenWithdrawal = (status: WithdrawalStatus) =>
  status === 'CREATED' || status === 'PROCESSING';
