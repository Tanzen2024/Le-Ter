import { apiRequest } from '../lib/api-client';
import type { DetectionSetting, DetectionSettingChange } from '../types/admin';

/** Administration (rôle `admin`, D-053). Le serveur refuse tout autre compte (403). */
export const adminApi = {
  detectionSetting: (accessToken: string) =>
    apiRequest<DetectionSetting>('/api/admin/settings/detection', {
      accessToken,
    }),

  setDetection: (accessToken: string, enabled: boolean) =>
    apiRequest<DetectionSettingChange>('/api/admin/settings/detection', {
      method: 'PATCH',
      accessToken,
      body: { enabled },
    }),
};
