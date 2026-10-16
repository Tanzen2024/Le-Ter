import type { BadgeTone } from '@/components/ui/badge';

type Entry = readonly [label: string, tone: BadgeTone];

/** Libellés des réclamations (D-114), alignés sur les valeurs réelles du backend. */
export const COMPLAINT_STATUS: Record<string, Entry> = {
  OPEN: ['Reçue', 'info'],
  AI_ANALYSIS: ['Analyse automatique', 'info'],
  WAITING_FOR_PLAYER: ['Attente du joueur', 'warning'],
  IN_REVIEW: ['En examen', 'info'],
  RESOLVED: ['Résolue', 'success'],
  REJECTED: ['Non retenue', 'danger'],
  CLOSED: ['Clôturée', 'neutral'],
};

export const COMPLAINT_PRIORITY: Record<string, Entry> = {
  URGENT: ['Urgente', 'danger'],
  HIGH: ['Haute', 'warning'],
  NORMAL: ['Normale', 'info'],
  LOW: ['Basse', 'neutral'],
};

export const COMPLAINT_CATEGORY: Record<string, string> = {
  GAME_RESULT: 'Partie / résultat contesté',
  BALANCE: 'Solde / jetons',
  PAYMENT: 'Recharge / paiement',
  WITHDRAWAL: 'Retrait / remboursement',
  TOURNAMENT: 'Tournoi',
  TOURNAMENT_REWARD: 'Récompense de tournoi',
  TECHNICAL: 'Technique / déconnexion',
  FRAUD: 'Comportement suspect / fraude',
  ACCOUNT_SECURITY: 'Compte / sécurité',
  OTHER: 'Autre',
};

export const COMPLAINT_EVENT: Record<string, string> = {
  CREATED: 'Réclamation déposée',
  STATUS_CHANGED: 'Statut modifié',
  MESSAGE_ADDED: 'Message ajouté',
  INFO_REQUESTED: 'Informations demandées',
  ATTACHMENT_ADDED: 'Pièce jointe ajoutée',
  ASSIGNED: 'Assignation',
  PRIORITY_CHANGED: 'Priorité modifiée',
  DECISION_RECORDED: 'Décision motivée enregistrée',
  REOPENED: 'Décision contestée par le joueur',
  AI_ANALYSIS_COMPLETED: 'Analyse automatique terminée',
  AI_ANALYSIS_UNAVAILABLE: 'Analyse automatique indisponible',
};

export const CHECK_TOOL: Record<string, string> = {
  get_game: 'Partie',
  list_recent_games: 'Parties récentes',
  get_wallet_history: 'Historique du compte de jeu',
  check_payment: 'Recharge',
  check_withdrawal: 'Retrait',
  get_tournament_status: 'Tournoi / récompense',
  get_complaint_status: 'Réclamation',
};

/**
 * Transitions administratives autorisées (miroir de COMPLAINT_TRANSITIONS côté serveur, qui
 * reste seul juge). Les boutons hors de cette liste ne sont pas proposés.
 */
export const ADMIN_TRANSITIONS: Record<string, string[]> = {
  OPEN: ['IN_REVIEW', 'WAITING_FOR_PLAYER'],
  AI_ANALYSIS: ['IN_REVIEW', 'WAITING_FOR_PLAYER'],
  IN_REVIEW: ['WAITING_FOR_PLAYER', 'RESOLVED', 'REJECTED'],
  WAITING_FOR_PLAYER: ['IN_REVIEW', 'CLOSED'],
  RESOLVED: ['IN_REVIEW', 'CLOSED'],
  REJECTED: ['IN_REVIEW', 'CLOSED'],
  CLOSED: [],
};
