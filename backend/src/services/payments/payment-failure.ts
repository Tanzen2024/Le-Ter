import {
  DirectPaymentUnavailableError,
  PaymentInitializationUncertainError,
  PaymentProfileIncompleteError,
} from '../../domain/payments/payment';
import { MobileMoneyNotConfiguredError } from '../wallet/mobile-money.gateway';
import { CinetPayError, CinetPayPaymentNotSentError } from './cinetpay/cinetpay-client';

/**
 * Classification UNIQUE des échecs d'une demande de paiement (D-100), utilisée par la
 * passerelle (journaux), le compte de jeu (erreur rendue au joueur) et la surveillance du
 * fournisseur. Elle ne décide d'aucun crédit : seul le statut relu chez CinetPay le fait.
 *
 * `sent` : la création du paiement a quitté le serveur. `charged` n'est JAMAIS affirmé ici :
 * pour un paiement direct envoyé sans réponse, l'issue reste inconnue (D-091) et passe par la
 * réconciliation, pas par cette classification.
 */
export type PaymentFailureCategory =
  /** Aucun fournisseur ou configuration invalide (variables du serveur). */
  | 'CONFIG_INVALID'
  /** Adresse IP publique du serveur absente de la liste blanche du compte (code 2011). */
  | 'PROVIDER_IP_NOT_ALLOWED'
  /** Clé ou mot de passe API refusés, jeton refusé après renouvellement. */
  | 'PROVIDER_AUTH_REFUSED'
  /** Réseau, DNS, connexion refusée : CinetPay injoignable. */
  | 'PROVIDER_UNREACHABLE'
  /** Délai dépassé AVANT l'envoi de la création (authentification). */
  | 'PROVIDER_TIMEOUT_BEFORE_SEND'
  /** Délai dépassé APRÈS l'envoi : la transaction a pu être créée chez CinetPay. */
  | 'PROVIDER_TIMEOUT_AFTER_SEND'
  /** Erreur HTTP 5xx du fournisseur (dont 52x Cloudflare). */
  | 'PROVIDER_HTTP_ERROR'
  /** Réponse illisible ou incohérente. */
  | 'PROVIDER_MALFORMED_RESPONSE'
  /** Refus métier explicite de CinetPay (paramètres, opérateur, montant…). */
  | 'PROVIDER_REFUSED'
  /** Moyen de paiement non activé / non autorisé pour ce compte ou ce numéro. */
  | 'METHOD_UNAVAILABLE'
  /** Profil du payeur incompatible avec le fournisseur. */
  | 'PROFILE_INCOMPLETE'
  /** Paiement direct parti sans réponse : en attente de vérification (jamais un échec). */
  | 'OUTCOME_UNKNOWN'
  | 'UNKNOWN';

export interface PaymentFailureInfo {
  category: PaymentFailureCategory;
  /** Un nouvel essai par le joueur est sûr et a une chance d'aboutir sans intervention. */
  retryable: boolean;
  /** La demande de création a quitté le serveur. */
  sent: boolean;
  httpStatus?: number;
  apiCode?: number;
  apiStatus?: string;
}

/** Code CinetPay : adresse IP non autorisée (`This Ip is not withlisted`). */
export const CINETPAY_IP_NOT_ALLOWED_CODE = 2011;

/** Catégories qui signalent une panne du FOURNISSEUR (pas un refus individuel). */
export const PROVIDER_OUTAGE_CATEGORIES: ReadonlySet<PaymentFailureCategory> = new Set([
  'PROVIDER_IP_NOT_ALLOWED',
  'PROVIDER_AUTH_REFUSED',
  'PROVIDER_UNREACHABLE',
  'PROVIDER_TIMEOUT_BEFORE_SEND',
  'PROVIDER_TIMEOUT_AFTER_SEND',
  'PROVIDER_HTTP_ERROR',
  'PROVIDER_MALFORMED_RESPONSE',
]);

function fromCinetPay(err: CinetPayError, sent: boolean): PaymentFailureInfo {
  const { httpStatus, apiCode, apiStatus } = err.details;
  const base = {
    sent,
    ...(httpStatus !== undefined && { httpStatus }),
    ...(apiCode !== undefined && { apiCode }),
    ...(apiStatus !== undefined && { apiStatus }),
  };
  switch (err.kind) {
    case 'authentication':
      return apiCode === CINETPAY_IP_NOT_ALLOWED_CODE || apiStatus === 'NOT_ALLOWED'
        ? { ...base, category: 'PROVIDER_IP_NOT_ALLOWED', retryable: false }
        : { ...base, category: 'PROVIDER_AUTH_REFUSED', retryable: false };
    case 'expired_token':
      return { ...base, category: 'PROVIDER_AUTH_REFUSED', retryable: false };
    case 'network':
      return { ...base, category: 'PROVIDER_UNREACHABLE', retryable: true };
    case 'timeout':
      return {
        ...base,
        category: sent ? 'PROVIDER_TIMEOUT_AFTER_SEND' : 'PROVIDER_TIMEOUT_BEFORE_SEND',
        retryable: true,
      };
    case 'malformed_response':
      return { ...base, category: 'PROVIDER_MALFORMED_RESPONSE', retryable: true };
    case 'http':
      if (httpStatus !== undefined && httpStatus >= 500) {
        return { ...base, category: 'PROVIDER_HTTP_ERROR', retryable: true };
      }
      return { ...base, category: 'PROVIDER_REFUSED', retryable: false };
    case 'api':
      return { ...base, category: 'PROVIDER_REFUSED', retryable: false };
  }
}

export function classifyPaymentFailure(err: unknown): PaymentFailureInfo {
  if (err instanceof CinetPayPaymentNotSentError) {
    return err.cause instanceof CinetPayError
      ? fromCinetPay(err.cause, false)
      : { category: 'UNKNOWN', retryable: true, sent: false };
  }
  if (err instanceof CinetPayError) return fromCinetPay(err, true);
  if (err instanceof PaymentInitializationUncertainError) {
    return { category: 'OUTCOME_UNKNOWN', retryable: false, sent: true };
  }
  if (err instanceof DirectPaymentUnavailableError) {
    return err.reason === 'PROVIDER_REFUSED'
      ? { category: 'PROVIDER_REFUSED', retryable: false, sent: true }
      : { category: 'METHOD_UNAVAILABLE', retryable: false, sent: false };
  }
  if (err instanceof PaymentProfileIncompleteError) {
    return { category: 'PROFILE_INCOMPLETE', retryable: false, sent: false };
  }
  if (err instanceof MobileMoneyNotConfiguredError) {
    return { category: 'CONFIG_INVALID', retryable: false, sent: false };
  }
  return { category: 'UNKNOWN', retryable: true, sent: false };
}

/**
 * Message au joueur d'une recharge NON effectuée (503 `MOBILE_MONEY_UNAVAILABLE`). « Aucun
 * montant n'a été débité » est exact ici : cette erreur n'est rendue que lorsque rien n'a pu
 * être payé (demande jamais partie, ou page de paiement jamais remise au joueur). Jamais de
 * détail interne (IP, clé, code fournisseur) : ils restent dans les journaux.
 */
export function unavailableMessageOf(category: string | undefined): string {
  switch (category) {
    case 'PROVIDER_IP_NOT_ALLOWED':
    case 'PROVIDER_AUTH_REFUSED':
    case 'CONFIG_INVALID':
      return 'Les recharges sont suspendues le temps de rétablir l’accès au service de paiement. Aucun montant n’a été débité. Réessayez plus tard.';
    case 'PROVIDER_UNREACHABLE':
    case 'PROVIDER_TIMEOUT_BEFORE_SEND':
      return 'Le service de paiement CinetPay est injoignable pour le moment. Aucun montant n’a été débité. Réessayez dans quelques minutes.';
    case 'PROVIDER_TIMEOUT_AFTER_SEND':
    case 'PROVIDER_HTTP_ERROR':
    case 'PROVIDER_MALFORMED_RESPONSE':
      return 'Le service de paiement CinetPay rencontre un incident. Aucun montant n’a été débité. Réessayez dans quelques minutes.';
    case 'PROVIDER_REFUSED':
      return 'CinetPay a refusé la demande de paiement. Aucun montant n’a été débité.';
    default:
      return 'Le service de paiement est indisponible : l’opération n’a pas été effectuée.';
  }
}
