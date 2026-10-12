/**
 * Chat de partie (D-045) tel que l'API l'envoie. `senderId` sert uniquement à reconnaître
 * ses propres messages : il n'est jamais affiché. `content` est du texte brut.
 */
export interface ChatMessage {
  id: string;
  gameId: string;
  senderId: string;
  senderDisplayName: string;
  content: string;
  createdAt: string;
}

/** Page d'historique (du plus ancien au plus récent) et état d'envoi décidé par le serveur. */
export interface ChatHistory {
  messages: ChatMessage[];
  hasMore: boolean;
  /** Faux quand la partie est terminée, ou quand le chat du joueur est restreint. */
  canSend: boolean;
  /** Restriction du chat par l'administration (D-079) ; `endsAt` null : indéterminée. */
  restriction?: { endsAt: string | null } | null;
  /** Limite de longueur d'un message : valeur du serveur, jamais recopiée ici. */
  maxMessageLength: number;
}

/** Événement temps réel `chat:message` (salle `game:{gameId}:chat`). */
export interface ChatMessageEvent {
  type: 'chat:message';
  gameId: string;
  message: ChatMessage;
}
