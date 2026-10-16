import { randomInt } from 'node:crypto';

import type { UserId } from '../users/user';

/**
 * Réclamations des joueurs (D-114, docs/complaints.md). Le domaine ne connaît ni SQL ni
 * fournisseur d'IA : catégories, statuts, transitions autorisées et bornes.
 *
 * Une réclamation ne déclenche JAMAIS d'opération financière ni de modification d'une partie,
 * d'un classement ou d'une récompense : une correction passe par le processus métier existant
 * (paiements, retraits, tournois), audité, et la décision du dossier le mentionne.
 */

export const COMPLAINT_CATEGORIES = [
  /** Partie, victoire, défaite ou résultat contesté. */
  'GAME_RESULT',
  /** Solde du compte de jeu, jetons de tournoi ou mouvement inexpliqué. */
  'BALANCE',
  /** Recharge (achat de jetons CinetPay). */
  'PAYMENT',
  /** Retrait Mobile Money ou remboursement d'un retrait échoué. */
  'WITHDRAWAL',
  /** Tournoi : inscription, annulation, classement. */
  'TOURNAMENT',
  /** Récompense de tournoi non reçue. */
  'TOURNAMENT_REWARD',
  /** Problème technique ou déconnexion. */
  'TECHNICAL',
  /** Comportement suspect, fraude présumée, tricherie. */
  'FRAUD',
  /** Compte, connexion ou sécurité. */
  'ACCOUNT_SECURITY',
  'OTHER',
] as const;
export type ComplaintCategory = (typeof COMPLAINT_CATEGORIES)[number];

export function isComplaintCategory(value: unknown): value is ComplaintCategory {
  return (COMPLAINT_CATEGORIES as readonly unknown[]).includes(value);
}

/** Catégories touchant à l'argent réel : jamais clôturées sans décision humaine motivée. */
export const FINANCIAL_CATEGORIES: ReadonlySet<ComplaintCategory> = new Set([
  'BALANCE',
  'PAYMENT',
  'WITHDRAWAL',
  'TOURNAMENT_REWARD',
]);

export const COMPLAINT_STATUSES = [
  'OPEN',
  'AI_ANALYSIS',
  'WAITING_FOR_PLAYER',
  'IN_REVIEW',
  'RESOLVED',
  'REJECTED',
  'CLOSED',
] as const;
export type ComplaintStatus = (typeof COMPLAINT_STATUSES)[number];

export function isComplaintStatus(value: unknown): value is ComplaintStatus {
  return (COMPLAINT_STATUSES as readonly unknown[]).includes(value);
}

export const COMPLAINT_PRIORITIES = ['LOW', 'NORMAL', 'HIGH', 'URGENT'] as const;
export type ComplaintPriority = (typeof COMPLAINT_PRIORITIES)[number];

export function isComplaintPriority(value: unknown): value is ComplaintPriority {
  return (COMPLAINT_PRIORITIES as readonly unknown[]).includes(value);
}

/** Priorité initiale, calculée par le serveur (l'administration peut la changer, audité). */
export function initialPriority(category: ComplaintCategory): ComplaintPriority {
  if (FINANCIAL_CATEGORIES.has(category) || category === 'FRAUD') return 'HIGH';
  if (category === 'ACCOUNT_SECURITY') return 'HIGH';
  if (category === 'OTHER') return 'LOW';
  return 'NORMAL';
}

export type ComplaintActor = 'PLAYER' | 'ADMIN' | 'SYSTEM';

/**
 * Transitions autorisées, par acteur. Toute autre transition est refusée
 * (`InvalidComplaintTransitionError`). Le SYSTÈME est l'analyse automatique et sa reprise :
 * il ne peut ni résoudre, ni rejeter, ni clôturer un dossier.
 *
 *   OPEN ──system──▶ AI_ANALYSIS ──system──▶ IN_REVIEW
 *   OPEN ──system/admin──▶ IN_REVIEW
 *   OPEN / AI_ANALYSIS / IN_REVIEW ──admin──▶ WAITING_FOR_PLAYER (demande d'informations)
 *   WAITING_FOR_PLAYER ──player (réponse) / admin──▶ IN_REVIEW
 *   IN_REVIEW ──admin + décision motivée──▶ RESOLVED | REJECTED
 *   RESOLVED / REJECTED ──player (contestation, ≤ 2) / admin──▶ IN_REVIEW
 *   RESOLVED / REJECTED ──player (accepte) / admin──▶ CLOSED
 *   OPEN / AI_ANALYSIS / IN_REVIEW / WAITING_FOR_PLAYER ──player (retrait)──▶ CLOSED
 *   WAITING_FOR_PLAYER ──admin (sans réponse)──▶ CLOSED
 *   CLOSED : définitif.
 */
export const COMPLAINT_TRANSITIONS: Readonly<
  Record<ComplaintStatus, Partial<Record<ComplaintStatus, readonly ComplaintActor[]>>>
> = {
  OPEN: {
    AI_ANALYSIS: ['SYSTEM'],
    IN_REVIEW: ['SYSTEM', 'ADMIN'],
    WAITING_FOR_PLAYER: ['ADMIN'],
    CLOSED: ['PLAYER'],
  },
  AI_ANALYSIS: {
    IN_REVIEW: ['SYSTEM', 'ADMIN'],
    WAITING_FOR_PLAYER: ['ADMIN'],
    CLOSED: ['PLAYER'],
  },
  IN_REVIEW: {
    WAITING_FOR_PLAYER: ['ADMIN'],
    RESOLVED: ['ADMIN'],
    REJECTED: ['ADMIN'],
    CLOSED: ['PLAYER'],
  },
  WAITING_FOR_PLAYER: {
    IN_REVIEW: ['PLAYER', 'ADMIN'],
    CLOSED: ['PLAYER', 'ADMIN'],
  },
  RESOLVED: {
    IN_REVIEW: ['PLAYER', 'ADMIN'],
    CLOSED: ['PLAYER', 'ADMIN'],
  },
  REJECTED: {
    IN_REVIEW: ['PLAYER', 'ADMIN'],
    CLOSED: ['PLAYER', 'ADMIN'],
  },
  CLOSED: {},
};

export function canTransition(
  from: ComplaintStatus,
  to: ComplaintStatus,
  actor: ComplaintActor,
): boolean {
  return COMPLAINT_TRANSITIONS[from][to]?.includes(actor) ?? false;
}

/** Statuts dans lesquels le joueur peut encore écrire au support. */
export const PLAYER_WRITABLE: ReadonlySet<ComplaintStatus> = new Set([
  'OPEN',
  'AI_ANALYSIS',
  'WAITING_FOR_PLAYER',
  'IN_REVIEW',
]);

/** Dossier encore actif (compte dans la limite de dossiers ouverts). */
export const ACTIVE_STATUSES: readonly ComplaintStatus[] = [
  'OPEN',
  'AI_ANALYSIS',
  'WAITING_FOR_PLAYER',
  'IN_REVIEW',
];

export const COMPLAINT_LIMITS = {
  titleMin: 3,
  titleMax: 120,
  descriptionMin: 10,
  descriptionMax: 4000,
  messageMax: 4000,
  decisionMin: 10,
  decisionMax: 2000,
  reasonMax: 500,
  /** Dossiers actifs simultanés par joueur (abus). */
  maxActivePerPlayer: 10,
  /** Contestations d'une décision par dossier. */
  maxReopens: 2,
  /** Délai de contestation après la décision. */
  reopenWindowMs: 30 * 24 * 3600 * 1000,
  attachmentsPerComplaint: 5,
  attachmentMaxBytes: 3 * 1024 * 1024,
} as const;

/** Types acceptés, reconnus par leur SIGNATURE (le Content-Type déclaré n'est pas cru). */
export const ATTACHMENT_TYPES = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'application/pdf',
] as const;
export type AttachmentType = (typeof ATTACHMENT_TYPES)[number];

export function sniffAttachmentType(data: Uint8Array): AttachmentType | null {
  const at = (i: number) => data[i];
  if (data.length >= 3 && at(0) === 0xff && at(1) === 0xd8 && at(2) === 0xff) return 'image/jpeg';
  if (
    data.length >= 8 &&
    [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].every((b, i) => at(i) === b)
  ) {
    return 'image/png';
  }
  if (
    data.length >= 12 &&
    String.fromCharCode(...data.subarray(0, 4)) === 'RIFF' &&
    String.fromCharCode(...data.subarray(8, 12)) === 'WEBP'
  ) {
    return 'image/webp';
  }
  if (data.length >= 5 && String.fromCharCode(...data.subarray(0, 5)) === '%PDF-') {
    return 'application/pdf';
  }
  return null;
}

const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

/** Référence lisible : RCL-AAAAMMJJ-XXXXXX (aléa cryptographique ; unicité garantie en base). */
export function newComplaintReference(
  now: Date,
  random: (max: number) => number = randomInt,
): string {
  const day = now.toISOString().slice(0, 10).replace(/-/g, '');
  let suffix = '';
  for (let i = 0; i < 6; i += 1) suffix += CROCKFORD[random(CROCKFORD.length)];
  return `RCL-${day}-${suffix}`;
}

export const COMPLAINT_REFERENCE_PATTERN = /^RCL-[0-9]{8}-[0-9A-HJKMNP-TV-Z]{6}$/;

export interface ComplaintLinks {
  gameId?: string;
  tournamentId?: string;
  walletTransactionId?: string;
  paymentId?: string;
  withdrawalId?: string;
}

export interface Complaint {
  id: string;
  reference: string;
  userId: UserId;
  category: ComplaintCategory;
  suggestedCategory: ComplaintCategory | null;
  title: string;
  description: string;
  status: ComplaintStatus;
  priority: ComplaintPriority;
  links: ComplaintLinks;
  conversationId: string | null;
  incidentAt: Date | null;
  assignedAdminId: UserId | null;
  aiSummary: string | null;
  aiAnalysisStatus: 'PENDING' | 'COMPLETED' | 'UNAVAILABLE';
  decision: string | null;
  decidedBy: UserId | null;
  decidedAt: Date | null;
  reopenCount: number;
  version: number;
  createdAt: Date;
  updatedAt: Date;
  closedAt: Date | null;
}

export type MessageAuthor = 'PLAYER' | 'ADMIN' | 'ASSISTANT' | 'SYSTEM';

export interface ComplaintMessage {
  id: string;
  complaintId: string;
  authorType: MessageAuthor;
  authorId: UserId | null;
  body: string;
  visibility: 'PUBLIC' | 'INTERNAL';
  createdAt: Date;
}

export type ComplaintEventType =
  | 'CREATED'
  | 'STATUS_CHANGED'
  | 'MESSAGE_ADDED'
  | 'INFO_REQUESTED'
  | 'ATTACHMENT_ADDED'
  | 'ASSIGNED'
  | 'PRIORITY_CHANGED'
  | 'DECISION_RECORDED'
  | 'REOPENED'
  | 'AI_ANALYSIS_COMPLETED'
  | 'AI_ANALYSIS_UNAVAILABLE';

export interface ComplaintEvent {
  id: string;
  complaintId: string;
  type: ComplaintEventType;
  actorType: MessageAuthor;
  actorId: UserId | null;
  fromStatus: ComplaintStatus | null;
  toStatus: ComplaintStatus | null;
  details: Record<string, unknown>;
  createdAt: Date;
}

export interface ComplaintCheck {
  id: string;
  complaintId: string;
  tool: string;
  outcome: 'FOUND' | 'NOT_FOUND' | 'ERROR';
  facts: Record<string, unknown>;
  source: 'ASSISTANT' | 'SYSTEM';
  createdAt: Date;
}

export interface ComplaintAttachmentMeta {
  id: string;
  complaintId: string;
  uploaderType: 'PLAYER' | 'ADMIN';
  contentType: AttachmentType;
  sizeBytes: number;
  createdAt: Date;
}

// --- Erreurs ---------------------------------------------------------------------------------

/** Dossier inconnu OU appartenant à un autre joueur (aucune distinction : pas de fuite). */
export class ComplaintNotFoundError extends Error {
  constructor() {
    super('Réclamation introuvable.');
    this.name = 'ComplaintNotFoundError';
  }
}

export class InvalidComplaintTransitionError extends Error {
  constructor(
    readonly from: ComplaintStatus,
    readonly to: ComplaintStatus,
  ) {
    super(`Transition ${from} → ${to} refusée.`);
    this.name = 'InvalidComplaintTransitionError';
  }
}

/** Le statut a changé depuis la lecture (traitement concurrent) : relire puis décider. */
export class ComplaintConflictError extends Error {
  constructor(readonly current: ComplaintStatus) {
    super('Le dossier a été modifié entre-temps.');
    this.name = 'ComplaintConflictError';
  }
}

export class ComplaintLimitError extends Error {
  constructor(readonly limit: 'ACTIVE_COMPLAINTS' | 'ATTACHMENTS' | 'REOPENS' | 'REOPEN_WINDOW') {
    super(`Limite atteinte : ${limit}`);
    this.name = 'ComplaintLimitError';
  }
}

/** Élément lié (partie, transaction…) inconnu ou n'appartenant pas au joueur. */
export class ComplaintLinkError extends Error {
  constructor(readonly field: keyof ComplaintLinks | 'conversationId') {
    super('Élément introuvable parmi les vôtres.');
    this.name = 'ComplaintLinkError';
  }
}

export class AttachmentRejectedError extends Error {
  constructor(readonly reason: 'TYPE' | 'SIZE' | 'EMPTY' | 'DUPLICATE') {
    super(`Pièce refusée : ${reason}`);
    this.name = 'AttachmentRejectedError';
  }
}

export class NotAnAdministratorError extends Error {
  constructor() {
    super("Ce compte n'est pas un administrateur.");
    this.name = 'NotAnAdministratorError';
  }
}
