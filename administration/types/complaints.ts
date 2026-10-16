/**
 * Réclamations des joueurs (D-114) : miroir des réponses de /api/admin/complaints. Les faits
 * « vérifiés » viennent des tables qui font autorité ; le résumé automatisé n'est jamais un fait.
 */

export type ComplaintStatus =
  'OPEN' | 'AI_ANALYSIS' | 'WAITING_FOR_PLAYER' | 'IN_REVIEW' | 'RESOLVED' | 'REJECTED' | 'CLOSED';

export type ComplaintPriority = 'LOW' | 'NORMAL' | 'HIGH' | 'URGENT';

export interface PersonRef {
  id: string;
  username: string | null;
}

export interface ComplaintRow {
  id: string;
  reference: string;
  category: string;
  suggestedCategory: string | null;
  title: string;
  status: ComplaintStatus;
  priority: ComplaintPriority;
  player: PersonRef;
  assignee: PersonRef | null;
  aiAnalysisStatus: 'PENDING' | 'COMPLETED' | 'UNAVAILABLE';
  createdAt: string;
  updatedAt: string;
}

export interface ComplaintLinks {
  gameId?: string;
  tournamentId?: string;
  walletTransactionId?: string;
  paymentId?: string;
  withdrawalId?: string;
}

export interface AdminComplaintDetail {
  complaint: {
    id: string;
    reference: string;
    category: string;
    suggestedCategory: string | null;
    title: string;
    description: string;
    status: ComplaintStatus;
    priority: ComplaintPriority;
    links: ComplaintLinks;
    incidentAt: string | null;
    decision: string | null;
    decidedAt: string | null;
    decidedBy: PersonRef | null;
    reopenCount: number;
    conversationId: string | null;
    player: PersonRef;
    assignee: PersonRef | null;
    version: number;
    createdAt: string;
    updatedAt: string;
    closedAt: string | null;
  };
  aiAnalysis: { status: 'PENDING' | 'COMPLETED' | 'UNAVAILABLE'; summary: string | null };
  verified: {
    readAt: string;
    game: Record<string, unknown> | null;
    wallet: {
      balance: number;
      reserved: number;
      available: number;
      entries: {
        transactionId: string;
        kind: string;
        status: string;
        tokens: number;
        createdAt: string;
      }[];
    };
    transaction: Record<string, unknown> | null;
    payment: Record<string, unknown> | null;
    withdrawal: Record<string, unknown> | null;
    tournament: Record<string, unknown> | null;
  };
  checks: {
    id: string;
    tool: string;
    outcome: 'FOUND' | 'NOT_FOUND' | 'ERROR';
    source: 'ASSISTANT' | 'SYSTEM';
    facts: Record<string, unknown>;
    createdAt: string;
  }[];
  messages: {
    id: string;
    authorType: 'PLAYER' | 'ADMIN' | 'ASSISTANT' | 'SYSTEM';
    body: string;
    visibility: 'PUBLIC' | 'INTERNAL';
    author: PersonRef | null;
    createdAt: string;
  }[];
  events: {
    id: string;
    type: string;
    actorType: string;
    actor: PersonRef | null;
    fromStatus: ComplaintStatus | null;
    toStatus: ComplaintStatus | null;
    details: Record<string, unknown>;
    createdAt: string;
  }[];
  attachments: {
    id: string;
    contentType: string;
    sizeBytes: number;
    uploaderType: 'PLAYER' | 'ADMIN';
    createdAt: string;
  }[];
}
