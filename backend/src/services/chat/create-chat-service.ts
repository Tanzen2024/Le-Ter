import type { RedisConnections } from '../../config/redis';
import type { SqlClient } from '../../database/sql-client';
import { PostgresChatRepository } from '../../repositories/postgres-chat.repository';
import type { Logger } from '../../utils/logger';
import { InMemoryChatEventHub, PubSubChatEventBus } from '../../websocket/chat-event-bus';
import { RedisPubSubTransport } from '../../websocket/pubsub-transport';
import { ChatService } from './chat.service';

/**
 * Assemble le chat de partie (D-045), à côté de GameService et sans en dépendre :
 *
 *   ChatService → PostgresChatRepository → PostgreSQL (historique, source de vérité)
 *   ChatService → PubSubChatEventBus → Redis Pub/Sub (InMemoryChatEventHub sans Redis)
 */
export function createChatService(options: {
  sql: SqlClient;
  redis?: RedisConnections;
  logger: Logger;
}): ChatService {
  const bus = options.redis
    ? new PubSubChatEventBus(
        new RedisPubSubTransport(options.redis.client, options.redis.subscriber),
        options.logger,
      )
    : new InMemoryChatEventHub();
  return new ChatService({
    repository: new PostgresChatRepository(options.sql),
    bus,
    logger: options.logger,
  });
}
