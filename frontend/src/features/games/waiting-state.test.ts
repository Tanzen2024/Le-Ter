import type { PlayerInGame } from '../../types/game';
import { tournamentWaitingState } from './waiting-state';

const player = (playerId: string): PlayerInGame =>
  ({ playerId, seat: 0, joinedAt: '2026-10-12T16:00:00.000Z' }) as PlayerInGame;
const game = (players: string[], viewerId: string) => ({
  status: 'waiting' as const,
  players: players.map(player),
  creatorId: 'ana',
  viewerId,
});

describe('tournamentWaitingState : table de tournoi en attente (D-065)', () => {
  it('un joueur seul : attente, ni compte à rebours ni bouton', () => {
    expect(tournamentWaitingState(game(['ana'], 'ana'))).toEqual({ kind: 'alone' });
  });

  it('dès 2 joueurs : bouton seulement chez le premier joueur affecté (créateur)', () => {
    expect(tournamentWaitingState(game(['ana', 'ben'], 'ana'))).toEqual({
      kind: 'ready',
      canStartManually: true,
    });
    expect(tournamentWaitingState(game(['ana', 'ben', 'cid'], 'ben'))).toEqual({
      kind: 'ready',
      canStartManually: false,
    });
  });
});
