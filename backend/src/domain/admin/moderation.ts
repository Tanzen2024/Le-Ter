import type { UserId } from '../users/user';

/**
 * Gestion des joueurs par l'administration (D-079, docs/admin/MODERATION.md).
 *
 * - Désactivation : `users.status = 'disabled'` (mécanisme existant de D-029), sans échéance.
 * - Suspension : mesure de modération temporaire ou indéterminée, levable ; même effet sur
 *   l'accès (connexion, renouvellement, chaque requête HTTP et WebSocket refusés) mais
 *   indépendante du statut : son expiration ne réactive jamais un compte désactivé.
 * - Restriction du chat : seul l'envoi de messages est refusé.
 * - Avertissement : enregistré, et transmis au joueur par une notification dans
 *   l'application quand un message visible est saisi.
 *
 * Aucune de ces mesures ne touche une partie, un solde, une transaction ni `platform_ledger`.
 */
export const SANCTION_KINDS = ['SUSPENSION', 'CHAT_RESTRICTION', 'WARNING'] as const;
export type SanctionKind = (typeof SANCTION_KINDS)[number];
/** Mesures qui ont une durée et peuvent être levées. */
export type RestrictionKind = Exclude<SanctionKind, 'WARNING'>;

export const MODERATION_LIMITS = {
  reason: { min: 3, max: 500 },
  comment: { max: 2000 },
  playerMessage: { max: 1000 },
  note: { max: 2000 },
  /** Durée maximale d'une mesure temporaire ; au-delà, choisir « indéterminée ». */
  maxDurationDays: 365,
  /** Durée minimale d'une mesure temporaire. */
  minDurationMinutes: 5,
} as const;

export interface Sanction {
  id: string;
  userId: UserId;
  kind: SanctionKind;
  reason: string;
  comment: string | null;
  playerMessage: string | null;
  notificationId: string | null;
  startsAt: Date;
  endsAt: Date | null;
  createdBy: UserId;
  createdByUsername: string | null;
  createdAt: Date;
  liftedAt: Date | null;
  liftedBy: UserId | null;
  liftedByUsername: string | null;
  liftReason: string | null;
}

export type SanctionState = 'ACTIVE' | 'EXPIRED' | 'LIFTED' | 'RECORDED';

/** État d'une mesure à l'heure du serveur `now` ; jamais stocké, donc jamais périmé. */
export function sanctionState(
  s: Pick<Sanction, 'kind' | 'endsAt' | 'liftedAt'>,
  now: Date,
): SanctionState {
  if (s.kind === 'WARNING') return 'RECORDED';
  if (s.liftedAt) return 'LIFTED';
  if (s.endsAt && s.endsAt.getTime() <= now.getTime()) return 'EXPIRED';
  return 'ACTIVE';
}

export interface AdminNote {
  id: string;
  userId: UserId;
  authorId: UserId;
  authorUsername: string | null;
  body: string;
  createdAt: Date;
  deletedAt: Date | null;
  deletedBy: UserId | null;
  deletedByUsername: string | null;
  deleteReason: string | null;
}

/** Action refusée par une règle de protection des comptes d'administration. */
export class ModerationForbiddenError extends Error {
  constructor(readonly reason: 'SELF_ACTION' | 'LAST_ADMIN') {
    super(reason === 'SELF_ACTION' ? 'Action interdite sur son propre compte' : 'Dernier admin');
    this.name = 'ModerationForbiddenError';
  }
}

/** Action incompatible avec l'état courant du joueur (mesure déjà active, aucune à lever…). */
export class ModerationConflictError extends Error {
  constructor(
    readonly code:
      | 'ALREADY_SUSPENDED'
      | 'ALREADY_CHAT_RESTRICTED'
      | 'NOT_SUSPENDED'
      | 'NOT_CHAT_RESTRICTED'
      | 'NOTE_ALREADY_DELETED',
  ) {
    super(code);
    this.name = 'ModerationConflictError';
  }
}

/** Note inconnue ou appartenant à un autre joueur. */
export class AdminNoteNotFoundError extends Error {
  constructor() {
    super('Note introuvable');
    this.name = 'AdminNoteNotFoundError';
  }
}
