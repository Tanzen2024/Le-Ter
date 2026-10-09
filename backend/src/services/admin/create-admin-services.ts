import type { RedisClientType } from 'redis';

import type { SqlClient } from '../../database/sql-client';
import {
  FallbackRateLimitStore,
  MemoryRateLimitStore,
  RedisRateLimitStore,
  redisCounter,
  type RateLimitStore,
} from '../../middleware/shared-rate-limit';
import { PostgresAdminAuditRepository } from '../../repositories/postgres-admin-audit.repository';
import { PostgresAdminQueryRepository } from '../../repositories/postgres-admin-query.repository';
import { PostgresAdminSessionRepository } from '../../repositories/postgres-admin-session.repository';
import type { Logger } from '../../utils/logger';
import type { AuthService } from '../auth/auth.service';
import type { PaymentService } from '../payments/payment.service';
import { AdminQueryService } from './admin-query.service';
import { AdminSessionService } from './admin-session.service';

export interface AdminServices {
  sessions: AdminSessionService;
  queries: AdminQueryService;
  rateLimitStore: RateLimitStore;
}

/**
 * Assemble l'administration (D-061) sur PostgreSQL. Redis, s'il est configuré, ne sert qu'à
 * partager les compteurs de la connexion admin entre instances (repli local en cas de panne).
 */
export function createAdminServices(deps: {
  sql: SqlClient;
  auth: AuthService;
  logger: Logger;
  payments?: PaymentService;
  redis?: RedisClientType;
  clock?: () => Date;
}): AdminServices {
  const audit = new PostgresAdminAuditRepository(deps.sql);
  const memory = new MemoryRateLimitStore();
  const rateLimitStore: RateLimitStore = deps.redis
    ? new FallbackRateLimitStore(
        new RedisRateLimitStore(redisCounter(deps.redis)),
        memory,
        deps.logger,
      )
    : memory;
  return {
    sessions: new AdminSessionService({
      auth: deps.auth,
      sessions: new PostgresAdminSessionRepository(deps.sql),
      audit,
      logger: deps.logger,
      clock: deps.clock,
    }),
    queries: new AdminQueryService({
      queries: new PostgresAdminQueryRepository(deps.sql),
      audit,
      payments: deps.payments,
      logger: deps.logger,
      clock: deps.clock,
    }),
    rateLimitStore,
  };
}
