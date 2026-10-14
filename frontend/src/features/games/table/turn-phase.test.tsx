/// <reference types="jest" />
import { render, renderHook, screen } from '@testing-library/react-native';

import { computeLobbyMetrics } from '../../lobby/lobby-metrics';
import { computeGameTableLayout } from './table-layout';
import { TurnHud } from './TurnHud';
import { StyleSheet } from 'react-native';

import type { GameView } from '../../../types/game';
import { newestGame } from '../hooks';
import { SeatPlate, URGENT_FRACTION } from './TableParts';
import {
  CLOCK_JITTER_MS,
  dialVisibleFor,
  remainingFraction,
  seatTurnFor,
  turnPhaseOf,
  useClockOffset,
  useTurnPhase,
} from './turn-phase';

const ME = 'p-me';
const OTHER = 'p-other';
const START = '2026-10-13T10:00:00.000Z';
/** Échéance du SERVEUR : 13 s (D-098) ; l'écran n'en montre que 10. */
const DEADLINE = '2026-10-13T10:00:13.000Z';
const T0 = Date.parse(START);

function game(overrides: Partial<GameView> = {}): GameView {
  return {
    gameId: 'g-1',
    version: 5,
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
      dealSequence: [],
      controllerId: ME,
      nextPlayerId: ME,
      trickOrder: [ME, OTHER],
      currentTrick: [],
      completedTricks: [],
      myHand: ['COEUR-3'],
      handCounts: { [ME]: 5, [OTHER]: 5 },
      stockCount: 0,
    },
    activePlayerId: ME,
    turnStartedAt: START,
    turnDeadlineAt: DEADLINE,
    serverNow: START,
    createdAt: START,
    myActions: { canPlayCard: true, playableCardIds: [], canFlee: false, canDeclareInstantWin: false },
    viewerId: ME,
    ...overrides,
  } as GameView;
}

const phaseOf = (g: GameView, offsetMs = 0, dealing = false) =>
  turnPhaseOf(g, { dealing, offsetMs });

/** Échelle horizontale du remplissage de la barre (valeur animée courante). */
function fillScale(): number {
  const style = StyleSheet.flatten(screen.getByTestId('turn-progress-fill', { includeHiddenElements: true }).props.style);
  const transform = style.transform as { scaleX: number }[];
  return transform[0]!.scaleX;
}

describe('tour courant (source unique : échéance du serveur)', () => {
  it('début de tour : progression 1 sur 10 s ; mi-délai : 0,5 ; échéance : 0', () => {
    const phase = phaseOf(game())!;
    expect(phase).toMatchObject({ playerId: ME, totalMs: 10_000, timedOut: false });
    expect(remainingFraction(phase, T0)).toBe(1);
    expect(remainingFraction(phase, T0 + 5_000)).toBe(0.5);
    expect(remainingFraction(phase, T0 + 10_000)).toBe(0);
    expect(remainingFraction(phase, T0 + 60_000)).toBe(0); // Bornée à [0, 1].
    expect(remainingFraction(phase, T0 - 5_000)).toBe(1);
  });

  it('horloge du téléphone décalée : l’échéance est recalée sur l’heure du serveur', () => {
    // Téléphone en avance de 3 s : serveur − téléphone = −3 s.
    const phase = phaseOf(game(), -3_000)!;
    expect(remainingFraction(phase, T0 + 3_000)).toBe(1);
    expect(remainingFraction(phase, T0 + 8_000)).toBe(0.5);
  });

  it('changement de joueur : nouveau tour, nouvelle clé', () => {
    const mine = phaseOf(game())!;
    const theirs = phaseOf(
      game({
        activePlayerId: OTHER,
        turnStartedAt: '2026-10-13T10:00:04.000Z',
        turnDeadlineAt: '2026-10-13T10:00:17.000Z',
      }),
    )!;
    expect(theirs.playerId).toBe(OTHER);
    expect(theirs.key).not.toBe(mine.key);
  });

  it('délai écoulé (serveur) : progression nulle, coup automatique attendu', () => {
    const phase = phaseOf(game({ turnTimedOutAt: DEADLINE }))!;
    expect(phase.timedOut).toBe(true);
    expect(remainingFraction(phase, T0)).toBe(0);
  });

  it('aucun tour : attente, distribution, partie terminée (dont le 5e tour automatique)', () => {
    expect(phaseOf(game({ status: 'waiting' }))).toBeNull();
    expect(phaseOf(game(), 0, true)).toBeNull();
    expect(phaseOf(game({ status: 'finished' }))).toBeNull();
    expect(phaseOf(game({ turnDeadlineAt: undefined }))).toBeNull();
  });

  it('relecture régulière : un bruit réseau ne recale pas l’horloge, un vrai écart oui', async () => {
    const { result, rerender } = await renderHook(
      ({ serverNow, receivedAt }: { serverNow: string; receivedAt: number }) =>
        useClockOffset(serverNow, receivedAt),
      { initialProps: { serverNow: START, receivedAt: T0 } },
    );
    expect(result.current).toBe(0);
    await rerender({ serverNow: '2026-10-13T10:00:03.000Z', receivedAt: T0 + 3_000 + 120 });
    expect(result.current).toBe(0);
    await rerender({ serverNow: '2026-10-13T10:00:06.000Z', receivedAt: T0 + 6_000 + CLOCK_JITTER_MS + 500 });
    expect(result.current).toBe(-(CLOCK_JITTER_MS + 500));
  });

  it('même état, deux lecteurs (barre et chrono) : même tour', async () => {
    const g = game({ serverNow: '2026-10-13T10:00:02.000Z' });
    const a = await renderHook(() => useTurnPhase(g, T0, false));
    const b = await renderHook(() => useTurnPhase(g, T0, false));
    expect(a.result.current).toEqual(b.result.current);
  });
});

describe('relecture reçue en retard', () => {
  it('une version plus ancienne ne remplace jamais l’état affiché', () => {
    const current = game({ version: 8, activePlayerId: OTHER });
    const stale = game({ version: 7, serverNow: '2026-10-13T10:00:05.000Z' });
    const kept = newestGame(current, stale);
    expect(kept.version).toBe(8);
    expect(kept.activePlayerId).toBe(OTHER);
    // Heure du serveur de la réponse reçue : cohérente avec l'heure de réception.
    expect(kept.serverNow).toBe('2026-10-13T10:00:05.000Z');
    expect(newestGame(stale, current)).toBe(current);
  });
});

describe('barre de progression d’un joueur', () => {
  const plate = (turn: ReturnType<typeof phaseOf>) => (
    <SeatPlate
      state={{ name: 'Hugo', local: false, active: true, firstPlayer: false, dimmed: false, winner: false }}
      width={160}
      height={40}
      turn={turn}
      style={{}}
    />
  );

  afterEach(() => jest.useRealTimers());

  it('pseudo toujours affiché ; aucune barre hors de son tour', async () => {
    await render(plate(null));
    expect(screen.getByText('Hugo')).toBeTruthy();
    expect(screen.queryByTestId('turn-progress', { includeHiddenElements: true })).toBeNull();
  });

  it('reconnexion à mi-tour : la barre reprend au bon niveau, sans repartir de 10 s', async () => {
    jest.useFakeTimers({ now: T0 + 6_000 });
    await render(plate(phaseOf(game())));
    expect(screen.getByText('Hugo')).toBeTruthy();
    expect(fillScale()).toBeCloseTo(0.4, 2);
    expect(0.4).toBeGreaterThan(URGENT_FRACTION);
  });

  it('état reçu en retard (changement de joueur vu 3 s après) : barre à 70 %', async () => {
    jest.useFakeTimers({ now: T0 + 3_000 });
    await render(plate(phaseOf(game())));
    expect(fillScale()).toBeCloseTo(0.7, 2);
  });

  it('délai expiré : barre vide', async () => {
    jest.useFakeTimers({ now: T0 + 11_000 });
    await render(plate(phaseOf(game({ turnTimedOutAt: DEADLINE }))));
    expect(fillScale()).toBe(0);
  });

  it('joueur ayant fui : aucune barre', async () => {
    jest.useFakeTimers({ now: T0 });
    await render(
      <SeatPlate
        state={{ name: 'Hugo', local: false, active: false, firstPlayer: false, dimmed: true, winner: false }}
        width={160}
        height={40}
        turn={phaseOf(game())}
        style={{}}
      />,
    );
    expect(screen.queryByTestId('turn-progress', { includeHiddenElements: true })).toBeNull();
  });
});

describe('13 s côté serveur, 10 s affichées (D-098)', () => {
  it('le tour de 13 s s’affiche sur 10 s : barre et chrono à 0 trois secondes avant le serveur', () => {
    const phase = phaseOf(game())!;
    expect(phase.totalMs).toBe(10_000);
    expect(remainingFraction(phase, T0 + 10_000)).toBe(0);
    expect(Date.parse(DEADLINE) - (T0 + 10_000)).toBe(3_000);
  });

  it('ancien serveur sans début de tour : échelle de 10 s', () => {
    expect(phaseOf(game({ turnStartedAt: undefined }))!.totalMs).toBe(10_000);
  });
});

describe('chrono en bas à gauche (« roulette »)', () => {
  const layout = computeGameTableLayout(
    computeLobbyMetrics({ width: 800, height: 360, safe: { top: 6, bottom: 6, left: 12, right: 12 } }),
  );
  const hud = (g: GameView, opts: { dealing?: boolean; presenting?: boolean } = {}) => (
    <TurnHud
      game={g}
      receivedAt={T0}
      layout={layout}
      dealing={opts.dealing ?? false}
      presenting={opts.presenting ?? false}
      safeLeft={12}
      safeBottom={6}
    />
  );
  const timer = () => screen.getByTestId('turn-timer', { includeHiddenElements: true });
  const opacity = () => StyleSheet.flatten(timer().props.style).opacity as number;

  beforeEach(() => jest.useFakeTimers({ now: T0 }));
  afterEach(() => jest.useRealTimers());

  it('visible pendant un tour de jeu, avec 10 s affichées (jamais 13)', async () => {
    await render(hud(game()));
    expect(opacity()).toBe(1);
    expect(timer().props.accessibilityElementsHidden).toBe(false);
    expect(screen.getByText('10')).toBeTruthy();
  });

  it('masqué hors tour : distribution, délai écoulé, 5e tour automatique', async () => {
    expect(dialVisibleFor(phaseOf(game(), 0, true), ME)).toBe(false);
    expect(dialVisibleFor(phaseOf(game({ turnTimedOutAt: DEADLINE })), ME)).toBe(false);
    expect(dialVisibleFor(phaseOf(game({ status: 'finished' })), ME)).toBe(false);
    expect(dialVisibleFor(phaseOf(game()), ME)).toBe(true);

    await render(hud(game({ status: 'finished' }), { presenting: true }));
    expect(opacity()).toBe(0);
    expect(timer().props.accessibilityElementsHidden).toBe(true);
    // Le compteur « Tour 5/5 » reste affiché.
    expect(screen.getByText('Tour 5/5')).toBeTruthy();
  });

  it('distribution puis début du tour : le chrono réapparaît', async () => {
    const view = await render(hud(game(), { dealing: true }));
    expect(timer().props.accessibilityElementsHidden).toBe(true);
    await view.rerender(hud(game()));
    expect(timer().props.accessibilityElementsHidden).toBe(false);
  });
});

describe('qui voit quoi : table de 4 joueurs, un téléphone chacun (D-099)', () => {
  const [J1, J2, J3, J4] = ['id-a', 'id-b', 'id-c', 'id-d'];
  const players = [J1, J2, J3, J4].map((playerId, seat) => ({
    playerId,
    seat,
    joinedAt: START,
    username: `Pseudo${seat}`,
  }));
  /** État officiel vu par le téléphone de `viewerId` : J2 doit jouer. */
  const seenBy = (viewerId: string) =>
    phaseOf(game({ players, viewerId, activePlayerId: J2, firstPlayerId: J1 }));

  it('barre : celle du joueur actif, chez les autres seulement ; jamais la sienne', () => {
    for (const viewer of [J1, J2, J3, J4]) {
      const phase = seenBy(viewer);
      const shown = [J1, J2, J3, J4].filter((seat) => seatTurnFor(phase, seat, viewer));
      expect(shown).toEqual(viewer === J2 ? [] : [J2]);
    }
  });

  it('chrono et roulette : uniquement sur le téléphone du joueur actif', () => {
    expect([J1, J2, J3, J4].filter((v) => dialVisibleFor(seenBy(v), v))).toEqual([J2]);
  });

  it('même tour sur tous les téléphones : même joueur, même échéance affichée', () => {
    const phases = [J1, J2, J3, J4].map(seenBy);
    expect(new Set(phases.map((p) => p!.key)).size).toBe(1);
    expect(new Set(phases.map((p) => p!.localDeadline)).size).toBe(1);
  });

  it('nouveau joueur actif : la barre passe à lui, plus rien sur l’ancien', () => {
    const next = phaseOf(
      game({
        players,
        viewerId: J1,
        activePlayerId: J3,
        turnStartedAt: '2026-10-13T10:00:05.000Z',
        turnDeadlineAt: '2026-10-13T10:00:18.000Z',
      }),
    );
    expect(seatTurnFor(next, J2, J1)).toBeNull();
    expect(seatTurnFor(next, J3, J1)).toBe(next);
  });

  it('carte de J2 acceptée à 3 s sur 10 : roulette et barre de J2 arrêtées à la réception, sans attendre les 7 s', () => {
    // État serveur après la carte : J3 attendu, nouveau tour démarré à 3 s.
    const accepted = (viewerId: string) =>
      phaseOf(
        game({
          players,
          viewerId,
          version: 6,
          activePlayerId: J3,
          turnStartedAt: '2026-10-13T10:00:03.000Z',
          turnDeadlineAt: '2026-10-13T10:00:16.000Z',
        }),
      );
    const at3s = T0 + 3_000;
    // Avant : 7 s restantes pour J2 (70 %).
    expect(remainingFraction(seenBy(J1)!, at3s)).toBeCloseTo(0.7);
    // Après réception : plus aucune barre pour J2, chez personne ; plus de roulette chez J2.
    for (const viewer of [J1, J2, J3, J4]) {
      expect(seatTurnFor(accepted(viewer), J2, viewer)).toBeNull();
    }
    expect(dialVisibleFor(accepted(J2), J2)).toBe(false);
    // Le tour de J3 part plein (10 s affichées), jamais avec l'ancienne échéance.
    expect(dialVisibleFor(accepted(J3), J3)).toBe(true);
    expect(remainingFraction(accepted(J1)!, at3s)).toBe(1);
    expect(accepted(J1)!.key).not.toBe(seenBy(J1)!.key);
    // Un état plus ancien reçu ensuite (relecture en retard) ne réactive pas le tour de J2.
    const shown = game({ players, viewerId: J1, version: 6, activePlayerId: J3 });
    expect(newestGame(shown, game({ players, viewerId: J1, version: 5, activePlayerId: J2 })).activePlayerId).toBe(J3);
  });

  it('distribution, 5e tour automatique, fin de partie : aucune barre, aucun chrono', () => {
    for (const phase of [
      phaseOf(game({ players, viewerId: J1, activePlayerId: J2 }), 0, true),
      phaseOf(game({ players, viewerId: J1, activePlayerId: J2, status: 'finished' })),
    ]) {
      expect([J1, J2, J3, J4].some((s) => seatTurnFor(phase, s, J1))).toBe(false);
      expect(dialVisibleFor(phase, J2)).toBe(false);
    }
  });

  it('chrono masqué chez un joueur qui n’a pas la main', async () => {
    jest.useFakeTimers({ now: T0 });
    const layout = computeGameTableLayout(
      computeLobbyMetrics({ width: 800, height: 360, safe: { top: 6, bottom: 6, left: 12, right: 12 } }),
    );
    await render(
      <TurnHud
        game={game({ viewerId: OTHER })}
        receivedAt={T0}
        layout={layout}
        dealing={false}
        presenting={false}
        safeLeft={12}
        safeBottom={6}
      />,
    );
    const timer = screen.getByTestId('turn-timer', { includeHiddenElements: true });
    expect(StyleSheet.flatten(timer.props.style).opacity).toBe(0);
    expect(timer.props.accessibilityElementsHidden).toBe(true);
    // Le bandeau dit quand même à qui c'est le tour.
    expect(screen.getByText('Tour de Moi')).toBeTruthy();
    jest.useRealTimers();
  });
});
