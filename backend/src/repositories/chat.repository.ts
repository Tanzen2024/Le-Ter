import type { ChatMessage, ChatMessageId } from '../domain/chat/chat';
import type { GameStatus } from '../domain/game/game';
import type { GameId, PlayerId } from '../domain/game/game-id';

/** Ce que le chat doit savoir d'une partie pour un joueur : son statut, et s'il y joue. */
export interface ChatAccess {
  status: GameStatus;
  isPlayer: boolean;
}

/** Message à enregistrer ; le pseudo de l'expéditeur est lu en base, jamais reçu du client. */
export interface NewChatMessage {
  id: ChatMessageId;
  gameId: GameId;
  senderId: PlayerId;
  content: string;
  /** Clé d'envoi du client : un renvoi (double appui, coupure) ne crée pas un second message. */
  clientMessageId: string;
  createdAt: Date;
}

/** Message existant pour une clé d'envoi, avec le contenu pour détecter une réutilisation. */
export type StoredChatMessage = ChatMessage;

export interface ChatPageQuery {
  /** Messages plus anciens que ce message (pagination vers le passé). */
  before?: ChatMessageId;
  /** Messages plus récents que ce message (rattrapage après reconnexion). */
  after?: ChatMessageId;
  /** Nombre de lignes demandées ; le dépôt en lit une de plus pour `hasMore`. */
  limit: number;
}

/**
 * Port de persistance du chat (D-045). Isolé par `gameId` : toute lecture et toute
 * écriture portent sur UNE partie. Aucune dépendance au moteur de jeu.
 */
export interface ChatRepository {
  /** `null` : partie inexistante. */
  findAccess(gameId: GameId, playerId: PlayerId): Promise<ChatAccess | null>;

  findByClientMessageId(
    gameId: GameId,
    senderId: PlayerId,
    clientMessageId: string,
  ): Promise<StoredChatMessage | null>;

  /**
   * Enregistre le message si l'expéditeur est TOUJOURS joueur de la partie et qu'elle n'est
   * pas terminée (vérifié dans la même instruction SQL). `null` : refusé, ou clé d'envoi
   * déjà enregistrée par un envoi concurrent ; l'appelant relit pour savoir lequel.
   */
  insert(message: NewChatMessage): Promise<ChatMessage | null>;

  /** `undefined` : le curseur n'est pas un message de CETTE partie. */
  listPage(
    gameId: GameId,
    query: ChatPageQuery,
  ): Promise<{ messages: ChatMessage[]; hasMore: boolean } | undefined>;
}
