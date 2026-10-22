import { parseArgs } from 'node:util';

import { connectDatabase, disconnectDatabase } from '../config/database';
import { loadEnvFile, readEnv } from '../config/env';
import { isGameType } from '../domain/game/game';
import { GARAM_VARIANT_REQUIRED, isGaramVariant } from '../domain/garam/garam-rules';
import {
  InvalidTournamentError,
  TOURNAMENT_GAME_REQUIRED,
} from '../domain/tournaments/tournament';
import { PostgresUserRepository } from '../repositories/postgres-user.repository';
import { createGameService } from '../services/game/create-game-service';
import { createLogger } from '../utils/logger';

/**
 * `npm run tournament:create -- --admin admin@le-ter.cm --game TER \
 *    --starts-at 2026-10-12T18:00:00+01:00 --ends-at 2026-10-12T20:00:00+01:00 \
 *    --entry-fee 1000 --min-players 20 --max-players 100 --prizes 50,30,20`
 *
 * Les tournois n'ont ni nom ni description (D-060). `--game` est obligatoire (D-124) :
 * `TER` (Fap-Fap) ou `GARAM` (GARAM TIA), sans valeur par défaut. Pour GARAM, `--variant`
 * (15, 16, 17 ou 18) est obligatoire, sans valeur par défaut (D-127).
 *
 * Outil d'exploitation (D-054) : crée un tournoi PUBLIÉ au nom d'un compte `admin`, par le
 * MÊME chemin que l'API d'administration (validation, commission copiée, non-chevauchement,
 * audit). Les dates exigent un fuseau explicite (`Z` ou `±hh:mm`). Jetons de départ et mise
 * sont calculés depuis le prix d'entrée et les coefficients des paramètres (D-071).
 */
const ISO_WITH_ZONE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,3})?)?(Z|[+-]\d{2}:\d{2})$/;

function parseDate(value: string | undefined, option: string): Date {
  if (!value || !ISO_WITH_ZONE.test(value)) {
    throw new Error(
      `--${option} : date ISO 8601 avec fuseau attendue (ex. 2026-10-12T18:00:00+01:00)`,
    );
  }
  return new Date(value);
}

function parseInteger(value: string | undefined, option: string): number | undefined {
  if (value === undefined) return undefined;
  if (!/^\d+$/.test(value)) throw new Error(`--${option} : nombre entier attendu`);
  return Number(value);
}

/** « 50,30,20 » (pourcentages) → règles en points de base. */
function parsePrizes(value: string | undefined) {
  if (!value) throw new Error('--prizes obligatoire (ex. 50,30,20)');
  return value.split(',').map((part, index) => {
    const percent = Number(part.trim());
    if (!Number.isFinite(percent))
      throw new Error('--prizes : pourcentages séparés par des virgules');
    return { rank: index + 1, shareBps: Math.round(percent * 100) };
  });
}

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      admin: { type: 'string' },
      game: { type: 'string' },
      variant: { type: 'string' },
      'starts-at': { type: 'string' },
      'ends-at': { type: 'string' },
      'entry-fee': { type: 'string' },
      'min-players': { type: 'string' },
      'max-players': { type: 'string' },
      prizes: { type: 'string' },
      timezone: { type: 'string' },
    },
    strict: true,
  });
  if (!values.admin) throw new Error('--admin <email d’un compte admin> obligatoire');
  if (!isGameType(values.game)) {
    throw new Error(`--game TER (Fap-Fap) ou GARAM (GARAM TIA) : ${TOURNAMENT_GAME_REQUIRED}`);
  }
  const variant = parseInteger(values.variant, 'variant');
  if (values.game === 'GARAM' && !isGaramVariant(variant)) {
    throw new Error(`--variant 15, 16, 17 ou 18 : ${GARAM_VARIANT_REQUIRED}`);
  }
  const input = {
    gameType: values.game,
    ...(isGaramVariant(variant) && { garamVariant: variant }),
    ...(values.timezone && { timezone: values.timezone }),
    startsAt: parseDate(values['starts-at'], 'starts-at'),
    endsAt: parseDate(values['ends-at'], 'ends-at'),
    entryFee: parseInteger(values['entry-fee'], 'entry-fee') ?? 0,
    minimumPlayers: parseInteger(values['min-players'], 'min-players') ?? 20,
    maximumPlayers: parseInteger(values['max-players'], 'max-players'),
    prizeRules: parsePrizes(values.prizes),
  };

  loadEnvFile();
  const env = readEnv();
  if (!env.databaseUrl) throw new Error('DATABASE_URL non défini');
  const logger = createLogger({ action: 'ADMIN_CREATE_TOURNAMENT' });
  const sql = await connectDatabase(env.databaseUrl);
  try {
    const admin = await new PostgresUserRepository(sql).findByEmail(
      values.admin.trim().toLowerCase(),
    );
    if (!admin || admin.role !== 'admin') {
      throw new Error('--admin : aucun compte admin avec cet email (npm run user:role)');
    }
    const { tournaments, sessions } = createGameService({ sql, logger });
    const t = await tournaments.createAsAdmin(admin.id, input);
    console.log(
      `Tournoi ${t.id} (${t.status}) : ` +
        `${t.startsAt.toISOString()} → ${t.endsAt.toISOString()}, ` +
        `entrée ${t.entryFee} XAF, commission ${(t.platformFeeBps ?? 0) / 100} %`,
    );
    sessions.stopTimers();
  } finally {
    await disconnectDatabase();
  }
}

main().catch((err: unknown) => {
  if (err instanceof InvalidTournamentError) {
    console.error('Tournoi invalide :');
    for (const [field, message] of Object.entries(err.fields)) {
      console.error(`  ${field} : ${message}`);
    }
  } else {
    console.error('Échec :', err instanceof Error ? err.message : err);
  }
  process.exit(1);
});
