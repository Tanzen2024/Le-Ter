import type { BadgeTone } from '@/components/ui/badge';

/**
 * Libellés français et tons des statuts RÉELLEMENT utilisés par le backend. Un statut
 * inconnu s'affiche tel quel (jamais masqué, jamais réinterprété).
 */
type Entry = readonly [label: string, tone: BadgeTone];

export const GAME_STATUS: Record<string, Entry> = {
  waiting: ['En attente', 'info'],
  in_progress: ['En cours', 'accent'],
  finished: ['Terminée', 'neutral'],
};

export const END_REASON: Record<string, string> = {
  INSTANT_WIN: 'Victoire instantanée',
  CONTROL_AFTER_LAST_TRICK: 'Contrôle au dernier pli',
  INSTANT_WIN_TIE: 'Égalité de victoires instantanées (reprise)',
  ADMIN_STOP: 'Arrêt d’exploitation',
};

export const GAME_ANOMALY: Record<string, string> = {
  STALE_WAITING: 'En attente depuis plus de 24 h',
  LONG_RUNNING: 'En cours depuis plus d’une heure',
  OVERDUE_TURN: 'Échéance de tour dépassée',
};

export const PAYMENT_STATUS: Record<string, Entry> = {
  PENDING: ['En attente', 'warning'],
  SUCCESS: ['Confirmé', 'success'],
  FAILED: ['Échoué', 'danger'],
  EXPIRED: ['Expiré', 'neutral'],
};

export const WALLET_STATUS: Record<string, Entry> = {
  pending: ['En attente', 'warning'],
  succeeded: ['Réussie', 'success'],
  failed: ['Échouée', 'danger'],
};

export const WALLET_KIND: Record<string, string> = {
  deposit: 'Achat de jetons',
  withdrawal: 'Retrait',
  tournament_entry: 'Prix d’entrée de tournoi',
  tournament_prize: 'Gain de tournoi',
};

export const ACCOUNT_STATUS: Record<string, Entry> = {
  active: ['Actif', 'success'],
  disabled: ['Désactivé', 'danger'],
};

export const ROLE: Record<string, Entry> = {
  user: ['Joueur', 'neutral'],
  admin: ['Super administrateur', 'primary'],
};

export const TOURNAMENT_STATUS: Record<string, Entry> = {
  DRAFT: ['Brouillon', 'neutral'],
  PENDING_APPROVAL: ['À approuver', 'warning'],
  SCHEDULED: ['Programmé', 'info'],
  REGISTRATION_OPEN: ['Inscriptions ouvertes', 'info'],
  REGISTRATION_CLOSED: ['Inscriptions closes', 'info'],
  STARTING: ['Démarrage', 'accent'],
  IN_PROGRESS: ['En cours', 'accent'],
  CALCULATING_RESULTS: ['Calcul des résultats', 'accent'],
  RESULTS_VALIDATED: ['Résultats validés', 'primary'],
  DISTRIBUTING_PRIZES: ['Versement des gains', 'primary'],
  COMPLETED: ['Terminé', 'success'],
  CANCELLED: ['Annulé', 'danger'],
};

export const CANCELLATION_REASON: Record<string, string> = {
  INSUFFICIENT_PLAYERS: 'Participants insuffisants',
  ADMIN_CANCELLED: 'Annulé par l’administration',
  SYSTEM_ERROR: 'Erreur système',
  PAYMENT_ERROR: 'Erreur de paiement',
  APPROVAL_REJECTED: 'Proposition refusée',
  CREATOR_CANCELLED: 'Retiré par son créateur',
};

export const RESERVATION_STATUS: Record<string, Entry> = {
  ACTIVE: ['Réservé', 'warning'],
  CAPTURED: ['Débité', 'success'],
  RELEASED: ['Libéré', 'neutral'],
  EXPIRED: ['Expiré', 'neutral'],
};

export const ALERT_STATUS: Record<string, Entry> = {
  NEW: ['Nouvelle', 'warning'],
  REVIEWED: ['En examen', 'info'],
  DISMISSED: ['Écartée', 'neutral'],
  RESOLVED: ['Traitée', 'success'],
};

export const ALERT_LEVEL: Record<string, Entry> = {
  high: ['Élevé', 'warning'],
  very_high: ['Très élevé', 'danger'],
};

export const LEDGER_KIND: Record<string, string> = {
  TOURNAMENT_PLATFORM_FEE: 'Commission de tournoi',
  UNALLOCATED_PRIZE: 'Part de gains non attribuée',
};

export const ANOMALY_TYPE: Record<string, string> = {
  PAYMENT_STATUS_MISMATCH: 'Statut paiement / achat incohérent',
  PAYMENT_AMOUNT_MISMATCH: 'Montant différent des jetons',
  PAYMENT_AMOUNT_OUT_OF_RANGE: 'Montant hors barème',
  PAYMENT_STALE_PENDING: 'Paiement en attente ancien',
  PAYMENT_MISSING_PROVIDER_REFERENCE: 'Référence CinetPay manquante',
  DEPOSIT_WITHOUT_PAYMENT: 'Achat sans paiement fournisseur',
  TOURNAMENT_FEE_ENTRY_MISSING: 'Commission non comptabilisée',
  TOURNAMENT_FEE_ENTRY_MISMATCH: 'Écriture de commission différente',
  TOURNAMENT_FEE_FORMULA: 'Commission hors formule',
  TOURNAMENT_ENTRIES_MISMATCH: 'Entrées capturées ≠ cagnotte',
  TOURNAMENT_POOL_SPLIT: 'Répartition de la cagnotte incohérente',
  TOURNAMENT_PRIZES_MISMATCH: 'Gains ≠ cagnotte des gains',
  TOURNAMENT_UNALLOCATED_ENTRY: 'Part non attribuée mal comptabilisée',
  TOURNAMENT_PRIZES_UNPAID: 'Gains non versés',
  LEDGER_ENTRY_WITHOUT_START: 'Écriture pour un tournoi non démarré',
};

export const AUDIT_ACTION: Record<string, string> = {
  ALERT_STATUS_CHANGED: 'Statut d’alerte modifié',
  DETECTION_ENABLED: 'Détection activée',
  DETECTION_DISABLED: 'Détection désactivée',
  TOURNAMENT_CREATED: 'Tournoi créé',
  TOURNAMENT_UPDATED: 'Tournoi modifié',
  TOURNAMENT_APPROVED: 'Tournoi approuvé',
  TOURNAMENT_REJECTED: 'Tournoi refusé',
  TOURNAMENT_CANCELLED: 'Tournoi annulé',
  TOURNAMENT_SETTINGS_UPDATED: 'Paramètres des tournois modifiés',
  ADMIN_LOGIN_SUCCEEDED: 'Connexion réussie',
  ADMIN_LOGIN_FAILED: 'Échec de connexion',
  ADMIN_LOGOUT: 'Déconnexion',
  ADMIN_SESSION_EXPIRED: 'Session expirée',
  USER_VIEWED: 'Consultation d’un joueur',
  PAYMENT_VIEWED: 'Consultation d’un paiement',
  PAYMENT_VERIFICATION_REQUESTED: 'Revérification d’un paiement',
  REPORT_EXPORTED: 'Export de rapport',
};

export const AUDIT_TARGET: Record<string, string> = {
  DETECTION_ALERT: 'Alerte',
  SYSTEM_SETTING: 'Paramètre',
  TOURNAMENT: 'Tournoi',
  ADMIN_ACCOUNT: 'Compte admin',
  ADMIN_SESSION: 'Session admin',
  USER: 'Joueur',
  PAYMENT: 'Paiement',
  REPORT: 'Rapport',
};

export const SERVICE_STATUS: Record<string, Entry> = {
  connected: ['Connecté', 'success'],
  unavailable: ['Indisponible', 'danger'],
  disconnected: ['Non configuré', 'neutral'],
};

export function entry(map: Record<string, Entry>, key: string | null | undefined): Entry {
  if (!key) return ['—', 'neutral'];
  return map[key] ?? [key, 'neutral'];
}

export function label(map: Record<string, string>, key: string | null | undefined): string {
  if (!key) return '—';
  return map[key] ?? key;
}
