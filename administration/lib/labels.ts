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
  OPPONENT_FLED: 'Adversaire couché (partie à 2)',
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

export const WITHDRAWAL_STATUS: Record<string, Entry> = {
  CREATED: ['Enregistré', 'warning'],
  PROCESSING: ['En traitement', 'info'],
  SUCCEEDED: ['Confirmé', 'success'],
  FAILED: ['Échoué (remboursé)', 'danger'],
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
  GAME_COMMISSION: 'Commission de partie',
};

export const ANOMALY_TYPE: Record<string, string> = {
  PAYMENT_STATUS_MISMATCH: 'Statut paiement / achat incohérent',
  PAYMENT_AMOUNT_MISMATCH: 'Montant différent des jetons',
  PAYMENT_AMOUNT_OUT_OF_RANGE: 'Montant hors limites',
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
  GAME_COMMISSION_UPDATED: 'Barème de commission des parties modifié',
  WITHDRAWAL_LIMIT_UPDATED: 'Quota de retraits modifié',
  WITHDRAWAL_VIEWED: 'Consultation d’un retrait',
  WITHDRAWAL_VERIFICATION_REQUESTED: 'Revérification d’un retrait',
  WITHDRAWAL_ESCALATED: 'Retrait escaladé au fournisseur',
  WITHDRAWAL_REFUND_PROPOSED: 'Remboursement de retrait proposé',
  WITHDRAWAL_REFUND_APPROVED: 'Remboursement de retrait approuvé',
  WITHDRAWAL_REFUND_REJECTED: 'Remboursement de retrait rejeté',
  PAYOUT_BENEFICIARY_CREATED: 'Bénéficiaire de la plateforme enregistré',
  PAYOUT_BENEFICIARY_VERIFIED: 'Bénéficiaire de la plateforme vérifié',
  PAYOUT_BENEFICIARY_DISABLED: 'Bénéficiaire de la plateforme désactivé',
  TREASURY_OBSERVED: 'Trésorerie CinetPay relue',
  PLATFORM_PAYOUT_CREATED: 'Retrait de la plateforme demandé',
  PLATFORM_PAYOUT_APPROVED: 'Retrait de la plateforme approuvé',
  PLATFORM_PAYOUT_REJECTED: 'Retrait de la plateforme rejeté',
  PLATFORM_PAYOUT_CANCELLED: 'Retrait de la plateforme annulé',
  PLATFORM_PAYOUT_RELEASED: 'Retrait de la plateforme mis en exécution',
  PLATFORM_PAYOUT_VIEWED: 'Consultation d’un retrait de la plateforme',
  PLATFORM_PAYOUT_RECONCILED: 'Rapprochement des retraits de la plateforme',
  USER_DISABLED: 'Compte désactivé',
  USER_ENABLED: 'Compte réactivé',
  USER_SUSPENDED: 'Joueur suspendu',
  USER_SUSPENSION_LIFTED: 'Suspension levée',
  USER_SESSIONS_REVOKED: 'Sessions révoquées',
  USER_WARNED: 'Avertissement',
  USER_CHAT_RESTRICTED: 'Chat restreint',
  USER_CHAT_RESTRICTION_LIFTED: 'Restriction du chat levée',
  USER_NOTE_ADDED: 'Note interne ajoutée',
  USER_NOTE_DELETED: 'Note interne supprimée',
  COMPLAINT_VIEWED: 'Réclamation consultée',
  COMPLAINT_ATTACHMENT_VIEWED: 'Pièce justificative consultée',
  COMPLAINT_REPLIED: 'Réponse au joueur (réclamation)',
  COMPLAINT_NOTE_ADDED: 'Note interne (réclamation)',
  COMPLAINT_INFO_REQUESTED: 'Informations demandées (réclamation)',
  COMPLAINT_ASSIGNED: 'Réclamation assignée',
  COMPLAINT_STATUS_CHANGED: 'Statut de réclamation modifié',
  COMPLAINT_PRIORITY_CHANGED: 'Priorité de réclamation modifiée',
};

/** Mesures de modération d'un joueur (D-079). */
export const SANCTION_KIND: Record<string, string> = {
  SUSPENSION: 'Suspension',
  CHAT_RESTRICTION: 'Restriction du chat',
  WARNING: 'Avertissement',
};

export const SANCTION_STATE: Record<string, Entry> = {
  ACTIVE: ['En cours', 'danger'],
  EXPIRED: ['Échue', 'neutral'],
  LIFTED: ['Levée', 'neutral'],
  RECORDED: ['Enregistré', 'info'],
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
  WITHDRAWAL: 'Retrait',
  PLATFORM_PAYOUT: 'Retrait de la plateforme',
  PAYOUT_BENEFICIARY: 'Bénéficiaire',
  TREASURY: 'Trésorerie',
  COMPLAINT: 'Réclamation',
};

/** État des nouveaux retraits (D-077), décidé au démarrage du serveur. */
export const WITHDRAWAL_SERVICE_MODE: Record<string, Entry> = {
  live: ['Production · fonds réels', 'success'],
  sandbox: ['Mode test (sandbox)', 'warning'],
  unavailable: ['Indisponibles', 'neutral'],
};

/** Motif d'indisponibilité des retraits et action attendue de l'exploitant. */
export const WITHDRAWAL_UNAVAILABLE_REASON: Record<string, string> = {
  PROVIDER_NOT_CONFIGURED: 'Identifiants CinetPay absents.',
  TRANSFERS_DISABLED: 'Transferts non activés (CINETPAY_TRANSFERS_ENABLED=false).',
  LIVE_NOT_CONFIRMED:
    'Clé de production sans attestation des prérequis (CINETPAY_TRANSFERS_LIVE_CONFIRMED).',
  LIVE_OUTSIDE_PRODUCTION: 'Clé de production sur un serveur hors NODE_ENV=production.',
  SANDBOX_IN_PRODUCTION: 'Clé sandbox sur un serveur de production : retraits refusés.',
  ENVIRONMENT_MISMATCH: 'CINETPAY_BASE_URL ne correspond pas à l’environnement de la clé.',
  NOTIFY_URL_NOT_PUBLIC: 'URL de notification des transferts non HTTPS ou non publique.',
  SCHEMA_OUTDATED: 'Migrations des retraits non appliquées (npm run db:migrate).',
};

export const WITHDRAWAL_SERVICE_WARNING: Record<string, string> = {
  TRANSFER_NOTIFY_URL_NOT_PUBLIC:
    'Notification des transferts non joignable par CinetPay : seule la réconciliation réglera les retraits.',
};

export const SERVICE_STATUS: Record<string, Entry> = {
  connected: ['Connecté', 'success'],
  unavailable: ['Indisponible', 'danger'],
  disconnected: ['Non configuré', 'neutral'],
};

// --- Retraits des revenus de la plateforme (D-078) ---------------------------------------------

export const PLATFORM_PAYOUT_STATUS: Record<string, Entry> = {
  PENDING_APPROVAL: ['En attente d’approbation', 'info'],
  REJECTED: ['Rejetée', 'neutral'],
  CANCELLED: ['Annulée', 'neutral'],
  RESERVED: ['Approuvée · fonds réservés', 'primary'],
  READY: ['Prête à exécution', 'accent'],
  SUBMITTING: ['Envoi en cours', 'warning'],
  PROCESSING: ['En cours chez CinetPay', 'warning'],
  UNCERTAIN: ['Statut incertain · vérification', 'warning'],
  SUCCEEDED: ['Réussie (confirmée)', 'success'],
  FAILED: ['Échec confirmé', 'danger'],
  RECONCILIATION_REQUIRED: ['Rapprochement requis', 'danger'],
};

export const TREASURY_STATE: Record<string, Entry> = {
  CONFIRMED: ['Confirmée', 'success'],
  STALE: ['Périmée', 'warning'],
  UNAVAILABLE: ['Indisponible', 'danger'],
  UNKNOWN: ['Non confirmée', 'neutral'],
};

export const BENEFICIARY_STATUS: Record<string, Entry> = {
  PENDING_VERIFICATION: ['À vérifier', 'warning'],
  ACTIVE: ['Vérifié', 'success'],
  DISABLED: ['Désactivé', 'neutral'],
};

/** Raisons pour lesquelles aucun montant n'est retirable, ou une action est refusée. */
export const PAYOUT_BLOCKER: Record<string, string> = {
  TREASURY_NOT_CONFIRMED:
    'Trésorerie non confirmée : relisez le solde CinetPay (une relecture vaut 15 minutes).',
  INCONSISTENT_DATA: 'Données financières incohérentes : aucun montant n’est engagé.',
  FEE_SCHEDULE_UNKNOWN:
    'Barème des frais de transfert non configuré (PLATFORM_PAYOUT_FEE_BPS / _FIXED, contrat CinetPay).',
  NOTHING_AVAILABLE: 'Aucun montant retirable actuellement.',
  SAME_ADMIN: 'Un autre administrateur doit décider (séparation des responsabilités).',
  PLATFORM_PAYOUTS_DISABLED: 'Exécution désactivée sur ce serveur (PLATFORM_PAYOUTS_ENABLED).',
  EXECUTION_DISABLED: 'Exécution désactivée sur ce serveur.',
  NOTIFY_URL_MISSING: 'URL de notification des retraits de la plateforme absente.',
};

export const PAYOUT_ANOMALY: Record<string, string> = {
  NEGATIVE_DISTRIBUTABLE: 'Retraits supérieurs aux revenus enregistrés',
  COLLECTION_FEES_NOT_RECORDED:
    'Frais de collecte CinetPay des achats non enregistrés : non déduits des revenus (la trésorerie relue en tient compte)',
  TREASURY_UNKNOWN: 'Aucune relecture de trésorerie',
  TREASURY_UNAVAILABLE: 'Dernière relecture de trésorerie en erreur',
  TREASURY_STALE: 'Relecture de trésorerie de plus de 15 minutes',
  TREASURY_BELOW_PLAYER_OBLIGATIONS:
    'Solde CinetPay disponible inférieur aux fonds dus aux joueurs',
  TOURNAMENT_FUNDS_NEGATIVE: 'Fonds de tournoi négatifs (incohérence)',
};

export function entry(map: Record<string, Entry>, key: string | null | undefined): Entry {
  if (!key) return ['—', 'neutral'];
  return map[key] ?? [key, 'neutral'];
}

export function label(map: Record<string, string>, key: string | null | undefined): string {
  if (!key) return '—';
  return map[key] ?? key;
}
