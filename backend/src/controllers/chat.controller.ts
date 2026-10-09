import type { Request, Response } from 'express';

import { toChatMessageJson } from '../domain/chat/chat';
import type { GameId } from '../domain/game/game-id';
import { playerIdOf } from '../domain/users/user';
import { getAuth } from '../middleware/require-auth';
import type { ChatService } from '../services/chat/chat.service';
import { parseChatMessageInput, parseChatPageQuery } from '../validators/chat.validators';

/**
 * Contrôleurs minces du chat (D-045) : valider la forme, identifier le joueur PAR LE JWT,
 * appeler ChatService. Ni SQL, ni Redis, ni GameService ici.
 */
export function createChatController(chat: ChatService) {
  return {
    async list(req: Request, res: Response): Promise<void> {
      const history = await chat.listMessages(
        gameIdOf(res),
        currentPlayer(res),
        parseChatPageQuery(req.query),
      );
      res.json({ ...history, messages: history.messages.map(toChatMessageJson) });
    },

    async send(req: Request, res: Response): Promise<void> {
      const input = parseChatMessageInput(req.body, req.get('idempotency-key'));
      const { message, replayed } = await chat.sendMessage(
        gameIdOf(res),
        currentPlayer(res),
        input,
      );
      if (replayed) {
        res.setHeader('Idempotent-Replayed', 'true');
      }
      res.status(replayed ? 200 : 201).json({ message: toChatMessageJson(message) });
    },
  };
}

function currentPlayer(res: Response) {
  return playerIdOf(getAuth(res).userId);
}

function gameIdOf(res: Response): GameId {
  const { gameId } = res.locals;
  if (!gameId) {
    throw new Error('gameId absent : route sans paramètre :gameId validé');
  }
  return gameId;
}
