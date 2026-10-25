/// <reference types="jest" />
import {
  act,
  cleanup,
  fireEvent,
  render,
  renderHook,
  screen,
  within,
} from '@testing-library/react-native';

import type { GameView } from '../../../types/game';
import type { LobbyMetrics } from '../../lobby/lobby-metrics';
import { computeLobbyMetrics } from '../../lobby/lobby-metrics';
import {
  BACK_LETTER,
  CARD_RATIO,
  CardBack,
  CardFace,
  FACE_CORNER,
  faceLayout,
  FACE_MIN_GAP,
  HiddenHand,
  PublicRow,
  ROW_STEP,
} from './Cards';
import {
  handZoneRect,
  PUBLIC_ROW_MAX_STEP,
  publicCardLeft,
  publicRowBox,
  publicRowStep,
  seatZones,
  spotCardWidth,
} from './TableCards';
import {
  centerCircles,
  computeGameTableLayout,
  TABLE_REFERENCE,
  handWidthOf,
  MAX_HAND_CARDS,
  type SeatSide,
} from './table-layout';
import {
  CONTROL_SIGNAL_MS,
  controllerOf,
  playerOfControlSignal,
  playerOfTurnKey,
  TURN_SIGNAL_MS,
  turnKeyOf,
  useControlSignal,
  useTurnSignal,
} from './turn-signal';
import {
  CONTROL_GLOW_KEYFRAMES,
  ControlGlow,
  controlGlowSpread,
  SeatPlate,
  plateContentHeight,
  WoodTable,
} from './TableParts';
import {
  TURN_GLOW_KEYFRAMES,
  cardsPlayedBy,
  PRESS_LATCH_MS,
  SPECIAL_HAND_HINT_MS,
  SPECIAL_HAND_REFUSED,
  TurnActions,
  TurnGlow,
  TurnHud,
  turnMessage,
} from './TurnHud';
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
    turnDeadlineAt: '2026-10-09T10:01:13.000Z',
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
    expect(key).toBe(`${ME}|2026-10-09T10:01:13.000Z`);
    expect(playerOfTurnKey(key!)).toBe(ME);
    // Pas de signal pendant la distribution, ni hors partie en cours.
    expect(turnKeyOf(gameView(), true)).toBeUndefined();
    expect(turnKeyOf(gameView({ status: 'finished' }), false)).toBeUndefined();
  });

  it("s'allume au changement de tour et s'éteint après 5 s, sans se rejouer", async () => {
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

    // Nouveau joueur actif : nouveau halo de 5 s, sur lui.
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

  it('dure 5 s exactement : allumé à 4 999 ms, éteint à 5 000 ms', async () => {
    expect(TURN_SIGNAL_MS).toBe(5000);
    const { result } = await renderHook(() => useTurnSignal(turnKeyOf(gameView(), false)));
    await act(() => jest.advanceTimersByTime(4999));
    expect(result.current).not.toBeNull();
    await act(() => jest.advanceTimersByTime(1));
    expect(result.current).toBeNull();
  });

  it('changement de joueur avant la fin : un seul minuteur, relancé pour 5 s pleines', async () => {
    const setSpy = jest.spyOn(globalThis, 'setTimeout');
    const clearSpy = jest.spyOn(globalThis, 'clearTimeout');
    const { result, rerender } = await renderHook(
      ({ key }: { key: string | undefined }) => useTurnSignal(key),
      { initialProps: { key: turnKeyOf(gameView(), false) } },
    );
    const timers = () => setSpy.mock.calls.filter((call) => call[1] === TURN_SIGNAL_MS).length;
    expect(timers()).toBe(1);
    // Nouveaux rendus du même tour : aucun minuteur de plus.
    await rerender({ key: turnKeyOf(gameView(), false) });
    await rerender({ key: turnKeyOf(gameView(), false) });
    expect(timers()).toBe(1);
    await act(() => jest.advanceTimersByTime(3000));
    const next = turnKeyOf(
      gameView({ activePlayerId: OTHER, turnDeadlineAt: '2026-10-09T10:01:20.000Z' }),
      false,
    );
    await rerender({ key: next });
    // L'ancien minuteur est annulé, le nouveau repart de zéro.
    expect(clearSpy).toHaveBeenCalled();
    expect(timers()).toBe(2);
    await act(() => jest.advanceTimersByTime(4999));
    expect(playerOfTurnKey(result.current!)).toBe(OTHER);
    await act(() => jest.advanceTimersByTime(1));
    expect(result.current).toBeNull();
    setSpy.mockRestore();
    clearSpy.mockRestore();
  });

  it('isolation par gameId : les halos de deux parties ne se mélangent pas', async () => {
    // Deux tables (deux parties) montées en même temps : chacune a son propre minuteur.
    const gameA = renderHook(() => useTurnSignal(turnKeyOf(gameView({ gameId: 'g-a' }), false)));
    const { result: a } = await gameA;
    await act(() => jest.advanceTimersByTime(3000));
    const { result: b, unmount: unmountB } = await renderHook(() =>
      useTurnSignal(
        turnKeyOf(
          gameView({ gameId: 'g-b', activePlayerId: OTHER, turnDeadlineAt: '2026-10-09T11:00:00.000Z' }),
          false,
        ),
      ),
    );
    expect(playerOfTurnKey(a.current!)).toBe(ME);
    expect(playerOfTurnKey(b.current!)).toBe(OTHER);
    // La fin du halo de A n'éteint pas celui de B…
    await act(() => jest.advanceTimersByTime(2000));
    expect(a.current).toBeNull();
    expect(playerOfTurnKey(b.current!)).toBe(OTHER);
    // … et la fermeture de B (démontage) ne touche pas A.
    await unmountB();
    await act(() => jest.advanceTimersByTime(3000));
    expect(a.current).toBeNull();
  });

  it('halo dessiné autour de la zone, plus intense que le simple cadre, sans capter les gestes', async () => {
    const rect = { left: 100, top: 200, width: 150, height: 90 };
    await render(<TurnGlow rect={rect} />);
    const hidden = { includeHiddenElements: true };
    const spread = 16; // 90 × 0,18 = 16,2 → 16
    expect(screen.getByTestId('turn-glow', hidden)).toHaveStyle({
      left: 100 - spread,
      top: 200 - spread,
      width: 150 + spread * 2,
      height: 90 + spread * 2,
      pointerEvents: 'none',
    });
    expect(screen.getByTestId('turn-glow-rim', hidden)).toHaveStyle({ borderWidth: 3 });
  });

  it('animation du halo : allumé tout du long, éteint seulement à la fin des 5 s', () => {
    const { at, opacity, scale } = TURN_GLOW_KEYFRAMES;
    expect(at[0]).toBe(0);
    expect(at[at.length - 1]).toBe(1);
    expect([...at]).toEqual([...at].sort((x, y) => x - y));
    expect(opacity).toHaveLength(at.length);
    expect(scale).toHaveLength(at.length);
    // Entre l'allumage et la toute fin, jamais sous 70 % d'intensité.
    expect(Math.min(...opacity.slice(1, -1))).toBeGreaterThanOrEqual(0.7);
    expect(opacity[opacity.length - 1]).toBe(0);
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

  it("« C'est ton tour ! » affiché seulement au joueur courant, en blanc, sans autre phrase", async () => {
    const L = computeGameTableLayout(metrics(800, 360));
    const hud = (game: GameView) => (
      <TurnHud
        game={game}
        receivedAt={Date.now()}
        layout={L}
        dealing={false}
        presenting={false}
        safeLeft={12}
        safeBottom={6}
      />
    );
    const { rerender } = await render(hud(gameView()));
    const message = screen.getByTestId('turn-message');
    expect(message).toHaveTextContent("C'est ton tour !", { exact: true });
    expect(message).toHaveStyle({ color: '#FFFFFF' });
    // Le tour passe à l'adversaire : le comportement existant (« Tour de <pseudo> ») reprend.
    await rerender(hud(gameView({ activePlayerId: OTHER })));
    expect(screen.queryByText("C'est ton tour !")).toBeNull();
    expect(screen.getByText('Tour de Kofi')).toBeTruthy();
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
    // Aucun numéro de siège affiché (D-099) : ni « J1 » ni pastille, seulement le pseudo.
    expect(screen.queryByText('J1')).toBeNull();
    expect(screen.queryByTestId('first-player-chip')).toBeNull();
    expect(screen.getByText('Kofi')).toBeTruthy();
  });

  it('la barre n’affiche QUE le pseudo : ni statut, ni siège, ni nombre de cartes', async () => {
    const plate = await plateOf('Kofi', 'À son tour · Contrôle');
    // Un seul texte dans la barre : le pseudo, blanc et gras.
    expect(within(plate).getAllByText(/.+/).map((t) => t.props.children)).toEqual(['Kofi']);
    expect(screen.queryByText(/À son tour|Contrôle|\d+ cartes?|Siège/)).toBeNull();
    expect(screen.getByText('Kofi')).toHaveStyle({ color: '#FFFFFF' });
    // L'état reste annoncé aux lecteurs d'écran, sans être écrit.
    expect(plate.props.accessibilityLabel).toContain('Contrôle');
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

  /** Partie dont `count` tours terminés contiennent une carte de chaque joueur (moi compris). */
  const afterTricks = (count: number, overrides: Partial<GameView> = {}) => {
    const base = gameView(overrides);
    const plays = (n: number) =>
      [ME, OTHER, THIRD].map((playerId, i) => ({ playerId, cardId: `PIQUE-${3 + n * 3 + i}` }));
    return {
      ...base,
      play: {
        ...base.play!,
        completedTricks: Array.from({ length: count }, (_, n) => ({
          number: n + 1,
          plays: plays(n),
          controllerId: ME,
        })),
      },
    };
  };

  it('aucune carte jouée, aucun droit : « Main spéciale » visible, « Se coucher » visible inactif', async () => {
    const { onFlee } = await renderActions(gameView());
    expect(screen.getByText('Main spéciale')).toBeTruthy();
    expect(screen.getByLabelText(/^Se coucher : indisponible/)).toBeDisabled();
    await fireEvent.press(screen.getByText('Se coucher'));
    expect(onFlee).not.toHaveBeenCalled();
  });

  it('« Main spéciale » sans main gagnante : message explicatif, rien n’est envoyé, puis il s’efface', async () => {
    jest.useFakeTimers();
    try {
      const { onDeclareWin } = await renderActions(gameView());
      expect(screen.queryByTestId('special-hand-hint')).toBeNull();
      await fireEvent.press(screen.getByText('Main spéciale'));
      expect(onDeclareWin).not.toHaveBeenCalled();
      expect(screen.getByText(SPECIAL_HAND_REFUSED)).toBeTruthy();
      await act(() => jest.advanceTimersByTime(SPECIAL_HAND_HINT_MS));
      expect(screen.queryByText(SPECIAL_HAND_REFUSED)).toBeNull();
    } finally {
      jest.useRealTimers();
    }
  });

  it('après sa 1re carte : « Main spéciale » disparaît, « Se coucher » reste visible (inactif)', async () => {
    await renderActions(afterTricks(1));
    expect(screen.queryByText('Main spéciale')).toBeNull();
    expect(screen.getByLabelText(/^Se coucher : indisponible/)).toBeDisabled();
  });

  it('carte posée dans le tour en cours : compte aussi comme carte jouée', async () => {
    const base = gameView();
    await renderActions({
      ...base,
      play: { ...base.play!, currentTrick: [{ playerId: ME, cardId: 'PIQUE-3' }] },
    });
    expect(screen.queryByText('Main spéciale')).toBeNull();
    expect(screen.getByText('Se coucher')).toBeTruthy();
  });

  it('après sa 2e carte : plus aucun bouton', async () => {
    await renderActions(afterTricks(2));
    expect(screen.queryByText('Main spéciale')).toBeNull();
    expect(screen.queryByText('Se coucher')).toBeNull();
  });

  it('joueur qui a fui : aucun bouton', async () => {
    const fled = gameView();
    await renderActions({
      ...fled,
      players: fled.players.map((p) =>
        p.playerId === ME ? { ...p, fledAt: '2026-10-09T10:01:05.000Z' } : p,
      ),
    });
    expect(screen.queryByText('Main spéciale')).toBeNull();
    expect(screen.queryByText('Se coucher')).toBeNull();
  });

  it('un AUTRE joueur a fui : « Se coucher » disparaît chez moi (un seul fuyard par partie)', async () => {
    const base = gameView();
    await renderActions({
      ...base,
      players: base.players.map((p) =>
        p.playerId === OTHER ? { ...p, fledAt: '2026-10-09T10:01:05.000Z' } : p,
      ),
    });
    expect(screen.queryByText('Se coucher')).toBeNull();
    // « Main spéciale » ne dépend que de mes propres cartes.
    expect(screen.getByText('Main spéciale')).toBeTruthy();
  });

  it('D-089 : après ma 1re carte, « Se coucher » reste actif si le serveur l’autorise', async () => {
    const game = afterTricks(1, { myActions: { ...gameView().myActions, canFlee: true } });
    const { onFlee } = await renderActions(game);
    await fireEvent.press(screen.getByText('Se coucher'));
    expect(onFlee).toHaveBeenCalledTimes(1);
  });

  it('cartes jouées par les AUTRES joueurs : sans effet sur mes boutons', async () => {
    const base = gameView();
    await renderActions({
      ...base,
      play: {
        ...base.play!,
        currentTrick: [
          { playerId: OTHER, cardId: 'PIQUE-4' },
          { playerId: THIRD, cardId: 'PIQUE-5' },
        ],
      },
    });
    expect(screen.getByText('Main spéciale')).toBeTruthy();
    expect(screen.getByText('Se coucher')).toBeTruthy();
  });

  it('nombre de cartes jouées : tours terminés + tour en cours, par joueur', () => {
    const game = afterTricks(2);
    expect(cardsPlayedBy(game, ME)).toBe(2);
    expect(cardsPlayedBy(game, OTHER)).toBe(2);
    expect(cardsPlayedBy(gameView({ play: undefined }), ME)).toBe(0);
  });

  it('« Se coucher » envoie la fuite seulement si le serveur l’autorise', async () => {
    const { onFlee, onDeclareWin } = await renderActions(
      gameView({ myActions: { ...gameView().myActions, canFlee: true } }),
    );
    await fireEvent.press(screen.getByText('Se coucher'));
    expect(onFlee).toHaveBeenCalledTimes(1);
    expect(onDeclareWin).not.toHaveBeenCalled();
    // Main non gagnante selon le serveur : un appui sur « Main spéciale » n'envoie rien.
    await fireEvent.press(screen.getByText('Main spéciale'));
    expect(onDeclareWin).not.toHaveBeenCalled();
  });

  it('partie à 2 (fuite impossible, R-30) : « Main spéciale » active, « Se coucher » inactif', async () => {
    const { onFlee, onDeclareWin } = await renderActions(
      gameView({ myActions: { ...gameView().myActions, canDeclareInstantWin: true } }),
    );
    expect(screen.getByLabelText(/^Se coucher : indisponible/)).toBeDisabled();
    await fireEvent.press(screen.getByText('Se coucher'));
    await fireEvent.press(screen.getByText('Main spéciale'));
    expect(onFlee).not.toHaveBeenCalled();
    expect(onDeclareWin).toHaveBeenCalledTimes(1);
  });

  it('double appui rapide (avant la mise à jour « en cours ») : une seule commande', async () => {
    jest.useFakeTimers({ now: 1_000_000 });
    try {
      const { onFlee } = await renderActions(
        gameView({ myActions: { ...gameView().myActions, canFlee: true } }),
      );
      await fireEvent.press(screen.getByText('Se coucher'));
      await fireEvent.press(screen.getByText('Se coucher'));
      expect(onFlee).toHaveBeenCalledTimes(1);
      // Refus du serveur (le bouton reste là) : un nouvel appui ultérieur est possible.
      jest.setSystemTime(1_000_000 + PRESS_LATCH_MS);
      await fireEvent.press(screen.getByText('Se coucher'));
      expect(onFlee).toHaveBeenCalledTimes(2);
    } finally {
      jest.useRealTimers();
    }
  });

  it('« Main spéciale » réclame la victoire instantanée détectée par le serveur', async () => {
    const game = gameView({
      myActions: { ...gameView().myActions, canDeclareInstantWin: true },
      myInstantWin: { rank: 1, combination: 'THREE_SEVENS' },
    });
    const { onDeclareWin } = await renderActions(game);
    expect(screen.getByLabelText('Main spéciale : gagner instantanément (Trois 7, rang 1)')).toBeTruthy();
    await fireEvent.press(screen.getByText('Main spéciale'));
    expect(onDeclareWin).toHaveBeenCalledTimes(1);
  });

  it('pas de double envoi : les deux boutons sont inactifs pendant la requête', async () => {
    const game = gameView({
      myActions: { ...gameView().myActions, canDeclareInstantWin: true, canFlee: true },
      myInstantWin: { rank: 1, combination: 'THREE_SEVENS' },
    });
    const { onDeclareWin, onFlee } = await renderActions(game, true);
    await fireEvent.press(screen.getByText('Main spéciale'));
    await fireEvent.press(screen.getByText('Se coucher'));
    expect(onDeclareWin).not.toHaveBeenCalled();
    expect(onFlee).not.toHaveBeenCalled();
  });

  it('deux boutons ronds côte à côte en bas à droite, mêmes diamètres', async () => {
    const game = gameView({
      myActions: { ...gameView().myActions, canDeclareInstantWin: true, canFlee: true },
    });
    await renderActions(game);
    const size = layout.action.size;
    for (const label of [/^Main spéciale/, /^Se coucher/]) {
      expect(screen.getByLabelText(label)).toHaveStyle({
        width: size,
        height: size,
        borderRadius: size / 2,
      });
    }
    expect(layout.action.width).toBeGreaterThanOrEqual(size * 2);
  });
});

describe('mains adverses', () => {
  it('ne dessine que des dos, autant que de cartes restantes', async () => {
    await render(<HiddenHand count={4} width={30} zone={{ left: 0, top: 0, width: 120 }} />);
    expect(screen.getByLabelText('4 cartes en main')).toBeTruthy();
    // Aucune valeur ni famille : seul le monogramme du dos est écrit.
    expect(screen.queryByText(/[♥♠♣★]|\d/)).toBeNull();
    expect(screen.getAllByTestId('card-back', { includeHiddenElements: true })).toHaveLength(4);
  });

  it('dos empilés régulièrement, sans écart excessif ni chevauchement total', async () => {
    await render(<HiddenHand count={4} width={30} zone={{ left: 0, top: 0, width: 140 }} />);
    const backs = screen.getAllByTestId('card-back', { includeHiddenElements: true });
    const lefts = backs.map((b) => Object.assign({}, ...[b.props.style].flat(3)).left as number);
    const steps = lefts.slice(1).map((left, i) => left - lefts[i]!);
    expect(new Set(steps.map((x) => x.toFixed(3))).size).toBe(1);
    expect(steps[0]).toBeGreaterThan(0);
    expect(steps[0]).toBeLessThan(30);
  });
});

describe('style des cartes (référence)', () => {
  it('dos : fond bleu, liseré blanc, « L » dessiné dans le dos (aucun texte posé dessus)', async () => {
    await render(<CardBack width={40} />);
    const back = screen.getByTestId('card-back', { includeHiddenElements: true });
    expect(back).toHaveStyle({ width: 40, height: 40 * CARD_RATIO });
    expect(screen.queryByText('T')).toBeNull();
    expect(screen.queryByText('L')).toBeNull();
    // Le « L » est un tracé du dessin, rempli par le dégradé blanc, sur le fond bleu texturé.
    const json = JSON.stringify(screen.toJSON());
    expect(json).toContain(BACK_LETTER);
    expect(json).toContain('"brushRef":"backFill"');
    expect(json).toContain('"brushRef":"backWeave"');
    expect(json).toContain('"brushRef":"backLetter"');
  });

  it('face : grand chiffre et symbole dans le coin haut gauche, couleur de la famille', async () => {
    await render(<CardFace cardId="PIQUE-8" width={90} />);
    // Cartes premium (D-156) : fond ivoire (repli sous le dégradé texturé, dessin vectoriel,
    // aucune image), tranche fine champagne, coins arrondis.
    expect(screen.getByLabelText('8 ♠')).toHaveStyle({
      width: 90,
      height: 135,
      backgroundColor: '#F8F3E7',
      borderColor: '#B9A47A',
      borderRadius: 90 * 0.08,
    });
    expect(screen.getByLabelText('8 ♠')).not.toHaveStyle({
      experimental_backgroundImage: expect.anything(),
    });
    const texture = JSON.stringify(screen.toJSON());
    expect(texture).toContain('"brushRef":"faceFill"');
    expect(texture).toContain('"brushRef":"faceLozenges"');
    expect(screen.getByText('8')).toHaveStyle({ fontSize: 90 * FACE_CORNER.value, color: '#1E2125' });
    expect(screen.getByText('♠')).toHaveStyle({ fontSize: 90 * FACE_CORNER.pip });
    expect(screen.getByTestId('card-corner')).toHaveStyle({
      top: 90 * FACE_CORNER.top,
      left: 90 * FACE_CORNER.left,
    });
    // Bas de la carte : grand symbole centré, comme le gros ♦ du 8 de la référence (masqué aux
    // lecteurs d'écran : la carte est déjà annoncée par son libellé).
    const hidden = { includeHiddenElements: true };
    expect(screen.getByTestId('card-center-pip', hidden)).toHaveStyle({
      bottom: 90 * FACE_CORNER.centerBottom,
      left: 0,
      right: 0,
      alignItems: 'center',
    });
    expect(screen.getAllByText('8', hidden)).toHaveLength(1);
    const pips = screen.getAllByText('♠', hidden);
    expect(pips).toHaveLength(2);
    // Symboles du pique : noir foncé (valeur anthracite).
    expect(pips[1]).toHaveStyle({ fontSize: 90 * FACE_CORNER.center, color: '#08090B' });
    await cleanup();
    await render(<CardFace cardId="COEUR-3" width={90} />);
    expect(screen.getByText('3')).toHaveStyle({ color: '#D3202A' });
    expect(screen.getByText('♥')).toHaveStyle({ color: '#D3202A' });
  });

  it('quatre familles : valeurs pique et trèfle anthracite (symboles noir foncé / noir léger), cœur et étoile rouges', async () => {
    const hidden = { includeHiddenElements: true };
    for (const [cardId, symbol, color, pipColor] of [
      ['PIQUE-9', '♠', '#1E2125', '#08090B'],
      ['TREFLE-5', '♣', '#1E2125', '#6A7079'],
      ['COEUR-6', '♥', '#D3202A', '#D3202A'],
      ['ETOILE-8', '★', '#D3202A', '#D3202A'],
    ] as const) {
      await render(<CardFace cardId={cardId} width={80} />);
      const value = cardId.split('-')[1]!;
      expect(screen.getByText(value)).toHaveStyle({ color, fontSize: 80 * FACE_CORNER.value });
      for (const pip of screen.getAllByText(symbol, hidden)) {
        expect(pip).toHaveStyle({ color: pipColor });
      }
      await cleanup();
    }
    // Valeur à deux chiffres : réduite pour tenir dans le coin, jamais coupée.
    await render(<CardFace cardId="COEUR-10" width={80} />);
    expect(screen.getByText('10')).toHaveStyle({ fontSize: 80 * FACE_CORNER.valueLong });
  });

  it('le grand symbole tient dans la carte, sous le coin, pour toutes les tailles', () => {
    for (const width of [24, 48, 72, 92]) {
      const height = width * CARD_RATIO;
      const { centerTop, cornerBottom, gap } = faceLayout(width);
      // Dans la carte (jamais coupé par le bord bas) et sous TOUT le coin (valeur et petit
      // symbole), avec un espace net entre les deux symboles.
      expect(centerTop).toBeGreaterThan(0);
      expect(centerTop).toBeGreaterThan(cornerBottom);
      expect(gap).toBeGreaterThanOrEqual(width * FACE_MIN_GAP - 1e-9);
      expect(height).toBeGreaterThan(centerTop);
      // Centré : sa largeur (≈ 0,8 em) reste dans la carte.
      expect(width * FACE_CORNER.center * 0.8).toBeLessThan(width);
    }
  });

  it('main du joueur : chevauchement régulier, coin (valeur et famille) toujours visible', () => {
    for (const [width, height] of [
      [640, 320],
      [800, 360],
      [915, 412],
    ] as const) {
      const L = computeGameTableLayout(metrics(width, height));
      expect(L.handStep).toBe(Math.round(L.cardWidth * TABLE_REFERENCE.handStep));
      // Le coin (marge + chiffre le plus large) tient dans la partie non recouverte.
      const corner = L.cardWidth * (FACE_CORNER.left + FACE_CORNER.value * 0.62);
      expect(corner).toBeLessThan(L.handStep);
      // 5 cartes tiennent sans défilement entre le chrono et la plaque locale.
      expect(handWidthOf(5, L)).toBe(L.cardWidth + 4 * L.handStep);
      expect(L.handLeft).toBeGreaterThan(L.hud.columnWidth);
    }
  });

  it('carte jouée au centre : 11 % du diamètre, jamais plus petite que les cartes publiques', () => {
    expect(spotCardWidth(400, 30)).toBe(44);
    expect(spotCardWidth(200, 30)).toBe(30);
    expect(spotCardWidth(2000, 30)).toBe(72);
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
        left: width - m.safe.right - L.action.width,
        top: height - m.safe.bottom - L.action.size,
        width: L.action.width,
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
        // Hors de la zone de dépôt centrale (agrandie sur smartphone).
        const drop = L.center.drop;
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

describe('cartes déjà jouées : espacement (5 cartes au plus, une par tour)', () => {
  const screens: [number, number][] = [
    [640, 320],
    [800, 360],
    [853, 393],
    [915, 412],
    [1280, 800],
  ];

  it('pas borné : jamais plus chevauché qu’avant, au plus des cartes séparées', () => {
    expect(publicRowStep(0, 30)).toBe(ROW_STEP);
    expect(publicRowStep(10_000, 30)).toBe(PUBLIC_ROW_MAX_STEP);
    // 5 cartes de 30 px dans 180 px : (180 − 30) / (4 × 30) = 1,25 → plafonné à 1,12.
    expect(publicRowStep(180, 30)).toBe(PUBLIC_ROW_MAX_STEP);
    expect(publicRowStep(120, 30)).toBeCloseTo(0.75);
  });

  it.each(screens)(
    '%i×%i : 5 cartes dans l’écran, hors main, chrono, actions et zone de dépôt',
    (width, height) => {
      for (const topSeat of [false, true]) {
        const m = metrics(width, height);
        const L = computeGameTableLayout(m, { topSeat });
        const sw = L.smallCard;
        const sides: SeatSide[] = topSeat
          ? ['bottom', 'right', 'top', 'left']
          : ['bottom', 'right', 'left'];
        const hand = handZoneRect('bottom', 5, L, m);
        const action: Rect = {
          left: width - m.safe.right - L.action.width,
          top: L.action.top,
          width: L.action.width,
          height: height - L.action.top,
        };
        const drop: Rect = {
          left: L.cx - L.center.drop / 2,
          top: L.cy - L.center.drop / 2,
          width: L.center.drop,
          height: L.center.drop,
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
        for (const side of sides) {
          const z = seatZones(side, L, m);
          // Cartes jouées : légèrement plus petites que la main, réduites seulement si la place
          // manque, jamais sous 75 % d'un dos de carte (taille d'avant).
          const row = publicRowBox(z.publicRow, MAX_HAND_CARDS);
          expect(z.publicRow.cardWidth).toBeLessThanOrEqual(L.playedCard);
          expect(z.publicRow.cardWidth).toBeGreaterThanOrEqual(Math.ceil(sw * 0.75));
          expect(z.publicRow.step).toBeGreaterThanOrEqual(ROW_STEP);
          expect(z.publicRow.step).toBeLessThanOrEqual(PUBLIC_ROW_MAX_STEP);
          // Aucune carte hors de l'écran (bords sûrs compris).
          expect(row.left).toBeGreaterThanOrEqual(m.safe.left);
          expect(row.left + row.width).toBeLessThanOrEqual(width - m.safe.right + 0.5);
          for (const other of [hand, action, drop, hud, message]) {
            expect(overlaps(row, other)).toBe(false);
          }
          if (side === 'left') {
            // Vers la gauche : la rangée ne dépasse pas la plaque côté table.
            expect(row.left + row.width).toBeLessThanOrEqual(z.plate.left + L.plateWidth + 0.5);
          }
          if (side === 'top') {
            // Avant les contrôles du coin haut droit.
            expect(row.left + row.width).toBeLessThanOrEqual(
              width - m.safe.right - L.control * 2.6 - L.gap + 0.5,
            );
          }
          // Chaque carte garde sa place : positions distinctes, dans l'ordre de jeu.
          const lefts = [0, 1, 2, 3, 4].map((i) => publicCardLeft(z.publicRow, i));
          expect(new Set(lefts).size).toBe(5);
        }
      }
    },
  );

  it.each([
    [800, 360],
    [853, 393],
    [915, 412],
  ])('smartphone %i×%i : cartes jouées légèrement empilées, plus grandes qu’un dos', (width, height) => {
    const m = metrics(width, height);
    const L = computeGameTableLayout(m);
    for (const side of ['right', 'left', 'bottom'] as const) {
      const row = seatZones(side, L, m).publicRow;
      // Léger décalage : chevauchées, mais coin (valeur, famille) de chacune visible.
      expect(row.step).toBeGreaterThanOrEqual(ROW_STEP);
      expect(row.step).toBeLessThan(1);
      // Sur smartphone, la taille des cartes jouées est tenue : plus grandes qu'un dos.
      expect(row.cardWidth).toBeGreaterThan(L.smallCard);
      expect(row.cardWidth).toBeLessThan(L.cardWidth);
    }
  });

  it('rangée vers la gauche : la première carte reste au-dessus, son coin visible', async () => {
    const cards = ['COEUR-3', 'PIQUE-8', 'ETOILE-5'];
    await render(<PublicRow cardIds={cards} width={30} step={0.8} reverse />);
    const row = screen.getByTestId('public-row');
    const faces = row.children as unknown as { props: { style: unknown } }[];
    const styleOf = (i: number) => Object.assign({}, ...[faces[i]!.props.style].flat(3));
    expect(styleOf(0)).toMatchObject({ left: 48, zIndex: 3 });
    expect(styleOf(2)).toMatchObject({ left: 0, zIndex: 1 });
  });
});

describe('les cercles du centre (proportions de la référence)', () => {
  it('anneau gravé à 54 % du diamètre, trait à 4,4 %, zone de dépôt = intérieur de l’anneau', () => {
    for (const d of [200, 261, 300, 407, 560]) {
      const c = centerCircles(d);
      expect(c.ring).toBe(Math.round(d * 0.54));
      expect(c.ringBorder).toBe(Math.max(3, Math.round(d * 0.044)));
      expect(c.drop).toBe(c.ring - c.ringBorder * 2);
    }
    // Capture de référence : table 407 px, anneau 219 px, trait 18 px.
    expect(centerCircles(407)).toMatchObject({ ring: 220, ringBorder: 18 });
  });

  it.each([
    [640, 320],
    [800, 360],
    [853, 393],
    [915, 412],
  ])('smartphone %i×%i : table à 72,5 %% de la hauteur, concentrique, dans l’écran', (width, height) => {
    const m = metrics(width, height);
    const L = computeGameTableLayout(m, { topSeat: true });
    expect(L.diameter).toBeLessThanOrEqual(Math.round(height * TABLE_REFERENCE.diameterToHeight));
    // Assez de place sur ces écrans pour la proportion de la référence (± 2 px).
    expect(L.diameter).toBeGreaterThanOrEqual(height * TABLE_REFERENCE.diameterToHeight - 2);
    expect(L.cy + L.diameter / 2).toBeLessThanOrEqual(height - m.safe.bottom);
    expect(L.cx).toBe(width / 2);
    expect(L.center.ring).toBeLessThan(L.diameter);
    expect(L.center.drop).toBeLessThan(L.center.ring);
  });

  it('l’anneau gravé prend le diamètre et le trait de la disposition', async () => {
    await render(<WoodTable diameter={300} ring={162} ringBorder={13} />);
    expect(screen.getByTestId('table-ring')).toHaveStyle({
      width: 162,
      height: 162,
      borderRadius: 81,
      borderWidth: 13,
    });
  });
});

describe('chronomètre circulaire', () => {
  const L = computeGameTableLayout(metrics(800, 360));
  const hud = (game: GameView, receivedAt: number) => (
    <TurnHud
      game={game}
      receivedAt={receivedAt}
      layout={L}
      dealing={false}
      presenting={false}
      safeLeft={12}
      safeBottom={6}
    />
  );

  beforeEach(() => jest.useFakeTimers({ now: Date.parse('2026-10-09T10:01:00.000Z') }));
  afterEach(() => jest.useRealTimers());

  it('disque unique (aucun point), chiffre centré : temps restant de l’échéance serveur', async () => {
    const game = gameView({ serverNow: '2026-10-09T10:01:02.000Z' });
    await render(hud(game, Date.now()));
    // Échéance affichée 10:01:10 (serveur 10:01:13 − 3 s de marge) − 10:01:02 = 8 s.
    expect(screen.getByLabelText('8 secondes')).toHaveStyle({
      width: L.hud.ring,
      height: L.hud.ring,
      alignItems: 'center',
      justifyContent: 'center',
    });
    expect(screen.getByText('8')).toHaveStyle({ color: '#FFFFFF', textAlign: 'center' });
    expect(screen.getByTestId('timer-dial')).toBeTruthy();
    // Un seul arc continu, plus de petites boules en cercle.
    expect(screen.getAllByTestId('timer-arc')).toHaveLength(1);
    await act(() => jest.advanceTimersByTime(3000));
    expect(screen.getByText('5')).toBeTruthy();
  });

  it('carte lâchée ou cartes du tour pas encore rangées : roulette arrêtée aussitôt', async () => {
    const game = gameView({ serverNow: '2026-10-09T10:01:02.000Z' });
    // Réception de l'état fixée : seul le temps qui passe fait varier le chrono.
    const receivedAt = Date.now();
    const held = (turnHeld: boolean) => (
      <TurnHud
        game={game}
        receivedAt={receivedAt}
        layout={L}
        dealing={false}
        presenting={false}
        turnHeld={turnHeld}
        safeLeft={12}
        safeBottom={6}
      />
    );
    const { rerender } = await render(held(false));
    expect(screen.getByText('8')).toBeTruthy();
    // Même tour du serveur, mais ma carte vient d'être lâchée : plus de compte à rebours.
    await rerender(held(true));
    expect(screen.queryByText('8')).toBeNull();
    expect(
      screen.getByTestId('turn-timer', { includeHiddenElements: true }).props
        .accessibilityElementsHidden,
    ).toBe(true);
    // Coup refusé (ou cartes rangées) : le chrono reprend au temps réel restant du serveur.
    await act(() => jest.advanceTimersByTime(1000));
    await rerender(held(false));
    // Horloge du chrono recalée au tick suivant.
    await act(() => jest.advanceTimersByTime(250));
    expect(screen.getByText('7')).toBeTruthy();
  });

  it('nouveau tour : la valeur suit la nouvelle échéance fixée par le serveur', async () => {
    const { rerender } = await render(
      hud(gameView({ serverNow: '2026-10-09T10:01:02.000Z' }), Date.now()),
    );
    expect(screen.getByText('8')).toBeTruthy();
    await rerender(
      hud(
        gameView({
          // Je reprends la main (contrôle) : nouveau tour, nouvelle échéance.
          activePlayerId: ME,
          turnStartedAt: '2026-10-09T10:01:03.000Z',
          turnDeadlineAt: '2026-10-09T10:01:16.000Z',
          serverNow: '2026-10-09T10:01:03.000Z',
        }),
        Date.now(),
      ),
    );
    // Tour de 13 s côté serveur : 10 affichées, jamais 13.
    expect(screen.getByText('10')).toBeTruthy();
    // Tour d'un adversaire : chrono masqué sur mon téléphone (D-099), il voit sa barre.
    await rerender(
      hud(
        gameView({
          activePlayerId: OTHER,
          turnStartedAt: '2026-10-09T10:01:04.000Z',
          turnDeadlineAt: '2026-10-09T10:01:17.000Z',
          serverNow: '2026-10-09T10:01:04.000Z',
        }),
        Date.now(),
      ),
    );
    expect(screen.queryByTestId('turn-timer')).toBeNull();
    expect(
      screen.getByTestId('turn-timer', { includeHiddenElements: true }).props
        .accessibilityElementsHidden,
    ).toBe(true);
  });
});

describe('halo du joueur qui obtient le contrôle (3 s)', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('lit le détenteur officiel du contrôle, pas le joueur attendu', () => {
    const game = gameView({
      activePlayerId: OTHER,
      play: { ...gameView().play!, controllerId: THIRD },
    });
    expect(controllerOf(game, false)).toBe(THIRD);
    expect(controllerOf(game, true)).toBeUndefined();
    expect(controllerOf(gameView({ status: 'finished' }), false)).toBeUndefined();
  });

  it('s’allume au changement réel, dure 3 s, ne se relance pas sur un simple rafraîchissement', async () => {
    const { result, rerender } = await renderHook(
      ({ id }: { id: string | undefined }) => useControlSignal(id),
      { initialProps: { id: ME as string | undefined } },
    );
    // Détenteur présent dès l'ouverture (reconnexion) : rien n'a changé, pas de halo.
    expect(result.current).toBeNull();

    await rerender({ id: OTHER });
    expect(playerOfControlSignal(result.current!)).toBe(OTHER);
    await act(() => jest.advanceTimersByTime(CONTROL_SIGNAL_MS / 2));
    await rerender({ id: OTHER }); // même détenteur, nouvel état reçu
    expect(playerOfControlSignal(result.current!)).toBe(OTHER);
    await act(() => jest.advanceTimersByTime(CONTROL_SIGNAL_MS / 2 - 1));
    expect(result.current).not.toBeNull();
    await act(() => jest.advanceTimersByTime(1));
    expect(result.current).toBeNull();
    await rerender({ id: OTHER });
    expect(result.current).toBeNull();
  });

  it('changement avant la fin : le halo passe au nouveau détenteur, pour 3 s pleines', async () => {
    const { result, rerender } = await renderHook(
      ({ id }: { id: string | undefined }) => useControlSignal(id),
      { initialProps: { id: ME as string | undefined } },
    );
    await rerender({ id: OTHER });
    const first = result.current;
    await act(() => jest.advanceTimersByTime(2000));
    await rerender({ id: THIRD });
    expect(playerOfControlSignal(result.current!)).toBe(THIRD);
    await act(() => jest.advanceTimersByTime(2000));
    expect(playerOfControlSignal(result.current!)).toBe(THIRD);
    await act(() => jest.advanceTimersByTime(1000));
    expect(result.current).toBeNull();
    // Retour au premier détenteur : nouveau halo (nouveau jeton).
    await rerender({ id: OTHER });
    expect(result.current).not.toBe(first);
    expect(playerOfControlSignal(result.current!)).toBe(OTHER);
  });

  it('fin de la distribution : le premier contrôle (J1) est signalé', async () => {
    const { result, rerender } = await renderHook(
      ({ id }: { id: string | undefined }) => useControlSignal(id),
      { initialProps: { id: undefined as string | undefined } },
    );
    expect(result.current).toBeNull();
    await rerender({ id: ME });
    expect(playerOfControlSignal(result.current!)).toBe(ME);
  });

  it('halo en couches autour de la plaque : grande lueur, contour, sans capter les gestes', async () => {
    const rect = { left: 100, top: 50, width: 118, height: 40 };
    await render(<ControlGlow rect={rect} />);
    const spread = controlGlowSpread(rect.height);
    expect(spread).toBe(20);
    // Masqué aux lecteurs d'écran (décoratif) : la plaque annonce déjà « Contrôle ».
    const hidden = { includeHiddenElements: true };
    expect(screen.getByTestId('control-glow', hidden)).toHaveStyle({
      left: 80,
      top: 30,
      width: 158,
      height: 80,
      pointerEvents: 'none',
    });
    expect(screen.getByTestId('control-glow-bloom', hidden)).toHaveStyle({
      position: 'absolute',
      left: 0,
      top: 0,
      right: 0,
      bottom: 0,
    });
    // Deux anneaux pleins sans ombre (visibles quel que soit le rendu des ombres).
    const rings = screen.getAllByTestId('control-glow-ring', hidden);
    expect(rings).toHaveLength(2);
    expect(rings[0]).toHaveStyle({ left: 9, top: 9, right: 9, bottom: 9 });
    // Contour brillant juste autour de la plaque (4 px), dimensions de la plaque inchangées.
    expect(screen.getByTestId('control-glow-rim', hidden)).toHaveStyle({
      left: 16,
      top: 16,
      width: 126,
      height: 48,
      borderWidth: 3,
    });
  });

  it('grande lueur proportionnée : visible sur petit écran, contenue sur tablette', () => {
    expect(controlGlowSpread(30)).toBe(15);
    expect(controlGlowSpread(10)).toBe(12);
    expect(controlGlowSpread(80)).toBe(22);
  });

  it('animation : apparition immédiate, deux pulsations, jamais éteint entre elles, extinction à 3 s', () => {
    const { at, bloom, scale, core } = CONTROL_GLOW_KEYFRAMES;
    expect(at[0]).toBe(0);
    expect(at[at.length - 1]).toBe(1);
    expect([...at]).toEqual([...at].sort((a, b) => a - b));
    for (const track of [bloom, scale, core]) expect(track).toHaveLength(at.length);
    // Visible dès la 1re image (pas de montée depuis zéro).
    expect(bloom[0]).toBeGreaterThanOrEqual(0.7);
    expect(core[0]).toBe(1);
    // Exactement deux pics d'intensité ET de taille.
    const peaks = (v: readonly number[]) =>
      v.filter((x, i) => i > 0 && i < v.length - 1 && x > v[i - 1]! && x >= v[i + 1]!).length;
    expect(peaks(bloom)).toBe(2);
    expect(peaks(scale)).toBe(2);
    // Entre le 1er et le 2nd pic : intensité de base, jamais éteint.
    const first = bloom.indexOf(1);
    const second = bloom.lastIndexOf(1);
    expect(second).toBeGreaterThan(first);
    expect(Math.min(...bloom.slice(first, second + 1))).toBeGreaterThanOrEqual(0.5);
    expect(Math.min(...core.slice(0, second + 1))).toBeGreaterThanOrEqual(0.85);
    // Extinction complète à la fin.
    expect(bloom[bloom.length - 1]).toBe(0);
    expect(core[core.length - 1]).toBe(0);
    expect(CONTROL_SIGNAL_MS).toBe(3000);
  });
});
