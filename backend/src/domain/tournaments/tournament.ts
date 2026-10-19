import { randomUUID } from 'node:crypto';

import type { Game } from '../game/game';
import type { PlayerId } from '../game/game-id';
import {
  planGameSettlement,
  settledParticipants,
  victoryTypeOf,
  type GameVictoryType,
} from '../rules/game-settlement';
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
 * affecté (créateur de la partie) a 13 s pour démarrer (D-098 : 10 s affichées, 3 s de marge
 * invisible) ; ensuite le serveur démarre.
 */
export const TOURNAMENT_TABLE_AUTO_START_MS = 13_000;
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

/**
 * Proposition de joueur ouverte aux PRÉINSCRIPTIONS (D-108) : visible de tous les joueurs et
 * ouverte aux inscriptions avant l'approbation. Elle n'est pas publiée pour autant : pas de
 * créneau réservé, pas de commission ni de poids figés, jamais de démarrage.
 */
export const PRE_REGISTRATION_STATUSES: readonly TournamentStatus[] = ['PENDING_APPROVAL'];

/**
 * Compté dans la limite plateforme `TOURNAMENT_LIMITS.maxWaitingTournaments` (D-072, D-113) :
 * - tournoi publié aux inscriptions ouvertes ou à ouvrir (`REGISTRATION_LIMIT_STATUSES`) ;
 * - proposition ouverte aux préinscriptions (`PRE_REGISTRATION_STATUSES`) tant que sa fenêtre
 *   n'est pas close (même borne que `registrationWindowOpen`) ; comme un tournoi `SCHEDULED`,
 *   elle compte aussi avant l'ouverture choisie, qui se fera sans nouveau contrôle.
 * Jamais : brouillon, annulé, inscriptions closes. Règle reproduite en SQL par
 * `countWaitingTournaments` (dépôt), sous le verrou de planification.
 */
export function countsTowardRegistrationLimit(
  t: Pick<Tournament, 'status' | 'registrationClosesAt' | 'startsAt'>,
  now: Date,
): boolean {
  if (REGISTRATION_LIMIT_STATUSES.includes(t.status)) return true;
  return (
    PRE_REGISTRATION_STATUSES.includes(t.status) &&
    now.getTime() < (t.registrationClosesAt ?? t.startsAt).getTime()
  );
}

/**
 * Fenêtre d'inscription, statut ET horloge (le planificateur peut avoir un tick de retard) :
 * - tournoi publié `REGISTRATION_OPEN`, de l'ouverture à la clôture (D-054) ;
 * - proposition en attente d'approbation (préinscription, D-108), de l'ouverture choisie
 *   (sinon dès la soumission) à la clôture, au plus tard au début.
 * SEULE règle d'ouverture des inscriptions : le service l'applique, la vue joueur l'affiche.
 */
export function registrationWindowOpen(
  t: Pick<
    Tournament,
    'status' | 'registrationOpensAt' | 'registrationClosesAt' | 'publishedAt' | 'startsAt'
  >,
  now: Date,
): boolean {
  const at = now.getTime();
  const closes = (t.registrationClosesAt ?? t.startsAt).getTime();
  if (t.status === 'REGISTRATION_OPEN') {
    return at >= (t.registrationOpensAt ?? t.publishedAt ?? now).getTime() && at < closes;
  }
  if (PRE_REGISTRATION_STATUSES.includes(t.status)) {
    return at >= (t.registrationOpensAt ?? now).getTime() && at < closes;
  }
  return false;
}

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
  /**
   * Jetons de départ et mise figés dès la première préinscription d'une proposition (D-113) :
   * ce sont alors les valeurs promises, reprises telles quelles à la lecture et à l'approbation.
   */
  tokenSetupFrozenAt?: Date;
  prizeRules: PrizeRule[];
  /** Poids du classement (D-062), copiés des paramètres à la publication, puis immuables. */
  rankingWeights?: RankingWeights;
  /** Méthode de classement figée au DÉMARRAGE (D-106) ; absente avant le démarrage. */
  rankingMethod?: RankingMethod;
  /** Parties de référence (D-106), figées au démarrage. */
  rankingGamesReference?: number;
  /** Règle de règlement des parties figée au DÉMARRAGE (D-111) ; absente avant. */
  settlementRule?: TournamentSettlementRule;
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

/**
 * `DISSOLVED` (D-111) : tournoi terminé, classement publié et gains versés ; le compte fictif
 * n'est plus utilisable mais reste conservé (soldes finaux, parties, rang, audit).
 */
export type TournamentAccountStatus = 'ACTIVE' | 'OUT_OF_TOKENS' | 'DISSOLVED';

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
  /** Fin de la participation : classement officiel calculé (D-106), compte figé ensuite. */
  finishedAt?: Date;
}

/** Critère qui a départagé deux scores EXACTEMENT égaux (D-062, D-106). */
export type RankingTieBreak = 'GAMES_WON' | 'REGISTRATION_ORDER' | 'PLAYER_ID';

/**
 * Détail d'audit d'un rang (D-106), figé avec le résultat : de quoi recalculer et vérifier le
 * score sans relire les paramètres. Absent des résultats classés avant D-106.
 */
export interface RankingAudit {
  rankingMethod: RankingMethod;
  /** Ratios arrondis à 6 décimales (le classement, lui, compare des fractions exactes). */
  tokensRatio: number;
  gamesRatio: number;
  tokensWeightBps: number;
  gamesWeightBps: number;
  gamesReference: number;
  tieBreak?: RankingTieBreak;
}

/** Ligne de résultat figée (rang, statistiques, gain), avec le pseudo pour l'affichage. */
export interface TournamentResultRow extends Partial<RankingAudit> {
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
  /** Publication du classement (écriture des résultats). */
  createdAt?: Date;
  registeredAt?: Date;
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
  /**
   * Bornes du nombre de joueurs à la création d'un tournoi : son minimum et son maximum de
   * participants sont choisis entre ces deux valeurs. `null` = aucun plafond (∞) (D-103).
   */
  tournamentMinimumPlayers: number;
  tournamentMaximumPlayers: number | null;
  /** Durée d'un tournoi, en minutes, bornes incluses (D-104). */
  tournamentMinimumDurationMinutes: number;
  tournamentMaximumDurationMinutes: number;
  /** Prix d'entrée minimal pour créer un tournoi, en FCFA (D-105, 500 par défaut). */
  tournamentMinimumEntryFee: number;
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
  tournamentMinimumPlayers: 20,
  tournamentMaximumPlayers: null,
  tournamentMinimumDurationMinutes: 45,
  tournamentMaximumDurationMinutes: 120,
  tournamentMinimumEntryFee: 500,
};

/** Plus grand entier d'une colonne `integer` PostgreSQL (nombre de joueurs d'un tournoi). */
export const PG_INTEGER_MAX = 2_147_483_647;

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
  // Au moins 2 joueurs (contrainte `tournaments.minimum_players`) ; maximum : `null` aussi (∞).
  tournamentMinimumPlayers: { min: 2, max: PG_INTEGER_MAX },
  tournamentMaximumPlayers: { min: 2, max: PG_INTEGER_MAX },
  // Durée en minutes : 1 min à 24 h (borne haute historique de D-054).
  tournamentMinimumDurationMinutes: { min: 1, max: 24 * 60 },
  tournamentMaximumDurationMinutes: { min: 1, max: 24 * 60 },
  // Jamais gratuit (D-071) ; au plus le prix d'entrée maximal de la plateforme.
  tournamentMinimumEntryFee: { min: 1, max: 100_000 },
};

type DurationLimits = Pick<
  TournamentSettings,
  'tournamentMinimumDurationMinutes' | 'tournamentMaximumDurationMinutes'
>;

/** Bornes de durée incohérentes (maximum sous le minimum) ; `undefined` si valides. */
export function durationLimitsError(settings: DurationLimits): string | undefined {
  return settings.tournamentMaximumDurationMinutes < settings.tournamentMinimumDurationMinutes
    ? 'La durée maximale doit être au moins égale à la durée minimale.'
    : undefined;
}

/** Bornes de joueurs incohérentes (maximum sous le minimum) ; `undefined` si valides. */
export function playerLimitsError(
  settings: Pick<TournamentSettings, 'tournamentMinimumPlayers' | 'tournamentMaximumPlayers'>,
): string | undefined {
  const { tournamentMinimumPlayers: min, tournamentMaximumPlayers: max } = settings;
  return max !== null && max < min ? 'Le maximum doit être au moins égal au minimum.' : undefined;
}

/**
 * Limites plateforme d'un tournoi (D-054). Joueurs, durée et prix d'entrée minimal :
 * paramètres réglables (`TournamentSettings`, D-103, D-104, D-105).
 */
export const TOURNAMENT_LIMITS = {
  /**
   * Un joueur propose un tournoi au moins 1 h à l'avance : vérifié à la création et à la
   * soumission de la proposition, mais plus à l'approbation (D-108 : elle exige seulement
   * un début encore à venir).
   */
  playerMinLeadMs: 60 * 60 * 1000,
  /** Prix d'entrée maximal (FCFA) ; le minimum est réglable (`tournamentMinimumEntryFee`). */
  maxEntryFee: 100_000,
  maxPrizeRanks: 10,
  maxInitialTokens: 1_000_000,
  /** Tournois aux inscriptions ouvertes ou à ouvrir (REGISTRATION_LIMIT_STATUSES), plateforme (D-072). */
  maxWaitingTournaments: 5,
} as const;

/**
 * Message d'une durée hors limites : forme imposée par D-058 (« Durée entre X minutes et Y
 * minutes. », point final compris), avec les bornes réglées (D-104).
 */
export function tournamentDurationError(settings: DurationLimits): string {
  const { tournamentMinimumDurationMinutes: min, tournamentMaximumDurationMinutes: max } = settings;
  return `Durée entre ${min} minutes et ${max} minutes.`;
}

/**
 * Démarrage bloqué (D-056) : au-delà de `starts_at` + ce délai, un tournoi encore en STARTING
 * après des échecs est annulé (SYSTEM_ERROR) et ses réservations sont libérées.
 */
export const START_RECOVERY_MS = 15 * 60 * 1000;
/** Échecs de démarrage consécutifs (dans une instance) à partir desquels on alerte. */
export const START_FAILURE_ALERT_THRESHOLD = 3;

/**
 * Clôture (D-106) : après la fin, le classement attend TOUTES les parties commencées et leur
 * règlement, sans jamais les annuler (D-054 les annulait après 10 min). Au-delà de ce délai,
 * l'attente est signalée par une alerte (journal `error`, `alert: true`), répétée au plus
 * toutes les CLOSING_ALERT_INTERVAL_MS : une partie bloquée se résout par les mécanismes
 * existants (timers de tour reconstruits, `npm run game:finish`).
 */
export const RESULTS_GRACE_MS = 10 * 60 * 1000;
export const CLOSING_ALERT_INTERVAL_MS = 5 * 60 * 1000;

/**
 * Message de remerciement (D-117) : visible 10 s après la fin effective du tournoi, c'est-à-dire
 * la publication du classement officiel (`resultsAt`, horloge du serveur). Les résultats sont
 * donc toujours consultables quand il apparaît.
 */
export const TOURNAMENT_THANKS_DELAY_MS = 10_000;

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
    /**
     * Approbation d'une proposition (D-108) : le début doit seulement être à venir, sans le
     * délai d'1 h des propositions. Toutes les autres règles restent vérifiées.
     */
    approval?: boolean;
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
    const playerLead = context.creatorType === 'PLAYER' && !context.approval;
    const minStart = context.now.getTime() + (playerLead ? TOURNAMENT_LIMITS.playerMinLeadMs : 0);
    if (startsAt.getTime() <= minStart) {
      fields.startsAt = playerLead
        ? 'Le tournoi doit commencer au moins 1 h plus tard.'
        : 'Le début doit être dans le futur.';
    }
    const {
      tournamentMinimumDurationMinutes: minMinutes,
      tournamentMaximumDurationMinutes: maxMinutes,
    } = context.settings;
    if (duration < minMinutes * 60_000 || duration > maxMinutes * 60_000) {
      fields.endsAt = tournamentDurationError(context.settings);
    }
    if (registrationOpensAt !== undefined) {
      if (!validDate(registrationOpensAt) || registrationOpensAt.getTime() >= startsAt.getTime()) {
        fields.registrationOpensAt = 'Ouverture des inscriptions avant le début.';
      }
    }
    if (registrationClosesAt !== undefined) {
      // À l'approbation, la clôture a pu passer pendant les préinscriptions (D-108) : seul
      // l'ordre des dates choisies compte (déjà vérifié contre l'horloge à la soumission).
      const opens =
        registrationOpensAt?.getTime() ??
        (context.approval ? Number.NEGATIVE_INFINITY : context.now.getTime());
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

  // Prix d'entrée : au moins le minimum réglé dans les paramètres (D-105, 500 par défaut).
  const minEntryFee = context.settings.tournamentMinimumEntryFee;
  const entryFeeValid =
    isInt(input.entryFee) &&
    input.entryFee >= minEntryFee &&
    input.entryFee <= TOURNAMENT_LIMITS.maxEntryFee;
  if (!entryFeeValid) {
    fields.entryFee = `Montant entier entre ${minEntryFee} et ${TOURNAMENT_LIMITS.maxEntryFee}.`;
  }
  // Participants : entre les bornes des paramètres (minimum 20, maximum ∞ par défaut).
  const { minimumPlayers, maximumPlayers } = input;
  const { tournamentMinimumPlayers: minLimit, tournamentMaximumPlayers: maxLimit } =
    context.settings;
  const playersCap = maxLimit ?? PG_INTEGER_MAX;
  const withinLimits = (n: unknown): n is number => isInt(n) && n >= minLimit && n <= playersCap;
  if (!withinLimits(minimumPlayers)) {
    fields.minimumPlayers =
      maxLimit === null ? `Au moins ${minLimit}.` : `Entre ${minLimit} et ${maxLimit}.`;
  }
  if (
    maximumPlayers !== undefined &&
    (!withinLimits(maximumPlayers) || (isInt(minimumPlayers) && maximumPlayers < minimumPlayers))
  ) {
    fields.maximumPlayers =
      maxLimit === null
        ? `Au moins le minimum (${minLimit} ou plus).`
        : `Au moins le minimum (${minLimit} ou plus), au plus ${maxLimit}.`;
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
 * D-092 revient aux délais de 10 s d'origine : la référence leur correspond de nouveau.
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

// --- Classement D-106 : capital conservé et parties jouées -----------------------------------

/**
 * Méthodes de classement. `D062_SATURATING` : ratios `x / (x + référence)` (D-062), gardée pour
 * les tournois démarrés avant D-106. `D106_CAPITAL_RATIO` : méthode courante (D-106).
 */
export type RankingMethod = 'D062_SATURATING' | 'D106_CAPITAL_RATIO';

/** Méthode figée sur tout tournoi qui DÉMARRE désormais. */
export const CURRENT_RANKING_METHOD: RankingMethod = 'D106_CAPITAL_RATIO';

/**
 * Parties de référence D-106 : `max(1, floor(durée / RANKING_REFERENCE_GAME_MS))`, figées au
 * démarrage. Même durée de référence d'une partie que D-062 (170 s) : 10 parties pour 30 min,
 * 42 pour 2 h. Jamais 0 (pas de division par zéro).
 */
export function capitalRatioGamesReference(t: Pick<Tournament, 'startsAt' | 'endsAt'>): number {
  return Math.max(1, rankingReferences({ initialTournamentTokens: 1, ...t }).games);
}

/** Règles officielles de classement d'un tournoi (méthode, poids, références). */
export interface RankingRules {
  method: RankingMethod;
  weights: RankingWeights;
  /** D-062 seulement : référence des jetons (capital initial du tournoi). */
  tokensReference: number;
  gamesReference: number;
}

/**
 * Règles du tournoi : celles FIGÉES au démarrage. Un tournoi démarré sans méthode enregistrée
 * (antérieur à D-106) garde D-062 ; un tournoi pas encore démarré n'a pas de classement.
 */
export function tournamentRankingRules(
  t: Pick<
    Tournament,
    | 'rankingMethod'
    | 'rankingGamesReference'
    | 'rankingWeights'
    | 'startedAt'
    | 'startsAt'
    | 'endsAt'
    | 'initialTournamentTokens'
  >,
): RankingRules {
  const method = t.rankingMethod ?? (t.startedAt ? 'D062_SATURATING' : CURRENT_RANKING_METHOD);
  const legacy = rankingReferences(t);
  return {
    method,
    weights: tournamentRankingWeights(t),
    tokensReference: legacy.tokens,
    gamesReference:
      method === 'D106_CAPITAL_RATIO'
        ? (t.rankingGamesReference ?? capitalRatioGamesReference(t))
        : legacy.games,
  };
}

/** Une fraction exacte `num / den` (den > 0). */
interface Fraction {
  num: bigint;
  den: bigint;
}

/**
 * Ratios EXACTS d'un compte (D-106) :
 * - jetons : `jetons restants / capital initial` (1 = capital conservé, peut dépasser 1) ;
 * - parties : `min(parties jouées, référence) / référence` (plafonné à 1 : au-delà de la
 *   référence, jouer davantage ne rapporte plus rien, pour ne pas favoriser ceux qui ont eu
 *   accès à plus de parties).
 * D-062 : `x / (x + référence)`.
 */
function exactRatios(
  stats: { tokens: number; initialTokens: number; gamesPlayed: number },
  rules: RankingRules,
): { tokens: Fraction; games: Fraction } {
  const t = BigInt(count(stats.tokens));
  const g = BigInt(count(stats.gamesPlayed));
  if (rules.method === 'D062_SATURATING') {
    return {
      tokens: { num: t, den: t === 0n ? 1n : t + BigInt(count(rules.tokensReference)) },
      games: { num: g, den: g === 0n ? 1n : g + BigInt(count(rules.gamesReference)) },
    };
  }
  const capital = BigInt(Math.max(1, count(stats.initialTokens)));
  const reference = BigInt(Math.max(1, count(rules.gamesReference)));
  return {
    tokens: { num: t, den: capital },
    games: { num: g < reference ? g : reference, den: reference },
  };
}

/** `100 × (poids_jetons × ratio_jetons + poids_parties × ratio_parties)`, poids en bps. */
function exactScoreOf(ratios: { tokens: Fraction; games: Fraction }, w: RankingWeights) {
  const { tokens: rt, games: rg } = ratios;
  return {
    num: BigInt(count(w.tokensBps)) * rt.num * rg.den + BigInt(count(w.gamesBps)) * rg.num * rt.den,
    den: 100n * rt.den * rg.den,
  };
}

/** Points apportés par un critère : `100 × poids × ratio` (poids en points de base). */
function pointsOf(weightBps: number, ratio: Fraction): Fraction {
  return { num: BigInt(count(weightBps)) * ratio.num, den: 100n * ratio.den };
}

/** Arrondi au plus proche à `decimals` décimales d'une fraction positive. */
function roundFraction({ num, den }: Fraction, decimals: number): number {
  const scale = 10n ** BigInt(decimals);
  return Number((num * scale * 2n + den) / (2n * den)) / Number(scale);
}

/** Détail du score d'un compte classé (affichage et audit). */
export interface RankingBreakdown {
  score: number;
  tokensRatio: number;
  gamesRatio: number;
  /** Points apportés par chaque critère (somme = score, à l'arrondi près), 4 décimales. */
  tokensPoints: number;
  gamesPoints: number;
  tieBreak?: RankingTieBreak;
}

/**
 * Détail du score d'UN joueur selon les règles du tournoi (affichage de son résultat) : mêmes
 * fractions exactes que le classement, donc le même score que celui figé avec son rang.
 */
export function scoreBreakdown(
  stats: { tokens: number; initialTokens: number; gamesPlayed: number },
  rules: RankingRules,
): Omit<RankingBreakdown, 'tieBreak'> {
  const ratios = exactRatios(stats, rules);
  return {
    score: roundedRankingScore(exactScoreOf(ratios, rules.weights)),
    tokensRatio: roundFraction(ratios.tokens, 6),
    gamesRatio: roundFraction(ratios.games, 6),
    tokensPoints: roundFraction(pointsOf(rules.weights.tokensBps, ratios.tokens), 4),
    gamesPoints: roundFraction(pointsOf(rules.weights.gamesBps, ratios.games), 4),
  };
}

type RankableAccount = Pick<
  TournamentPlayerAccount,
  'currentTokens' | 'initialTokens' | 'gamesPlayed' | 'gamesWon' | 'registeredAt' | 'playerId'
>;

/** Premier critère de départage qui sépare deux comptes à score égal (`a` avant `b`). */
function tieBreakBetween(a: RankableAccount, b: RankableAccount): RankingTieBreak {
  if (a.gamesWon !== b.gamesWon) return 'GAMES_WON';
  if (a.registeredAt.getTime() !== b.registeredAt.getTime()) return 'REGISTRATION_ORDER';
  return 'PLAYER_ID';
}

/**
 * Classement officiel DÉTERMINISTE, sans ex æquo, selon les règles figées du tournoi :
 * score EXACT DESC ; à égalité exacte (D-062, inchangé), parties gagnées DESC, date
 * d'inscription ASC, puis identifiant. Tous les comptes sont classés, y compris ceux sous le
 * seuil de jetons ou sans partie. Chaque ligne porte son détail et, si elle a été départagée,
 * le critère appliqué.
 */
export function rankTournamentAccounts<T extends RankableAccount>(
  accounts: readonly T[],
  rules: RankingRules,
): (T & RankingBreakdown)[] {
  const scored = accounts.map((account) => {
    const ratios = exactRatios(
      {
        tokens: account.currentTokens,
        initialTokens: account.initialTokens,
        gamesPlayed: account.gamesPlayed,
      },
      rules,
    );
    return { account, ratios, exact: exactScoreOf(ratios, rules.weights) };
  });
  scored.sort(
    (a, b) =>
      compareRankingScores(b.exact, a.exact) ||
      b.account.gamesWon - a.account.gamesWon ||
      a.account.registeredAt.getTime() - b.account.registeredAt.getTime() ||
      a.account.playerId.localeCompare(b.account.playerId),
  );
  return scored.map(({ account, ratios, exact }, index) => {
    const previous = scored[index - 1];
    const next = scored[index + 1];
    const tieBreak =
      previous && compareRankingScores(previous.exact, exact) === 0
        ? tieBreakBetween(previous.account, account)
        : next && compareRankingScores(next.exact, exact) === 0
          ? tieBreakBetween(account, next.account)
          : undefined;
    return {
      ...account,
      score: roundedRankingScore(exact),
      tokensRatio: roundFraction(ratios.tokens, 6),
      gamesRatio: roundFraction(ratios.games, 6),
      tokensPoints: roundFraction(pointsOf(rules.weights.tokensBps, ratios.tokens), 4),
      gamesPoints: roundFraction(pointsOf(rules.weights.gamesBps, ratios.games), 4),
      ...(tieBreak && { tieBreak }),
    };
  });
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

/**
 * Règle de règlement des parties d'un tournoi, figée au démarrage (D-111) :
 * - `D054_TAPIS` : règle d'origine (`settleGameTokens`), gardée par les tournois démarrés avant ;
 * - `D111_ORDINARY_RULES` : MÊMES règles qu'une partie ordinaire (D-074, D-080, D-086), appliquées
 *   au compte FICTIF du tournoi, sans commission (la plateforme est rémunérée sur le prix
 *   d'entrée, D-054).
 */
export type TournamentSettlementRule = 'D054_TAPIS' | 'D111_ORDINARY_RULES';
export const CURRENT_SETTLEMENT_RULE: TournamentSettlementRule = 'D111_ORDINARY_RULES';

/** Règle d'un tournoi : celle figée au démarrage ; un tournoi démarré sans elle : D-054. */
export function tournamentSettlementRule(
  t: Pick<Tournament, 'settlementRule' | 'startedAt'>,
): TournamentSettlementRule {
  return t.settlementRule ?? (t.startedAt ? 'D054_TAPIS' : CURRENT_SETTLEMENT_RULE);
}

/** Motifs d'un règlement sans mouvement (le résultat de jeu, lui, est inchangé). */
export type TournamentVoidReason =
  | 'NO_WINNER'
  | 'TOURNAMENT_NOT_IN_PROGRESS'
  | 'STARTED_AFTER_END'
  | 'WINNER_NOT_PARTICIPANT'
  | 'PARTICIPANT_WITHOUT_ACCOUNT'
  | 'INVALID_SETTLEMENT'
  | (string & {});

export type TournamentGamePlan =
  | {
      status: 'SETTLED';
      winnerId: string;
      /** Absent pour la règle D-054 (pas de Kora). */
      victoryType?: GameVictoryType;
      /** Variation de CHAQUE compte réglé (clés = participants réglés, une fois chacun). */
      transfers: Record<string, number>;
      /** Total en jeu (audit) : pertes payées + mise équivalente du gagnant. */
      pot: number;
    }
  | { status: 'VOID'; voidReason: TournamentVoidReason };

/**
 * Plan de règlement d'une partie TERMINÉE d'un tournoi, sur les comptes FICTIFS (fonction
 * pure). Le résultat de jeu (gagnant, perdants, Kora, fuite) vient du moteur commun ; seul le
 * compte change. Toute incohérence donne VOID (aucun mouvement, jamais partiel) :
 * - D111_ORDINARY_RULES : participants réglés = ceux d'une partie ordinaire
 *   (`settledParticipants` : fuyards exclus, sauf adversaire couché à 2, D-086) ; perte de
 *   chaque perdant = celle d'une partie ordinaire (`planGameSettlement`, M ou 2M en Kora,
 *   D-080), commission 0 ; le gagnant reçoit le total. Garde-fou « jamais de solde négatif » :
 *   un perdant ne paie jamais plus que ses jetons (le seuil de 2 × la mise de D-063 couvre
 *   déjà la Kora : il ne joue normalement pas).
 * - D054_TAPIS : `settleGameTokens` sur tous les joueurs assis (règle d'origine inchangée).
 */
export function planTournamentGame(input: {
  game: Game;
  stake: number;
  rule: TournamentSettlementRule;
  /** Jetons des comptes du tournoi, par joueur (comptes verrouillés). */
  tokensByPlayer: ReadonlyMap<string, number>;
}): TournamentGamePlan {
  const { game, stake, rule, tokensByPlayer } = input;
  const winnerId = game.result?.winnerId as string | undefined;
  if (game.status !== 'finished' || !winnerId) {
    return { status: 'VOID', voidReason: game.endReason ?? 'NO_WINNER' };
  }
  if (rule === 'D054_TAPIS') {
    if (!tokensByPlayer.has(winnerId)) return { status: 'VOID', voidReason: 'WINNER_NOT_PARTICIPANT' };
    const seated = new Map(
      game.players
        .map((p) => p.playerId as string)
        .filter((id) => tokensByPlayer.has(id))
        .map((id) => [id, tokensByPlayer.get(id)!] as const),
    );
    return { status: 'SETTLED', winnerId, ...settleGameTokens(stake, winnerId, seated) };
  }
  const participants = settledParticipants(game) as string[];
  if (!participants.includes(winnerId)) return { status: 'VOID', voidReason: 'WINNER_NOT_PARTICIPANT' };
  if (participants.some((id) => !tokensByPlayer.has(id))) {
    return { status: 'VOID', voidReason: 'PARTICIPANT_WITHOUT_ACCOUNT' };
  }
  const victoryType = victoryTypeOf(game);
  let plan;
  try {
    if (!victoryType) throw new RangeError('Type de victoire absent');
    plan = planGameSettlement({
      stake,
      commissionBps: 0,
      winnerId: winnerId as PlayerId,
      participants: participants as PlayerId[],
      victoryType,
    });
  } catch {
    return { status: 'VOID', voidReason: 'INVALID_SETTLEMENT' };
  }
  const transfers: Record<string, number> = {};
  let won = 0;
  for (const loserId of plan.loserIds) {
    const paid = Math.min(plan.unitAmount, Math.max(0, tokensByPlayer.get(loserId) ?? 0));
    transfers[loserId] = -paid;
    won += paid;
  }
  transfers[winnerId] = won;
  // Pot = tout ce qui était en jeu (même sens que D-054) : pertes payées + mise équivalente du
  // gagnant (M, ou 2M en Kora, bornée à ses jetons). Donnée d'audit : aucun mouvement de plus.
  const winnerStake = Math.min(plan.unitAmount, Math.max(0, tokensByPlayer.get(winnerId) ?? 0));
  return {
    status: 'SETTLED',
    winnerId,
    victoryType: plan.victoryType,
    transfers,
    pot: won + winnerStake,
  };
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

/**
 * Bilan d'un joueur sur TOUTES les parties réglées (SETTLED) de son tournoi, quelles que
 * soient les tables (sessions) où il les a jouées : une partie comptée une fois par joueur.
 */
export interface TournamentGameTally {
  gamesPlayed: number;
  gamesWon: number;
  /** Somme des variations de jetons des règlements. */
  tokenDelta: number;
}

type LedgerAccount = Pick<
  TournamentPlayerAccount,
  'playerId' | 'initialTokens' | 'currentTokens' | 'gamesPlayed' | 'gamesWon' | 'status'
>;

/**
 * Recalcule les compteurs des comptes depuis le registre des règlements (`tournament_games`),
 * seule source officielle des parties d'un tournoi : parties jouées et gagnées cumulées sur
 * toutes les tables, jetons = capital initial + variations réglées. Les compteurs incrémentés
 * à chaque règlement ne sont qu'un cache : en cas d'écart, le registre fait foi et le compte
 * figure dans `drifted` (valeurs d'origine) pour être journalisé.
 */
export function reconcileAccountsWithLedger<T extends LedgerAccount>(
  accounts: readonly T[],
  ledger: ReadonlyMap<string, TournamentGameTally>,
  stake: number,
): { accounts: T[]; drifted: T[] } {
  const drifted: T[] = [];
  const reconciled = accounts.map((account) => {
    const tally = ledger.get(account.playerId);
    const gamesPlayed = tally?.gamesPlayed ?? 0;
    const gamesWon = tally?.gamesWon ?? 0;
    const currentTokens = account.initialTokens + (tally?.tokenDelta ?? 0);
    if (
      gamesPlayed === account.gamesPlayed &&
      gamesWon === account.gamesWon &&
      currentTokens === account.currentTokens
    ) {
      return account;
    }
    drifted.push(account);
    return {
      ...account,
      gamesPlayed,
      gamesWon,
      currentTokens,
      status: accountStatusFor(currentTokens, stake),
    };
  });
  return { accounts: reconciled, drifted };
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
