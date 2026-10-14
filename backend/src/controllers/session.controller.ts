import type { Request, Response } from 'express';

import { toPlayerView } from '../domain/game/game-view';
import { withServerTime } from './server-time';
import { pendingDecisions, seatMap, type SessionId } from '../domain/sessions/session';
import { playerIdOf } from '../domain/users/user';
import { getAuth } from '../middleware/require-auth';
import { getRequestId } from '../middleware/request-id';
import type { SessionService, SessionSnapshot } from '../services/sessions/session.service';
import {
  parseCreateSessionInput,
  parseIdempotencyKey,
  parseJoinSessionInput,
  parseNextGameInput,
  parseSessionDecisionInput,
} from '../validators/game.validators';

/**
 * Contrôleurs minces des sessions (D-033) : forme de la requête, identité issue du JWT,
 * appel de SessionService, vue publique (aucune carte, aucune donnée de compte).
 */
export function createSessionController(sessions: SessionService) {
  return {
    /** Nouvelle session + sa première partie (le créateur est J1). */
    async create(req: Request, res: Response): Promise<void> {
      const playerId = currentPlayer(res);
      const creationKey = parseIdempotencyKey(req.get('idempotency-key'));
      const { session, game, replayed } = await sessions.createSession(
        playerId,
        { ...parseCreateSessionInput(req.body), creationKey },
        { requestId: getRequestId(res) },
      );
      if (replayed) {
        res.setHeader('Idempotent-Replayed', 'true');
      }
      res.status(201).json({
        session: toSessionView({ session, lastGame: null }),
        game: withServerTime(toPlayerView(game, playerId)),
      });
    },

    async listMine(_req: Request, res: Response): Promise<void> {
      const mine = await sessions.findActiveSessions(currentPlayer(res));
      res.json({ sessions: mine.map((session) => toSessionView({ session, lastGame: null })) });
    },

    /** Tables ouvertes (partie en attente, siège libre) ; la mienne est marquée `mine`. */
    async listOpen(_req: Request, res: Response): Promise<void> {
      const [tables, detectionAvailable] = await Promise.all([
        sessions.listOpenTables(currentPlayer(res)),
        sessions.isDetectionAvailable(),
      ]);
      // `detectionAvailable` : l'option « Détection anti-collusion » est-elle proposée (D-081) ?
      res.json({ tables, detectionAvailable });
    },

    async get(_req: Request, res: Response): Promise<void> {
      res.json({
        session: toSessionView(await sessions.getSession(sessionIdOf(res), currentPlayer(res))),
      });
    },

    async join(req: Request, res: Response): Promise<void> {
      const playerId = currentPlayer(res);
      const { password } = parseJoinSessionInput(req.body);
      await sessions.joinSession(
        sessionIdOf(res),
        playerId,
        { requestId: getRequestId(res) },
        password,
      );
      res.json({ session: toSessionView(await sessions.getSession(sessionIdOf(res), playerId)) });
    },

    /** Quitter (R-19, D-037) : `session: null` si le dernier départ l'a supprimée (Q1). */
    async leave(_req: Request, res: Response): Promise<void> {
      const playerId = currentPlayer(res);
      const { deleted } = await sessions.leaveSession(sessionIdOf(res), playerId, {
        requestId: getRequestId(res),
      });
      if (deleted) {
        res.json({ session: null });
        return;
      }
      res.json({ session: toSessionView(await sessions.getSession(sessionIdOf(res), playerId)) });
    },

    /** Poursuivre / Quitter entre deux parties (D-034). */
    async decide(req: Request, res: Response): Promise<void> {
      const playerId = currentPlayer(res);
      const { choice } = parseSessionDecisionInput(req.body);
      await sessions.decide(sessionIdOf(res), playerId, choice, { requestId: getRequestId(res) });
      res.json({ session: toSessionView(await sessions.getSession(sessionIdOf(res), playerId)) });
    },

    async listGames(_req: Request, res: Response): Promise<void> {
      res.json({ games: await sessions.listGames(sessionIdOf(res), currentPlayer(res)) });
    },

    /** Partie suivante de la session (J1 calculé par le serveur). */
    async createGame(req: Request, res: Response): Promise<void> {
      const playerId = currentPlayer(res);
      const creationKey = parseIdempotencyKey(req.get('idempotency-key'));
      const { game, replayed } = await sessions.createNextGame(
        sessionIdOf(res),
        playerId,
        { ...parseNextGameInput(req.body), creationKey },
        { requestId: getRequestId(res) },
      );
      if (replayed) {
        res.setHeader('Idempotent-Replayed', 'true');
      }
      res.status(201).json({ game: withServerTime(toPlayerView(game, playerId)) });
    },
  };
}

/**
 * Vue d'une session (D-034) : sièges FIXES (0 … maxPlayers-1, sens antihoraire) avec leur
 * occupant ou `null` (siège vacant), historique des joueurs, partie courante, ronde de
 * décision. `serverNow` permet au client d'afficher un compte à rebours fidèle à l'heure du
 * serveur ; il ne décide jamais d'une expiration.
 */
export function toSessionView({ session, lastGame, viewerCanContinue }: SessionSnapshot) {
  const round = session.round;
  return {
    sessionId: session.id,
    version: session.version,
    status: session.status,
    creatorId: session.creatorId,
    maxPlayers: session.maxPlayers,
    ...(session.name !== undefined && { name: session.name }),
    // Le hash ne quitte jamais le serveur : seulement l'existence d'un mot de passe.
    hasPassword: session.passwordHash !== undefined,
    suspicionDetectionEnabled: session.suspicionDetectionEnabled,
    seats: seatMap(session).map((playerId, seat) => ({ seat, playerId: playerId ?? null })),
    players: [...session.players]
      .sort((a, b) => Number(b.active) - Number(a.active) || a.seat - b.seat)
      .map((p) => ({
        playerId: p.playerId,
        seat: p.seat,
        active: p.active,
        joinedAt: p.joinedAt,
        ...(p.leftAt && { leftAt: p.leftAt }),
      })),
    currentGame:
      lastGame && lastGame.status !== 'finished'
        ? { gameId: lastGame.gameId, status: lastGame.status, playerIds: lastGame.playerIds }
        : null,
    decision: round
      ? {
          gameId: round.gameId,
          deadlineAt: round.deadlineAt,
          open: !round.resolvedAt,
          ...(round.resolvedAt && { resolvedAt: round.resolvedAt }),
          decisions: Object.entries(round.decisions).map(([playerId, d]) => ({
            playerId,
            choice: d.choice,
            decidedAt: d.decidedAt,
          })),
          pendingPlayerIds: pendingDecisions(session),
          // Pour le joueur qui lit la vue : « Poursuivre » permis (D-073) ; absent = inconnu.
          ...(viewerCanContinue !== undefined && { canContinue: viewerCanContinue }),
        }
      : null,
    createdAt: session.createdAt,
    ...(session.closedAt && { closedAt: session.closedAt }),
    serverNow: new Date(),
  };
}

function currentPlayer(res: Response) {
  return playerIdOf(getAuth(res).userId);
}

function sessionIdOf(res: Response): SessionId {
  const { sessionId } = res.locals;
  if (!sessionId) {
    throw new Error('sessionId absent : route sans paramètre :sessionId validé');
  }
  return sessionId;
}
