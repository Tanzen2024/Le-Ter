import type { ApiError } from '../../lib/api-client';
import type { GameType, GaramVariant } from '../../types/game';
import type { TournamentCreationRules, TournamentProposalInput } from '../../types/tournament';

/**
 * Formulaire d'un tournoi (proposition d'un joueur, création par l'admin), D-054.
 *
 * Le FORMAT des saisies est vérifié ici (date, heure, nombres entiers, pourcentages), ainsi que
 * la durée, le nombre de joueurs et le prix d'entrée minimal dans les bornes réglées dans les
 * Paramètres des tournois (D-103, D-104, D-105, lues sur le serveur) pour un retour immédiat.
 * Les autres règles (au moins 1 h à l'avance, 1 à 10 rangs, somme 100 %, une proposition en
 * attente) sont celles du
 * SERVEUR, qui reste la source de vérité pour toutes et renvoie ses erreurs par champ ;
 * `fieldErrorsFromApi` les replace sur le formulaire.
 */
export interface TournamentFormValues {
  /**
   * Jeu du tournoi (D-124) : `null` tant que l'utilisateur n'a pas choisi. Jamais présélectionné
   * à la création (ni Fap-Fap ni GARAM TIA).
   */
  gameType: GameType | null;
  /**
   * Variante d'un tournoi GARAM TIA (D-127) : 15 présélectionnée (amendement du 2026-10-21),
   * toujours envoyée explicitement ; `null` reste refusé ; ignorée pour Fap-Fap.
   */
  garamVariant: GaramVariant | null;
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

export type TournamentFormField = keyof TournamentFormValues;
/** Champs saisis au clavier ou par les sélecteurs de date et d'heure. */
export type TournamentTextField = Exclude<
  TournamentFormField,
  'shares' | 'gameType' | 'garamVariant'
>;
export type TournamentFormErrors = Partial<Record<TournamentFormField, string>>;

/** Les deux jeux proposés, dans cet ordre ; libellés affichés tels quels. */
export const TOURNAMENT_GAMES: readonly { value: GameType; label: string }[] = [
  { value: 'TER', label: 'FAP-FAP' },
  { value: 'GARAM', label: 'GARAM TIA' },
];

/** Jeu non choisi : même message que le serveur. */
export const TOURNAMENT_GAME_REQUIRED = 'Veuillez sélectionner le jeu du tournoi.';

/** Variante GARAM non choisie (D-127) : même message que le serveur. */
export const GARAM_VARIANT_REQUIRED = 'Veuillez choisir la variante : GARAM 15, 16, 17 ou 18.';

export const MAX_RANKS = 10;

/**
 * Durée proposée par défaut dans les formulaires, en minutes (ramenée dans les bornes réglées,
 * `withRuleDefaults`).
 */
export const TOURNAMENT_DURATION_MINUTES = {
  default: 60,
} as const;

/** Minimum de joueurs proposé avant la lecture des règles (valeur initiale du serveur). */
export const DEFAULT_MINIMUM_PLAYERS = 20;

/** Prix d'entrée proposé par défaut (FCFA), relevé au minimum réglé s'il est plus élevé. */
export const DEFAULT_ENTRY_FEE = 1000;

/** Message d'un prix d'entrée hors limites, identique à celui du serveur. */
export function entryFeeError(rules: TournamentCreationRules): string {
  return `Montant entier entre ${rules.minimumEntryFee} et ${rules.maximumEntryFee}.`;
}

/** Message d'une durée hors limites, identique à celui du serveur (forme imposée par D-058). */
export function tournamentDurationError(rules: TournamentCreationRules): string {
  return `Durée entre ${rules.minimumDurationMinutes} minutes et ${rules.maximumDurationMinutes} minutes.`;
}

/**
 * Valeurs par défaut ajustées aux règles réglées : minimum de joueurs du paramètre, durée
 * ramenée dans les bornes, prix d'entrée relevé au minimum réglé. Une saisie déjà modifiée par
 * le joueur n'est jamais touchée.
 */
export function withRuleDefaults(
  values: TournamentFormValues,
  rules: TournamentCreationRules,
): TournamentFormValues {
  const next = { ...values };
  if (values.minimumPlayers === String(DEFAULT_MINIMUM_PLAYERS)) {
    next.minimumPlayers = String(rules.minimumPlayers);
  }
  if (values.durationMinutes === String(TOURNAMENT_DURATION_MINUTES.default)) {
    const duration = Math.min(
      rules.maximumDurationMinutes,
      Math.max(rules.minimumDurationMinutes, TOURNAMENT_DURATION_MINUTES.default),
    );
    next.durationMinutes = String(duration);
  }
  if (values.entryFee === String(DEFAULT_ENTRY_FEE) && DEFAULT_ENTRY_FEE < rules.minimumEntryFee) {
    next.entryFee = String(rules.minimumEntryFee);
  }
  return next;
}

const pad = (n: number) => String(n).padStart(2, '0');

/** Valeurs de départ : demain 18:00, 60 min, 1 000 FCFA, 20 joueurs minimum, 50 / 30 / 20. */
export function defaultTournamentForm(now: Date = new Date()): TournamentFormValues {
  const tomorrow = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
  return {
    gameType: null,
    garamVariant: 15,
    date: `${pad(tomorrow.getDate())}/${pad(tomorrow.getMonth() + 1)}/${tomorrow.getFullYear()}`,
    startTime: '18:00',
    durationMinutes: String(TOURNAMENT_DURATION_MINUTES.default),
    entryFee: String(DEFAULT_ENTRY_FEE),
    minimumPlayers: String(DEFAULT_MINIMUM_PLAYERS),
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
  /** Règles réglées (serveur) ; absentes (pas encore lues) : seul le format est vérifié. */
  rules?: TournamentCreationRules,
): { ok: true; payload: TournamentProposalInput } | { ok: false; errors: TournamentFormErrors } {
  const errors: TournamentFormErrors = {};
  const { gameType } = values;
  if (gameType === null) errors.gameType = TOURNAMENT_GAME_REQUIRED;
  const { garamVariant } = values;
  if (gameType === 'GARAM' && garamVariant === null) errors.garamVariant = GARAM_VARIANT_REQUIRED;
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
  const entryFee = integer('entryFee', values.entryFee, 'Montant entier en FCFA.');
  const minimumPlayers = integer('minimumPlayers', values.minimumPlayers, 'Nombre entier.');
  const maximumPlayers = values.maximumPlayers.trim()
    ? integer('maximumPlayers', values.maximumPlayers, 'Nombre entier (ou vide).')
    : undefined;
  if (rules) checkRules(rules, { duration, entryFee, minimumPlayers, maximumPlayers }, errors);
  const shares = values.shares.map((s) => s.trim().replace(',', '.'));
  if (shares.length < 1 || shares.length > MAX_RANKS || shares.some((s) => !PERCENT.test(s))) {
    errors.shares = 'Un pourcentage par rang récompensé.';
  }
  if (Object.keys(errors).length > 0 || !start || gameType === null) return { ok: false, errors };

  return {
    ok: true,
    payload: {
      gameType,
      ...(gameType === 'GARAM' && garamVariant !== null && { garamVariant }),
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

/**
 * Bornes réglées dans les Paramètres des tournois (D-103, D-104, D-105), mêmes messages que le
 * serveur : durée en minutes, prix d'entrée, minimum et maximum de joueurs (maximum `null` = ∞).
 */
function checkRules(
  rules: TournamentCreationRules,
  input: { duration: number; entryFee: number; minimumPlayers: number; maximumPlayers?: number },
  errors: TournamentFormErrors,
) {
  if (
    !errors.entryFee &&
    (input.entryFee < rules.minimumEntryFee || input.entryFee > rules.maximumEntryFee)
  ) {
    errors.entryFee = entryFeeError(rules);
  }
  const { minimumDurationMinutes: minMinutes, maximumDurationMinutes: maxMinutes } = rules;
  if (!errors.durationMinutes && (input.duration < minMinutes || input.duration > maxMinutes)) {
    errors.durationMinutes = tournamentDurationError(rules);
  }
  const { minimumPlayers: minLimit, maximumPlayers: maxLimit } = rules;
  const within = (n: number) => n >= minLimit && (maxLimit === null || n <= maxLimit);
  if (!errors.minimumPlayers && !within(input.minimumPlayers)) {
    errors.minimumPlayers =
      maxLimit === null ? `Au moins ${minLimit}.` : `Entre ${minLimit} et ${maxLimit}.`;
  }
  const max = input.maximumPlayers;
  if (
    max !== undefined &&
    !errors.maximumPlayers &&
    (!within(max) || (!errors.minimumPlayers && max < input.minimumPlayers))
  ) {
    errors.maximumPlayers =
      maxLimit === null
        ? `Au moins le minimum (${minLimit} ou plus).`
        : `Au moins le minimum (${minLimit} ou plus), au plus ${maxLimit}.`;
  }
}

/** Somme des pourcentages saisis (affichage : « Total : 100 % »). */
export function sharesTotal(shares: string[]): number {
  const total = shares.reduce((sum, s) => sum + (Number(s.replace(',', '.')) || 0), 0);
  return Math.round(total * 100) / 100;
}

/** Champs de l'API → champs du formulaire (messages du serveur affichés tels quels). */
const API_FIELD_MAP: Record<string, TournamentFormField> = {
  gameType: 'gameType',
  garamVariant: 'garamVariant',
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

/** Erreurs d'une création refusée, posées sur le formulaire (champs renvoyés par le serveur). */
export function formErrorsFromApiError(err: ApiError): TournamentFormErrors {
  return fieldErrorsFromApi(err.fields);
}

/** Erreur à afficher sous le formulaire : seulement celles qu'aucun champ ne porte. */
export function generalApiError(err: ApiError | undefined): string | undefined {
  if (!err || Object.keys(formErrorsFromApiError(err)).length > 0) return undefined;
  return err.message;
}
