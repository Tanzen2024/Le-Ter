import type { ReferralEnv } from '../../config/referral-env';
import type { SqlClient } from '../../database/sql-client';
import { PostgresReferralRepository } from '../../repositories/postgres-referral.repository';
import type { Logger } from '../../utils/logger';
import { ReferralService } from './referral.service';

/** Parrainage (D-161) sur PostgreSQL : source de vérité, aucun état dans Redis. */
export function createReferralService(options: {
  sql: SqlClient;
  logger: Logger;
  env: ReferralEnv;
  clock?: () => Date;
}): ReferralService {
  return new ReferralService({
    repository: new PostgresReferralRepository(options.sql),
    logger: options.logger.child({ action: 'REFERRAL' }),
    downloadUrl: options.env.downloadUrl,
    appScheme: 'leter',
    tickMs: options.env.tickMs,
    clock: options.clock,
  });
}
