import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { adminApi } from '../../services/admin-api';
import { withAccessToken } from '../auth/session';

export const adminKeys = {
  detectionSetting: ['admin', 'settings', 'detection'] as const,
};

/** État de l'interrupteur global, lu sur le serveur (PostgreSQL est la source de vérité). */
export function useDetectionSetting() {
  return useQuery({
    queryKey: adminKeys.detectionSetting,
    queryFn: () => withAccessToken((t) => adminApi.detectionSetting(t)),
  });
}

/** Change l'interrupteur ; l'état affiché est celui confirmé par le serveur. */
export function useSetDetection() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (enabled: boolean) => withAccessToken((t) => adminApi.setDetection(t, enabled)),
    onSuccess: (setting) => {
      queryClient.setQueryData(adminKeys.detectionSetting, {
        enabled: setting.enabled,
        updatedAt: setting.updatedAt,
      });
    },
  });
}
