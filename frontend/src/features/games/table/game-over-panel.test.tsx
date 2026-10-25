/// <reference types="jest" />
import {
  act,
  cleanup,
  fireEvent,
  render,
  renderHook,
  screen,
} from "@testing-library/react-native";
import { StyleSheet, Text } from "react-native";

import {
  DEFAULT_PREFERENCES,
  usePreferencesStore,
} from "../../../stores/preferences-store";
import type { GameView } from "../../../types/game";
import {
  amountColor,
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
    mySettlement: { delta: -84, account: "WALLET" },
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
      mySettlement: { delta: 98, account: "WALLET" },
    });
    await render(<GameOverPanel {...panel({ game }).props} />);

    expect(screen.getByTestId("game-over-title")).toHaveTextContent(
      "Vous avez gagné !",
    );
    expect(screen.getByTestId("game-over-chips")).toBeTruthy();
    expect(screen.getByText("Vous gagnez")).toBeTruthy();
    expect(screen.getByText("+98")).toBeTruthy();
  });

  it("pas encore réglée (ou sans mise) : aucun montant inventé", async () => {
    const game = finishedGame({ mySettlement: undefined });
    await render(<GameOverPanel {...panel({ game }).props} />);

    expect(screen.getByText("Vous perdez")).toBeTruthy();
    expect(screen.queryByTestId("game-over-amount")).toBeNull();
  });

  it("victoire en tournoi : même titre, même message, même montant ; compte fictif signalé", async () => {
    const won = {
      winnerId: ME,
      method: "CONTROL_AFTER_LAST_TRICK" as const,
      remainingOpponentIds: [OTHER],
      fledPlayerIds: [],
    };
    const ordinary = finishedGame({ result: won, mySettlement: { delta: 100, account: "WALLET" } });
    const tournament = finishedGame({
      result: won,
      tournamentId: "t-1",
      mySettlement: { delta: 100, account: "TOURNAMENT" },
    });

    await render(<GameOverPanel {...panel({ game: ordinary }).props} />);
    const ordinaryTitle = screen.getByTestId("game-over-title").props.children;
    expect(screen.getByText("+100")).toBeTruthy();
    expect(screen.getByText("Vous gagnez")).toBeTruthy();
    expect(screen.queryByTestId("game-over-tournament-note")).toBeNull();
    expect(screen.getByTestId("game-over-amount").props.accessibilityLabel).toBe("+100 jetons");
    await cleanup();

    await render(<GameOverPanel {...panel({ game: tournament }).props} />);
    expect(screen.getByTestId("game-over-title").props.children).toBe(ordinaryTitle);
    expect(screen.getByTestId("game-over-chips")).toBeTruthy();
    expect(screen.getByText("Vous gagnez")).toBeTruthy();
    expect(screen.getByText("+100")).toBeTruthy();
    expect(screen.getByTestId("game-over-tournament-note")).toHaveTextContent(
      "Jetons du tournoi — solde fictif, votre solde réel est inchangé",
    );
    expect(screen.getByTestId("game-over-amount").props.accessibilityLabel).toBe(
      "+100 jetons du tournoi (solde fictif)",
    );
  });

  it("défaite en tournoi : message habituel, perte sur le compte fictif", async () => {
    const game = finishedGame({
      tournamentId: "t-1",
      mySettlement: { delta: -200, account: "TOURNAMENT" },
    });
    await render(<GameOverPanel {...panel({ game }).props} />);

    expect(screen.getByText("Vous perdez")).toBeTruthy();
    expect(screen.getByText("-200")).toBeTruthy();
    expect(screen.getByTestId("game-over-tournament-note")).toBeTruthy();
  });

  it("partie arrêtée sans gagnant : pas de badge, aucun gain ni perte", async () => {
    const game = finishedGame({
      result: undefined,
      mySettlement: { delta: 0, account: "WALLET" },
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

  it("GARAM : victoire à 22 points annoncée « Victoire avec deux As » ; un autre total reste « Meilleur total »", async () => {
    const garamWin = (score: number) =>
      finishedGame({
        result: {
          winnerId: OTHER,
          method: "GARAM_BEST_SCORE" as const,
          scores: { [OTHER]: score, [ME]: 18 },
          belowThresholdIds: [],
          penaltyThreshold: 15,
          remainingOpponentIds: [ME],
          fledPlayerIds: [],
        },
        mySettlement: undefined,
      });
    const twoAces = panel({ game: garamWin(22) });
    await render(<GameOverPanel {...twoAces.props} />);
    expect(screen.getByTestId("game-over-reason")).toHaveTextContent("Victoire avec deux As");
    expect(screen.queryByText(/22/)).toBeNull();
    await cleanup();
    const best = panel({ game: garamWin(21) });
    await render(<GameOverPanel {...best.props} />);
    expect(screen.getByTestId("game-over-reason")).toHaveTextContent("Meilleur total : 21");
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
    const winner = finishedGame({ result, mySettlement: { delta: 99, account: "WALLET" } });
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
      mySettlement: { delta: -100, account: "WALLET" },
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

describe("panneau de fin de partie : victoire par Full (THREE_AND_TWO)", () => {
  const instantWin = (combination: "THREE_AND_TWO" | "FIVE_SAME_SUIT", winnerId = ME) => ({
    winnerId,
    method: "INSTANT_WIN" as const,
    instantWinRank: combination === "THREE_AND_TWO" ? 5 : 3,
    instantWinCombination: combination,
    automatic: false,
    victoryType: "SIMPLE" as const,
    remainingOpponentIds: [winnerId === ME ? OTHER : ME],
    fledPlayerIds: [],
  });
  const wonWith = (combination: "THREE_AND_TWO" | "FIVE_SAME_SUIT") =>
    finishedGame({
      result: instantWin(combination),
      mySettlement: { delta: 98, account: "WALLET" },
    });

  it("ma victoire par Full : surtitre, « Vous avez gagné ! », « Main spéciale : » puis « Full »", async () => {
    await render(<GameOverPanel {...panel({ game: wonWith("THREE_AND_TWO") }).props} />);

    expect(screen.getByTestId("game-over-special-kicker")).toHaveTextContent("Main spéciale");
    expect(screen.getByTestId("game-over-title")).toHaveTextContent("Vous avez gagné !");
    expect(screen.getByText("Main spéciale :")).toBeTruthy();
    expect(screen.getByTestId("game-over-special-name")).toHaveTextContent("Full");
    // Même icône de victoire, même bilan ; l'ancienne ligne de raison n'est pas doublée.
    expect(screen.getByTestId("game-over-chips")).toBeTruthy();
    expect(screen.getByText("Vous gagnez")).toBeTruthy();
    expect(screen.getByText("+98")).toBeTruthy();
    expect(screen.queryByTestId("game-over-reason")).toBeNull();
  });

  it("autre main spéciale gagnée : comportement inchangé, aucun bloc Full", async () => {
    await render(<GameOverPanel {...panel({ game: wonWith("FIVE_SAME_SUIT") }).props} />);

    expect(screen.getByTestId("game-over-reason")).toHaveTextContent(
      "Victoire par main spéciale : Cinq cartes de la même famille",
    );
    expect(screen.queryByTestId("game-over-special-kicker")).toBeNull();
    expect(screen.queryByTestId("game-over-special-hand")).toBeNull();
  });

  it("Full gagné par un adversaire, ou victoire au contrôle : comportement inchangé", async () => {
    const lost = finishedGame({ result: instantWin("THREE_AND_TWO", OTHER) });
    await render(<GameOverPanel {...panel({ game: lost }).props} />);
    expect(screen.getByTestId("game-over-title")).toHaveTextContent("Sorobio a gagné la partie.");
    expect(screen.getByTestId("game-over-reason")).toHaveTextContent(
      "Victoire par main spéciale : Trois + deux",
    );
    expect(screen.queryByTestId("game-over-special-hand")).toBeNull();
    await cleanup();

    await render(<GameOverPanel {...panel().props} />);
    expect(screen.queryByTestId("game-over-special-hand")).toBeNull();
    expect(screen.queryByTestId("game-over-special-kicker")).toBeNull();
  });

  it("même boîte que les autres victoires : largeur et positionnement du panneau inchangés", async () => {
    const boxOf = () => {
      const style = StyleSheet.flatten(screen.getByTestId("game-over-panel").props.style);
      return { width: style.width, position: style.position, top: style.top, left: style.left };
    };
    await render(<GameOverPanel {...panel({ game: wonWith("FIVE_SAME_SUIT") }).props} />);
    const ordinary = boxOf();
    await cleanup();

    await render(<GameOverPanel {...panel({ game: wonWith("THREE_AND_TWO") }).props} />);
    expect(boxOf()).toEqual(ordinary);
    expect(ordinary).toEqual({ width: 320, position: undefined, top: undefined, left: undefined });
    // Le bloc Full reste dans le flux du panneau : rien n'est posé par-dessus la table.
    const block = StyleSheet.flatten(screen.getByTestId("game-over-special-hand").props.style);
    expect(block.position).toBeUndefined();
  });

  it("aucun recalcul : seule la combinaison du serveur compte, jamais les cartes", async () => {
    // Main affichée qui formerait un Full : sans THREE_AND_TWO du serveur, pas de Full.
    const fullLookingHand = {
      ...wonWith("FIVE_SAME_SUIT"),
      myHand: ["H7", "S7", "D7", "H3", "S3"],
    } as unknown as GameView;
    await render(<GameOverPanel {...panel({ game: fullLookingHand }).props} />);
    expect(screen.queryByTestId("game-over-special-hand")).toBeNull();
    await cleanup();

    // Combinaison du serveur sans aucune carte connue : le Full est affiché quand même.
    const noCards = { ...wonWith("THREE_AND_TWO"), myHand: [] } as unknown as GameView;
    await render(<GameOverPanel {...panel({ game: noCards }).props} />);
    expect(screen.getByTestId("game-over-special-name")).toHaveTextContent("Full");
  });

  it("en anglais", async () => {
    usePreferencesStore.getState().setLanguage("en");
    await render(<GameOverPanel {...panel({ game: wonWith("THREE_AND_TWO") }).props} />);
    expect(screen.getByTestId("game-over-special-kicker")).toHaveTextContent("Special hand");
    expect(screen.getByTestId("game-over-title")).toHaveTextContent("You won!");
    expect(screen.getByText("Special hand:")).toBeTruthy();
    expect(screen.getByTestId("game-over-special-name")).toHaveTextContent("Full house");
  });
});

describe("panneau de fin de partie : victoire par « Somme ≤ 21 » (SUM_AT_MOST_21)", () => {
  // Main de la capture : 3♠ 5♠ 4♥ 4♣ 4⭐ (3 + 5 + 4 + 4 + 4 = 20), combinaison retenue par le serveur.
  const sumWin = (winnerId = ME) =>
    finishedGame({
      result: {
        winnerId,
        method: "INSTANT_WIN" as const,
        instantWinRank: 2,
        instantWinCombination: "SUM_AT_MOST_21",
        automatic: false,
        victoryType: "SIMPLE" as const,
        remainingOpponentIds: [winnerId === ME ? OTHER : ME],
        fledPlayerIds: [],
      },
      mySettlement: { delta: 98, account: "WALLET" },
    });

  it("ma victoire : « Main spéciale », « Vous avez gagné ! », « Main spéciale : » puis le nom", async () => {
    await render(<GameOverPanel {...panel({ game: sumWin() }).props} />);

    expect(screen.getByTestId("game-over-special-kicker")).toHaveTextContent("Main spéciale");
    expect(screen.getByTestId("game-over-title")).toHaveTextContent("Vous avez gagné !");
    expect(screen.getByText("Main spéciale :")).toBeTruthy();
    const name = screen.getByTestId("game-over-special-name");
    expect(name).toHaveTextContent("Somme inférieur ou égale à 21");
    // Nom long : réduit sur une ligne, la hauteur du panneau ne bouge pas.
    expect(name.props).toMatchObject({ numberOfLines: 1, adjustsFontSizeToFit: true });
    expect(screen.getByTestId("game-over-chips")).toBeTruthy();
    expect(screen.queryByTestId("game-over-reason")).toBeNull();
  });

  it("même boîte que le Full : largeur et position du panneau inchangées", async () => {
    await render(<GameOverPanel {...panel({ game: sumWin() }).props} />);
    const style = StyleSheet.flatten(screen.getByTestId("game-over-panel").props.style);
    expect(style).toMatchObject({ width: 320 });
    expect(style.position).toBeUndefined();
  });

  it("gagnée par un adversaire : ligne de raison inchangée, pas de bloc", async () => {
    await render(<GameOverPanel {...panel({ game: sumWin(OTHER) }).props} />);
    expect(screen.getByTestId("game-over-reason")).toHaveTextContent(
      "Victoire par main spéciale : Somme ≤ 21",
    );
    expect(screen.queryByTestId("game-over-special-hand")).toBeNull();
  });

  it("en anglais", async () => {
    usePreferencesStore.getState().setLanguage("en");
    await render(<GameOverPanel {...panel({ game: sumWin() }).props} />);
    expect(screen.getByTestId("game-over-special-name")).toHaveTextContent("Total of 21 or less");
  });
});

describe("panneau de fin de partie : victoire par « Composition de 7 » (COMPOSITION_OF_SEVEN, D-118)", () => {
  // Main de la capture : 3♠ 4♥ 8♥ 7♣ 7★ (deux 7, un 4, un 3), combinaison retenue par le serveur.
  const compositionWin = (winnerId = ME) =>
    finishedGame({
      result: {
        winnerId,
        method: "INSTANT_WIN" as const,
        instantWinRank: 6,
        instantWinCombination: "COMPOSITION_OF_SEVEN",
        automatic: false,
        victoryType: "SIMPLE" as const,
        remainingOpponentIds: [winnerId === ME ? OTHER : ME],
        fledPlayerIds: [],
      },
      mySettlement: { delta: 98, account: "WALLET" },
    });

  it("ma victoire : « Main spéciale », « Vous avez gagné ! », « Main spéciale : » puis « Composition de 7 »", async () => {
    await render(<GameOverPanel {...panel({ game: compositionWin() }).props} />);

    expect(screen.getByTestId("game-over-special-kicker")).toHaveTextContent("Main spéciale");
    expect(screen.getByTestId("game-over-title")).toHaveTextContent("Vous avez gagné !");
    expect(screen.getByText("Main spéciale :")).toBeTruthy();
    expect(screen.getByTestId("game-over-special-name")).toHaveTextContent(/^Composition de 7$/);
    // Ni « Full » ni « Paire », ni la ligne de raison générique.
    expect(screen.queryByText(/Full|Paire/)).toBeNull();
    expect(screen.queryByTestId("game-over-reason")).toBeNull();
    expect(screen.getByTestId("game-over-chips")).toBeTruthy();
  });

  it("même boîte que les autres mains spéciales : largeur et position du panneau inchangées", async () => {
    await render(<GameOverPanel {...panel({ game: compositionWin() }).props} />);
    const style = StyleSheet.flatten(screen.getByTestId("game-over-panel").props.style);
    expect(style).toMatchObject({ width: 320 });
    expect(style.position).toBeUndefined();
  });

  it("gagnée par un adversaire : ligne de raison habituelle avec le nom, pas de bloc", async () => {
    await render(<GameOverPanel {...panel({ game: compositionWin(OTHER) }).props} />);
    expect(screen.getByTestId("game-over-reason")).toHaveTextContent(
      "Victoire par main spéciale : Composition de 7",
    );
    expect(screen.queryByTestId("game-over-special-hand")).toBeNull();
  });

  it("en anglais", async () => {
    usePreferencesStore.getState().setLanguage("en");
    await render(<GameOverPanel {...panel({ game: compositionWin() }).props} />);
    expect(screen.getByTestId("game-over-special-name")).toHaveTextContent("Composition of 7");
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

describe("présentation du résultat (LOT 5, visuel seulement)", () => {
  const won = () =>
    finishedGame({
      result: {
        winnerId: ME,
        method: "CONTROL_AFTER_LAST_TRICK",
        remainingOpponentIds: [OTHER],
        fledPlayerIds: [],
      },
      mySettlement: { delta: 84, account: "WALLET" },
    } as Partial<GameView>);

  it("soleil de victoire seulement quand le serveur annonce ma victoire", async () => {
    await render(<GameOverPanel {...panel({ game: won() }).props} />);
    expect(screen.getByTestId("game-over-rays", { includeHiddenElements: true })).toBeTruthy();
    await cleanup();
    await render(<GameOverPanel {...panel().props} />);
    expect(screen.queryByTestId("game-over-rays", { includeHiddenElements: true })).toBeNull();
  });

  it("filet sous le titre, gagnant ou non", async () => {
    await render(<GameOverPanel {...panel().props} />);
    expect(screen.getByTestId("game-over-rule", { includeHiddenElements: true })).toBeTruthy();
  });

  it("montant coloré selon le signe du bilan du serveur, libellé inchangé", async () => {
    expect(amountColor(84)).not.toBe(amountColor(-84));
    expect(amountColor(0)).toBe("#FFFFFF");
    await render(<GameOverPanel {...panel().props} />);
    expect(screen.getByText(signedAmount(-84))).toHaveStyle({ color: amountColor(-84) });
  });

  it("boîte du panneau inchangée (largeur, pas de position absolue)", async () => {
    await render(<GameOverPanel {...panel({ game: won() }).props} />);
    const style = StyleSheet.flatten(screen.getByTestId("game-over-panel").props.style);
    expect(style).toMatchObject({ width: 320 });
    expect(style.position).toBeUndefined();
  });
});
