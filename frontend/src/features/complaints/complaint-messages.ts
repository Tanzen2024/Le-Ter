import { useLanguage } from '../../lib/i18n';
import type { Language } from '../../stores/preferences-store';
import type { ComplaintCategory, ComplaintStatus, NextStep } from '../../types/complaint';

/**
 * Textes « Aide et réclamations » (D-114), en français et en anglais. Dictionnaire propre à la
 * fonctionnalité (comme les tournois) : l'anglais a exactement les mêmes clés (TypeScript).
 */
const fr = {
  title: 'Aide et réclamations',
  back: 'Retour',
  backA11y: "Revenir à l'écran précédent",
  tabs: { assistant: 'Assistant', complaints: 'Mes réclamations' },
  assistant: {
    disclaimer:
      'Assistant automatisé : il consulte uniquement vos informations et ne peut modifier ni solde, ni partie, ni récompense. Les décisions sont prises par l’équipe du support.',
    degraded:
      'Assistant intelligent indisponible : vérifications automatiques seulement. Vous pouvez toujours déposer une réclamation.',
    placeholder: 'Décrivez votre problème…',
    send: 'Envoyer',
    sendA11y: 'Envoyer le message à l’assistant',
    newConversation: 'Nouvelle conversation',
    start: 'Démarrer la conversation',
    thinking: 'L’assistant vérifie vos informations…',
    you: 'Vous',
    bot: 'Assistant automatisé',
    verified: 'Vérifié par le serveur',
    fileComplaint: 'Déposer une réclamation',
    fileRecommended: 'Déposer cette réclamation (recommandé)',
  },
  form: {
    title: 'Nouvelle réclamation',
    category: 'Catégorie',
    categoryHint: 'Catégorie proposée : vous pouvez la corriger.',
    subject: 'Titre',
    description: 'Description',
    submit: 'Déposer la réclamation',
    cancel: 'Annuler',
    created: (reference: string) => `Réclamation ${reference} déposée. Vous pouvez la suivre ici.`,
    linked: 'Éléments liés (vérifiés par le serveur au dépôt)',
    linkGame: 'Partie',
    linkTournament: 'Tournoi',
    linkPayment: 'Recharge',
    linkWithdrawal: 'Retrait',
    linkTransaction: 'Transaction',
    unlink: 'Retirer',
    linkInvalid:
      'Cet élément n’est pas (ou plus) rattaché à votre compte. Retirez-le pour déposer la réclamation.',
  },
  shortcut: {
    label: 'Signaler un problème',
    a11y: 'Signaler un problème ou faire une réclamation',
  },
  list: {
    empty: 'Aucune réclamation pour le moment.',
    new: 'Nouvelle réclamation',
    refresh: 'Actualiser',
  },
  detail: {
    reference: 'Référence',
    status: 'Statut',
    nextStep: 'Prochaine étape',
    decision: 'Décision du support',
    history: 'Historique',
    messages: 'Échanges',
    support: 'Support',
    attachments: 'Pièces justificatives',
    attach: 'Joindre une capture',
    attachHint: 'Image (JPEG, PNG, WebP) ou PDF, 3 Mo maximum.',
    attached: 'Pièce jointe envoyée.',
    reply: 'Répondre',
    replyPlaceholder: 'Votre message au support…',
    reopen: 'Contester la décision',
    reopenPlaceholder: 'Pourquoi contestez-vous cette décision ?',
    accept: 'Accepter et clôturer',
    withdraw: 'Retirer ma réclamation',
    withdrawConfirm: 'Retirer cette réclamation ? Le dossier sera clôturé.',
    confirm: 'Confirmer',
    loading: 'Chargement…',
  },
  categories: {
    GAME_RESULT: 'Partie ou résultat contesté',
    BALANCE: 'Solde ou jetons',
    PAYMENT: 'Recharge ou paiement',
    WITHDRAWAL: 'Retrait ou remboursement',
    TOURNAMENT: 'Tournoi (inscription, classement)',
    TOURNAMENT_REWARD: 'Récompense de tournoi non reçue',
    TECHNICAL: 'Problème technique ou déconnexion',
    FRAUD: 'Comportement suspect ou triche',
    ACCOUNT_SECURITY: 'Compte, connexion ou sécurité',
    OTHER: 'Autre demande',
  } satisfies Record<ComplaintCategory, string>,
  statuses: {
    OPEN: 'Reçue',
    AI_ANALYSIS: 'Analyse automatique',
    WAITING_FOR_PLAYER: 'Informations demandées',
    IN_REVIEW: 'En examen par le support',
    RESOLVED: 'Résolue',
    REJECTED: 'Non retenue',
    CLOSED: 'Clôturée',
  } satisfies Record<ComplaintStatus, string>,
  nextSteps: {
    ANALYSIS: 'Vérifications automatiques en cours, puis examen par le support.',
    SUPPORT_REVIEW: 'Un membre du support examine votre dossier.',
    PLAYER_REPLY_EXPECTED: 'Le support attend votre réponse : répondez ci-dessous.',
    DECISION_RENDERED: 'Une décision a été rendue : acceptez-la ou contestez-la.',
    NONE: 'Dossier clôturé.',
  } satisfies Record<NextStep, string>,
  events: {
    CREATED: 'Réclamation déposée',
    STATUS_CHANGED: 'Statut modifié',
    INFO_REQUESTED: 'Informations demandées',
    ATTACHMENT_ADDED: 'Pièce jointe ajoutée',
    DECISION_RECORDED: 'Décision rendue',
    REOPENED: 'Décision contestée',
  } as Record<string, string>,
  notification: (reference: string, event: string) => {
    switch (event) {
      case 'CREATED':
        return `Réclamation ${reference} enregistrée.`;
      case 'INFO_REQUESTED':
        return `Réclamation ${reference} : le support vous demande des informations.`;
      case 'REPLY':
        return `Réclamation ${reference} : nouvelle réponse du support.`;
      case 'DECISION':
        return `Réclamation ${reference} : une décision a été rendue.`;
      case 'CLOSED':
        return `Réclamation ${reference} clôturée.`;
      default:
        return `Réclamation ${reference} mise à jour.`;
    }
  },
  locale: 'fr-FR',
};

export type ComplaintMessages = typeof fr;

const en: ComplaintMessages = {
  title: 'Help & complaints',
  back: 'Back',
  backA11y: 'Go back to the previous screen',
  tabs: { assistant: 'Assistant', complaints: 'My complaints' },
  assistant: {
    disclaimer:
      'Automated assistant: it only reads your own information and cannot change any balance, game or reward. Decisions are made by the support team.',
    degraded: 'Smart assistant unavailable: automatic checks only. You can still file a complaint.',
    placeholder: 'Describe your problem…',
    send: 'Send',
    sendA11y: 'Send the message to the assistant',
    newConversation: 'New conversation',
    start: 'Start the conversation',
    thinking: 'The assistant is checking your information…',
    you: 'You',
    bot: 'Automated assistant',
    verified: 'Verified by the server',
    fileComplaint: 'File a complaint',
    fileRecommended: 'File this complaint (recommended)',
  },
  form: {
    title: 'New complaint',
    category: 'Category',
    categoryHint: 'Suggested category: you can change it.',
    subject: 'Title',
    description: 'Description',
    submit: 'File the complaint',
    cancel: 'Cancel',
    created: (reference: string) => `Complaint ${reference} filed. You can follow it here.`,
    linked: 'Linked items (checked by the server when filing)',
    linkGame: 'Game',
    linkTournament: 'Tournament',
    linkPayment: 'Top-up',
    linkWithdrawal: 'Withdrawal',
    linkTransaction: 'Transaction',
    unlink: 'Remove',
    linkInvalid:
      'This item is not (or no longer) linked to your account. Remove it to file the complaint.',
  },
  shortcut: {
    label: 'Report a problem',
    a11y: 'Report a problem or file a complaint',
  },
  list: {
    empty: 'No complaint yet.',
    new: 'New complaint',
    refresh: 'Refresh',
  },
  detail: {
    reference: 'Reference',
    status: 'Status',
    nextStep: 'Next step',
    decision: 'Support decision',
    history: 'History',
    messages: 'Messages',
    support: 'Support',
    attachments: 'Attachments',
    attach: 'Attach a screenshot',
    attachHint: 'Image (JPEG, PNG, WebP) or PDF, 3 MB maximum.',
    attached: 'Attachment sent.',
    reply: 'Reply',
    replyPlaceholder: 'Your message to support…',
    reopen: 'Dispute the decision',
    reopenPlaceholder: 'Why do you dispute this decision?',
    accept: 'Accept and close',
    withdraw: 'Withdraw my complaint',
    withdrawConfirm: 'Withdraw this complaint? The case will be closed.',
    confirm: 'Confirm',
    loading: 'Loading…',
  },
  categories: {
    GAME_RESULT: 'Disputed game or result',
    BALANCE: 'Balance or tokens',
    PAYMENT: 'Top-up or payment',
    WITHDRAWAL: 'Withdrawal or refund',
    TOURNAMENT: 'Tournament (registration, ranking)',
    TOURNAMENT_REWARD: 'Tournament reward not received',
    TECHNICAL: 'Technical issue or disconnection',
    FRAUD: 'Suspicious behaviour or cheating',
    ACCOUNT_SECURITY: 'Account, login or security',
    OTHER: 'Other request',
  },
  statuses: {
    OPEN: 'Received',
    AI_ANALYSIS: 'Automated analysis',
    WAITING_FOR_PLAYER: 'Information requested',
    IN_REVIEW: 'Under review by support',
    RESOLVED: 'Resolved',
    REJECTED: 'Not upheld',
    CLOSED: 'Closed',
  },
  nextSteps: {
    ANALYSIS: 'Automatic checks in progress, then review by support.',
    SUPPORT_REVIEW: 'A support team member is reviewing your case.',
    PLAYER_REPLY_EXPECTED: 'Support is waiting for your answer: reply below.',
    DECISION_RENDERED: 'A decision was made: accept it or dispute it.',
    NONE: 'Case closed.',
  },
  events: {
    CREATED: 'Complaint filed',
    STATUS_CHANGED: 'Status changed',
    INFO_REQUESTED: 'Information requested',
    ATTACHMENT_ADDED: 'Attachment added',
    DECISION_RECORDED: 'Decision made',
    REOPENED: 'Decision disputed',
  },
  notification: (reference: string, event: string) => {
    switch (event) {
      case 'CREATED':
        return `Complaint ${reference} recorded.`;
      case 'INFO_REQUESTED':
        return `Complaint ${reference}: support needs more information.`;
      case 'REPLY':
        return `Complaint ${reference}: new reply from support.`;
      case 'DECISION':
        return `Complaint ${reference}: a decision was made.`;
      case 'CLOSED':
        return `Complaint ${reference} closed.`;
      default:
        return `Complaint ${reference} updated.`;
    }
  },
  locale: 'en-GB',
};

const MESSAGES: Record<Language, ComplaintMessages> = { fr, en };

export function getComplaintMessages(language: Language): ComplaintMessages {
  return MESSAGES[language] ?? fr;
}

export function useComplaintMessages(): ComplaintMessages {
  return getComplaintMessages(useLanguage());
}
