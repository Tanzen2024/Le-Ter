import { GARAM_VARIANT_REQUIRED, isGaramVariant } from '../domain/garam/garam-rules';
import { isGameType } from '../domain/game/game';
import type {
  CancellationReason,
  TournamentInput,
  TournamentSettings,
  TournamentStatus,
} from '../domain/tournaments/tournament';
import { TOURNAMENT_GAME_REQUIRED, TOURNAMENT_STATUSES } from '../domain/tournaments/tournament';
import { ValidationError } from './validation-error';

/**
 * Forme des requêtes des tournois (D-054). Seules la FORME et le type sont vérifiés ici ;
 * les règles (dates, limites, somme des parts) sont celles du domaine.
 *
 * Dates : ISO 8601 AVEC fuseau (`Z` ou `±hh:mm`), jamais une heure locale ambiguë.
 * Répartition : `prizeRules: [{ rank: 1, percent: 50 }, …]` (pourcentages, 2 décimales).
 */
const ISO_WITH_ZONE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,3})?)?(Z|[+-]\d{2}:\d{2})$/;

type Body = Record<string, unknown>;

function asBody(body: unknown): Body {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    throw new ValidationError({ body: 'Objet JSON attendu.' });
  }
  return body as Body;
}

export function parseTournamentInput(
  body: unknown,
  { partial = false } = {},
): Partial<TournamentInput> {
  const b = asBody(body);
  const fields: Record<string, string> = {};
  const out: Partial<TournamentInput> = {};

  // Jeu (D-124) : 'TER' (Fap-Fap) ou 'GARAM' (GARAM TIA), le `game_type` des sessions.
  // Obligatoire à la création ; absent, null, vide ou inconnu : refusé, jamais remplacé.
  if (!partial || b.gameType !== undefined) {
    if (isGameType(b.gameType)) out.gameType = b.gameType;
    else fields.gameType = TOURNAMENT_GAME_REQUIRED;
  }
  // Variante GARAM TIA (D-127) : transmise telle quelle, vérifiée avec le jeu par
  // `validateTournamentInput` (obligatoire pour GARAM, refusée pour Fap-Fap).
  if (b.garamVariant !== undefined && b.garamVariant !== null) {
    if (isGaramVariant(b.garamVariant)) out.garamVariant = b.garamVariant;
    else fields.garamVariant = GARAM_VARIANT_REQUIRED;
  }

  // Ni nom ni description (D-060) : ces clés, si un ancien client les envoie, sont ignorées.
  if (b.timezone !== undefined) {
    if (typeof b.timezone !== 'string') fields.timezone = 'Texte attendu.';
    else out.timezone = b.timezone;
  }

  const dateKeys = ['startsAt', 'endsAt', 'registrationOpensAt', 'registrationClosesAt'] as const;
  for (const key of dateKeys) {
    const v = b[key];
    if (v === undefined || v === null) continue;
    if (typeof v !== 'string' || !ISO_WITH_ZONE.test(v) || Number.isNaN(Date.parse(v))) {
      fields[key] = 'Date ISO 8601 avec fuseau attendue.';
    } else {
      out[key] = new Date(v);
    }
  }

  // Jetons de départ et mise : toujours calculés par le serveur (D-071), jamais reçus.
  for (const key of ['initialTournamentTokens', 'stakePerGame']) {
    if (b[key] !== undefined) fields[key] = 'Calculé par le serveur à partir du prix d’entrée.';
  }

  const intKeys = ['entryFee', 'minimumPlayers', 'maximumPlayers'] as const;
  for (const key of intKeys) {
    const v = b[key];
    if (v === undefined || v === null) continue;
    if (typeof v !== 'number' || !Number.isSafeInteger(v)) fields[key] = 'Nombre entier attendu.';
    else out[key] = v;
  }

  if (b.prizeRules !== undefined) {
    if (!Array.isArray(b.prizeRules)) {
      fields.prizeRules = 'Liste attendue.';
    } else {
      const rules = b.prizeRules.map((r: unknown) => {
        const rule = (r ?? {}) as { rank?: unknown; percent?: unknown };
        return {
          rank: typeof rule.rank === 'number' ? rule.rank : NaN,
          shareBps: typeof rule.percent === 'number' ? Math.round(rule.percent * 100) : NaN,
        };
      });
      if (rules.some((r) => Number.isNaN(r.rank) || Number.isNaN(r.shareBps))) {
        fields.prizeRules = 'Chaque rang : { rank, percent }.';
      } else {
        out.prizeRules = rules;
      }
    }
  }

  if (!partial) {
    for (const key of ['startsAt', 'endsAt', 'entryFee', 'minimumPlayers', 'prizeRules'] as const) {
      if (out[key] === undefined && !fields[key]) fields[key] = 'Champ obligatoire.';
    }
  }
  if (Object.keys(fields).length > 0) throw new ValidationError(fields);
  return out;
}

const SETTINGS_KEYS: (keyof TournamentSettings)[] = [
  'platformFeePercent',
  'initialTokensCoefficient',
  'stakePerGameCoefficient',
  'maximumPendingTournamentsPerPlayer',
  'tournamentTransitionMinutes',
  'rankingTokensWeightPercent',
  'rankingGamesWeightPercent',
  'tournamentMinimumPlayers',
  'tournamentMaximumPlayers',
  'tournamentMinimumDurationMinutes',
  'tournamentMaximumDurationMinutes',
  'tournamentMinimumEntryFee',
];

export function parseTournamentSettingsInput(body: unknown): Partial<TournamentSettings> {
  const b = asBody(body);
  const fields: Record<string, string> = {};
  const out: Partial<TournamentSettings> = {};
  for (const [key, value] of Object.entries(b)) {
    if (!SETTINGS_KEYS.includes(key as keyof TournamentSettings)) {
      fields[key] = 'Paramètre inconnu.';
    } else if (key === 'tournamentMaximumPlayers' && value === null) {
      // Aucun plafond de joueurs (∞).
      out.tournamentMaximumPlayers = null;
    } else if (typeof value !== 'number' || !Number.isFinite(value)) {
      fields[key] = 'Nombre attendu.';
    } else {
      out[key as Exclude<keyof TournamentSettings, 'tournamentMaximumPlayers'>] = value;
    }
  }
  if (Object.keys(fields).length > 0) throw new ValidationError(fields);
  return out;
}

export function parseStatusFilter(value: unknown): TournamentStatus[] | undefined {
  if (value === undefined) return undefined;
  const list = String(value)
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  if (list.some((s) => !(TOURNAMENT_STATUSES as readonly string[]).includes(s))) {
    throw new ValidationError({ status: 'Statut inconnu.' });
  }
  return list as TournamentStatus[];
}

export type { CancellationReason };
