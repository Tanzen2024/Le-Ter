import { formatFcfa as formatXafAmount } from '../../lib/money';
import type { TournamentStatus, TournamentView } from '../../types/tournament';

/**
 * État d'affichage du module Tournois, dérivé UNIQUEMENT de la vue du serveur (statut,
 * inscription) : l'écran ne décide jamais qu'un tournoi a commencé ou fini (D-054).
 *
 *   NO_TOURNAMENT ─► UPCOMING ─(inscription)─► REGISTERED ─► WAITING ─► IN_PROGRESS ─► COMPLETED
 *
 * - NO_TOURNAMENT : aucun tournoi programmé → petite icône discrète.
 * - UPCOMING : inscriptions ouvertes (ou bientôt), joueur non inscrit.
 * - REGISTERED : inscription (et réservation) confirmée à l'instant par le serveur.
 * - WAITING : inscrit, en attente du début (réservation active).
 * - IN_PROGRESS : en cours (rejoindre si participant, sinon inscriptions fermées).
 * - COMPLETED : clôture, résultats, ou annulé.
 */
export type TournamentWidgetState =
  'NO_TOURNAMENT' | 'UPCOMING' | 'REGISTERED' | 'WAITING' | 'IN_PROGRESS' | 'COMPLETED';

const BEFORE_START: readonly TournamentStatus[] = [
  'SCHEDULED',
  'REGISTRATION_OPEN',
  'REGISTRATION_CLOSED',
  'STARTING',
];

export function tournamentWidgetState(
  tournament: TournamentView | null | undefined,
  { justRegistered = false }: { justRegistered?: boolean } = {},
): TournamentWidgetState {
  if (!tournament) return 'NO_TOURNAMENT';
  if (BEFORE_START.includes(tournament.status)) {
    if (!tournament.registration) return 'UPCOMING';
    return justRegistered ? 'REGISTERED' : 'WAITING';
  }
  if (tournament.status === 'IN_PROGRESS') return 'IN_PROGRESS';
  // Clôture, fin ou annulation (un brouillon n'est jamais mis en avant par le serveur).
  return 'COMPLETED';
}

/** Les gains sont versés : résultats officiels affichables. */
export function hasResults(tournament: TournamentView): boolean {
  return (
    tournament.status === 'RESULTS_VALIDATED' ||
    tournament.status === 'DISTRIBUTING_PRIZES' ||
    tournament.status === 'COMPLETED'
  );
}

/**
 * Tournoi complet d'après la vue du SERVEUR (inscrits actifs ≥ maximum). Indication
 * d'affichage seulement : la capacité reste garantie par le serveur (D-057).
 */
export function isFull(tournament: TournamentView): boolean {
  return (
    tournament.maximumPlayers !== undefined &&
    tournament.registeredCount >= tournament.maximumPlayers
  );
}

/** Nombre de rangs récompensés. */
export const rewardedRanks = (tournament: TournamentView) => tournament.prizeRules.length;

/** Plafond d'attente entre deux relectures programmées (aucun polling agressif). */
export const MAX_REFRESH_DELAY_MS = 60 * 60 * 1000;
/** Pendant la clôture (résultats, gains), relecture courte et bornée. */
export const CLOSING_REFRESH_MS = 30 * 1000;
/** Marge après une échéance : le serveur a basculé le statut quand on le relit. */
const BOUNDARY_MARGIN_MS = 2_000;

/**
 * Délai avant la prochaine relecture : prochaine échéance (fermeture des inscriptions,
 * début, fin) mesurée sur l'horloge du SERVEUR (`serverNow`), plus une marge, plafonnée à
 * 1 h ; 30 s pendant la clôture ; `null` quand il n'y a plus rien à attendre.
 */
export function nextRefreshDelayMs(tournament: TournamentView | null | undefined): number | null {
  if (!tournament || tournament.status === 'COMPLETED' || tournament.status === 'CANCELLED') {
    return null;
  }
  if (
    tournament.status === 'STARTING' ||
    tournament.status === 'CALCULATING_RESULTS' ||
    tournament.status === 'RESULTS_VALIDATED' ||
    tournament.status === 'DISTRIBUTING_PRIZES'
  ) {
    return CLOSING_REFRESH_MS;
  }
  const serverNow = Date.parse(tournament.serverNow);
  const boundary = Date.parse(
    tournament.status === 'IN_PROGRESS'
      ? tournament.endsAt
      : tournament.status === 'REGISTRATION_OPEN' &&
          Date.parse(tournament.registrationClosesAt) > serverNow
        ? tournament.registrationClosesAt
        : tournament.startsAt,
  );
  if (Number.isNaN(serverNow) || Number.isNaN(boundary)) return null;
  return Math.min(Math.max(0, boundary - serverNow) + BOUNDARY_MARGIN_MS, MAX_REFRESH_DELAY_MS);
}

/**
 * Date et heures dans le fuseau du téléphone : `12 octobre 2026`, `18:00`, `20:00`. Les
 * instants viennent du serveur en UTC ; seul l'affichage est local.
 */
export function formatTournamentPeriod(
  tournament: Pick<TournamentView, 'startsAt' | 'endsAt'>,
  locale: string,
  timeZone?: string,
): { date: string; start: string; end: string } {
  const startsAt = new Date(tournament.startsAt);
  const endsAt = new Date(tournament.endsAt);
  const date = new Intl.DateTimeFormat(locale, {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone,
  }).format(startsAt);
  const time = new Intl.DateTimeFormat(locale, {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone,
  });
  return { date, start: time.format(startsAt), end: time.format(endsAt) };
}

/**
 * Date `JJ/MM/AAAA`, début et fin `HH:mm` (24 h), dans le fuseau du téléphone : chiffres
 * construits à la main, identiques quelle que soit la langue ou le moteur JS.
 */
export function formatTournamentSchedule(tournament: Pick<TournamentView, 'startsAt' | 'endsAt'>): {
  date: string;
  start: string;
  end: string;
} {
  const pad = (n: number) => String(n).padStart(2, '0');
  const time = (d: Date) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  const startsAt = new Date(tournament.startsAt);
  const endsAt = new Date(tournament.endsAt);
  return {
    date: `${pad(startsAt.getDate())}/${pad(startsAt.getMonth() + 1)}/${startsAt.getFullYear()}`,
    start: time(startsAt),
    end: time(endsAt),
  };
}

/**
 * Durée RÉELLE du tournoi (fin − début, fixée à la création, D-058) : « 45 min », « 1 h »,
 * « 1 h 30 ». Affichage seulement : les bornes de durée restent celles du serveur (D-104).
 */
export function formatTournamentDuration(
  tournament: Pick<TournamentView, 'startsAt' | 'endsAt'>,
): string {
  const minutes = Math.max(
    0,
    Math.round((Date.parse(tournament.endsAt) - Date.parse(tournament.startsAt)) / 60_000),
  );
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (hours === 0) return `${rest} min`;
  return rest === 0 ? `${hours} h` : `${hours} h ${String(rest).padStart(2, '0')}`;
}

/** « 45 000 FCFA » (1 jeton du compte de jeu = 1 FCFA). */
export function formatFcfa(amount: number): string {
  return formatXafAmount(amount);
}

/**
 * Temps restant avant le début, sur l'horloge du serveur (décalage du téléphone corrigé par
 * `serverNow` et l'instant de réception). Purement visuel.
 */
export function remainingBeforeStartMs(
  tournament: Pick<TournamentView, 'startsAt' | 'serverNow'>,
  receivedAt: number,
  localNow: number,
): number {
  const offset = Date.parse(tournament.serverNow) - receivedAt;
  return Math.max(0, Date.parse(tournament.startsAt) - (localNow + offset));
}

/**
 * Badge de statut (D-065), fidèle à la machine à états du SERVEUR (D-054) :
 * SCHEDULED → À venir ; REGISTRATION_OPEN → Inscriptions ouvertes ; REGISTRATION_CLOSED →
 * Inscriptions clôturées ; STARTING → Démarrage ; IN_PROGRESS → En cours ; calcul, validation
 * et versement → Résultats ; COMPLETED → Terminé ; CANCELLED → Annulé. Un tournoi encore
 * « avant le début » dont l'heure est passée sur l'horloge du serveur est affiché
 * « Démarrage », jamais « À venir » (le serveur bascule son statut au tick suivant).
 */
export type TournamentStatusKey =
  | 'UPCOMING'
  | 'OPEN'
  | 'CLOSED'
  | 'STARTING'
  | 'IN_PROGRESS'
  | 'CLOSING'
  | 'COMPLETED'
  | 'CANCELLED';

export function tournamentStatusKey(
  tournament: Pick<TournamentView, 'status' | 'startsAt' | 'serverNow'>,
): TournamentStatusKey {
  const { status } = tournament;
  if (BEFORE_START.includes(status)) {
    const started = Date.parse(tournament.startsAt) <= Date.parse(tournament.serverNow);
    if (status === 'STARTING' || started) return 'STARTING';
    if (status === 'REGISTRATION_OPEN') return 'OPEN';
    if (status === 'REGISTRATION_CLOSED') return 'CLOSED';
    return 'UPCOMING';
  }
  if (status === 'IN_PROGRESS') return 'IN_PROGRESS';
  if (status === 'COMPLETED') return 'COMPLETED';
  if (status === 'CANCELLED') return 'CANCELLED';
  return 'CLOSING';
}

/** Le joueur participe : inscrit (avant le début) ou titulaire d'un compte de tournoi. */
export const isParticipant = (t: TournamentView) => t.registration !== null || t.account !== null;

/** Le joueur peut encore agir sur ce tournoi (s'inscrire, rejoindre) ou y est inscrit. */
export const isActionable = (t: TournamentView) =>
  t.canRegister || t.canJoin || (t.registration !== null && BEFORE_START.includes(t.status));

/**
 * Tournoi résumé sur l'accueil (D-065), choisi parmi la liste du SERVEUR (déjà triée par
 * début croissant) :
 *   1. un tournoi en cours auquel je participe ;
 *   2. sinon le plus proche à venir (début futur sur l'horloge du serveur) où je suis inscrit
 *      ou dont les inscriptions sont ouvertes ;
 *   3. sinon le plus proche à venir ;
 *   4. sinon un tournoi en cours (information).
 * Jamais un tournoi passé présenté « à venir » ; `null` sans tournoi pertinent.
 */
export function selectHomeTournament(
  tournaments: readonly TournamentView[] | undefined,
): TournamentView | null {
  if (!tournaments || tournaments.length === 0) return null;
  const live = tournaments.filter((t) => t.status === 'IN_PROGRESS');
  const upcoming = tournaments.filter(
    (t) => BEFORE_START.includes(t.status) && Date.parse(t.startsAt) > Date.parse(t.serverNow),
  );
  return (
    live.find(isParticipant) ??
    upcoming.find((t) => t.registration !== null || t.canRegister) ??
    upcoming[0] ??
    live[0] ??
    null
  );
}
