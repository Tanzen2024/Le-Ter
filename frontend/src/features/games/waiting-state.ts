import type { GameView } from '../../types/game';
import { MIN_PLAYERS_TO_START } from './hooks';

/**
 * Attente d'une table de tournoi (D-065), dérivée UNIQUEMENT de la vue du serveur :
 * - `alone` : moins de 2 joueurs, aucun compte à rebours, aucun bouton ;
 * - `ready` : 2 joueurs ou plus ; `canStartManually` seulement pour le premier joueur
 *   affecté (créateur de la partie, désigné par le serveur), jusqu'au démarrage.
 */
export type TournamentWaitingState =
  { kind: 'alone' } | { kind: 'ready'; canStartManually: boolean };

export function tournamentWaitingState(
  game: Pick<GameView, 'status' | 'players' | 'creatorId' | 'viewerId'>,
): TournamentWaitingState {
  if (game.status !== 'waiting' || game.players.length < MIN_PLAYERS_TO_START) {
    return { kind: 'alone' };
  }
  return { kind: 'ready', canStartManually: game.creatorId === game.viewerId };
}
