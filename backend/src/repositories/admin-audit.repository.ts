import type { SqlExecutor } from '../database/sql-client';
import type { AuditAction, AuditEntry, AuditOutcome, AuditTargetType } from '../domain/admin/admin';

export interface AuditListQuery {
  page: number;
  limit: number;
  action?: AuditAction;
  outcome?: AuditOutcome;
  actorId?: string;
  targetType?: AuditTargetType;
  /** Identifiant de cible (UUID exact). */
  targetId?: string;
  from?: Date;
  to?: Date;
}

export interface AuditListItem extends AuditEntry {
  actorUsername: string | null;
}

/** Journal d'audit administratif : AJOUT et LECTURE seulement (migration 0023). */
export interface AdminAuditRepository {
  insert(entry: AuditEntry): Promise<void>;
  list(query: AuditListQuery): Promise<{ total: number; items: AuditListItem[] }>;
  /** Dernière vérification de paiement demandée avec cette clé d'idempotence, ou null. */
  findVerification(idempotencyKey: string): Promise<AuditEntry | null>;
}

/**
 * Insertion d'une ligne du journal, dans la transaction de l'appelant quand l'action en a
 * une (l'action et sa trace sont alors atomiques).
 */
export async function insertAuditRow(tx: SqlExecutor, entry: AuditEntry): Promise<void> {
  await tx.query(
    `INSERT INTO admin_audit_log
       (id, actor_id, action, target_type, target_id, outcome, details, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [
      entry.id,
      entry.actorId,
      entry.action,
      entry.targetType,
      entry.targetId,
      entry.outcome,
      JSON.stringify(entry.details),
      entry.createdAt.toISOString(),
    ],
  );
}

export interface AuditRow {
  id: string;
  actor_id: string | null;
  action: AuditAction;
  target_type: AuditTargetType;
  target_id: string | null;
  outcome: AuditOutcome;
  details: Record<string, unknown>;
  created_at: Date;
}

export function auditEntryOf(row: AuditRow): AuditEntry {
  return {
    id: row.id,
    actorId: row.actor_id as AuditEntry['actorId'],
    action: row.action,
    targetType: row.target_type,
    targetId: row.target_id,
    outcome: row.outcome,
    details: row.details,
    createdAt: new Date(row.created_at),
  };
}
