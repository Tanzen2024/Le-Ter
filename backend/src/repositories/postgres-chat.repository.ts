import type { SqlExecutor } from '../database/sql-client';
import type { ChatMessage, ChatMessageId } from '../domain/chat/chat';
import type { GameStatus } from '../domain/game/game';
import type { GameId, PlayerId } from '../domain/game/game-id';
import type {
  ChatAccess,
  ChatPageQuery,
  ChatRepository,
  NewChatMessage,
  StoredChatMessage,
} from './chat.repository';

interface MessageRow {
  id: string;
  game_id: string;
  sender_id: string;
  sender_display_name: string;
  content: string;
  created_at: Date | string;
}

function toMessage(row: MessageRow): ChatMessage {
  return {
    id: row.id as ChatMessageId,
    gameId: row.game_id as GameId,
    senderId: row.sender_id as PlayerId,
    senderDisplayName: row.sender_display_name,
    content: row.content,
    createdAt: new Date(row.created_at),
  };
}

/** Colonnes d'un message avec le pseudo public de l'expéditeur (jamais d'autre donnée de compte). */
const MESSAGE_COLUMNS = `m.id, m.game_id, m.sender_id, u.username AS sender_display_name,
  m.content, m.created_at`;

/**
 * Chat de partie sur PostgreSQL (migration 0013). Requêtes paramétrées uniquement ; aucun
 * verrou sur `games` : le chat ne ralentit jamais une commande de jeu (D-045).
 *
 * Ordre total des messages d'une partie : (created_at, id), servi par l'index
 * `game_chat_messages_game_created_idx`.
 */
export class PostgresChatRepository implements ChatRepository {
  constructor(private readonly db: SqlExecutor) {}

  async findAccess(gameId: GameId, playerId: PlayerId): Promise<ChatAccess | null> {
    const { rows } = await this.db.query<{ status: GameStatus; is_player: boolean }>(
      `SELECT g.status,
         EXISTS (SELECT 1 FROM game_players gp WHERE gp.game_id = g.id AND gp.player_id = $2)
           AS is_player
       FROM games g WHERE g.id = $1`,
      [gameId, playerId],
    );
    const row = rows[0];
    return row ? { status: row.status, isPlayer: row.is_player } : null;
  }

  async findByClientMessageId(
    gameId: GameId,
    senderId: PlayerId,
    clientMessageId: string,
  ): Promise<StoredChatMessage | null> {
    const { rows } = await this.db.query<MessageRow>(
      `SELECT ${MESSAGE_COLUMNS}
       FROM game_chat_messages m JOIN users u ON u.id = m.sender_id
       WHERE m.game_id = $1 AND m.sender_id = $2 AND m.client_message_id = $3`,
      [gameId, senderId, clientMessageId],
    );
    return rows[0] ? toMessage(rows[0]) : null;
  }

  async insert(message: NewChatMessage): Promise<ChatMessage | null> {
    // Appartenance et statut vérifiés DANS l'insertion : un joueur retiré de la partie ou une
    // partie terminée entre la vérification du service et l'écriture n'enregistre rien.
    const { rows } = await this.db.query<MessageRow>(
      `WITH inserted AS (
         INSERT INTO game_chat_messages
           (id, game_id, sender_id, content, client_message_id, created_at)
         SELECT $1, g.id, gp.player_id, $4, $5, $6
         FROM games g
         JOIN game_players gp ON gp.game_id = g.id AND gp.player_id = $3
         WHERE g.id = $2 AND g.status <> 'finished'
         ON CONFLICT (game_id, sender_id, client_message_id) DO NOTHING
         RETURNING *
       )
       SELECT ${MESSAGE_COLUMNS} FROM inserted m JOIN users u ON u.id = m.sender_id`,
      [
        message.id,
        message.gameId,
        message.senderId,
        message.content,
        message.clientMessageId,
        message.createdAt.toISOString(),
      ],
    );
    return rows[0] ? toMessage(rows[0]) : null;
  }

  async listPage(
    gameId: GameId,
    { before, after, limit }: ChatPageQuery,
  ): Promise<{ messages: ChatMessage[]; hasMore: boolean } | undefined> {
    const cursorId = before ?? after;
    let cursor: { created_at: Date | string; id: string } | undefined;
    if (cursorId) {
      const { rows } = await this.db.query<{ created_at: Date | string; id: string }>(
        'SELECT created_at, id FROM game_chat_messages WHERE id = $1 AND game_id = $2',
        [cursorId, gameId],
      );
      cursor = rows[0];
      if (!cursor) {
        return undefined;
      }
    }

    // `after` : les plus anciens d'abord (rattrapage dans l'ordre) ; sinon les plus récents
    // d'abord (dernière page, ou page précédant `before`), remis dans l'ordre chronologique.
    const forward = after !== undefined;
    const params: unknown[] = [gameId, limit + 1];
    let range = '';
    if (cursor) {
      params.push(new Date(cursor.created_at).toISOString(), cursor.id);
      range = `AND (m.created_at, m.id) ${forward ? '>' : '<'} ($3::timestamptz, $4::uuid)`;
    }
    const order = forward ? 'ASC' : 'DESC';
    const { rows } = await this.db.query<MessageRow>(
      `SELECT ${MESSAGE_COLUMNS}
       FROM game_chat_messages m JOIN users u ON u.id = m.sender_id
       WHERE m.game_id = $1 ${range}
       ORDER BY m.created_at ${order}, m.id ${order}
       LIMIT $2`,
      params,
    );
    const hasMore = rows.length > limit;
    const page = rows.slice(0, limit).map(toMessage);
    return { messages: forward ? page : page.reverse(), hasMore };
  }
}
