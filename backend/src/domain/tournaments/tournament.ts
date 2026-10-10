import { randomUUID } from 'node:crypto';

import type { UserId } from '../users/user';

/**
 * Tournois financiers (D-054). Logique PURE : états et transitions, validation des
 * paramètres, cagnotte, gains, classement et règlement des jetons d'une partie. Aucune
 * entrée-sortie : PostgreSQL et l'orchestration sont dans le dépôt et TournamentService.
 */
export type TournamentId = string & { readonly __brand: 'TournamentId' };

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export function isTournamentId(value: unknown): value is TournamentId {
  return typeof value === 'string' && UUID_PATTERN.test(value);
}

export function newTournamentId(): TournamentId {
  return randomUUID() as TournamentId;
}

/** Capacité des tables de tournoi (D-051), immuable comme toute session (D-034). */
export const TOURNAMENT_TABLE_SIZE = 4;
/**
 * Démarrage d'une table de tournoi (D-065) : dès le 2e joueur assis, le premier joueur
 * affecté (créateur de la partie) a 15 s pour démarrer (D-068) ; ensuite le serveur démarre.
 */
export const TOURNAMENT_TABLE_AUTO_START_MS = 15_000;
export const TOURNAMENT_CURRENCY = 'XAF';

// --- États (D-054) -----------------------------------------------------------------------

export const TOURNAMENT_STATUSES = [
  'DRAFT',
  'PENDING_APPROVAL',
  'SCHEDULED',
  'REGISTRATION_OPEN',
  'REGISTRATION_CLOSED',
  'STARTING',
  'IN_PROGRESS',
  'CALCULATING_RESULTS',
  'RESULTS_VALIDATED',
  'DISTRIBUTING_PRIZES',
  'COMPLETED',
  'CANCELLED',
] as const;
export type TournamentStatus = (typeof TOURNAMENT_STATUSES)[number];

export type CancellationReason =
  | 'INSUFFICIENT_PLAYERS'
  | 'ADMIN_CANCELLED'
  | 'SYSTEM_ERROR'
  | 'PAYMENT_ERROR'
  | 'APPROVAL_REJECTED'
  | 'CREATOR_CANCELLED';

export type CreatorType = 'ADMIN' | 'PLAYER';

/** Seules transitions permises ; toute autre est refusée (InvalidTournamentTransitionError). */
const TRANSITIONS: Record<TournamentStatus, readonly TournamentStatus[]> = {
  DRAFT: ['PENDING_APPROVAL', 'CANCELLED'],
  PENDING_APPROVAL: ['SCHEDULED', 'CANCELLED'],
  SCHEDULED: ['REGISTRATION_OPEN', 'CANCELLED'],
  REGISTRATION_OPEN: ['REGISTRATION_CLOSED', 'CANCELLED'],
  REGISTRATION_CLOSED: ['STARTING', 'CANCELLED'],
  STARTING: ['IN_PROGRESS', 'CANCELLED'],
  IN_PROGRESS: ['CALCULATING_RESULTS'],
  CALCULATING_RESULTS: ['RESULTS_VALIDATED'],
  RESULTS_VALIDATED: ['DISTRIBUTING_PRIZES'],
  DISTRIBUTING_PRIZES: ['COMPLETED'],
  COMPLETED: [],
  CANCELLED: [],
};

export function canTransition(from: TournamentStatus, to: TournamentStatus): boolean {
  return TRANSITIONS[from].includes(to);
}

export function assertTransition(id: TournamentId, from: TournamentStatus, to: TournamentStatus) {
  if (!canTransition(from, to)) {
    throw new InvalidTournamentTransitionError(id, from, to);
  }
}

/** Publiés et non terminés : ils occupent leur créneau (non-chevauchement). */
export const BLOCKING_STATUSES: readonly TournamentStatus[] = [
  'SCHEDULED',
  'REGISTRATION_OPEN',
  'REGISTRATION_CLOSED',
  'STARTING',
  'IN_PROGRESS',
  'CALCULATING_RESULTS',
];

/**
 * Publiés et pas encore commencés (D-059) : les tournois « en attente de démarrage ». Les
 * propositions non publiées (brouillon, en attente d'approbation) n'en font pas partie.
 */
export const WAITING_STATUSES: readonly TournamentStatus[] = [
  'SCHEDULED',
  'REGISTRATION_OPEN',
  'REGISTRATION_CLOSED',
  'STARTING',
];

/**
 * Comptés dans la limite plateforme `TOURNAMENT_LIMITS.maxWaitingTournaments` (D-072) :
 * inscriptions ouvertes, ou qui vont s'ouvrir (publié, `SCHEDULED`, ouvert automatiquement à
 * son heure sans nouveau contrôle). Ainsi jamais plus de 5 tournois aux inscriptions ouvertes ;
 * une place se libère dès la clôture des inscriptions.
 */
export const REGISTRATION_LIMIT_STATUSES: readonly TournamentStatus[] = [
  'SCHEDULED',
  'REGISTRATION_OPEN',
];

/** Avant la capture : une annulation libère les réservations (jamais de remboursement). */
export const PRE_CAPTURE_STATUSES: readonly TournamentStatus[] = [
  'DRAFT',
  'PENDING_APPROVAL',
  'SCHEDULED',
  'REGISTRATION_OPEN',
  'REGISTRATION_CLOSED',
  'STARTING',
];

/** Après la capture : les paiements sont définitifs. */
export const STARTED_STATUSES: readonly TournamentStatus[] = [
  'IN_PROGRESS',
  'CALCULATING_RESULTS',
  'RESULTS_VALIDATED',
  'DISTRIBUTING_PRIZES',
  'COMPLETED',
];

// --- Modèle --------------------------------------------------------------------------------

export interface PrizeRule {
  rank: number;
  /** Part de la cagnotte en points de base (5000 = 50 %). */
  shareBps: number;
}

export interface Tournament {
  id: TournamentId;
  version: number;
  status: TournamentStatus;
  creatorType: CreatorType;
  creatorId?: UserId;
  timezone: string;
  startsAt: Date;
  endsAt: Date;
  registrationOpensAt?: Date;
  registrationClosesAt?: Date;
  /** Fin + période de transition, figée à la publication (non-chevauchement). */
  blockedUntil?: Date;
  entryFee: number;
  currency: 'XAF';
  minimumPlayers: number;
  maximumPlayers?: number;
  /** Copié des paramètres à la publication, puis immuable. */
  platformFeeBps?: number;
  /**
   * Calculés par le serveur depuis le prix d'entrée et les coefficients des paramètres
   * (D-071, `tournamentTokenSetup`) tant que le tournoi n'est pas publié, puis figés.
   */
  initialTournamentTokens: number;
  stakePerGame: number;
  prizeRules: PrizeRule[];
  /** Poids du classement (D-062), copiés des paramètres à la publication, puis immuables. */
  rankingWeights?: RankingWeights;
  cancellationReason?: CancellationReason;
  cancelledAt?: Date;
  publishedAt?: Date;
  approvedBy?: UserId;
  startedAt?: Date;
  resultsAt?: Date;
  completedAt?: Date;
  /** Cagnotte, figée au démarrage. */
  participants?: number;
  grossPool?: number;
  platformFee?: number;
  prizePool?: number;
  unallocatedPrize?: number;
  createdAt: Date;
  updatedAt: Date;
}

export type TournamentRegistrationStatus = 'REGISTERED' | 'CANCELLED';

export interface TournamentRegistration {
  id: string;
  tournamentId: TournamentId;
  userId: UserId;
  status: TournamentRegistrationStatus;
  registeredAt: Date;
  cancelledAt?: Date;
}

export type TournamentAccountStatus = 'ACTIVE' | 'OUT_OF_TOKENS';

/** Compte temporaire du joueur dans le tournoi : jetons de tournoi, jamais d'argent. */
export interface TournamentPlayerAccount {
  id: string;
  tournamentId: TournamentId;
  playerId: UserId;
  registrationId: string;
  registeredAt: Date;
  initialTokens: number;
  currentTokens: number;
  gamesPlayed: number;
  gamesWon: number;
  rank?: number;
  prizeAmount: number;
  status: TournamentAccountStatus;
}

/** Ligne de résultat figée (rang, statistiques, gain), avec le pseudo pour l'affichage. */
export interface TournamentResultRow {
  tournamentId: TournamentId;
  rank: number;
  playerId: UserId;
  username: string;
  initialTokens: number;
  remainingTokens: number;
  gamesPlayed: number;
  gamesWon: number;
  /** Score pondéré figé (D-062) ; absent des résultats classés avant D-062. */
  score?: number;
  prizeShareBps: number;
  prizeAmount: number;
  prizeTransactionId?: string;
  paidAt?: Date;
}

/** Paramètres plateforme (system_settings, D-054). */
export interface TournamentSettings {
  platformFeePercent: number;
  /** Jetons de départ = prix d'entrée × coefficient (D-071) ; 2 décimales au plus. */
  initialTokensCoefficient: number;
  /** Mise par partie = prix d'entrée × coefficient (D-071) ; 2 décimales au plus. */
  stakePerGameCoefficient: number;
  maximumPendingTournamentsPerPlayer: number;
  tournamentTransitionMinutes: number;
  /** Poids du classement (D-062), en % ; leur somme vaut exactement 100. */
  rankingTokensWeightPercent: number;
  rankingGamesWeightPercent: number;
}

/**
 * Valeurs initiales (D-071) : utilisées seulement pour une clé jamais enregistrée dans
 * `system_settings`. Un réglage enregistré par l'administration n'est jamais écrasé.
 */
export const DEFAULT_TOURNAMENT_SETTINGS: TournamentSettings = {
  platformFeePercent: 15,
  initialTokensCoefficient: 10,
  stakePerGameCoefficient: 0.5,
  maximumPendingTournamentsPerPlayer: 1,
  tournamentTransitionMinutes: 0,
  rankingTokensWeightPercent: 60,
  rankingGamesWeightPercent: 40,
};

/** Bornes des paramètres modifiables par l'administrateur. */
export const SETTINGS_LIMITS: Record<keyof TournamentSettings, { min: number; max: number }> = {
  platformFeePercent: { min: 0, max: 50 },
  // Strictement positifs ; au plus jetons max / prix minimal (1 000 000 / 500).
  initialTokensCoefficient: { min: 0.01, max: 2000 },
  stakePerGameCoefficient: { min: 0.01, max: 2000 },
  maximumPendingTournamentsPerPlayer: { min: 0, max: 20 },
  tournamentTransitionMinutes: { min: 0, max: 24 * 60 },
  rankingTokensWeightPercent: { min: 0, max: 100 },
  rankingGamesWeightPercent: { min: 0, max: 100 },
};

/** Limites plateforme d'un tournoi (D-054 ; joueurs : D-057 ; durée : D-058). */
export const TOURNAMENT_LIMITS = {
  /** Durée : 30 min à 120 min (bornes incluses, D-058). */
  minDurationMs: 30 * 60 * 1000,
  maxDurationMs: 120 * 60 * 1000,
  /** Un joueur propose un tournoi au moins 1 h à l'avance (temps d'approbation). */
  playerMinLeadMs: 60 * 60 * 1000,
  /** Prix d'entrée : 500 à 100 000 FCFA (D-071 : plus de tournoi gratuit). */
  minEntryFee: 500,
  maxEntryFee: 100_000,
  /** Participants : 20 à 1 000, pour le minimum comme pour le maximum (D-057). */
  minPlayers: 20,
  maxPlayers: 1000,
  maxPrizeRanks: 10,
  maxInitialTokens: 1_000_000,
  /** Tournois aux inscriptions ouvertes ou à ouvrir (REGISTRATION_LIMIT_STATUSES), plateforme (D-072). */
  maxWaitingTournaments: 5,
} as const;

/**
 * Message EXACT d'une durée hors limites (D-058) : texte imposé par le propriétaire du projet,
 * à ne pas reformuler (point final compris).
 */
export const TOURNAMENT_DURATION_ERROR = 'Durée entre 30 minutes et 120 minutes.';

/**
 * Démarrage bloqué (D-056) : au-delà de `starts_at` + ce délai, un tournoi encore en STARTING
 * après des échecs est annulé (SYSTEM_ERROR) et ses réservations sont libérées.
 */
export const START_RECOVERY_MS = 15 * 60 * 1000;
/** Échecs de démarrage consécutifs (dans une instance) à partir desquels on alerte. */
export const START_FAILURE_ALERT_THRESHOLD = 3;

/** Délai maximal d'attente des parties encore en cours après la fin (D-054). */
export const RESULTS_GRACE_MS = 10 * 60 * 1000;

// --- Validation -----------------------------------------------------------------------------

/** Paramètres d'un tournoi. Ni nom ni description : supprimés (D-060). */
export interface TournamentInput {
  timezone?: string;
  startsAt: Date;
  endsAt: Date;
  registrationOpensAt?: Date;
  registrationClosesAt?: Date;
  entryFee: number;
  minimumPlayers: number;
  maximumPlayers?: number;
  prizeRules: PrizeRule[];
}

/** Paramètres validés : prêts à être enregistrés, jetons de départ et mise calculés. */
export type ValidTournamentInput = Required<
  Pick<
    TournamentInput,
    'timezone' | 'startsAt' | 'endsAt' | 'entryFee' | 'minimumPlayers' | 'prizeRules'
  >
> &
  Pick<TournamentInput, 'maximumPlayers' | 'registrationOpensAt' | 'registrationClosesAt'> &
  TournamentTokenSetup;

const isInt = (v: unknown): v is number => typeof v === 'number' && Number.isSafeInteger(v);
const validDate = (d: unknown): d is Date => d instanceof Date && !Number.isNaN(d.getTime());

function validTimezone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat('en', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/**
 * Libellé d'un tournoi, CALCULÉ (jamais stocké : le nom n'existe plus, D-060) :
 * « Tournoi du 10/10/2026 18:00 » dans le fuseau du tournoi. Nom de session des tables,
 * résumé partageable, export et références internes de l'administration.
 */
export function tournamentLabel(startsAt: Date, timezone: string): string {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('fr-FR', {
      timeZone: timezone,
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    })
      .formatToParts(startsAt)
      .map((p) => [p.type, p.value]),
  );
  return `Tournoi du ${parts.day}/${parts.month}/${parts.year} ${parts.hour}:${parts.minute}`;
}

/**
 * Valide les paramètres d'un tournoi (création ou modification). Jetons de départ et mise
 * sont CALCULÉS depuis le prix d'entrée et les coefficients des paramètres (D-071), sauf
 * `frozenTokens` : valeurs déjà figées à la publication, conservées telles quelles. Lève
 * InvalidTournamentError (champs fautifs).
 */
export function validateTournamentInput(
  input: TournamentInput,
  context: {
    now: Date;
    creatorType: CreatorType;
    settings: TournamentSettings;
    frozenTokens?: TournamentTokenSetup;
  },
): ValidTournamentInput {
  const fields: Record<string, string> = {};
  const timezone = input.timezone ?? 'Africa/Douala';
  if (typeof timezone !== 'string' || timezone.length > 64 || !validTimezone(timezone)) {
    fields.timezone = 'Fuseau horaire inconnu.';
  }

  const { startsAt, endsAt, registrationOpensAt, registrationClosesAt } = input;
  if (!validDate(startsAt)) fields.startsAt = 'Date de début invalide.';
  if (!validDate(endsAt)) fields.endsAt = 'Date de fin invalide.';
  if (validDate(startsAt) && validDate(endsAt)) {
    const duration = endsAt.getTime() - startsAt.getTime();
    const minStart =
      context.now.getTime() +
      (context.creatorType === 'PLAYER' ? TOURNAMENT_LIMITS.playerMinLeadMs : 0);
    if (startsAt.getTime() <= minStart) {
      fields.startsAt =
        context.creatorType === 'PLAYER'
          ? 'Le tournoi doit commencer au moins 1 h plus tard.'
          : 'Le début doit être dans le futur.';
    }
    if (duration < TOURNAMENT_LIMITS.minDurationMs || duration > TOURNAMENT_LIMITS.maxDurationMs) {
      fields.endsAt = TOURNAMENT_DURATION_ERROR;
    }
    if (registrationOpensAt !== undefined) {
      if (!validDate(registrationOpensAt) || registrationOpensAt.getTime() >= startsAt.getTime()) {
        fields.registrationOpensAt = 'Ouverture des inscriptions avant le début.';
      }
    }
    if (registrationClosesAt !== undefined) {
      const opens = registrationOpensAt?.getTime() ?? context.now.getTime();
      if (
        !validDate(registrationClosesAt) ||
        registrationClosesAt.getTime() > startsAt.getTime() ||
        registrationClosesAt.getTime() <= opens
      ) {
        fields.registrationClosesAt =
          'Fermeture des inscriptions après l’ouverture, au plus au début.';
      }
    }
  }

  const entryFeeValid =
    isInt(input.entryFee) &&
    input.entryFee >= TOURNAMENT_LIMITS.minEntryFee &&
    input.entryFee <= TOURNAMENT_LIMITS.maxEntryFee;
  if (!entryFeeValid) {
    fields.entryFee = `Montant entier entre ${TOURNAMENT_LIMITS.minEntryFee} et ${TOURNAMENT_LIMITS.maxEntryFee}.`;
  }
  const { minimumPlayers, maximumPlayers } = input;
  if (
    !isInt(minimumPlayers) ||
    minimumPlayers < TOURNAMENT_LIMITS.minPlayers ||
    minimumPlayers > TOURNAMENT_LIMITS.maxPlayers
  ) {
    fields.minimumPlayers = `Entre ${TOURNAMENT_LIMITS.minPlayers} et ${TOURNAMENT_LIMITS.maxPlayers}.`;
  }
  if (
    maximumPlayers !== undefined &&
    (!isInt(maximumPlayers) ||
      maximumPlayers < TOURNAMENT_LIMITS.minPlayers ||
      maximumPlayers > TOURNAMENT_LIMITS.maxPlayers ||
      (isInt(minimumPlayers) && maximumPlayers < minimumPlayers))
  ) {
    fields.maximumPlayers = `Au moins le minimum (${TOURNAMENT_LIMITS.minPlayers} ou plus), au plus ${TOURNAMENT_LIMITS.maxPlayers}.`;
  }

  const tokens =
    context.frozenTokens ??
    (entryFeeValid ? tournamentTokenSetup(input.entryFee, context.settings) : undefined);
  if (tokens) {
    const { initialTournamentTokens, stakePerGame } = tokens;
    if (
      !isInt(initialTournamentTokens) ||
      initialTournamentTokens < 1 ||
      initialTournamentTokens > TOURNAMENT_LIMITS.maxInitialTokens
    ) {
      fields.entryFee = `Jetons de départ calculés hors limites (1 à ${TOURNAMENT_LIMITS.maxInitialTokens}).`;
    } else if (
      !isInt(stakePerGame) ||
      stakePerGame < 1 ||
      // Au départ, chacun doit pouvoir jouer : jetons initiaux >= seuil de participation.
      !canPlayTournamentGame(initialTournamentTokens, stakePerGame)
    ) {
      fields.entryFee = 'Mise calculée hors limites (de 1 à la moitié des jetons de départ).';
    }
  }

  const prizeError = prizeRulesError(input.prizeRules);
  if (prizeError) fields.prizeRules = prizeError;

  if (Object.keys(fields).length > 0) {
    throw new InvalidTournamentError(fields);
  }
  return {
    timezone,
    startsAt,
    endsAt,
    ...(registrationOpensAt && { registrationOpensAt }),
    ...(registrationClosesAt && { registrationClosesAt }),
    entryFee: input.entryFee,
    minimumPlayers,
    ...(maximumPlayers !== undefined && { maximumPlayers }),
    // Défini : un prix d'entrée invalide (donc des jetons absents) a déjà levé l'erreur.
    initialTournamentTokens: tokens!.initialTournamentTokens,
    stakePerGame: tokens!.stakePerGame,
    prizeRules: [...input.prizeRules].sort((a, b) => a.rank - b.rank),
  };
}

/**
 * Statuts où jetons de départ et mise SUIVENT les coefficients en vigueur (D-071) : ils sont
 * recalculés à chaque lecture et figés à la publication (approbation).
 */
export const TOKEN_SETUP_STATUSES: readonly TournamentStatus[] = ['DRAFT', 'PENDING_APPROVAL'];

export interface TournamentTokenSetup {
  initialTournamentTokens: number;
  stakePerGame: number;
}

/**
 * Coefficient en CENTIÈMES (entier exact) : 0,5 → 50, 10 → 1000. `undefined` si le nombre
 * n'est pas fini ou a plus de 2 décimales (aucun calcul flottant sur les montants).
 */
export function coefficientHundredths(coefficient: number): number | undefined {
  if (typeof coefficient !== 'number' || !Number.isFinite(coefficient)) return undefined;
  const hundredths = Math.round(coefficient * 100);
  return Math.abs(coefficient * 100 - hundredths) < 1e-6 ? hundredths : undefined;
}

/**
 * Seule formule des jetons de départ et de la mise (D-071) : prix d'entrée × coefficient des
 * paramètres, en entiers, arrondi à l'entier INFÉRIEUR (même sens que la commission). Calcul
 * exact : prix (≤ 100 000) × centièmes (≤ 200 000) reste un entier sûr. Les bornes (au moins
 * 1, mise au plus la moitié des jetons) sont vérifiées par `validateTournamentInput`.
 */
export function tournamentTokenSetup(
  entryFee: number,
  settings: Pick<TournamentSettings, 'initialTokensCoefficient' | 'stakePerGameCoefficient'>,
): TournamentTokenSetup {
  const times = (coefficient: number) =>
    Math.floor((entryFee * (coefficientHundredths(coefficient) ?? 0)) / 100);
  return {
    initialTournamentTokens: times(settings.initialTokensCoefficient),
    stakePerGame: times(settings.stakePerGameCoefficient),
  };
}

/**
 * Cohérence des deux coefficients (D-071, D-063) : la mise doit rester au plus la moitié des
 * jetons de départ pour TOUT prix d'entrée, donc coefficient de mise × 2 ≤ coefficient de
 * jetons (l'arrondi inférieur conserve l'inégalité).
 */
export function tokenCoefficientsError(
  settings: Pick<TournamentSettings, 'initialTokensCoefficient' | 'stakePerGameCoefficient'>,
): string | undefined {
  const tokens = coefficientHundredths(settings.initialTokensCoefficient);
  const stake = coefficientHundredths(settings.stakePerGameCoefficient);
  if (tokens === undefined || stake === undefined) return 'Nombre à 2 décimales au plus.';
  if (stake * TOURNAMENT_MIN_STAKES_TO_PLAY > tokens) {
    return 'Au plus la moitié du coefficient de jetons (seuil de participation : 2 mises).';
  }
  return undefined;
}

/** Rangs 1..n consécutifs, chacun > 0, somme exactement 100 % (10 000 points de base). */
export function prizeRulesError(rules: unknown): string | undefined {
  if (!Array.isArray(rules) || rules.length < 1 || rules.length > TOURNAMENT_LIMITS.maxPrizeRanks) {
    return `Entre 1 et ${TOURNAMENT_LIMITS.maxPrizeRanks} rangs récompensés.`;
  }
  const sorted = [...(rules as PrizeRule[])].sort((a, b) => a.rank - b.rank);
  for (const [index, rule] of sorted.entries()) {
    if (!isInt(rule?.rank) || rule.rank !== index + 1) {
      return 'Rangs consécutifs à partir de 1.';
    }
    if (!isInt(rule.shareBps) || rule.shareBps < 1 || rule.shareBps > 10_000) {
      return 'Chaque rang reçoit une part positive.';
    }
  }
  const total = sorted.reduce((sum, r) => sum + r.shareBps, 0);
  return total === 10_000 ? undefined : 'La somme des parts doit être exactement 100 %.';
}

// --- Finance --------------------------------------------------------------------------------

/** Pourcentage (10, 12.5…) → points de base (1000, 1250). */
export function percentToBps(percent: number): number {
  return Math.round(percent * 100);
}

/**
 * Cagnotte figée au démarrage : brut = prix × participants ; commission arrondie à l'entier
 * INFÉRIEUR (en faveur des joueurs) ; cagnotte des gains = brut − commission.
 */
export function computePool(entryFee: number, participants: number, feeBps: number) {
  const grossPool = entryFee * participants;
  const platformFee = Math.floor((grossPool * feeBps) / 10_000);
  return { grossPool, platformFee, prizePool: grossPool - platformFee };
}

export interface PrizeAllocation {
  rank: number;
  shareBps: number;
  amount: number;
}

/**
 * Gains par rang : `floor(cagnotte × part)` ; le reste d'arrondi va au 1er rang. Seuls les
 * rangs occupés (`rankedPlayers`) sont payés ; la part des autres est NON ATTRIBUÉE.
 */
export function computePrizes(
  prizePool: number,
  rules: PrizeRule[],
  rankedPlayers: number,
): { prizes: PrizeAllocation[]; unallocated: number } {
  const amounts = rules.map((r) => ({
    rank: r.rank,
    shareBps: r.shareBps,
    amount: Math.floor((prizePool * r.shareBps) / 10_000),
  }));
  const remainder = prizePool - amounts.reduce((sum, a) => sum + a.amount, 0);
  const first = amounts.find((a) => a.rank === 1);
  if (first) first.amount += remainder;
  const prizes = amounts.filter((a) => a.rank <= rankedPlayers);
  const unallocated = amounts
    .filter((a) => a.rank > rankedPlayers)
    .reduce((sum, a) => sum + a.amount, 0);
  return { prizes, unallocated };
}

// --- Classement pondéré (D-062) -------------------------------------------------------------

/** Poids des deux critères, en points de base (5000 = 50 %) ; somme exactement 10 000. */
export interface RankingWeights {
  tokensBps: number;
  gamesBps: number;
}

/** Configuration initiale : aucun critère n'est privilégié. */
export const DEFAULT_RANKING_WEIGHTS: RankingWeights = { tokensBps: 5000, gamesBps: 5000 };

/** Poids entiers de 0 à 10 000 dont la somme vaut exactement 10 000 (= 1). */
export function rankingWeightsError(weights: RankingWeights): string | undefined {
  const valid = (v: unknown) => isInt(v) && v >= 0 && v <= 10_000;
  if (!valid(weights.tokensBps) || !valid(weights.gamesBps)) {
    return 'Chaque poids est compris entre 0 et 100 %.';
  }
  return weights.tokensBps + weights.gamesBps === 10_000
    ? undefined
    : 'La somme des poids doit être exactement 100 %.';
}

/**
 * Durée de référence d'une partie de tournoi (D-062) : 170 s, calculée à l'origine avec les
 * délais de 10 s (4 plis joués × 4 joueurs × 10 s, le 5e pli est automatique, + 10 s de
 * Continuer/Quitter). FIGÉE par D-064 et D-068 : le passage des délais à 20 s puis à 15 s
 * ne modifie pas le classement des tournois ; seule une nouvelle décision peut l'ajuster.
 */
export const RANKING_REFERENCE_GAME_MS = 170_000;

/** Précision du score figé (4 décimales, colonne `numeric(7, 4)`). */
const SCORE_SCALE = 10_000;

/**
 * Références de normalisation d'un tournoi, issues de ses seuls paramètres figés (jamais
 * des autres participants : l'arrivée ou l'absence d'un joueur ne change le score de
 * personne). Jetons : le capital initial, identique pour tous. Parties : le nombre de
 * parties de référence que la durée du tournoi permet (`durée / RANKING_REFERENCE_GAME_MS`).
 */
export function rankingReferences(
  t: Pick<Tournament, 'initialTournamentTokens' | 'startsAt' | 'endsAt'>,
): { tokens: number; games: number } {
  const durationMs = t.endsAt.getTime() - t.startsAt.getTime();
  return {
    tokens: t.initialTournamentTokens,
    games: Number.isFinite(durationMs)
      ? Math.max(0, Math.floor(durationMs / RANKING_REFERENCE_GAME_MS))
      : 0,
  };
}

/** Entier positif ou nul (compteurs, références) ; toute valeur invalide vaut 0. */
const count = (v: number) => (Number.isFinite(v) && v > 0 ? Math.floor(v) : 0);

/**
 * Ratio normalisé dans [0, 1[ : `x / (x + référence)`. Vaut 0 sans rien, 0,5 à la
 * référence, croît strictement avec x sans jamais plafonner (deux joueurs différents restent
 * départagés). Valeur négative ou invalide → 0 ; référence nulle → 1 dès que x > 0.
 */
export function normalizedRatio(value: number, reference: number): number {
  const x = count(value);
  return x === 0 ? 0 : x / (x + count(reference));
}

/** Score EXACT en points, `num / den` (entiers) : aucune erreur d'arrondi dans le classement. */
export interface ExactRankingScore {
  num: bigint;
  den: bigint;
}

/**
 * Score sur 100 points (D-062) :
 * `100 × (poids_jetons × ratio_jetons + poids_parties × ratio_parties)`, en fraction exacte.
 * Avec des poids en points de base, `100 × p / 10 000 = p / 100`.
 */
export function exactRankingScore(
  stats: { tokens: number; gamesPlayed: number },
  references: { tokens: number; games: number },
  weights: RankingWeights,
): ExactRankingScore {
  const t = BigInt(count(stats.tokens));
  const g = BigInt(count(stats.gamesPlayed));
  // Dénominateur de chaque ratio ; 1 quand x = 0 (le ratio vaut 0, jamais 0 / 0).
  const dt = t === 0n ? 1n : t + BigInt(count(references.tokens));
  const dg = g === 0n ? 1n : g + BigInt(count(references.games));
  return {
    num: BigInt(count(weights.tokensBps)) * t * dg + BigInt(count(weights.gamesBps)) * g * dt,
    den: 100n * dt * dg,
  };
}

/** Comparaison exacte : négatif si a < b, 0 si égalité EXACTE, positif si a > b. */
export function compareRankingScores(a: ExactRankingScore, b: ExactRankingScore): number {
  const diff = a.num * b.den - b.num * a.den;
  return diff === 0n ? 0 : diff > 0n ? 1 : -1;
}

/** Score affiché et figé : arrondi au plus proche à 4 décimales (colonne `numeric(7, 4)`). */
export function roundedRankingScore({ num, den }: ExactRankingScore): number {
  return Number((num * BigInt(SCORE_SCALE) * 2n + den) / (2n * den)) / SCORE_SCALE;
}

export function rankingScore(
  stats: { tokens: number; gamesPlayed: number },
  references: { tokens: number; games: number },
  weights: RankingWeights,
): number {
  return roundedRankingScore(exactRankingScore(stats, references, weights));
}

/**
 * Classement DÉTERMINISTE, sans ex æquo (D-062) : score EXACT DESC ; à égalité exacte,
 * départage SANS privilégier l'un des deux critères : parties gagnées DESC, date
 * d'inscription ASC, puis identifiant (ordre total). Tous les comptes sont classés, y
 * compris ceux passés sous le seuil de jetons. `score` : valeur arrondie, à afficher et figer.
 */
export function rankAccounts<
  T extends Pick<
    TournamentPlayerAccount,
    'currentTokens' | 'gamesPlayed' | 'gamesWon' | 'registeredAt' | 'playerId'
  >,
>(
  accounts: readonly T[],
  references: { tokens: number; games: number },
  weights: RankingWeights,
): (T & { score: number })[] {
  return accounts
    .map((account) => ({
      account,
      exact: exactRankingScore(
        { tokens: account.currentTokens, gamesPlayed: account.gamesPlayed },
        references,
        weights,
      ),
    }))
    .sort(
      (a, b) =>
        compareRankingScores(b.exact, a.exact) ||
        b.account.gamesWon - a.account.gamesWon ||
        a.account.registeredAt.getTime() - b.account.registeredAt.getTime() ||
        a.account.playerId.localeCompare(b.account.playerId),
    )
    .map(({ account, exact }) => ({ ...account, score: roundedRankingScore(exact) }));
}

/** Poids des paramètres plateforme (en %) → points de base, copiés à la publication. */
export function rankingWeightsOf(
  settings: Pick<TournamentSettings, 'rankingTokensWeightPercent' | 'rankingGamesWeightPercent'>,
): RankingWeights {
  return {
    tokensBps: percentToBps(settings.rankingTokensWeightPercent),
    gamesBps: percentToBps(settings.rankingGamesWeightPercent),
  };
}

/** Poids figés du tournoi ; un tournoi publié avant D-062 reçoit la configuration initiale. */
export function tournamentRankingWeights(t: Pick<Tournament, 'rankingWeights'>): RankingWeights {
  return t.rankingWeights ?? DEFAULT_RANKING_WEIGHTS;
}

// --- Règlement d'une partie -----------------------------------------------------------------

/**
 * Jetons d'une partie terminée avec un gagnant (D-054) : mise effective
 * `e = min(mise, jetons du gagnant)` ; chaque autre joueur paie `min(e, ses jetons)` au
 * gagnant. Jamais de solde négatif, jamais de jetons créés ; un joueur ne gagne pas plus que
 * ce qu'il risque. Renvoie la variation de chaque joueur et le pot.
 */
export function settleGameTokens(
  stake: number,
  winnerId: string,
  tokensByPlayer: ReadonlyMap<string, number>,
): { transfers: Record<string, number>; pot: number } {
  const winnerTokens = tokensByPlayer.get(winnerId) ?? 0;
  const effective = Math.min(stake, winnerTokens);
  const transfers: Record<string, number> = {};
  let won = 0;
  for (const [playerId, tokens] of tokensByPlayer) {
    if (playerId === winnerId) continue;
    const paid = Math.min(effective, tokens);
    transfers[playerId] = -paid;
    won += paid;
  }
  transfers[winnerId] = won;
  return { transfers, pot: won + effective };
}

/** Seuil de participation (D-063) : il faut au moins deux mises pour jouer une partie. */
export const TOURNAMENT_MIN_STAKES_TO_PLAY = 2;

export function minimumTokensToPlay(stake: number): number {
  return TOURNAMENT_MIN_STAKES_TO_PLAY * stake;
}

/**
 * SEULE définition de la règle d'élimination (D-063) : `jetons >= 2 × mise`. En dessous, le
 * joueur ne peut plus créer ni rejoindre une partie du tournoi ; il reste classé.
 */
export function canPlayTournamentGame(tokens: number, stake: number): boolean {
  return tokens >= minimumTokensToPlay(stake);
}

/** Un compte sous le seuil ne peut plus s'asseoir à une table du tournoi. */
export function accountStatusFor(tokens: number, stake: number): TournamentAccountStatus {
  return canPlayTournamentGame(tokens, stake) ? 'ACTIVE' : 'OUT_OF_TOKENS';
}

// --- Erreurs --------------------------------------------------------------------------------

export class InvalidTournamentIdError extends Error {
  constructor(value: unknown) {
    super(`tournamentId invalide : ${JSON.stringify(value)}`);
    this.name = 'InvalidTournamentIdError';
  }
}

export function parseTournamentId(value: unknown): TournamentId {
  if (!isTournamentId(value)) {
    throw new InvalidTournamentIdError(value);
  }
  return value;
}

export class InvalidTournamentError extends Error {
  constructor(readonly fields: Record<string, string>) {
    super(`Tournoi invalide : ${Object.keys(fields).join(', ')}`);
    this.name = 'InvalidTournamentError';
  }
}

export class TournamentNotFoundError extends Error {
  constructor(readonly tournamentId: string) {
    super(`Tournoi ${tournamentId} introuvable`);
    this.name = 'TournamentNotFoundError';
  }
}

export class InvalidTournamentTransitionError extends Error {
  constructor(
    readonly tournamentId: string,
    readonly from: TournamentStatus,
    readonly to: TournamentStatus,
  ) {
    super(`Transition interdite ${from} → ${to} (${tournamentId})`);
    this.name = 'InvalidTournamentTransitionError';
  }
}

/** Créneau déjà occupé par un autre tournoi publié (contrainte d'exclusion). */
export class TournamentOverlapError extends Error {
  constructor() {
    super('Créneau déjà occupé par un autre tournoi');
    this.name = 'TournamentOverlapError';
  }
}

export class TooManyPendingTournamentsError extends Error {
  constructor(readonly limit: number) {
    super(`Trop de tournois en attente (${limit})`);
    this.name = 'TooManyPendingTournamentsError';
  }
}

/** Limite plateforme de tournois en attente de démarrage atteinte (D-059). */
export class TooManyWaitingTournamentsError extends Error {
  constructor(readonly limit: number) {
    super(`Limite de tournois en attente de démarrage atteinte (${limit})`);
    this.name = 'TooManyWaitingTournamentsError';
  }
}

/** Action réservée au créateur (tournoi proposé par un joueur). */
export class NotTournamentCreatorError extends Error {
  constructor(readonly tournamentId: string) {
    super(`Pas le créateur du tournoi ${tournamentId}`);
    this.name = 'NotTournamentCreatorError';
  }
}

/** Modification impossible dans cet état, ou d'un champ verrouillé par des inscriptions. */
export class TournamentLockedError extends Error {
  constructor(
    readonly tournamentId: string,
    readonly fields: string[] = [],
  ) {
    super(`Tournoi ${tournamentId} verrouillé ${fields.join(', ')}`);
    this.name = 'TournamentLockedError';
  }
}

/** Inscription ou désinscription hors de la fenêtre d'inscription. */
export class TournamentRegistrationClosedError extends Error {
  constructor(
    readonly tournamentId: TournamentId,
    readonly status: TournamentStatus,
  ) {
    super(`Inscriptions fermées pour le tournoi ${tournamentId} (${status})`);
    this.name = 'TournamentRegistrationClosedError';
  }
}

/** Action impossible : le tournoi a démarré (paiements capturés). */
export class TournamentStartedError extends Error {
  constructor(readonly tournamentId: TournamentId) {
    super(`Le tournoi ${tournamentId} a démarré`);
    this.name = 'TournamentStartedError';
  }
}

export class AlreadyRegisteredError extends Error {
  constructor(readonly tournamentId: TournamentId) {
    super(`Déjà inscrit au tournoi ${tournamentId}`);
    this.name = 'AlreadyRegisteredError';
  }
}

export class TournamentFullError extends Error {
  constructor(readonly tournamentId: TournamentId) {
    super(`Le tournoi ${tournamentId} est complet`);
    this.name = 'TournamentFullError';
  }
}

/** Rejoindre avant le début. */
export class TournamentNotStartedError extends Error {
  constructor(readonly tournamentId: TournamentId) {
    super(`Le tournoi ${tournamentId} n'a pas commencé`);
    this.name = 'TournamentNotStartedError';
  }
}

/** Rejoindre après la fin. */
export class TournamentCompletedError extends Error {
  constructor(readonly tournamentId: TournamentId) {
    super(`Le tournoi ${tournamentId} est terminé`);
    this.name = 'TournamentCompletedError';
  }
}

export class TournamentCancelledError extends Error {
  constructor(readonly tournamentId: TournamentId) {
    super(`Le tournoi ${tournamentId} est annulé`);
    this.name = 'TournamentCancelledError';
  }
}

/** Rejoindre ou se désinscrire sans inscription active. */
export class NotRegisteredError extends Error {
  constructor(readonly tournamentId: TournamentId) {
    super(`Non inscrit au tournoi ${tournamentId}`);
    this.name = 'NotRegisteredError';
  }
}

/** Plus assez de jetons de tournoi pour la mise d'une partie. */
export class TournamentOutOfTokensError extends Error {
  constructor(readonly tournamentId: TournamentId) {
    super(`Jetons insuffisants dans le tournoi ${tournamentId}`);
    this.name = 'TournamentOutOfTokensError';
  }
}

/** Accès direct (hors `join` du tournoi) à une table de tournoi refusé. */
export class TournamentAccessDeniedError extends Error {
  constructor(readonly sessionId: string) {
    super(`Table de tournoi ${sessionId} réservée aux participants pendant le tournoi`);
    this.name = 'TournamentAccessDeniedError';
  }
}

/** Le joueur est assis à une table du tournoi dont la partie en cours se joue sans lui. */
export class TournamentGameInProgressError extends Error {
  constructor(readonly sessionId: string) {
    super(`Partie en cours sans le joueur à la table ${sessionId}`);
    this.name = 'TournamentGameInProgressError';
  }
}

/** Résultats demandés avant leur calcul. */
export class TournamentResultsUnavailableError extends Error {
  constructor(readonly tournamentId: TournamentId) {
    super(`Résultats du tournoi ${tournamentId} non disponibles`);
    this.name = 'TournamentResultsUnavailableError';
  }
}

/**
 * Création d'une table de tournoi refusée sous verrou (D-054) : une table du tournoi est
 * devenue joignable entre-temps (autre instance) ; le joueur doit la rejoindre. Interne :
 * TournamentService réessaie, jamais renvoyée au client.
 */
export class TournamentTableAvailableError extends Error {
  constructor(readonly tournamentId: string) {
    super(`Une table du tournoi ${tournamentId} est déjà disponible`);
    this.name = 'TournamentTableAvailableError';
  }
}

/** Création d'une table refusée sous verrou : le tournoi n'est plus en cours. */
export class TournamentTableRefusedError extends Error {
  constructor(readonly tournamentId: string) {
    super(`Le tournoi ${tournamentId} n'accepte plus de nouvelle table`);
    this.name = 'TournamentTableRefusedError';
  }
}

/** Tables du tournoi très disputées (créations concurrentes répétées) : réessayer. */
export class TournamentBusyError extends Error {
  constructor(readonly tournamentId: string) {
    super(`Attribution de table du tournoi ${tournamentId} à réessayer`);
    this.name = 'TournamentBusyError';
  }
}
