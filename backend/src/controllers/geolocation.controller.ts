import type { Request, Response } from 'express';

import type { GameId } from '../domain/game/game-id';
import { playerIdOf } from '../domain/users/user';
import { getAuth } from '../middleware/require-auth';
import type { GeolocationService } from '../services/detection/geolocation.service';
import { parsePositionInput } from '../validators/geolocation.validators';

/**
 * Contrôleurs minces de la géolocalisation (D-046) : valider la forme, identifier le joueur
 * PAR LE JWT, appeler GeolocationService. Les réponses ne contiennent que des distances,
 * jamais de coordonnées.
 */
export function createGeolocationController(geolocation: GeolocationService) {
  return {
    async status(_req: Request, res: Response): Promise<void> {
      res.json(await geolocation.getStatus(gameIdOf(res), currentPlayer(res)));
    },

    async record(req: Request, res: Response): Promise<void> {
      const gameId = gameIdOf(res);
      const input = parsePositionInput(req.body, gameId);
      const distances = await geolocation.recordPosition(gameId, currentPlayer(res), input);
      res.status(201).json({ distances });
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
