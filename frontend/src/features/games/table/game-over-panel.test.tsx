/// <reference types="jest" />
import {
  act,
  cleanup,
  fireEvent,
  render,
  renderHook,
  screen,
} from "@testing-library/react-native";
import { Text } from "react-native";

import {
  DEFAULT_PREFERENCES,
  usePreferencesStore,
} from "../../../stores/preferences-store";
import type { GameView } from "../../../types/game";
import {
  EXIT_COUNTDOWN_SECONDS,
  GameOverPanel,
  signedAmount,
  useExitCountdown,
} from "./GameOverPanel";

jest.mock("expo-secure-store", () => ({
  getItemAsync: jest.fn(async () => null),
  setItemAsync: jest.fn(async () => undefined),
  deleteItemAsync: jest.fn(async () => undefined),
}));

const ME = "p-me";
const OTHER = "p-other";
const NOW = "2026-10-11T10:00:00.000Z";

function finishedGame(overrides: Partial<GameView> = {}): GameView {
  return {
    gameId: "g-1",
    sessionId: "session-1",
    firstPlayerId: OTHER,
    version: 9,
    status: "finished",
    creatorId: OTHER,
    maxPlayers: 2,
    players: [
      { playerId: OTHER, seat: 0, joinedAt: NOW, username: "Sorobio" },
      { playerId: ME, seat: 1, joinedAt: NOW, username: "Mo’AmB" },
    ],
    result: {
      winnerId: OTHER,
      method: "CONTROL_AFTER_LAST_TRICK",
      remainingOpponentIds: [ME],
      fledPlayerIds: [],
    },
    mySettlement: { delta: -84 },
    myActions: {
      canPlayCard: false,
      playableCardIds: [],
      canFlee: false,
      canDeclareInstantWin: false,
    },
    viewerId: ME,
    createdAt: NOW,
    ...overrides,
  } as GameView;
}

type PanelProps = Parameters<typeof GameOverPanel>[0];

function panel(overrides: Partial<PanelProps> = {}) {
  const onQuit = jest.fn(async () => true);
  const onReplay = jest.fn(async () => true);
  const props: PanelProps = {
    game: finishedGame(),
    width: 320,
    awaitingMe: true,
    canContinue: true,
    pending: false,
    onQuit,
    onReplay,
    ...overrides,
  };
  return {
    props,
    onQuit: props.onQuit as jest.Mock,
    onReplay: props.onReplay as jest.Mock,
  };
}

/** Laisse les promesses des actions se résoudre. */
const flush = () => act(async () => {});
const advance = (ms: number) =>
  act(async () => {
    jest.advanceTimersByTime(ms);
  });

beforeEach(() => {
  jest.useFakeTimers({ now: Date.parse(NOW) });
  usePreferencesStore.setState(DEFAULT_PREFERENCES);
});
afterEach(async () => {
  await cleanup();
  jest.useRealTimers();
});

describe("panneau de fin de partie : contenu", () => {
  it("défaite : gagnant réel, message, montant réglé avec jeton, deux boutons, 10 s affichées (D-098)", async () => {
    const { props } = panel();
    await render(<GameOverPanel {...props} />);

    expect(screen.getByTestId("game-over-title")).toHaveTextContent(
      "Sorobio a gagné la partie.",
    );
    // Défaite : ni pile de jetons ni ancien badge du gagnant.
    expect(screen.queryByTestId("game-over-chips")).toBeNull();
    expect(screen.queryByTestId("game-over-winner")).toBeNull();
    expect(screen.getByText("Vous perdez")).toBeTruthy();
    expect(screen.getByText("-84")).toBeTruthy();
    expect(screen.getByTestId("game-over-coin")).toBeTruthy();
    expect(screen.getByLabelText("-84 jetons")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Quitter" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Rejouer" })).toBeTruthy();
    expect(screen.getByTestId("game-over-countdown")).toHaveTextContent(
      "La partie sera quittée dans 10 secondes",
    );
  });

  it("victoire du joueur : message personnel et gain signé positif", async () => {
    const game = finishedGame({
      result: {
        winnerId: ME,
        method: "CONTROL_AFTER_LAST_TRICK",
        remainingOpponentIds: [OTHER],
        fledPlayerIds: [],
      },
      mySettlement: { delta: 98 },
    });
    await render(<GameOverPanel {...panel({ game }).props} />);

    expect(screen.getByTestId("game-over-title")).toHaveTextContent(
      "Vous avez gagné !",
    );
    expect(screen.getByTestId("game-over-chips")).toBeTruthy();
    expect(screen.getByText("Vous gagnez")).toBeTruthy();
    expect(screen.getByText("+98")).toBeTruthy();
  });

  it("sans règlement (table de tournoi) : aucun montant inventé", async () => {
    const game = finishedGame({ mySettlement: undefined });
    await render(<GameOverPanel {...panel({ game }).props} />);

    expect(screen.getByText("Vous perdez")).toBeTruthy();
    expect(screen.queryByTestId("game-over-amount")).toBeNull();
  });

  it("partie arrêtée sans gagnant : pas de badge, aucun gain ni perte", async () => {
    const game = finishedGame({
      result: undefined,
      mySettlement: { delta: 0 },
    });
    await render(<GameOverPanel {...panel({ game }).props} />);

    expect(screen.queryByTestId("game-over-winner")).toBeNull();
    expect(screen.getByText("Partie arrêtée.")).toBeTruthy();
    expect(screen.getByText("Aucun gain ni perte")).toBeTruthy();
    expect(screen.getByText("0")).toBeTruthy();
  });

  it("pseudo du gagnant pas encore reçu : libellé de repli, jamais un titre vide", async () => {
    const game = finishedGame({
      players: [
        { playerId: OTHER, seat: 0, joinedAt: NOW },
        { playerId: ME, seat: 1, joinedAt: NOW, username: "Mo’AmB" },
      ] as GameView["players"],
    });
    await render(<GameOverPanel {...panel({ game }).props} />);

    expect(screen.getByTestId("game-over-title")).toHaveTextContent(
      "Adversaire a gagné la partie.",
    );
  });

  it("état final reçu plusieurs fois : un seul panneau, même montant, compte à rebours continu", async () => {
    const { props } = panel();
    const view = await render(<GameOverPanel {...props} />);
    await advance(3_000);
    await view.rerender(
      <GameOverPanel {...props} game={finishedGame({ version: 10 })} />,
    );

    expect(screen.getAllByTestId("game-over-panel")).toHaveLength(1);
    expect(screen.getAllByText("-84")).toHaveLength(1);
    expect(screen.getByTestId("game-over-countdown")).toHaveTextContent(
      "La partie sera quittée dans 7 secondes",
    );
  });

  it("signes affichés", () => {
    expect(signedAmount(-84)).toBe("-84");
    expect(signedAmount(98)).toBe("+98");
    expect(signedAmount(0)).toBe("0");
  });

  it("en anglais", async () => {
    usePreferencesStore.getState().setLanguage("en");
    await render(<GameOverPanel {...panel().props} />);

    expect(screen.getByText("Sorobio won the game.")).toBeTruthy();
    expect(screen.getByText("You lose")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Quit" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Play again" })).toBeTruthy();
    expect(screen.getByTestId("game-over-countdown")).toHaveTextContent(
      "Leaving the game in 10 seconds",
    );
  });

  it("réponse plus attendue : le pied remplace boutons et compte à rebours", async () => {
    const { props, onQuit } = panel({
      awaitingMe: false,
      footer: <Text>Nouvelle partie…</Text>,
    });
    await render(<GameOverPanel {...props} />);

    expect(screen.getByText("Nouvelle partie…")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Quitter" })).toBeNull();
    expect(screen.queryByTestId("game-over-countdown")).toBeNull();
    await advance(20_000);
    expect(onQuit).not.toHaveBeenCalled();
  });
});

describe("panneau de fin de partie : message selon le résultat officiel", () => {
  const THIRD = "p-third";
  const threePlayers = (result: GameView["result"], viewerId = ME) =>
    finishedGame({
      maxPlayers: 3,
      viewerId,
      players: [
        { playerId: OTHER, seat: 0, joinedAt: NOW, username: "Sorobio" },
        { playerId: ME, seat: 1, joinedAt: NOW, username: "Mo’AmB" },
        { playerId: THIRD, seat: 2, joinedAt: NOW, username: "Awa" },
      ],
      result,
      mySettlement: undefined,
    });
  const instantWin = {
    winnerId: OTHER,
    method: "INSTANT_WIN" as const,
    instantWinRank: 3 as const,
    instantWinCombination: "FIVE_SAME_SUIT" as const,
    automatic: false,
    victoryType: "SIMPLE" as const,
    remainingOpponentIds: [ME, THIRD],
    fledPlayerIds: [],
  };

  it("main spéciale : le gagnant, chaque perdant et la combinaison, sans contradiction", async () => {
    for (const [viewerId, title, outcome] of [
      [OTHER, "Vous avez gagné !", "Vous gagnez"],
      [ME, "Sorobio a gagné la partie.", "Vous perdez"],
      [THIRD, "Sorobio a gagné la partie.", "Vous perdez"],
    ] as const) {
      const { props } = panel({ game: threePlayers(instantWin, viewerId) });
      await render(<GameOverPanel {...props} />);
      expect(screen.getByTestId("game-over-title")).toHaveTextContent(title);
      expect(screen.getByTestId("game-over-reason")).toHaveTextContent(
        "Victoire par main spéciale : Cinq cartes de la même famille",
      );
      expect(screen.getByText(outcome)).toBeTruthy();
      await cleanup();
    }
  });

  it("victoire au contrôle : aucune mention de main spéciale ni de fuite", async () => {
    const { props } = panel();
    await render(<GameOverPanel {...props} />);
    expect(screen.queryByTestId("game-over-reason")).toBeNull();
  });

  it("partie à 2, adversaire couché : le gagnant le sait, le fuyard voit sa fuite", async () => {
    const result = {
      winnerId: ME,
      method: "OPPONENT_FLED" as const,
      victoryType: "SIMPLE" as const,
      remainingOpponentIds: [],
      fledPlayerIds: [OTHER],
    };
    const winner = finishedGame({ result, mySettlement: { delta: 99 } });
    let { props } = panel({ game: winner });
    await render(<GameOverPanel {...props} />);
    expect(screen.getByTestId("game-over-title")).toHaveTextContent("Vous avez gagné !");
    expect(screen.getByTestId("game-over-reason")).toHaveTextContent("Sorobio s’est couché.");
    expect(screen.getByText("Vous gagnez")).toBeTruthy();
    await cleanup();

    const fled = finishedGame({
      viewerId: OTHER,
      players: winner.players.map((p) => (p.playerId === OTHER ? { ...p, fledAt: NOW } : p)),
      result,
      mySettlement: { delta: -100 },
    });
    ({ props } = panel({ game: fled }));
    await render(<GameOverPanel {...props} />);
    expect(screen.getByTestId("game-over-title")).toHaveTextContent("Mo’AmB a gagné la partie.");
    expect(screen.getByText("Vous avez fui la partie")).toBeTruthy();
    expect(screen.queryByText("Vous perdez")).toBeNull();
    expect(screen.queryByTestId("game-over-reason")).toBeNull();
    expect(screen.getByText("-100")).toBeTruthy();
  });

  it("partie à 3 avec un fuyard : seul le fuyard voit « Vous avez fui », les autres leur propre résultat", async () => {
    const result = {
      winnerId: THIRD,
      method: "CONTROL_AFTER_LAST_TRICK" as const,
      remainingOpponentIds: [OTHER],
      fledPlayerIds: [ME],
    };
    const game = threePlayers(result);
    const fledGame = {
      ...game,
      players: game.players.map((p) => (p.playerId === ME ? { ...p, fledAt: NOW } : p)),
    };
    for (const [viewerId, outcome] of [
      [ME, "Vous avez fui la partie"],
      [OTHER, "Vous perdez"],
      [THIRD, "Vous gagnez"],
    ] as const) {
      const { props } = panel({ game: { ...fledGame, viewerId } });
      await render(<GameOverPanel {...props} />);
      expect(screen.getByText(outcome)).toBeTruthy();
      expect(screen.queryByTestId("game-over-reason")).toBeNull();
      await cleanup();
    }
  });

  it("en anglais : même résultat, textes traduits", async () => {
    usePreferencesStore.getState().setLanguage("en");
    const { props } = panel({ game: threePlayers(instantWin, ME) });
    await render(<GameOverPanel {...props} />);
    expect(screen.getByTestId("game-over-title")).toHaveTextContent("Sorobio won the game.");
    expect(screen.getByTestId("game-over-reason")).toHaveTextContent(
      "Special hand win: Five cards of the same suit",
    );
    expect(screen.getByText("You lose")).toBeTruthy();
  });
});

describe("panneau de fin de partie : « Rejouer » selon le solde (D-073)", () => {
  it("solde refusé par le serveur : Rejouer absent, seul Quitter, explication", async () => {
    const { props, onReplay } = panel({ canContinue: false });
    await render(<GameOverPanel {...props} />);

    expect(screen.queryByRole("button", { name: "Rejouer" })).toBeNull();
    expect(screen.queryByText("Rejouer")).toBeNull();
    expect(screen.getByRole("button", { name: "Quitter" })).toBeTruthy();
    expect(screen.getByTestId("game-over-replay-notice")).toHaveTextContent(
      /il faut au moins le double de la mise/,
    );
    expect(onReplay).not.toHaveBeenCalled();
  });

  it("solde non vérifié : Rejouer absent, la sortie reste possible", async () => {
    const { props, onQuit } = panel({ canContinue: undefined });
    await render(<GameOverPanel {...props} />);

    expect(screen.queryByRole("button", { name: "Rejouer" })).toBeNull();
    expect(screen.getByTestId("game-over-replay-notice")).toHaveTextContent(
      /Vérification du solde impossible/,
    );
    await fireEvent.press(screen.getByRole("button", { name: "Quitter" }));
    await flush();
    expect(onQuit).toHaveBeenCalledWith(false);
  });

  it("nouvelle vue du serveur sans autorisation : Rejouer disparaît", async () => {
    const { props } = panel();
    const view = await render(<GameOverPanel {...props} />);
    expect(screen.getByRole("button", { name: "Rejouer" })).toBeTruthy();

    await view.rerender(<GameOverPanel {...props} canContinue={false} />);
    expect(screen.queryByRole("button", { name: "Rejouer" })).toBeNull();
  });

  it("réponse pas encore attendue : ni Rejouer refusé ni explication prématurée", async () => {
    await render(
      <GameOverPanel
        {...panel({ awaitingMe: undefined, canContinue: undefined }).props}
      />,
    );
    expect(screen.queryByRole("button", { name: "Rejouer" })).toBeNull();
    expect(screen.queryByTestId("game-over-replay-notice")).toBeNull();
  });
});

describe("panneau de fin de partie : compte à rebours et actions", () => {
  it("décompte réel puis sortie automatique UNE seule fois à zéro", async () => {
    const { props, onQuit } = panel();
    await render(<GameOverPanel {...props} />);

    await advance(4_000);
    expect(screen.getByTestId("game-over-countdown")).toHaveTextContent(
      /dans 6 secondes/,
    );
    await advance(EXIT_COUNTDOWN_SECONDS * 1000 - 4_000);
    await flush();
    expect(onQuit).toHaveBeenCalledTimes(1);
    expect(onQuit).toHaveBeenCalledWith(true);
    await advance(30_000);
    expect(onQuit).toHaveBeenCalledTimes(1);
  });

  it("jamais plus long que l’échéance du serveur", async () => {
    const { props, onQuit } = panel({ capAt: Date.parse(NOW) + 5_000 });
    await render(<GameOverPanel {...props} />);

    expect(screen.getByTestId("game-over-countdown")).toHaveTextContent(
      /dans 5 secondes/,
    );
    await advance(5_000);
    await flush();
    expect(onQuit).toHaveBeenCalledWith(true);
  });

  it("Quitter : une seule sortie, compte à rebours annulé, Rejouer bloqué", async () => {
    const { props, onQuit, onReplay } = panel();
    await render(<GameOverPanel {...props} />);

    await fireEvent.press(screen.getByRole("button", { name: "Quitter" }));
    await fireEvent.press(screen.getByRole("button", { name: "Quitter" }));
    await fireEvent.press(screen.getByRole("button", { name: "Rejouer" }));
    await flush();
    expect(onQuit).toHaveBeenCalledTimes(1);
    expect(onQuit).toHaveBeenCalledWith(false);
    expect(onReplay).not.toHaveBeenCalled();
    expect(screen.queryByTestId("game-over-countdown")).toBeNull();
    await advance(30_000);
    expect(onQuit).toHaveBeenCalledTimes(1);
  });

  it("Rejouer : une seule relance, compte à rebours de l’ancienne partie annulé", async () => {
    const { props, onQuit, onReplay } = panel();
    await render(<GameOverPanel {...props} />);

    await fireEvent.press(screen.getByRole("button", { name: "Rejouer" }));
    await fireEvent.press(screen.getByRole("button", { name: "Rejouer" }));
    await flush();
    expect(onReplay).toHaveBeenCalledTimes(1);
    await advance(30_000);
    expect(onQuit).not.toHaveBeenCalled();
  });

  it("Rejouer indisponible tant que le serveur n’attend pas ma réponse", async () => {
    const { props, onReplay } = panel({ awaitingMe: undefined });
    await render(<GameOverPanel {...props} />);

    await fireEvent.press(screen.getByRole("button", { name: "Rejouer" }));
    await flush();
    expect(onReplay).not.toHaveBeenCalled();
  });

  it("action refusée par le serveur : le panneau redevient actif", async () => {
    const onReplay = jest.fn(async () => false);
    const { props } = panel({ onReplay, error: "Ronde terminée." });
    await render(<GameOverPanel {...props} />);

    await fireEvent.press(screen.getByRole("button", { name: "Rejouer" }));
    await flush();
    expect(screen.getByText("Ronde terminée.")).toBeTruthy();
    expect(screen.getByTestId("game-over-countdown")).toBeTruthy();
    await fireEvent.press(screen.getByRole("button", { name: "Rejouer" }));
    await flush();
    expect(onReplay).toHaveBeenCalledTimes(2);
  });

  it("démontage (navigation, changement de partie) : aucun timer résiduel", async () => {
    const { props, onQuit } = panel();
    const view = await render(<GameOverPanel {...props} />);

    await view.unmount();
    await advance(30_000);
    expect(onQuit).not.toHaveBeenCalled();
  });

  it("deux parties : chaque panneau a son propre compte à rebours et ses actions", async () => {
    const a = panel({ game: finishedGame({ gameId: "g-a" }) });
    const b = panel({
      game: finishedGame({ gameId: "g-b" }),
      capAt: Date.parse(NOW) + 8_000,
    });
    await render(
      <>
        <GameOverPanel {...a.props} />
        <GameOverPanel {...b.props} />
      </>,
    );

    await fireEvent.press(
      screen.getAllByRole("button", { name: "Quitter" })[0]!,
    );
    await flush();
    expect(a.onQuit).toHaveBeenCalledWith(false);
    expect(b.onQuit).not.toHaveBeenCalled();

    await advance(8_000);
    await flush();
    expect(b.onQuit).toHaveBeenCalledWith(true);
    expect(a.onQuit).toHaveBeenCalledTimes(1);
  });
});

describe("useExitCountdown : un seul timer, jamais résiduel", () => {
  // Les timers sont comptés par rapport à un hook inactif (le moteur de rendu a les siens).
  it("arrêté puis démonté : le décompte se fige et ne rappelle jamais", async () => {
    const onExpire = jest.fn();
    const hook = await renderHook(
      ({ active }: { active: boolean }) =>
        useExitCountdown(active, undefined, onExpire),
      { initialProps: { active: true } },
    );
    await advance(3_000);
    expect(hook.result.current).toBe(EXIT_COUNTDOWN_SECONDS - 3);

    await hook.rerender({ active: false });
    await advance(30_000);
    expect(hook.result.current).toBe(EXIT_COUNTDOWN_SECONDS - 3);
    expect(onExpire).not.toHaveBeenCalled();

    await hook.rerender({ active: true });
    await hook.unmount();
    await advance(30_000);
    expect(onExpire).not.toHaveBeenCalled();
  });

  it("à zéro : un seul rappel, puis le timer s’arrête de lui-même", async () => {
    const onExpire = jest.fn();
    const hook = await renderHook(
      ({ active }: { active: boolean }) =>
        useExitCountdown(active, undefined, onExpire),
      { initialProps: { active: false } },
    );
    const baseline = jest.getTimerCount();
    await hook.rerender({ active: true });
    await advance(EXIT_COUNTDOWN_SECONDS * 1000);
    expect(hook.result.current).toBe(0);
    expect(onExpire).toHaveBeenCalledTimes(1);
    expect(jest.getTimerCount()).toBeLessThanOrEqual(baseline);
    await advance(30_000);
    expect(onExpire).toHaveBeenCalledTimes(1);
  });
});
