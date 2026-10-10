import { useLanguage } from '../../lib/i18n';
import { formatFcfa } from '../../lib/money';
import type { Language } from '../../stores/preferences-store';
import type { AppNotification, TournamentCancellationReason } from '../../types/tournament';

/**
 * Les tournois n'ont plus de nom (D-060) : une notification les désigne par leur début,
 * `JJ/MM/AAAA HH:mm` dans le fuseau du téléphone.
 */
function notificationDate(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/**
 * Textes du module Tournois (D-054), dans la langue choisie. Gardés dans le module tant que
 * le catalogue commun (`lib/i18n`) évolue ; à y fusionner sous la clé `tournaments`.
 */
const fr = {
  iconA11y: 'Tournois',
  none: 'Aucun tournoi programmé pour le moment.',
  status: {
    UPCOMING: 'À venir',
    OPEN: 'Inscriptions ouvertes',
    CLOSED: 'Inscriptions clôturées',
    STARTING: 'Démarrage',
    IN_PROGRESS: 'En cours',
    CLOSING: 'Résultats',
    COMPLETED: 'Terminé',
    CANCELLED: 'Annulé',
  },
  /** Liste des tournois (D-065). */
  list: {
    title: 'Tournois',
    current: 'À venir et en cours',
    history: 'Historique',
    /** Groupes de la liste (`tournament-groups.ts`). */
    groups: {
      open: 'Inscriptions ouvertes',
      closed: 'Inscriptions clôturées ou tournois complets',
      inProgress: 'Tournois en cours',
      history: 'Historique',
    },
    empty: 'Aucun tournoi programmé pour le moment.',
    error: 'Impossible de charger les tournois.',
    retry: 'Réessayer',
    open: (date: string) => `Ouvrir le tournoi du ${date}`,
    /** « 👥 Inscrits : 12 / 100 · minimum 20 » : jamais « 20 min », lu comme une durée. */
    registeredCount: (count: number, min: number, max?: number) =>
      `👥 Inscrits : ${count}${max !== undefined ? ` / ${max}` : ''} · minimum ${min}`,
    notRegistered: 'Non inscrit',
    approvedProposal: '✓ Proposition approuvée',
    back: 'Retour à la liste',
  },
  /** Formulaire de création / proposition : champs Date et Heure de début (sélecteurs). */
  form: {
    date: 'Date',
    startTime: 'Heure de début',
  },
  /** Recherche d'une table de tournoi (D-065) : uniquement des états réels. */
  matchmaking: {
    title: 'Recherche d’une partie en cours…',
    searching: 'Recherche d’une table disponible…',
    found: 'Table trouvée, connexion en cours…',
    failed: 'Aucune table n’a pu vous être attribuée.',
    retry: 'Réessayer',
    cancel: 'Annuler la recherche',
    cancelling: 'Annulation de la recherche…',
    cancelFailed: 'L’annulation n’a pas abouti. Vérifiez votre connexion et réessayez.',
    cancelled: 'Recherche annulée. Votre inscription au tournoi est conservée.',
  },
  period: (start: string, end: string) => `${start} — ${end}`,
  /** Informations essentielles de la fiche : libellé explicite au-dessus de chaque valeur. */
  facts: {
    entry: '💰 Inscription',
    players: '👥 Inscrits',
    duration: '⏱️ Durée',
    rewards: '🏆 Récompenses',
    registered: (count: number, max?: number) =>
      max !== undefined ? `${count} / ${max}` : String(count),
    minimum: (min: number) => `minimum ${min} joueurs`,
    ranks: (count: number) => (count > 1 ? `${count} premiers rangs` : '1er rang'),
  },
  entry: (fee: string) => `💰 ${fee}`,
  players: (min: number, max?: number) =>
    max !== undefined ? `👥 ${min} à ${max} joueurs` : `👥 ${min} joueurs minimum`,
  ranks: (count: number) =>
    count > 1 ? `🏆 ${count} premiers rangs récompensés` : '🏆 1er rang récompensé',
  panelA11y: (date: string) => `Tournoi du ${date}, voir le tournoi`,
  viewTournament: 'Voir le tournoi',
  notRegistered: "Vous n'êtes pas encore inscrit.",
  reservationInfo: (fee: string) =>
    `Les frais d'inscription de ${fee} seront réservés sur votre compte de jeu. Le débit aura lieu uniquement au démarrage du tournoi. En cas d'annulation, le montant réservé sera libéré.`,
  register: "S'inscrire",
  registeredNow: 'Inscription confirmée.',
  registered: '✓ Inscrit',
  reserved: (fee: string) => `${fee} réservés`,
  waiting: 'En attente du début du tournoi',
  startsIn: (duration: string) => `Début dans ${duration}`,
  unregister: 'Se désinscrire',
  join: 'Rejoindre le Tournoi',
  tokens: (tokens: number, played: number) =>
    `🪙 ${tokens} jetons · ${played} partie${played > 1 ? 's' : ''}`,
  outOfTokens: 'Plus assez de jetons pour une nouvelle partie : votre classement est conservé.',
  closed: 'Ce tournoi a déjà commencé et les inscriptions sont fermées.',
  closing: 'Tournoi terminé : calcul des résultats en cours.',
  completed: '🏆 TOURNOI TERMINÉ',
  cancelled: 'Tournoi annulé',
  cancelReasons: {
    INSUFFICIENT_PLAYERS: 'Pas assez de participants : votre réservation a été libérée.',
    ADMIN_CANCELLED: 'Annulé par l’organisation : votre réservation a été libérée.',
    SYSTEM_ERROR: 'Annulé suite à un incident : aucune somme n’a été débitée.',
    PAYMENT_ERROR: 'Annulé suite à un incident de paiement : votre réservation a été libérée.',
    APPROVAL_REJECTED: 'Proposition non retenue.',
    CREATOR_CANCELLED: 'Proposition retirée par son créateur.',
  } satisfies Record<TournamentCancellationReason, string>,
  myResult: (rank: number, prize: string) => `Votre rang : ${rank} · gain : ${prize}`,
  alreadyPlaying:
    'Terminez votre partie en cours (ou quittez sa table) avant de rejoindre le tournoi.',
  insufficientBalance: 'Solde disponible insuffisant pour réserver la participation.',
  /** Capacité atteinte (D-057) : message positif, jamais une erreur. */
  full: {
    title: 'Tournoi complet 🎉',
    register:
      'Ce tournoi a atteint son nombre maximum de participants. Merci pour ton intérêt ! Découvre les autres tournois disponibles pour participer à la prochaine partie.',
    join: 'Toutes les places de ce tournoi sont prises. Merci pour ton intérêt, on te retrouve au prochain tournoi !',
  },
  notifications: 'Notifications',
  notification: (n: AppNotification): string => {
    const name = n.payload.startsAt
      ? `Tournoi du ${notificationDate(n.payload.startsAt)}`
      : 'Tournoi';
    switch (n.type) {
      case 'TOURNAMENT_APPROVED':
        return `${name} : votre proposition est approuvée.`;
      case 'TOURNAMENT_REGISTRATION_CONFIRMED':
        return `${name} : inscription confirmée.`;
      case 'TOURNAMENT_CANCELLED':
        return `${name} : tournoi annulé.`;
      case 'TOURNAMENT_STARTED':
        return `${name} : le tournoi commence !`;
      case 'TOURNAMENT_RESULTS_AVAILABLE':
        return `${name} : les résultats sont disponibles.`;
      case 'TOURNAMENT_PRIZE_CREDITED':
        return `${name} : gain de ${formatFcfa(n.payload.amount ?? 0)} crédité.`;
      case 'TOURNAMENT_TABLE_CLOSED':
        return `${name} : le tournoi est terminé, plus de nouvelle partie à cette table.`;
    }
  },
  locale: 'fr-FR',
};

export type TournamentMessages = typeof fr;

const en: TournamentMessages = {
  iconA11y: 'Tournaments',
  none: 'No tournament scheduled for now.',
  status: {
    UPCOMING: 'Upcoming',
    OPEN: 'Registration open',
    CLOSED: 'Registration closed',
    STARTING: 'Starting',
    IN_PROGRESS: 'In progress',
    CLOSING: 'Results',
    COMPLETED: 'Finished',
    CANCELLED: 'Cancelled',
  },
  list: {
    title: 'Tournaments',
    current: 'Upcoming and in progress',
    history: 'History',
    groups: {
      open: 'Registration open',
      closed: 'Registration closed or full',
      inProgress: 'In progress',
      history: 'History',
    },
    empty: 'No tournament scheduled for now.',
    error: 'Could not load the tournaments.',
    retry: 'Try again',
    open: (date) => `Open the tournament on ${date}`,
    registeredCount: (count, min, max) =>
      `👥 Registered: ${count}${max !== undefined ? ` / ${max}` : ''} · minimum ${min}`,
    notRegistered: 'Not registered',
    approvedProposal: '✓ Proposal approved',
    back: 'Back to the list',
  },
  form: {
    date: 'Date',
    startTime: 'Start time',
  },
  matchmaking: {
    title: 'Looking for a game…',
    searching: 'Looking for an available table…',
    found: 'Table found, connecting…',
    failed: 'No table could be assigned to you.',
    retry: 'Try again',
    cancel: 'Cancel search',
    cancelling: 'Cancelling the search…',
    cancelFailed: 'The search could not be cancelled. Check your connection and try again.',
    cancelled: 'Search cancelled. Your tournament registration is kept.',
  },
  period: (start, end) => `${start} — ${end}`,
  facts: {
    entry: '💰 Entry fee',
    players: '👥 Registered',
    duration: '⏱️ Duration',
    rewards: '🏆 Prizes',
    registered: (count, max) => (max !== undefined ? `${count} / ${max}` : String(count)),
    minimum: (min) => `minimum ${min} players`,
    ranks: (count) => (count > 1 ? `Top ${count} ranks` : '1st place'),
  },
  entry: (fee) => `💰 ${fee}`,
  players: (min, max) =>
    max !== undefined ? `👥 ${min} to ${max} players` : `👥 ${min} players minimum`,
  ranks: (count) => (count > 1 ? `🏆 Top ${count} rewarded ranks` : '🏆 1st place rewarded'),
  panelA11y: (name) => `Tournament ${name}, view the tournament`,
  viewTournament: 'View the tournament',
  notRegistered: 'You are not registered yet.',
  reservationInfo: (fee) =>
    `The ${fee} entry fee will be reserved on your game account. It is only charged when the tournament starts. If it is cancelled, the reserved amount is released.`,
  register: 'Register',
  registeredNow: 'Registration confirmed.',
  registered: '✓ Registered',
  reserved: (fee) => `${fee} reserved`,
  waiting: 'Waiting for the tournament to start',
  startsIn: (duration) => `Starts in ${duration}`,
  unregister: 'Unregister',
  join: 'Join the Tournament',
  tokens: (tokens, played) => `🪙 ${tokens} tokens · ${played} game${played > 1 ? 's' : ''}`,
  outOfTokens: 'Not enough tokens for a new game: your ranking is kept.',
  closed: 'This tournament has already started and registration is closed.',
  closing: 'Tournament over: results are being calculated.',
  completed: '🏆 TOURNAMENT FINISHED',
  cancelled: 'Tournament cancelled',
  cancelReasons: {
    INSUFFICIENT_PLAYERS: 'Not enough participants: your reservation was released.',
    ADMIN_CANCELLED: 'Cancelled by the organisers: your reservation was released.',
    SYSTEM_ERROR: 'Cancelled after an incident: nothing was charged.',
    PAYMENT_ERROR: 'Cancelled after a payment incident: your reservation was released.',
    APPROVAL_REJECTED: 'Proposal not accepted.',
    CREATOR_CANCELLED: 'Proposal withdrawn by its creator.',
  },
  myResult: (rank, prize) => `Your rank: ${rank} · prize: ${prize}`,
  alreadyPlaying: 'Finish your current game (or leave its table) before joining the tournament.',
  insufficientBalance: 'Not enough available balance to reserve the entry fee.',
  full: {
    title: 'Tournament full 🎉',
    register:
      'This tournament has reached its maximum number of participants. Thanks for your interest! Check out the other tournaments to join the next game.',
    join: 'All the places in this tournament are taken. Thanks for your interest, see you at the next tournament!',
  },
  notifications: 'Notifications',
  notification: (n) => {
    const name = n.payload.startsAt
      ? `Tournament on ${notificationDate(n.payload.startsAt)}`
      : 'Tournament';
    switch (n.type) {
      case 'TOURNAMENT_APPROVED':
        return `${name}: your proposal was approved.`;
      case 'TOURNAMENT_REGISTRATION_CONFIRMED':
        return `${name}: registration confirmed.`;
      case 'TOURNAMENT_CANCELLED':
        return `${name}: tournament cancelled.`;
      case 'TOURNAMENT_STARTED':
        return `${name}: the tournament is starting!`;
      case 'TOURNAMENT_RESULTS_AVAILABLE':
        return `${name}: results are available.`;
      case 'TOURNAMENT_PRIZE_CREDITED':
        return `${name}: prize of ${formatFcfa(n.payload.amount ?? 0)} credited.`;
      case 'TOURNAMENT_TABLE_CLOSED':
        return `${name}: the tournament is over, no new game at this table.`;
    }
  },
  locale: 'en-GB',
};

const MESSAGES: Record<Language, TournamentMessages> = { fr, en };

export function useTournamentMessages(): TournamentMessages {
  return MESSAGES[useLanguage()] ?? fr;
}

/** « 1 h 05 », « 12 min », « 45 s ». */
export function formatDuration(ms: number): string {
  const totalSeconds = Math.ceil(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  if (hours > 0) return `${hours} h ${String(minutes).padStart(2, '0')}`;
  if (minutes > 0) return `${minutes} min`;
  return `${totalSeconds} s`;
}
