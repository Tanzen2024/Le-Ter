import type { TournamentProposalInput } from '../../types/tournament';

/**
 * Formulaire d'un tournoi (proposition d'un joueur, création par l'admin), D-054.
 *
 * Le FORMAT des saisies est vérifié ici (date, heure, nombres entiers, pourcentages), ainsi que
 * la durée (30 à 120 min, D-058) pour un retour immédiat. Les autres règles (au moins 1 h à
 * l'avance, prix 0 à 100 000, 20 à 1 000 joueurs, 1 à 10 rangs, somme 100 %, une proposition
 * en attente) sont celles du SERVEUR, qui reste la source de vérité pour toutes (durée
 * comprise) et renvoie ses erreurs par champ ; `fieldErrorsFromApi` les replace sur le
 * formulaire.
 */
export interface TournamentFormValues {
  /** JJ/MM/AAAA, heure locale du téléphone. */
  date: string;
  /** HH:MM. */
  startTime: string;
  durationMinutes: string;
  entryFee: string;
  minimumPlayers: string;
  /** Vide : sans limite. */
  maximumPlayers: string;
  /** Pourcentage de la cagnotte par rang récompensé (rang 1 en premier). */
  shares: string[];
}

export type TournamentFormField = Exclude<keyof TournamentFormValues, 'shares'> | 'shares';
export type TournamentFormErrors = Partial<Record<TournamentFormField, string>>;

export const MAX_RANKS = 10;

/**
 * Durée d'un tournoi en minutes : bornes incluses (D-058, miroir du serveur) et valeur
 * proposée par défaut dans les formulaires.
 */
export const TOURNAMENT_DURATION_MINUTES = {
  min: 30,
  max: 120,
  default: 60,
} as const;

/**
 * Message EXACT d'une durée hors limites (D-058), identique à celui du serveur : texte imposé,
 * à ne pas reformuler (point final compris).
 */
export const TOURNAMENT_DURATION_ERROR = 'Durée entre 30 minutes et 120 minutes.';

const pad = (n: number) => String(n).padStart(2, '0');

/** Valeurs de départ : demain 18:00, 60 min, 1 000 FCFA, 20 joueurs minimum, 50 / 30 / 20. */
export function defaultTournamentForm(now: Date = new Date()): TournamentFormValues {
  const tomorrow = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
  return {
    date: `${pad(tomorrow.getDate())}/${pad(tomorrow.getMonth() + 1)}/${tomorrow.getFullYear()}`,
    startTime: '18:00',
    durationMinutes: String(TOURNAMENT_DURATION_MINUTES.default),
    entryFee: '1000',
    minimumPlayers: '20',
    maximumPlayers: '',
    shares: defaultShares(3),
  };
}

/** Répartition proposée pour `count` rangs (modifiable) : la somme fait toujours 100. */
export function defaultShares(count: number): string[] {
  const presets: Record<number, number[]> = {
    1: [100],
    2: [60, 40],
    3: [50, 30, 20],
  };
  const n = Math.min(MAX_RANKS, Math.max(1, Math.trunc(count)));
  if (presets[n]) return presets[n].map(String);
  const each = Math.floor(100 / n);
  return Array.from({ length: n }, (_, i) => String(i === 0 ? 100 - each * (n - 1) : each));
}

const INTEGER = /^\d+$/;
const PERCENT = /^\d{1,3}([.,]\d{1,2})?$/;

function parseLocalStart(date: string, time: string): Date | undefined {
  const d = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(date.trim());
  const t = /^(\d{1,2}):(\d{2})$/.exec(time.trim());
  if (!d || !t) return undefined;
  const [day, month, year] = [Number(d[1]), Number(d[2]), Number(d[3])];
  const [hours, minutes] = [Number(t[1]), Number(t[2])];
  if (hours > 23 || minutes > 59) return undefined;
  const start = new Date(year, month - 1, day, hours, minutes);
  // 31/02 → 03/03 : refusé (date inexistante).
  if (start.getFullYear() !== year || start.getMonth() !== month - 1 || start.getDate() !== day) {
    return undefined;
  }
  return start;
}

/** Fuseau du téléphone (affichage) ; les instants envoyés sont en UTC, sans ambiguïté. */
export function deviceTimezone(): string | undefined {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || undefined;
  } catch {
    return undefined;
  }
}

/**
 * Saisie → corps de l'API. Les erreurs renvoyées ne portent que sur le format ; tout le
 * reste est décidé (et expliqué) par le serveur.
 */
export function toTournamentPayload(
  values: TournamentFormValues,
  timezone: string | undefined = deviceTimezone(),
): { ok: true; payload: TournamentProposalInput } | { ok: false; errors: TournamentFormErrors } {
  const errors: TournamentFormErrors = {};
  const start = parseLocalStart(values.date, values.startTime);
  if (!start) {
    if (!parseLocalStart(values.date, '00:00')) errors.date = 'Date au format JJ/MM/AAAA.';
    else errors.startTime = 'Heure au format HH:MM.';
  }
  const integer = (field: TournamentFormField, raw: string, message: string) => {
    if (!INTEGER.test(raw.trim())) {
      errors[field] = message;
      return 0;
    }
    return Number(raw.trim());
  };
  const duration = integer('durationMinutes', values.durationMinutes, 'Durée en minutes.');
  if (
    !errors.durationMinutes &&
    (duration < TOURNAMENT_DURATION_MINUTES.min || duration > TOURNAMENT_DURATION_MINUTES.max)
  ) {
    errors.durationMinutes = TOURNAMENT_DURATION_ERROR;
  }
  const entryFee = integer('entryFee', values.entryFee, 'Montant entier en FCFA.');
  const minimumPlayers = integer('minimumPlayers', values.minimumPlayers, 'Nombre entier.');
  const maximumPlayers = values.maximumPlayers.trim()
    ? integer('maximumPlayers', values.maximumPlayers, 'Nombre entier (ou vide).')
    : undefined;
  const shares = values.shares.map((s) => s.trim().replace(',', '.'));
  if (shares.length < 1 || shares.length > MAX_RANKS || shares.some((s) => !PERCENT.test(s))) {
    errors.shares = 'Un pourcentage par rang récompensé.';
  }
  if (Object.keys(errors).length > 0 || !start) return { ok: false, errors };

  return {
    ok: true,
    payload: {
      ...(timezone && { timezone }),
      startsAt: start.toISOString(),
      endsAt: new Date(start.getTime() + duration * 60_000).toISOString(),
      entryFee,
      minimumPlayers,
      ...(maximumPlayers !== undefined && { maximumPlayers }),
      prizeRules: shares.map((s, i) => ({ rank: i + 1, percent: Number(s) })),
    },
  };
}

/** Somme des pourcentages saisis (affichage : « Total : 100 % »). */
export function sharesTotal(shares: string[]): number {
  const total = shares.reduce((sum, s) => sum + (Number(s.replace(',', '.')) || 0), 0);
  return Math.round(total * 100) / 100;
}

/** Champs de l'API → champs du formulaire (messages du serveur affichés tels quels). */
const API_FIELD_MAP: Record<string, TournamentFormField> = {
  timezone: 'date',
  startsAt: 'startTime',
  endsAt: 'durationMinutes',
  registrationClosesAt: 'startTime',
  entryFee: 'entryFee',
  minimumPlayers: 'minimumPlayers',
  maximumPlayers: 'maximumPlayers',
  prizeRules: 'shares',
  initialTournamentTokens: 'shares',
  stakePerGame: 'shares',
};

export function fieldErrorsFromApi(
  fields: Record<string, string> | undefined,
): TournamentFormErrors {
  const errors: TournamentFormErrors = {};
  for (const [field, message] of Object.entries(fields ?? {})) {
    const target = API_FIELD_MAP[field];
    if (target && !errors[target]) errors[target] = message;
  }
  return errors;
}
