import type { TournamentSummary } from '../../types/tournament';

export type ProposalTone = 'neutral' | 'pending' | 'success' | 'danger';

/**
 * Ce que le statut d'une proposition (décidé par le serveur) signifie pour son créateur,
 * et les actions que le serveur accepte dans cet état.
 */
export function proposalStatus(t: Pick<TournamentSummary, 'status' | 'cancellationReason'>): {
  label: string;
  explanation: string;
  tone: ProposalTone;
  canSubmit: boolean;
  canWithdraw: boolean;
} {
  switch (t.status) {
    case 'DRAFT':
      return {
        label: 'Brouillon',
        explanation: 'Enregistré, pas encore soumis : soumettez-le pour approbation.',
        tone: 'neutral',
        canSubmit: true,
        canWithdraw: true,
      };
    case 'PENDING_APPROVAL':
      return {
        label: 'En attente d’approbation',
        explanation:
          'Votre proposition attend la validation de l’administration. Les préinscriptions sont déjà ouvertes aux autres joueurs ; dès la première, la date et les conditions ne peuvent plus être modifiées.',
        tone: 'pending',
        canSubmit: false,
        canWithdraw: true,
      };
    case 'CANCELLED':
      if (t.cancellationReason === 'APPROVAL_REJECTED') {
        return {
          label: 'Refusé',
          explanation: 'Proposition non retenue par l’administration.',
          tone: 'danger',
          canSubmit: false,
          canWithdraw: false,
        };
      }
      if (t.cancellationReason === 'CREATOR_CANCELLED') {
        return {
          label: 'Retiré',
          explanation: 'Vous avez retiré cette proposition.',
          tone: 'neutral',
          canSubmit: false,
          canWithdraw: false,
        };
      }
      return {
        label: 'Annulé',
        explanation:
          t.cancellationReason === 'INSUFFICIENT_PLAYERS'
            ? 'Annulé faute de participants : les réservations ont été libérées.'
            : 'Tournoi annulé : les réservations ont été libérées.',
        tone: 'danger',
        canSubmit: false,
        canWithdraw: false,
      };
    case 'SCHEDULED':
    case 'REGISTRATION_OPEN':
    case 'REGISTRATION_CLOSED':
    case 'STARTING':
      return {
        label: 'Approuvé',
        explanation: 'Publié : les joueurs peuvent le voir et s’y inscrire.',
        tone: 'success',
        canSubmit: false,
        canWithdraw: false,
      };
    case 'IN_PROGRESS':
      return {
        label: 'En cours',
        explanation: 'Le tournoi se joue.',
        tone: 'success',
        canSubmit: false,
        canWithdraw: false,
      };
    default:
      return {
        label: t.status === 'COMPLETED' ? 'Terminé' : 'Résultats en cours',
        explanation: 'Le tournoi est terminé.',
        tone: 'neutral',
        canSubmit: false,
        canWithdraw: false,
      };
  }
}

/** Libellé d'un statut pour l'administration. */
export const ADMIN_STATUS_LABELS: Record<TournamentSummary['status'], string> = {
  DRAFT: 'Brouillon',
  PENDING_APPROVAL: 'À approuver',
  SCHEDULED: 'Programmé',
  REGISTRATION_OPEN: 'Inscriptions ouvertes',
  REGISTRATION_CLOSED: 'Inscriptions fermées',
  STARTING: 'Démarrage',
  IN_PROGRESS: 'En cours',
  CALCULATING_RESULTS: 'Calcul des résultats',
  RESULTS_VALIDATED: 'Résultats validés',
  DISTRIBUTING_PRIZES: 'Versement des gains',
  COMPLETED: 'Terminé',
  CANCELLED: 'Annulé',
};

export const CANCELLATION_LABELS: Record<
  NonNullable<TournamentSummary['cancellationReason']>,
  string
> = {
  INSUFFICIENT_PLAYERS: 'Pas assez de participants',
  ADMIN_CANCELLED: 'Annulé par l’administration',
  SYSTEM_ERROR: 'Incident technique',
  PAYMENT_ERROR: 'Incident de paiement',
  APPROVAL_REJECTED: 'Proposition refusée',
  CREATOR_CANCELLED: 'Retiré par le créateur',
};

/** Annulable par l'admin : avant la capture seulement (le serveur revérifie). */
export function adminCanCancel(status: TournamentSummary['status']): boolean {
  return [
    'DRAFT',
    'PENDING_APPROVAL',
    'SCHEDULED',
    'REGISTRATION_OPEN',
    'REGISTRATION_CLOSED',
    'STARTING',
  ].includes(status);
}
