import type { GameRepository } from '../../repositories/game.repository';
import type { ParticipationPolicy } from './game.service';

/**
 * R-18 (TRANCHÉE, D-031) : un joueur peut avoir plusieurs parties historiques, mais une
 * seule partie ACTIVE (waiting ou in_progress) à la fois. Une partie finished ne bloque pas.
 *
 * Cette vérification donne une réponse claire avant d'écrire. Elle ne suffit pas en
 * concurrence (deux adhésions à deux parties différentes ne passent pas par la même
 * file) : la garantie est l'index unique partiel `game_players_one_active_game_per_player`
 * de PostgreSQL (migration 0004), vérifié dans la transaction d'écriture.
 *
 * Un joueur qui a fui reste membre de sa partie jusqu'à la fin de celle-ci : la question
 * de rejoindre une autre partie juste après une fuite (R-20) reste ouverte.
 */
export function singleActiveGameParticipation(repository: GameRepository): ParticipationPolicy {
  return {
    canJoin: async (playerId, game) => {
      const active = await repository.findActiveByPlayer(playerId);
      return active.every((other) => other.id === game.id);
    },
  };
}
