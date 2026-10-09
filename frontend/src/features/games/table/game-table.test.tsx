/// <reference types="jest" />
import { act, cleanup, fireEvent, render, renderHook, screen } from '@testing-library/react-native';

import type { GameView } from '../../../types/game';
import type { LobbyMetrics } from '../../lobby/lobby-metrics';
import { computeLobbyMetrics } from '../../lobby/lobby-metrics';
import { CARD_RATIO, HiddenHand } from './Cards';
import { handZoneRect, seatZones } from './TableCards';
import { computeGameTableLayout, handWidthOf, type SeatSide } from './table-layout';
import { playerOfTurnKey, TURN_SIGNAL_MS, turnKeyOf, useTurnSignal } from './turn-signal';
import { SeatPlate, plateContentHeight } from './TableParts';
import { TurnActions, TurnHud, turnMessage } from './TurnHud';
import { playerLabel } from '../format';

const ME = 'p-me';
const OTHER = 'p-other';
const THIRD = 'p-third';

function gameView(overrides: Partial<GameView> = {}): GameView {
  return {
    gameId: 'g-1',
    firstPlayerId: ME,
    version: 3,
    status: 'in_progress',
    creatorId: ME,
    maxPlayers: 3,
    players: [
      {
        playerId: ME,
        seat: 0,
        joinedAt: '2026-10-09T10:00:00.000Z',
        username: 'Roly_237',
      },
      {
        playerId: OTHER,
        seat: 1,
        joinedAt: '2026-10-09T10:00:01.000Z',
        username: 'Kofi',
      },
      {
        playerId: THIRD,
        seat: 2,
        joinedAt: '2026-10-09T10:00:02.000Z',
        username: 'Awa_99',
      },
    ],
    play: {
      trickNumber: 2,
      dealOrder: [ME, OTHER, THIRD],
      dealSequence: [],
      controllerId: ME,
      nextPlayerId: ME,
      trickOrder: [ME, OTHER, THIRD],
      currentTrick: [],
      completedTricks: [],
      myHand: ['COEUR-3', 'PIQUE-8', 'ETOILE-5', 'TREFLE-10'],
      handCounts: { [ME]: 4, [OTHER]: 4, [THIRD]: 4 },
      stockCount: 0,
    },
    activePlayerId: ME,
    turnStartedAt: '2026-10-09T10:01:00.000Z',
    turnDeadlineAt: '2026-10-09T10:01:10.000Z',
    myActions: {
      canPlayCard: true,
      playableCardIds: [],
      canFlee: false,
      canDeclareInstantWin: false,
    },
    viewerId: ME,
    createdAt: '2026-10-09T10:00:00.000Z',
    ...overrides,
  };
}

afterEach(cleanup);

describe('signal lumineux du joueur actif', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it("identifie un tour par le joueur attendu et l'échéance du serveur", () => {
    const key = turnKeyOf(gameView(), false);
    expect(key).toBe(`${ME}|2026-10-09T10:01:10.000Z`);
    expect(playerOfTurnKey(key!)).toBe(ME);
    // Pas de signal pendant la distribution, ni hors partie en cours.
    expect(turnKeyOf(gameView(), true)).toBeUndefined();
    expect(turnKeyOf(gameView({ status: 'finished' }), false)).toBeUndefined();
  });

  it("s'allume au changement de tour et s'éteint après 2 s, sans se rejouer", async () => {
    const first = turnKeyOf(gameView(), false);
    const { result, rerender } = await renderHook(
      ({ key }: { key: string | undefined }) => useTurnSignal(key),
      {
        initialProps: { key: first },
      },
    );
    expect(result.current).toBe(first);

    // Même tour reçu à nouveau (nouveau rendu, événement temps réel en double) : rien ne change.
    await act(() => jest.advanceTimersByTime(TURN_SIGNAL_MS / 2));
    await rerender({ key: turnKeyOf(gameView(), false) });
    expect(result.current).toBe(first);
    await act(() => jest.advanceTimersByTime(TURN_SIGNAL_MS / 2));
    expect(result.current).toBeNull();
    await rerender({ key: turnKeyOf(gameView(), false) });
    expect(result.current).toBeNull();

    // Nouveau joueur actif : nouveau signal de 2 s, sur lui.
    const next = turnKeyOf(
      gameView({
        activePlayerId: OTHER,
        turnDeadlineAt: '2026-10-09T10:01:20.000Z',
      }),
      false,
    );
    await rerender({ key: next });
    expect(playerOfTurnKey(result.current!)).toBe(OTHER);
    await act(() => jest.advanceTimersByTime(TURN_SIGNAL_MS));
    expect(result.current).toBeNull();
  });

  it('se rallume si le même joueur rejoue un nouveau tour (nouvelle échéance)', async () => {
    const { result, rerender } = await renderHook(
      ({ key }: { key: string | undefined }) => useTurnSignal(key),
      {
        initialProps: { key: turnKeyOf(gameView(), false) },
      },
    );
    await act(() => jest.advanceTimersByTime(TURN_SIGNAL_MS));
    expect(result.current).toBeNull();
    await rerender({
      key: turnKeyOf(gameView({ turnDeadlineAt: '2026-10-09T10:01:30.000Z' }), false),
    });
    expect(playerOfTurnKey(result.current!)).toBe(ME);
  });

  it('annule le minuteur au démontage', async () => {
    const setSpy = jest.spyOn(globalThis, 'setTimeout');
    const clearSpy = jest.spyOn(globalThis, 'clearTimeout');
    const { unmount } = await renderHook(() => useTurnSignal('x|1'));
    const index = setSpy.mock.calls.findIndex((call) => call[1] === TURN_SIGNAL_MS);
    const signalTimer = setSpy.mock.results[index]?.value;
    expect(signalTimer).toBeDefined();
    await unmount();
    expect(clearSpy).toHaveBeenCalledWith(signalTimer);
    setSpy.mockRestore();
    clearSpy.mockRestore();
  });
});

describe('bandeau de tour', () => {
  it("annonce « C'est ton tour ! » au joueur attendu, le nom de l'adversaire sinon", () => {
    const flags = { dealing: false, lastTrick: false };
    expect(turnMessage(gameView(), flags)).toBe("C'est ton tour !");
    expect(turnMessage(gameView({ activePlayerId: OTHER }), flags)).toBe('Tour de Kofi');
    expect(turnMessage(gameView(), { dealing: true, lastTrick: false })).toBe(
      'Distribution des cartes…',
    );
    expect(turnMessage(gameView({ turnTimedOutAt: '2026-10-09T10:01:10.000Z' }), flags)).toBe(
      'Temps écoulé : coup automatique',
    );
    expect(turnMessage(gameView({ status: 'waiting' }), flags)).toBeNull();
  });
});

describe('pseudos des joueurs (D-064)', () => {
  it('affiche le pseudo réel de chaque joueur, joueur connecté compris', () => {
    const game = gameView();
    expect(playerLabel(game, ME)).toBe('Roly_237');
    expect(playerLabel(game, OTHER)).toBe('Kofi');
    expect(playerLabel(game, THIRD)).toBe('Awa_99');
  });

  it('pseudo absent : libellé neutre, jamais un numéro de siège ni un identifiant', () => {
    const game = gameView({
      players: gameView().players.map(({ username: _u, ...p }) => ({
        ...p,
        username: '  ',
      })),
    });
    expect(playerLabel(game, ME)).toBe('Vous');
    expect(playerLabel(game, OTHER)).toBe('Adversaire');
    expect(playerLabel(game, 'inconnu')).toBe('Adversaire');
    for (const id of [ME, OTHER, THIRD]) {
      expect(playerLabel(game, id)).not.toMatch(/Joueur \d|p-/);
    }
  });

  it('le pseudo suit le joueur, pas l’ordre de la liste ni le siège (reconnexion)', () => {
    const reordered = gameView({ players: [...gameView().players].reverse() });
    expect(playerLabel(reordered, OTHER)).toBe('Kofi');
    expect(turnMessage(reordered, { dealing: false, lastTrick: false })).toBe("C'est ton tour !");
  });
});

describe('plaques des joueurs', () => {
  const L = computeGameTableLayout(metrics(853, 393));
  const plateOf = async (name: string, detail?: string) => {
    await render(
      <SeatPlate
        state={{
          name,
          detail,
          local: false,
          active: false,
          firstPlayer: true,
          dimmed: false,
          winner: false,
        }}
        width={L.plateWidth}
        height={L.plateHeight}
        style={{ left: 0, top: 0 }}
      />,
    );
    return screen.getByTestId('seat-plate');
  };

  it('hauteur ajustée au contenu : une ligne plus basse que l’emplacement, deux lignes y tiennent', async () => {
    const plate = await plateOf('Kofi');
    const oneLine = plateContentHeight(L.plateHeight, false);
    expect(plate.props.style).toEqual(
      expect.arrayContaining([expect.objectContaining({ height: oneLine })]),
    );
    expect(oneLine).toBeLessThan(L.plateHeight * 0.8);
    expect(plateContentHeight(L.plateHeight, true)).toBeLessThanOrEqual(L.plateHeight);
    expect(screen.getByText('J1')).toBeTruthy();
  });

  it('pseudo long : une seule ligne, réduit si besoin, plaque de largeur inchangée', async () => {
    await plateOf('Un_pseudo_de_20_sign');
    const name = screen.getByText('Un_pseudo_de_20_sign');
    expect(name.props.numberOfLines).toBe(1);
    expect(name.props.adjustsFontSizeToFit).toBe(true);
  });
});

describe('compteur de tour', () => {
  const screens: [number, number][] = [
    [640, 320],
    [800, 360],
    [853, 393],
    [915, 412],
    [1280, 800],
  ];

  it.each(screens)('%i×%i : « Tour n/5 » en entier, colonne assez large', async (width, height) => {
    const L = computeGameTableLayout(metrics(width, height));
    const { labelFontSize, labelHeight, columnWidth, ring } = L.hud;
    // « Tour 5/5 » : 8 signes de police grasse, plus les marges intérieures.
    expect(columnWidth).toBeGreaterThanOrEqual(labelFontSize * 0.62 * 8 + labelHeight * 0.8);
    expect(columnWidth).toBeGreaterThanOrEqual(ring);
    await render(
      <TurnHud
        game={gameView()}
        receivedAt={Date.now()}
        layout={L}
        dealing={false}
        presenting={false}
        safeLeft={12}
        safeBottom={6}
      />,
    );
    expect(screen.getByText('Tour 2/5')).toBeTruthy();
    expect(screen.queryByText(/…/)).toBeNull();
    const counter = screen.getByTestId('turn-counter');
    expect(counter.props.style).toEqual(
      expect.arrayContaining([expect.objectContaining({ width: columnWidth })]),
    );
    await cleanup();
  });
});

describe('actions ponctuelles', () => {
  const layout = computeGameTableLayout(metrics(800, 360));
  const renderActions = async (game: GameView, pending = false) => {
    const onFlee = jest.fn();
    const onDeclareWin = jest.fn();
    await render(
      <TurnActions
        game={game}
        layout={layout}
        pending={pending}
        onFlee={onFlee}
        onDeclareWin={onDeclareWin}
        safeRight={12}
        safeBottom={6}
      />,
    );
    return { onFlee, onDeclareWin };
  };

  it("n'affiche rien sans autorisation du serveur", async () => {
    await renderActions(gameView());
    expect(screen.queryByText('Se coucher')).toBeNull();
    expect(screen.queryByText('Gagner')).toBeNull();
  });

  it('« Se coucher » envoie la fuite seulement si le serveur l’autorise', async () => {
    const { onFlee } = await renderActions(
      gameView({ myActions: { ...gameView().myActions, canFlee: true } }),
    );
    await fireEvent.press(screen.getByText('Se coucher'));
    expect(onFlee).toHaveBeenCalledTimes(1);
    expect(screen.queryByText('Gagner')).toBeNull();
  });

  it('« Gagner » affiche la combinaison du serveur et se désactive pendant la requête', async () => {
    const game = gameView({
      myActions: { ...gameView().myActions, canDeclareInstantWin: true },
      myInstantWin: { rank: 1, combination: 'THREE_SEVENS' },
    });
    const { onDeclareWin } = await renderActions(game, true);
    expect(screen.getByText('Trois 7 (rang 1)')).toBeTruthy();
    await fireEvent.press(screen.getByText('Gagner'));
    expect(onDeclareWin).not.toHaveBeenCalled();
  });
});

describe('mains adverses', () => {
  it('ne dessine que des dos, autant que de cartes restantes', async () => {
    await render(<HiddenHand count={4} width={30} zone={{ left: 0, top: 0, width: 120 }} />);
    expect(screen.getByLabelText('4 cartes en main')).toBeTruthy();
    // Aucune valeur ni famille : seul le monogramme du dos est écrit.
    expect(screen.queryByText(/[♥♠♣★]|\d/)).toBeNull();
    expect(screen.getAllByText('L')).toHaveLength(4);
  });
});

function metrics(width: number, height: number): LobbyMetrics {
  return computeLobbyMetrics({
    width,
    height,
    safe: { top: 6, bottom: 6, left: 12, right: 12 },
  });
}

type Rect = { left: number; top: number; width: number; height: number };
const overlaps = (a: Rect, b: Rect) =>
  a.left < b.left + b.width &&
  b.left < a.left + a.width &&
  a.top < b.top + b.height &&
  b.top < a.top + a.height;

describe('disposition de la table', () => {
  const screens: [number, number][] = [
    [640, 320],
    [800, 360],
    [853, 393],
    [915, 412],
    [1280, 800],
  ];
  it.each(screens)('%i×%i : zones distinctes et dans l’écran', (width, height) => {
    for (const topSeat of [false, true]) {
      const m = metrics(width, height);
      const L = computeGameTableLayout(m, { topSeat });
      const sides: SeatSide[] = topSeat
        ? ['bottom', 'right', 'top', 'left']
        : ['bottom', 'right', 'left'];
      const hand = handZoneRect('bottom', 5, L, m);
      const action: Rect = {
        left: width - m.safe.right - L.action.size,
        top: height - m.safe.bottom - L.action.size,
        width: L.action.size,
        height: L.action.size,
      };
      const hud: Rect = {
        left: m.safe.left,
        top: height - m.safe.bottom - L.hud.ring - L.hud.labelHeight,
        width: L.hud.columnWidth,
        height: L.hud.ring + L.hud.labelHeight,
      };
      const message: Rect = {
        left: L.hud.message.left,
        top: height - L.hud.message.bottom - L.hud.message.height,
        width: L.hud.message.width,
        height: L.hud.message.height,
      };
      const local = seatZones('bottom', L, m).plate;
      const localPlate: Rect = {
        ...local,
        width: L.plateWidth,
        height: L.plateHeight,
      };
      // Bas de l'écran : chrono, bandeau, main, plaque locale et actions ne se touchent pas.
      const bottomRow = [hud, message, hand, localPlate, action];
      bottomRow.forEach((a, i) =>
        bottomRow.slice(i + 1).forEach((b) => expect(overlaps(a, b)).toBe(false)),
      );
      expect(hand.width).toBe(handWidthOf(5, L));

      for (const side of sides.filter((s) => s !== 'bottom')) {
        const zone = handZoneRect(side, 5, L, m);
        // Dos et plaque des adversaires : dans l'écran, hors de la main et des contrôles du bas.
        expect(zone.left).toBeGreaterThanOrEqual(0);
        expect(zone.top).toBeGreaterThanOrEqual(m.safe.top - 0.5);
        expect(zone.left + zone.width).toBeLessThanOrEqual(width);
        for (const other of [hand, hud, message, action]) expect(overlaps(zone, other)).toBe(false);
        // Dos immédiatement au-dessus de la plaque, centrés sur elle.
        const z = seatZones(side, L, m);
        expect(z.backs!.left).toBe(z.plate.left);
        expect(z.backs!.width).toBe(L.plateWidth);
        expect(z.plate.top - (z.backs!.top + L.smallCard * CARD_RATIO)).toBeLessThanOrEqual(3);
        // Hors de la zone de dépôt centrale (42 % du diamètre).
        const drop = L.diameter * 0.42;
        expect(
          overlaps(zone, {
            left: L.cx - drop / 2,
            top: L.cy - drop / 2,
            width: drop,
            height: drop,
          }),
        ).toBe(false);
      }
    }
  });
});
