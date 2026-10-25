import { useQuery } from '@tanstack/react-query';

import { referralsApi } from '../../services/referrals-api';
import { useAuthStore } from '../../stores/auth-store';
import { withAccessToken } from '../auth/session';

export const referralKeys = { me: ['referrals', 'me'] as const };

/** Section Parrainage : relue à l'ouverture et régulièrement tant qu'elle est affichée. */
export function useReferralProgram() {
  const signedIn = useAuthStore((s) => s.status) === 'signedIn';
  return useQuery({
    queryKey: referralKeys.me,
    queryFn: () => withAccessToken((t) => referralsApi.me(t)),
    enabled: signedIn,
    refetchInterval: 30_000,
  });
}
