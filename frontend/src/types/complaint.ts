/** Réclamations et assistant automatisé (D-114) : miroir des réponses de l'API. */

export const COMPLAINT_CATEGORIES = [
  'GAME_RESULT',
  'BALANCE',
  'PAYMENT',
  'WITHDRAWAL',
  'TOURNAMENT',
  'TOURNAMENT_REWARD',
  'TECHNICAL',
  'FRAUD',
  'ACCOUNT_SECURITY',
  'OTHER',
] as const;
export type ComplaintCategory = (typeof COMPLAINT_CATEGORIES)[number];

export type ComplaintStatus =
  'OPEN' | 'AI_ANALYSIS' | 'WAITING_FOR_PLAYER' | 'IN_REVIEW' | 'RESOLVED' | 'REJECTED' | 'CLOSED';

export type NextStep =
  'ANALYSIS' | 'SUPPORT_REVIEW' | 'PLAYER_REPLY_EXPECTED' | 'DECISION_RENDERED' | 'NONE';

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
  category: ComplaintCategory;
  title: string;
  description: string;
  status: ComplaintStatus;
  priority: string;
  links: ComplaintLinks;
  incidentAt: string | null;
  decision: string | null;
  decidedAt: string | null;
  reopenCount: number;
  canReopen: boolean;
  canReply: boolean;
  nextStep: NextStep;
  createdAt: string;
  updatedAt: string;
  closedAt: string | null;
}

export interface ComplaintMessage {
  id: string;
  authorType: 'PLAYER' | 'ADMIN' | 'ASSISTANT' | 'SYSTEM';
  body: string;
  visibility: 'PUBLIC' | 'INTERNAL';
  createdAt: string;
}

export interface ComplaintEvent {
  id: string;
  type: string;
  actorType: string;
  fromStatus: ComplaintStatus | null;
  toStatus: ComplaintStatus | null;
  createdAt: string;
}

export interface ComplaintAttachment {
  id: string;
  contentType: string;
  sizeBytes: number;
  uploaderType: 'PLAYER' | 'ADMIN';
  createdAt: string;
}

export interface ComplaintDetail {
  complaint: Complaint;
  messages: ComplaintMessage[];
  events: ComplaintEvent[];
  attachments: ComplaintAttachment[];
  checks: { tool: string; outcome: string; createdAt: string }[];
}

export interface ComplaintDraft {
  category: ComplaintCategory;
  title: string;
  description: string;
  links: ComplaintLinks;
  recommended: boolean;
}

export interface SupportMessage {
  id: string;
  role: 'PLAYER' | 'ASSISTANT';
  content: string;
  createdAt: string;
  meta?: {
    mode: 'AI' | 'DEGRADED';
    category: ComplaintCategory | null;
    /** Faits vérifiés par le serveur, distincts du texte de l'assistant. */
    verified: string[];
    checks: { tool: string; outcome: string }[];
    needsHuman: boolean;
    draft: ComplaintDraft | null;
    greeting: boolean;
  };
}

export interface SupportConversation {
  id: string;
  status: 'ACTIVE' | 'CLOSED';
  language: 'fr' | 'en';
  playerTurns: number;
  maxTurns: number;
  createdAt: string;
}

export interface SupportState {
  conversation: SupportConversation | null;
  messages: SupportMessage[];
}

export interface CreateComplaintPayload {
  category: ComplaintCategory;
  title: string;
  description: string;
  links?: ComplaintLinks;
  conversationId?: string;
}
