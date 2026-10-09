import { keepPreviousData, queryOptions } from '@tanstack/react-query';

import { api, type Query } from '@/lib/api/client';
import type {
  AlertDetail,
  AlertSignals,
  AlertStatus,
  AlertSummary,
  DetectionSetting,
  Paged,
} from '@/types/admin';

/** Routes EXISTANTES /api/admin/detection et /api/admin/settings/detection (D-049, D-053). */
export function alertsQuery(query: Query) {
  return queryOptions({
    queryKey: ['admin', 'alerts', query],
    queryFn: () => api.get<Paged<AlertSummary>>('detection/alerts', { limit: 25, ...query }),
    placeholderData: keepPreviousData,
  });
}

export function alertQuery(id: string) {
  return queryOptions({
    queryKey: ['admin', 'alert', id],
    queryFn: () => api.get<{ alert: AlertDetail }>(`detection/alerts/${id}`),
  });
}

export function alertSignalsQuery(id: string) {
  return queryOptions({
    queryKey: ['admin', 'alert', id, 'signals'],
    queryFn: () => api.get<AlertSignals>(`detection/alerts/${id}/signals`),
  });
}

export function detectionSettingQuery() {
  return queryOptions({
    queryKey: ['admin', 'detection-setting'],
    queryFn: () => api.get<DetectionSetting>('settings/detection'),
  });
}

/** Transitions permises par le serveur (machine d'état D-049). */
export const ALERT_TRANSITIONS: Record<AlertStatus, AlertStatus[]> = {
  NEW: ['REVIEWED', 'DISMISSED'],
  REVIEWED: ['RESOLVED'],
  DISMISSED: [],
  RESOLVED: [],
};

/** Changement de statut avec `expectedStatus` : un conflit concurrent est refusé (409). */
export function changeAlertStatus(id: string, status: AlertStatus, expectedStatus: AlertStatus) {
  return api.patch<{ alert: AlertSummary; changed: boolean }>(`detection/alerts/${id}/status`, {
    status,
    expectedStatus,
  });
}

export function setDetection(enabled: boolean) {
  return api.patch<DetectionSetting & { changed: boolean }>('settings/detection', { enabled });
}
