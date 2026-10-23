/// <reference types="jest" />
import type { GameView } from '../../../types/game';
import { arrangeSeats, type SeatSide } from './table-layout';

/**
 * Perspective de la table (Fap-Fap et GARAM TIA) : le joueur connecté est toujours en bas
 * (0°), les autres joueurs de la partie autour de lui, sens antihoraire (droite 90°, haut
 * 180°, gauche 270°), quels que soient son siège fixe et son ordre d'arrivée.
 */

const player = (playerId: string, seat: number, tablePosition = seat) => ({
  playerId,
  seat,
  tablePosition,
  joinedAt: '2026-10-14T10:00:00.000Z',
});

function view(
  viewerId: string,
  players: GameView['players'],
  overrides: Partial<GameView> = {},
): GameView {
  return {
    gameId: 'g-1',
    gameType: 'TER',
    firstPlayerId: players[0]!.playerId,
    version: 1,
    status: 'in_progress',
    creatorId: players[0]!.playerId,
    maxPlayers: 4,
    players,
    viewerId,
    createdAt: '2026-10-14T10:00:00.000Z',
    ...overrides,
  } as GameView;
}

const sidesOf = (game: GameView) =>
  Object.fromEntries(arrangeSeats(game).map((s) => [s.side, s.player?.playerId ?? null])) as Record<
    SeatSide,
    string | null
  >;

describe('perspective de la table (joueur connecté en bas)', () => {
  it('A — 2 joueurs à une table de 3 : l’adversaire est en face, pas sur le côté', () => {
    const game = view('bep', [player('bep', 0), player('hugo', 1)], { maxPlayers: 3 });
    expect(sidesOf(game)).toEqual({ bottom: 'bep', top: 'hugo' });
  });

  it('A — 2 joueurs à une table de 4 (sièges 0 et 3) : l’adversaire est en face', () => {
    const game = view('b', [player('a', 0), player('b', 1, 3)]);
    expect(sidesOf(game)).toEqual({ bottom: 'b', top: 'a' });
  });

  it('B — 3 joueurs : bas, droite, gauche, aucun siège partagé', () => {
    const game = view('b', [player('a', 0), player('b', 1), player('c', 2)], { maxPlayers: 3 });
    expect(sidesOf(game)).toEqual({ bottom: 'b', right: 'c', left: 'a' });
  });

  it('B — 3 joueurs à une table de 4 : le siège vide n’est pas dessiné', () => {
    const game = view('a', [player('a', 0), player('b', 1), player('d', 3)]);
    expect(sidesOf(game)).toEqual({ bottom: 'a', right: 'b', left: 'd' });
  });

  it('C — 4 joueurs : moi en bas, puis droite, haut, gauche', () => {
    const four = ['j1', 'j2', 'j3', 'j4'].map((id, seat) => player(id, seat));
    expect(sidesOf(view('j1', four))).toEqual({ bottom: 'j1', right: 'j2', top: 'j3', left: 'j4' });
  });

  it('D — arrivée A, B, C, D, téléphone de C : C en bas, les autres relatifs à C', () => {
    const four = ['A', 'B', 'C', 'D'].map((id, seat) => player(id, seat));
    expect(sidesOf(view('C', four))).toEqual({ bottom: 'C', right: 'D', top: 'A', left: 'B' });
  });

  it('salle d’attente : places libres toujours affichées, selon la capacité de la table', () => {
    const game = view('a', [player('a', 0), player('b', 1)], { status: 'waiting', maxPlayers: 3 });
    expect(sidesOf(game)).toEqual({ bottom: 'a', right: 'b', left: null });
  });

  it('GARAM TIA : même perspective, l’adversaire d’une partie à 2 est en face', () => {
    const game = view('a', [player('a', 0), player('b', 1)], { gameType: 'GARAM', maxPlayers: 3 });
    expect(sidesOf(game)).toEqual({ bottom: 'a', top: 'b' });
  });
});
