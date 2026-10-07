import type { Request, Response } from 'express';

import type { GameId } from '../domain/game/game-id';
import { toPlayerView } from '../domain/game/game-view';
import { withServerTime } from './server-time';
import { playerIdOf } from '../domain/users/user';
import { getAuth } from '../middleware/require-auth';
import { getRequestId } from '../middleware/request-id';
import type { GameService } from '../services/game/game.service';
import type { SessionService } from '../services/sessions/session.service';
import {
  parseCreateGameInput,
  parseGameActionInput,
  parseIdempotencyKey,
  parseJoinGameInput,
  parseStartGameInput,
} from '../validators/game.validators';

/**
 * Contrôleurs minces des parties (D-030) : valider la forme, identifier le joueur
 * PAR LE JWT, appeler GameService, renvoyer la VUE du joueur.
 *
 * Ils ne lisent ni n'écrivent jamais l'état d'une partie eux-mêmes (pas de dépôt ici) et
 * ne renvoient jamais l'agrégat `Game` brut : il contient les mains de tous les joueurs.
 */
export function createGameController(games: GameService, sessions: SessionService) {
  return {
    async create(req: Request, res: Response): Promise<void> {
      const playerId = currentPlayer(res);
      const creationKey = parseIdempotencyKey(req.get('idempotency-key'));
      const input = parseCreateGameInput(req.body);
      // Une partie appartient toujours à une session (D-033) : sans session indiquée, la
      // création ouvre une session dont cette partie est la première (créateur = J1).
      const { game, replayed } = await sessions.createSession(
        playerId,
        { ...input, creationKey },
        { requestId: getRequestId(res) },
      );
      if (replayed) {
        // Même réponse que la première fois ; l'en-tête signale le rejeu.
        res.setHeader('Idempotent-Replayed', 'true');
      }
      res.status(201).json({ game: withServerTime(toPlayerView(game, playerId)) });
    },

    async listActive(_req: Request, res: Response): Promise<void> {
      res.json({
        games: (await games.findActiveGamesForPlayer(currentPlayer(res))).map(withServerTime),
      });
    },

    async get(_req: Request, res: Response): Promise<void> {
      res.json({
        game: withServerTime(await games.getGameForPlayer(gameIdOf(res), currentPlayer(res))),
      });
    },

    async join(req: Request, res: Response): Promise<void> {
      const playerId = currentPlayer(res);
      const { commandId } = parseJoinGameInput(req.body);
      const game = await games.joinGame(gameIdOf(res), playerId, {
        commandId,
        requestId: getRequestId(res),
      });
      res.json({ game: withServerTime(toPlayerView(game, playerId)) });
    },

    /** Seul le créateur démarre ; l'identité est celle du JWT (R-23). */
    async start(req: Request, res: Response): Promise<void> {
      const playerId = currentPlayer(res);
      const { commandId } = parseStartGameInput(req.body);
      const game = await games.startGame(gameIdOf(res), playerId, {
        commandId,
        requestId: getRequestId(res),
      });
      res.json({ game: withServerTime(toPlayerView(game, playerId)) });
    },

    async act(req: Request, res: Response): Promise<void> {
      const playerId = currentPlayer(res);
      const gameId = gameIdOf(res);
      const { commandId, expectedVersion, action } = parseGameActionInput(req.body);
      const meta = { commandId, expectedVersion, requestId: getRequestId(res) };

      const game = await (action.type === 'PLAY_CARD'
        ? games.playCard(gameId, playerId, action.cardId, meta)
        : action.type === 'DECLARE_WIN'
          ? games.declareWin(gameId, playerId, meta)
          : games.flee(gameId, playerId, meta));
      res.json({ game: withServerTime(toPlayerView(game, playerId)) });
    },
  };
}

/** Le joueur qui agit : TOUJOURS le titulaire du JWT, jamais un champ de la requête. */
function currentPlayer(res: Response) {
  return playerIdOf(getAuth(res).userId);
}

/** `:gameId` validé par le paramètre du routeur (routes/game.routes.ts). */
function gameIdOf(res: Response): GameId {
  const { gameId } = res.locals;
  if (!gameId) {
    throw new Error('gameId absent : route sans paramètre :gameId validé');
  }
  return gameId;
}
