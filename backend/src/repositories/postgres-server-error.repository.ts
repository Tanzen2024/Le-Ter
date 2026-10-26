import type { SqlExecutor } from '../database/sql-client';
import {
  SERVER_ERROR_MESSAGE_MAX,
  SERVER_ERROR_STACK_MAX,
  serverErrorFingerprint,
  truncate,
  type ServerErrorGroup,
  type ServerErrorOccurrence,
} from '../domain/admin/server-errors';
import type { ServerErrorRepository } from './server-error.repository';

interface ServerErrorRow {
  fingerprint: string;
  method: string;
  route: string;
  status: number;
  code: string | null;
  error_name: string;
  message: string;
  occurrences: string | number;
  first_seen_at: Date;
  last_seen_at: Date;
  last_request_id: string | null;
  last_stack: string | null;
}

/** Pannes du serveur dans PostgreSQL (migration 0057) : une ligne par panne distincte. */
export class PostgresServerErrorRepository implements ServerErrorRepository {
  constructor(private readonly db: SqlExecutor) {}

  async record(o: ServerErrorOccurrence): Promise<void> {
    // Un seul ordre, atomique : la première occurrence crée le groupe, les suivantes le comptent
    // et gardent le message, la requête et la trace les plus récents.
    await this.db.query(
      `INSERT INTO server_errors
         (fingerprint, method, route, status, code, error_name, message, occurrences,
          first_seen_at, last_seen_at, last_request_id, last_stack)
       VALUES ($1, $2, $3, $4, $5, $6, $7, 1, $8, $8, $9, $10)
       ON CONFLICT (fingerprint) DO UPDATE SET
         occurrences     = server_errors.occurrences + 1,
         message         = EXCLUDED.message,
         first_seen_at   = LEAST(server_errors.first_seen_at, EXCLUDED.first_seen_at),
         last_seen_at    = GREATEST(server_errors.last_seen_at, EXCLUDED.last_seen_at),
         last_request_id = EXCLUDED.last_request_id,
         last_stack      = EXCLUDED.last_stack`,
      [
        serverErrorFingerprint(o),
        o.method,
        o.route,
        o.status,
        o.code,
        o.errorName,
        truncate(o.message, SERVER_ERROR_MESSAGE_MAX),
        o.occurredAt.toISOString(),
        o.requestId,
        o.stack === null ? null : truncate(o.stack, SERVER_ERROR_STACK_MAX),
      ],
    );
  }

  async list(page: { page: number; limit: number }): Promise<{ total: number; items: ServerErrorGroup[] }> {
    const count = await this.db.query<{ n: number }>(
      'SELECT count(*)::int AS n FROM server_errors',
    );
    const { rows } = await this.db.query<ServerErrorRow>(
      `SELECT fingerprint, method, route, status, code, error_name, message, occurrences,
              first_seen_at, last_seen_at, last_request_id, last_stack
       FROM server_errors
       ORDER BY last_seen_at DESC, fingerprint
       LIMIT $1 OFFSET $2`,
      [page.limit, (page.page - 1) * page.limit],
    );
    return {
      total: count.rows[0]?.n ?? 0,
      items: rows.map((r) => ({
        fingerprint: r.fingerprint,
        method: r.method,
        route: r.route,
        status: r.status,
        code: r.code,
        errorName: r.error_name,
        message: r.message,
        occurrences: Number(r.occurrences),
        firstSeenAt: new Date(r.first_seen_at),
        lastSeenAt: new Date(r.last_seen_at),
        lastRequestId: r.last_request_id,
        lastStack: r.last_stack,
      })),
    };
  }
}
