import { STATUS_CODES } from 'node:http';

import {
  ReferralAttributionNotFoundError,
  ReferralCodeRejectedError,
  ReferralNotEligibleError,
  ReferralReferrerNotFoundError,
} from '../domain/referrals/referral';
import type { ApiError } from './api-errors';

function apiError(
  status: number,
  code: string,
  message: string,
  fields?: Record<string, string>,
): ApiError {
  return {
    status,
    body: { error: STATUS_CODES[status] ?? 'Error', code, message, ...(fields && { fields }) },
  };
}

/** Erreurs du parrainage (D-161) : code stable, message fixe en français. */
export function toReferralApiError(err: unknown): ApiError | undefined {
  if (err instanceof ReferralCodeRejectedError) {
    // Inscription : le message s'affiche sous le champ, rien n'a été créé.
    return apiError(
      422,
      err.reason === 'CAMPAIGN_SUSPENDED' ? 'REFERRAL_CAMPAIGN_SUSPENDED' : 'INVALID_REFERRAL_CODE',
      err.message,
      { referralCode: err.message },
    );
  }
  if (err instanceof ReferralNotEligibleError) {
    return apiError(403, 'REFERRAL_NOT_ELIGIBLE', err.message);
  }
  if (err instanceof ReferralAttributionNotFoundError) {
    return apiError(404, 'REFERRAL_ATTRIBUTION_NOT_FOUND', err.message);
  }
  if (err instanceof ReferralReferrerNotFoundError) {
    return apiError(404, 'REFERRAL_REFERRER_NOT_FOUND', err.message);
  }
  return undefined;
}
