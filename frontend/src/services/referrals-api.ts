import { apiRequest } from '../lib/api-client';
import type { ReferralProgram } from '../types/referral';

/** Parrainage (D-161) : lecture seule. Aucune route n'attribue, ne qualifie ni ne crédite. */
export const referralsApi = {
  me: (accessToken: string) => apiRequest<ReferralProgram>('/api/referrals/me', { accessToken }),
};
