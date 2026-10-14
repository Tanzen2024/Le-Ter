/// <reference types="jest" />
import { renderHook } from '@testing-library/react-native';

import type { GameView } from '../../../types/game';
import { serverDealing, useTableDealing } from './deal-phase';
import { dialVisibleFor, remainingFraction, seatTurnFor, turnPhaseOf } from './turn-phase';
import { turnKeyOf } from './turn-signal';

const ME = 'p-me';
const OTHER = 'p-other';
const START = '2026-10-14T10:00:00.000Z';
/** Fin de la distribution fixée par le serveur (2 joueurs : 2,52 s, D-102). */
const DEAL_END = '2026-10-14T10:00:02.520Z';
/** Premier tour ouvert à la confirmation : 13 s de serveur (10 s affichées, D-098). */
const DEADLINE = '2026-10-14T10:00:15.520Z';

/** Partie démarrée, distribution PAS encore confirmée par le serveur. */
function dealingGame(overrides: Partial<GameView> = {}): GameView {
  return {
    gameId: 'g-1',
    version: 2,
    status: 'in_progress',
    creatorId: ME,
    maxPlayers: 2,
    firstPlayerId: ME,
    players: [
      { playerId: ME, seat: 0, joinedAt: START, username: 'Moi' },
      { playerId: OTHER, seat: 1, joinedAt: START, username: 'Hugo' },
    ],
    play: {
      trickNumber: 1,
      dealOrder: [ME, OTHER],
      dealSequence: [
        { playerId: ME, count: 3 },
        { playerId: OTHER, count: 3 },
        { playerId: ME, count: 2 },
        { playerId: OTHER, count: 2 },
      ],
      controllerId: ME,
      nextPlayerId: ME,
      trickOrder: [ME, OTHER],
      currentTrick: [],
      completedTricks: [],
      myHand: ['COEUR-3', 'COEUR-4', 'COEUR-5', 'COEUR-6', 'COEUR-7'],
      handCounts: { [ME]: 5, [OTHER]: 5 },
      stockCount: 21,
    },
    activePlayerId: ME,
    dealEndsAt: DEAL_END,
    serverNow: START,
    createdAt: START,
    myActions: { canPlayCard: false, playableCardIds: [], canFlee: false, canDeclareInstantWin: false },
    viewerId: ME,
    ...overrides,
  } as GameView;
}

/** Même partie après la confirmation serveur (`game:deal_completed`, version + 1). */
function dealtGame(): GameView {
  const g = dealingGame({
    version: 3,
    turnStartedAt: DEAL_END,
    turnDeadlineAt: DEADLINE,
    serverNow: DEAL_END,
    myActions: { canPlayCard: true, playableCardIds: ['COEUR-3'], canFlee: true, canDeclareInstantWin: false },
  });
  delete g.dealEndsAt;
  return g;
}

describe('Phase de distribution côté téléphone (D-102)', () => {
  it('distribution non confirmée : aucun tour, ni roulette ni barres, ni halo de tour', () => {
    const g = dealingGame();
    expect(serverDealing(g)).toBe(true);
    // Même si l'animation locale est finie (dealing = false), le serveur n'a ouvert aucun tour.
    const phase = turnPhaseOf(g, { dealing: false, offsetMs: 0 });
    expect(phase).toBeNull();
    expect(dialVisibleFor(phase, ME)).toBe(false);
    expect(seatTurnFor(phase, OTHER, ME)).toBeNull();
    expect(turnKeyOf(g, false)).toBeUndefined();
  });

  it('une échéance ancienne reçue avec la phase de distribution ne réactive aucun compte à rebours', () => {
    const stale = dealingGame({ turnDeadlineAt: DEADLINE, turnStartedAt: DEAL_END });
    expect(turnPhaseOf(stale, { dealing: false, offsetMs: 0 })).toBeNull();
  });

  it('confirmation serveur : le tour démarre à son début officiel, avec la durée affichée complète', () => {
    const phase = turnPhaseOf(dealtGame(), { dealing: false, offsetMs: 0 });
    expect(phase).not.toBeNull();
    expect(phase!.playerId).toBe(ME);
    expect(phase!.totalMs).toBe(10_000);
    expect(remainingFraction(phase!, Date.parse(DEAL_END))).toBe(1);
    expect(dialVisibleFor(phase, ME)).toBe(true);
    expect(seatTurnFor(phase, ME, OTHER)).toBe(phase);
  });

  it('l’animation démarre pendant la phase serveur et se termine même après la confirmation', async () => {
    const { result, rerender } = await renderHook(
      ({ g, animated }: { g: GameView; animated: boolean }) => useTableDealing(g, animated),
      { initialProps: { g: dealingGame(), animated: false } },
    );
    expect(result.current).toBe(true);
    // Confirmation reçue pendant que les lots volent encore : l'animation continue.
    await rerender({ g: dealtGame(), animated: false });
    expect(result.current).toBe(true);
    // Animation terminée : le tour (échéance serveur) s'affiche.
    await rerender({ g: dealtGame(), animated: true });
    expect(result.current).toBe(false);
  });

  it('reconnexion après la confirmation : pas de distribution rejouée, temps restant réel', async () => {
    const { result } = await renderHook(() => useTableDealing(dealtGame(), false));
    expect(result.current).toBe(false);
    // 4 s après la confirmation : 6 s affichées sur 10, pas 10 s.
    const phase = turnPhaseOf(dealtGame(), { dealing: false, offsetMs: 0 });
    expect(remainingFraction(phase!, Date.parse(DEAL_END) + 4_000)).toBeCloseTo(0.6);
  });

  it('reconnexion pendant la distribution : animation, aucun compte à rebours', async () => {
    const { result } = await renderHook(() => useTableDealing(dealingGame(), false));
    expect(result.current).toBe(true);
    expect(turnPhaseOf(dealingGame(), { dealing: true, offsetMs: 0 })).toBeNull();
  });

  it('distribution déjà animée sur cet appareil (remontage de l’écran) : jamais rejouée', async () => {
    const { result } = await renderHook(() => useTableDealing(dealingGame(), true));
    expect(result.current).toBe(false);
  });

  it('état du serveur reçu deux fois : même résultat, aucun tour en double', async () => {
    const { result, rerender } = await renderHook(({ g }: { g: GameView }) => useTableDealing(g, false), {
      initialProps: { g: dealingGame() },
    });
    await rerender({ g: dealingGame() });
    expect(result.current).toBe(true);
    const a = turnPhaseOf(dealtGame(), { dealing: false, offsetMs: 0 });
    const b = turnPhaseOf(dealtGame(), { dealing: false, offsetMs: 0 });
    expect(a?.key).toBe(b?.key);
  });

  it('partie suivante (autre gameId) : la distribution est rejouée pour elle seule', async () => {
    const { result, rerender } = await renderHook(
      ({ g, animated }: { g: GameView; animated: boolean }) => useTableDealing(g, animated),
      { initialProps: { g: dealingGame(), animated: true } },
    );
    expect(result.current).toBe(false);
    await rerender({ g: dealingGame({ gameId: 'g-2' }), animated: false });
    expect(result.current).toBe(true);
  });
});
