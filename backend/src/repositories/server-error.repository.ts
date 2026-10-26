import type { ServerErrorGroup, ServerErrorOccurrence } from '../domain/admin/server-errors';

/**
 * Pannes du serveur regroupées (D-168, migration 0057). `record` ajoute une occurrence à son
 * groupe (création au premier passage) ; `list` les rend, la plus récente d'abord.
 */
export interface ServerErrorRepository {
  record(occurrence: ServerErrorOccurrence): Promise<void>;
  list(page: { page: number; limit: number }): Promise<{ total: number; items: ServerErrorGroup[] }>;
}
