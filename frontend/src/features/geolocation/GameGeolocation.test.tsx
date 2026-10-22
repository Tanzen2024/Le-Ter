/// <reference types="jest" />
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react-native";
import * as Location from "expo-location";
import { router, useIsFocused } from "expo-router";
import { Text } from "react-native";

import { geolocationApi } from "../../services/geolocation-api";
import { sessionsApi } from "../../services/sessions-api";
import { useAuthStore } from "../../stores/auth-store";
import type { GameView } from "../../types/game";
import type { GeolocationStatus } from "../../types/geolocation";
import { distanceLabel, usePlayerDistances } from "../games/table/distance";
import { CONSENT_TITLE, GameGeolocation } from "./GameGeolocation";
import {
  GPS_RETRY_MS,
  LAST_KNOWN_MAX_AGE_MS,
  POSITION_TIMEOUT_MS,
  resetGeolocationConsent,
} from "./hooks";
import { useGameUiStore } from "../../stores/game-ui-store";

jest.mock("expo-location", () => ({
  getForegroundPermissionsAsync: jest.fn(),
  requestForegroundPermissionsAsync: jest.fn(),
  getCurrentPositionAsync: jest.fn(),
  getLastKnownPositionAsync: jest.fn(),
  hasServicesEnabledAsync: jest.fn(),
  Accuracy: { Balanced: 3, High: 4 },
}));
jest.mock("expo-router", () => ({
  useIsFocused: jest.fn(() => true),
  router: { dismissTo: jest.fn() },
}));
jest.mock("expo-crypto", () => ({
  randomUUID: () => jest.requireActual("crypto").randomUUID(),
}));
jest.mock("../../services/geolocation-api", () => ({
  geolocationApi: {
    status: jest.fn(),
    consent: jest.fn(),
    sendPosition: jest.fn(),
  },
}));
jest.mock("../../services/sessions-api", () => ({
  sessionsApi: { leave: jest.fn() },
}));

const location = Location as jest.Mocked<typeof Location>;
const focused = useIsFocused as jest.MockedFunction<typeof useIsFocused>;
const status = geolocationApi.status as jest.MockedFunction<
  typeof geolocationApi.status
>;
const sendPosition = geolocationApi.sendPosition as jest.MockedFunction<
  typeof geolocationApi.sendPosition
>;
const consent = geolocationApi.consent as jest.MockedFunction<
  typeof geolocationApi.consent
>;
const leave = sessionsApi.leave as jest.MockedFunction<
  typeof sessionsApi.leave
>;
const dismissTo = router.dismissTo as jest.MockedFunction<
  typeof router.dismissTo
>;
const { ApiError } = jest.requireActual("../../lib/api-client");
const SESSION = "table-1";

const GAME = "11111111-1111-4111-8111-111111111111";
const INTERVAL = 45_000;

const gameView = (overrides: Partial<GameView> = {}) =>
  ({
    gameId: GAME,
    sessionId: SESSION,
    status: "in_progress",
    ...overrides,
  }) as GameView;

const watched = (
  overrides: Partial<GeolocationStatus> = {},
): GeolocationStatus =>
  ({
    detectionEnabled: true,
    collecting: true,
    collectionIntervalMs: INTERVAL,
    distances: [
      { playerId: "p2", meters: null },
      { playerId: "p3", meters: null },
    ],
    ...overrides,
  }) as GeolocationStatus;

const permission = (granted: boolean, canAskAgain = true) =>
  ({
    granted,
    canAskAgain,
    status: granted ? "granted" : "undetermined",
    expires: "never",
  }) as never;

/** Étiquettes de distance, comme sur la table : aucune quand la partie n'est pas surveillée. */
const NO_TAG = "aucune étiquette";
function Distances({ game }: { game: GameView }) {
  const distances = usePlayerDistances(game);
  return (
    <>
      <Text testID="p2">
        {distances ? distanceLabel(distances.of("p2")) : NO_TAG}
      </Text>
      <Text testID="p3">
        {distances ? distanceLabel(distances.of("p3")) : NO_TAG}
      </Text>
    </>
  );
}

function Screen({ game, client }: { game: GameView; client: QueryClient }) {
  return (
    <QueryClientProvider client={client}>
      <GameGeolocation game={game} />
      <Distances game={game} />
    </QueryClientProvider>
  );
}

async function renderScreen(server: GeolocationStatus, game = gameView()) {
  status.mockResolvedValue(server);
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: Infinity } },
  });
  const view = await render(
    <Screen key={game.gameId} game={game} client={client} />,
  );
  return {
    ...view,
    client,
    // Clé = gameId : une autre partie remonte l'écran, comme dans l'application.
    rerenderWith: (next: GameView) =>
      view.rerender(<Screen key={next.gameId} game={next} client={client} />),
  };
}

const flush = () => act(async () => {});

beforeEach(() => {
  jest.useFakeTimers();
  jest.clearAllMocks();
  resetGeolocationConsent();
  focused.mockReturnValue(true);
  useAuthStore.getState().signIn("jeton");
  location.getForegroundPermissionsAsync.mockResolvedValue(permission(false));
  location.requestForegroundPermissionsAsync.mockResolvedValue(
    permission(true),
  );
  location.getCurrentPositionAsync.mockResolvedValue({
    coords: { latitude: 4.0511, longitude: 9.7679, accuracy: 12 },
    timestamp: 1_760_000_000_000,
  } as never);
  location.hasServicesEnabledAsync.mockResolvedValue(true);
  location.getLastKnownPositionAsync.mockResolvedValue(null);
  sendPosition.mockResolvedValue({
    distances: [
      { playerId: "p2", meters: 850 },
      { playerId: "p3", meters: null },
    ],
  });
  // Serveur : une fois le consentement enregistré, toute relecture le confirme.
  consent.mockImplementation(async () => {
    status.mockResolvedValue(watched({ consentGiven: true }));
    return watched({ consentGiven: true });
  });
  leave.mockResolvedValue({ session: null });
  useGameUiStore.setState({ dealAnimated: {}, localGps: {} });
});
afterEach(() => {
  jest.useRealTimers();
});

async function acceptConsent() {
  await waitFor(() => expect(screen.getByText(CONSENT_TITLE)).toBeTruthy());
  await fireEvent.press(screen.getByText("CONTINUER"));
  await waitFor(() => expect(sendPosition).toHaveBeenCalledTimes(1));
}

describe("Partie non surveillée", () => {
  it("aucune explication, aucune permission demandée, aucune position, aucune étiquette de distance", async () => {
    await renderScreen({ detectionEnabled: false });
    await waitFor(() => expect(status).toHaveBeenCalledWith("jeton", GAME));
    await act(async () => {
      await jest.advanceTimersByTimeAsync(3 * INTERVAL);
    });
    expect(screen.queryByText(CONSENT_TITLE)).toBeNull();
    expect(location.getForegroundPermissionsAsync).not.toHaveBeenCalled();
    expect(location.requestForegroundPermissionsAsync).not.toHaveBeenCalled();
    expect(location.getCurrentPositionAsync).not.toHaveBeenCalled();
    expect(sendPosition).not.toHaveBeenCalled();
    expect(screen.getByTestId("p2").props.children).toBe(NO_TAG);
  });
});

describe("Partie surveillée : consentement", () => {
  it("consentement absent : panneau affiché AVANT toute demande de permission native", async () => {
    await renderScreen(watched());
    await waitFor(() => expect(screen.getByText(CONSENT_TITLE)).toBeTruthy());
    expect(screen.getByText(/jamais montrée aux autres joueurs/)).toBeTruthy();
    expect(
      screen.getByText(/le serveur calcule seulement les distances/),
    ).toBeTruthy();
    expect(
      screen.getByText(/au plus tard 24 h après la fin de la partie/),
    ).toBeTruthy();
    expect(
      screen.getByText(/Vous pouvez refuser : vous quittez alors cette table/),
    ).toBeTruthy();
    expect(screen.getByText("NON MERCI")).toBeTruthy();
    expect(screen.getByText("CONTINUER")).toBeTruthy();
    expect(screen.queryByText(/trich|suspect|fraud/i)).toBeNull();
    expect(location.getForegroundPermissionsAsync).not.toHaveBeenCalled();
    expect(location.requestForegroundPermissionsAsync).not.toHaveBeenCalled();
    expect(location.getCurrentPositionAsync).not.toHaveBeenCalled();
  });

  it("consentement déjà enregistré par le serveur (reconnexion) : aucun panneau", async () => {
    location.getForegroundPermissionsAsync.mockResolvedValue(permission(true));
    await renderScreen(watched({ consentGiven: true }));
    await waitFor(() => expect(sendPosition).toHaveBeenCalledTimes(1));
    expect(screen.queryByText(CONSENT_TITLE)).toBeNull();
    expect(consent).not.toHaveBeenCalled();
  });

  it("« Continuer » : consentement envoyé, panneau fermé APRÈS confirmation, puis permission et position", async () => {
    let confirm!: (value: GeolocationStatus) => void;
    consent.mockReturnValueOnce(new Promise((resolve) => (confirm = resolve)));
    await renderScreen(watched());
    await waitFor(() => expect(screen.getByText(CONSENT_TITLE)).toBeTruthy());
    await fireEvent.press(screen.getByText("CONTINUER"));
    // En attente du serveur : panneau toujours là, chargement, rien de lu ni d'envoyé.
    expect(consent).toHaveBeenCalledWith("jeton", GAME);
    expect(screen.getByText(CONSENT_TITLE)).toBeTruthy();
    await waitFor(() =>
      expect(screen.getByTestId("consent-accepting")).toBeTruthy(),
    );
    expect(location.requestForegroundPermissionsAsync).not.toHaveBeenCalled();
    status.mockResolvedValue(watched({ consentGiven: true }));
    await act(async () => confirm(watched({ consentGiven: true })));
    await waitFor(() => expect(sendPosition).toHaveBeenCalledTimes(1));
    expect(screen.queryByText(CONSENT_TITLE)).toBeNull();
    expect(location.requestForegroundPermissionsAsync).toHaveBeenCalledTimes(1);
    expect(sendPosition).toHaveBeenCalledWith("jeton", GAME, {
      latitude: 4.0511,
      longitude: 9.7679,
      accuracy: 12,
      capturedAt: 1_760_000_000_000,
    });
    await waitFor(() =>
      expect(screen.getByTestId("p2").props.children).toBe("850 m"),
    );
    expect(screen.getByTestId("p3").props.children).toBe(
      "En attente de position",
    );
  });

  it("double appui sur « Continuer » : un seul envoi", async () => {
    await renderScreen(watched());
    await waitFor(() => expect(screen.getByText(CONSENT_TITLE)).toBeTruthy());
    const button = screen.getByText("CONTINUER");
    await act(async () => {
      fireEvent.press(button);
      fireEvent.press(button);
    });
    await waitFor(() => expect(screen.queryByText(CONSENT_TITLE)).toBeNull());
    expect(consent).toHaveBeenCalledTimes(1);
  });

  it("échec de l’enregistrement : panneau maintenu, aucune position, nouvel essai possible", async () => {
    consent.mockRejectedValueOnce(
      new ApiError(
        0,
        "NETWORK_ERROR",
        "Impossible de joindre le serveur. Vérifiez votre connexion.",
      ),
    );
    await renderScreen(watched());
    await waitFor(() => expect(screen.getByText(CONSENT_TITLE)).toBeTruthy());
    await fireEvent.press(screen.getByText("CONTINUER"));
    await waitFor(() =>
      expect(screen.getByText(/Votre choix n’est pas enregistré/)).toBeTruthy(),
    );
    expect(screen.getByText(CONSENT_TITLE)).toBeTruthy();
    expect(location.requestForegroundPermissionsAsync).not.toHaveBeenCalled();
    expect(sendPosition).not.toHaveBeenCalled();
    // Nouvel essai : le serveur confirme cette fois.
    await fireEvent.press(screen.getByText("CONTINUER"));
    await waitFor(() => expect(screen.queryByText(CONSENT_TITLE)).toBeNull());
    expect(consent).toHaveBeenCalledTimes(2);
  });

  it("consentement donné, permission système refusée : rien envoyé, jamais présenté comme actif", async () => {
    location.requestForegroundPermissionsAsync.mockResolvedValue(
      permission(false),
    );
    await renderScreen(watched());
    await waitFor(() => expect(screen.getByText(CONSENT_TITLE)).toBeTruthy());
    await fireEvent.press(screen.getByText("CONTINUER"));
    await act(async () => {
      await jest.advanceTimersByTimeAsync(3 * INTERVAL);
    });
    expect(screen.queryByText(CONSENT_TITLE)).toBeNull();
    expect(location.getCurrentPositionAsync).not.toHaveBeenCalled();
    expect(sendPosition).not.toHaveBeenCalled();
    expect(screen.getByTestId("p2").props.children).toBe(
      "Localisation refusée",
    );
  });

  it("partie suivante de la même table : permission refusée pas redemandée", async () => {
    location.requestForegroundPermissionsAsync.mockResolvedValue(
      permission(false),
    );
    const view = await renderScreen(watched());
    await waitFor(() => expect(screen.getByText(CONSENT_TITLE)).toBeTruthy());
    await fireEvent.press(screen.getByText("CONTINUER"));
    await waitFor(() =>
      expect(location.requestForegroundPermissionsAsync).toHaveBeenCalled(),
    );
    await view.rerenderWith(
      gameView({ gameId: "22222222-2222-4222-8222-222222222222" }),
    );
    await waitFor(() =>
      expect(status).toHaveBeenCalledWith(
        "jeton",
        "22222222-2222-4222-8222-222222222222",
      ),
    );
    await act(async () => {
      await jest.advanceTimersByTimeAsync(1_000);
    });
    expect(screen.queryByText(CONSENT_TITLE)).toBeNull();
    expect(consent).toHaveBeenCalledTimes(1);
    expect(location.requestForegroundPermissionsAsync).toHaveBeenCalledTimes(1);
  });
});

describe("« Non merci » : départ réel de la table", () => {
  it("départ demandé au serveur, confirmé : retour à l’accueil, état de CETTE partie oublié", async () => {
    const OTHER = "33333333-3333-4333-8333-333333333333";
    useGameUiStore.getState().markDealAnimated(GAME);
    useGameUiStore.getState().markDealAnimated(OTHER);
    useGameUiStore.getState().setLocalGps(OTHER, "unavailable");
    const view = await renderScreen(watched());
    view.client.setQueryData(["games", GAME], { gameId: GAME });
    view.client.setQueryData(["games", GAME, "chat"], { messages: [] });
    view.client.setQueryData(["games", OTHER], { gameId: OTHER });
    await waitFor(() => expect(screen.getByText(CONSENT_TITLE)).toBeTruthy());

    await fireEvent.press(screen.getByText("NON MERCI"));
    await waitFor(() =>
      expect(dismissTo).toHaveBeenCalledWith({
        pathname: "/",
        params: { panel: "private" },
      }),
    );
    expect(leave).toHaveBeenCalledWith("jeton", SESSION);
    // Aucune permission, aucune position, aucun consentement envoyé.
    expect(consent).not.toHaveBeenCalled();
    expect(location.requestForegroundPermissionsAsync).not.toHaveBeenCalled();
    expect(sendPosition).not.toHaveBeenCalled();

    // L'écran disparaît (navigation) : relectures arrêtées, état local de la partie oublié.
    const calls = status.mock.calls.length;
    await view.unmount();
    await act(async () => {
      await jest.advanceTimersByTimeAsync(3 * INTERVAL);
    });
    expect(status.mock.calls.length).toBe(calls);
    expect(view.client.getQueryData(["games", GAME])).toBeUndefined();
    expect(view.client.getQueryData(["games", GAME, "chat"])).toBeUndefined();
    expect(
      view.client.getQueryData(["games", GAME, "geolocation"]),
    ).toBeUndefined();
    expect(useGameUiStore.getState().dealAnimated[GAME]).toBeUndefined();
    // Isolation : l'autre partie est intacte.
    expect(view.client.getQueryData(["games", OTHER])).toEqual({
      gameId: OTHER,
    });
    expect(useGameUiStore.getState().dealAnimated[OTHER]).toBe(true);
    expect(useGameUiStore.getState().localGps[OTHER]).toBe("unavailable");
  });

  it("double appui : une seule demande de départ, chargement affiché", async () => {
    let done!: (value: { session: null }) => void;
    leave.mockReturnValueOnce(new Promise((resolve) => (done = resolve)));
    await renderScreen(watched());
    await waitFor(() => expect(screen.getByText(CONSENT_TITLE)).toBeTruthy());
    const button = screen.getByText("NON MERCI");
    await act(async () => {
      fireEvent.press(button);
      fireEvent.press(button);
    });
    await waitFor(() =>
      expect(screen.getByTestId("consent-leaving")).toBeTruthy(),
    );
    await act(async () => done({ session: null }));
    await waitFor(() => expect(dismissTo).toHaveBeenCalledTimes(1));
    expect(leave).toHaveBeenCalledTimes(1);
  });

  it("erreur réseau : aucune fausse confirmation, panneau maintenu, nouvel essai", async () => {
    leave.mockRejectedValueOnce(
      new ApiError(
        0,
        "NETWORK_ERROR",
        "Impossible de joindre le serveur. Vérifiez votre connexion.",
      ),
    );
    const view = await renderScreen(watched());
    view.client.setQueryData(["games", GAME], { gameId: GAME });
    await waitFor(() => expect(screen.getByText(CONSENT_TITLE)).toBeTruthy());
    await fireEvent.press(screen.getByText("NON MERCI"));
    await waitFor(() =>
      expect(screen.getByText(/Votre départ n’est pas confirmé/)).toBeTruthy(),
    );
    expect(dismissTo).not.toHaveBeenCalled();
    expect(screen.getByText(CONSENT_TITLE)).toBeTruthy();
    expect(view.client.getQueryData(["games", GAME])).toEqual({ gameId: GAME });
    // Nouvel essai (départ idempotent côté serveur) : confirmé, retour à l'accueil.
    await fireEvent.press(screen.getByText("NON MERCI"));
    await waitFor(() =>
      expect(dismissTo).toHaveBeenCalledWith({
        pathname: "/",
        params: { panel: "private" },
      }),
    );
    expect(leave).toHaveBeenCalledTimes(2);
  });

  it("refus du serveur : son message s’affiche, aucune navigation", async () => {
    leave.mockRejectedValueOnce(
      new ApiError(
        409,
        "PLAYER_IN_ACTIVE_GAME",
        "Vous participez à une partie de cette session : vous ne pouvez pas la quitter maintenant.",
      ),
    );
    await renderScreen(watched());
    await waitFor(() => expect(screen.getByText(CONSENT_TITLE)).toBeTruthy());
    await fireEvent.press(screen.getByText("NON MERCI"));
    await waitFor(() =>
      expect(
        screen.getByText(/vous ne pouvez pas la quitter maintenant/),
      ).toBeTruthy(),
    );
    expect(dismissTo).not.toHaveBeenCalled();
  });
});

describe("Collecte", () => {
  it("envoi périodique à la cadence du serveur (jamais plus d’une position par intervalle)", async () => {
    await renderScreen(watched());
    await acceptConsent();
    await act(async () => {
      await jest.advanceTimersByTimeAsync(INTERVAL - 1_000);
    });
    expect(sendPosition).toHaveBeenCalledTimes(1);
    await act(async () => {
      await jest.advanceTimersByTimeAsync(1_000);
    });
    expect(sendPosition).toHaveBeenCalledTimes(2);
    await act(async () => {
      await jest.advanceTimersByTimeAsync(INTERVAL);
    });
    expect(sendPosition).toHaveBeenCalledTimes(3);
  });

  it("arrêt quand la partie se termine", async () => {
    const view = await renderScreen(watched());
    await acceptConsent();
    await view.rerenderWith(gameView({ status: "finished" }));
    await act(async () => {
      await jest.advanceTimersByTimeAsync(3 * INTERVAL);
    });
    expect(sendPosition).toHaveBeenCalledTimes(1);
  });

  it("arrêt quand le serveur refuse (partie terminée côté serveur)", async () => {
    const { ApiError } = jest.requireActual("../../lib/api-client");
    sendPosition.mockRejectedValueOnce(
      new ApiError(409, "GAME_FINISHED", "La partie est terminée."),
    );
    await renderScreen(watched());
    await acceptConsent();
    status.mockResolvedValue(
      watched({ collecting: false } as Partial<GeolocationStatus>),
    );
    await act(async () => {
      await jest.advanceTimersByTimeAsync(3 * INTERVAL);
    });
    expect(sendPosition).toHaveBeenCalledTimes(1);
  });

  it("arrêt quand l’écran de la partie n’est plus affiché", async () => {
    const view = await renderScreen(watched());
    await acceptConsent();
    focused.mockReturnValue(false);
    await view.rerenderWith(gameView());
    await act(async () => {
      await jest.advanceTimersByTimeAsync(3 * INTERVAL);
    });
    expect(sendPosition).toHaveBeenCalledTimes(1);
  });

  it("arrêt quand l’écran est démonté (sortie de la partie)", async () => {
    const view = await renderScreen(watched());
    await acceptConsent();
    await view.unmount();
    await act(async () => {
      await jest.advanceTimersByTimeAsync(3 * INTERVAL);
    });
    expect(sendPosition).toHaveBeenCalledTimes(1);
  });
});

describe("Distances indisponibles et mises à jour", () => {
  it("position trop ancienne selon le serveur : « Position obsolète », jamais 0 m", async () => {
    await renderScreen(
      watched({
        distances: [
          { playerId: "p2", meters: null, unavailable: "STALE" },
          { playerId: "p3", meters: 0 },
        ],
      }),
    );
    sendPosition.mockResolvedValue({
      distances: [
        { playerId: "p2", meters: null, unavailable: "STALE" },
        { playerId: "p3", meters: 0 },
      ],
    });
    await acceptConsent();
    await waitFor(() =>
      expect(screen.getByTestId("p2").props.children).toBe("Position obsolète"),
    );
    // 0 m est une vraie distance (même lieu), distincte d'une distance inconnue.
    expect(screen.getByTestId("p3").props.children).toBe("0 m");
  });

  it("GPS en échec (coupé) : « GPS indisponible », rien n’est envoyé, nouvel essai plus tard", async () => {
    location.getCurrentPositionAsync.mockRejectedValue(
      new Error("Location services disabled"),
    );
    await renderScreen(watched());
    await waitFor(() => expect(screen.getByText(CONSENT_TITLE)).toBeTruthy());
    await fireEvent.press(screen.getByText("CONTINUER"));
    await waitFor(() =>
      expect(screen.getByTestId("p2").props.children).toBe("GPS indisponible"),
    );
    expect(sendPosition).not.toHaveBeenCalled();
    // Le GPS revient : la position suivante part, l'état se lève.
    location.getCurrentPositionAsync.mockResolvedValue({
      coords: { latitude: 4.0511, longitude: 9.7679, accuracy: 12 },
      timestamp: 1_760_000_000_000,
    } as never);
    await act(async () => {
      await jest.advanceTimersByTimeAsync(INTERVAL);
    });
    expect(sendPosition).toHaveBeenCalledTimes(1);
    await waitFor(() =>
      expect(screen.getByTestId("p2").props.children).toBe("850 m"),
    );
  });

  it("GPS sans réponse : délai dépassé, « GPS indisponible », jamais de position fictive", async () => {
    location.getCurrentPositionAsync.mockReturnValue(
      new Promise(() => undefined),
    );
    await renderScreen(watched());
    await waitFor(() => expect(screen.getByText(CONSENT_TITLE)).toBeTruthy());
    await fireEvent.press(screen.getByText("CONTINUER"));
    await act(async () => {
      await jest.advanceTimersByTimeAsync(POSITION_TIMEOUT_MS);
    });
    expect(screen.getByTestId("p2").props.children).toBe("GPS indisponible");
    expect(sendPosition).not.toHaveBeenCalled();
  });

  it("nouvelle position d’un adversaire : distance mise à jour sans envoi ni rechargement", async () => {
    // Ce joueur a consenti mais refusé la permission système : il n'envoie rien, mais la
    // distance de la table reste suivie.
    location.getForegroundPermissionsAsync.mockResolvedValue(
      permission(false, false),
    );
    const view = await renderScreen(watched({ consentGiven: true }));
    await flush();
    status.mockResolvedValue(
      watched({
        distances: [
          { playerId: "p2", meters: 1_200 },
          { playerId: "p3", meters: null },
        ],
      }),
    );
    await act(async () => {
      await jest.advanceTimersByTimeAsync(INTERVAL);
    });
    // Permission système refusée : la fenêtre de consentement est ouverte et, seule visible
    // (D-126), masque la table aux lecteurs d'écran ; la distance y est pourtant à jour.
    expect(
      screen.getByTestId("p2", { includeHiddenElements: true }).props.children,
    ).toBe("1,2 km");
    expect(sendPosition).not.toHaveBeenCalled();
    // Sortie de la partie : plus aucune relecture, état GPS local oublié.
    const calls = status.mock.calls.length;
    await view.unmount();
    await act(async () => {
      await jest.advanceTimersByTimeAsync(3 * INTERVAL);
    });
    expect(status.mock.calls.length).toBe(calls);
    expect(useGameUiStore.getState().localGps[GAME]).toBeUndefined();
  });

  it("partie terminée côté serveur : plus de relecture périodique", async () => {
    await renderScreen(watched({ collecting: false }));
    await waitFor(() => expect(status).toHaveBeenCalledTimes(1));
    await act(async () => {
      await jest.advanceTimersByTimeAsync(3 * INTERVAL);
    });
    expect(status).toHaveBeenCalledTimes(1);
  });

  it("localisation désactivée sur le téléphone : « Localisation désactivée », aucune mesure ni envoi", async () => {
    location.hasServicesEnabledAsync.mockResolvedValue(false);
    await renderScreen(watched());
    await waitFor(() => expect(screen.getByText(CONSENT_TITLE)).toBeTruthy());
    await fireEvent.press(screen.getByText("CONTINUER"));
    await waitFor(() =>
      expect(screen.getByTestId("p2").props.children).toBe("Localisation désactivée"),
    );
    expect(location.getCurrentPositionAsync).not.toHaveBeenCalled();
    expect(sendPosition).not.toHaveBeenCalled();
    // Le joueur réactive la localisation : nouvel essai sans attendre toute la cadence.
    location.hasServicesEnabledAsync.mockResolvedValue(true);
    await act(async () => {
      await jest.advanceTimersByTimeAsync(GPS_RETRY_MS);
    });
    expect(sendPosition).toHaveBeenCalledTimes(1);
  });

  it("acquisition lente : « Recherche GPS… » pendant la première mesure, jamais une distance", async () => {
    let answer: (value: unknown) => void = () => undefined;
    location.getCurrentPositionAsync.mockReturnValue(
      new Promise((resolve) => {
        answer = resolve;
      }) as never,
    );
    await renderScreen(watched());
    await waitFor(() => expect(screen.getByText(CONSENT_TITLE)).toBeTruthy());
    await fireEvent.press(screen.getByText("CONTINUER"));
    await waitFor(() =>
      expect(screen.getByTestId("p2").props.children).toBe("Recherche GPS…"),
    );
    expect(sendPosition).not.toHaveBeenCalled();
    await act(async () => {
      answer({
        coords: { latitude: 4.0511, longitude: 9.7679, accuracy: 30 },
        timestamp: 1_760_000_000_000,
      });
    });
    await waitFor(() => expect(screen.getByTestId("p2").props.children).toBe("850 m"));
  });

  it("dernière position récente du système : envoyée tout de suite, sans nouvelle mesure", async () => {
    location.getLastKnownPositionAsync.mockResolvedValue({
      coords: { latitude: 4.05, longitude: 9.76, accuracy: 40 },
      timestamp: 1_760_000_000_000,
    } as never);
    await renderScreen(watched());
    await acceptConsent();
    expect(location.getLastKnownPositionAsync).toHaveBeenCalledWith({
      maxAge: LAST_KNOWN_MAX_AGE_MS,
      requiredAccuracy: 1_000,
    });
    expect(location.getCurrentPositionAsync).not.toHaveBeenCalled();
    expect(sendPosition).toHaveBeenCalledWith("jeton", GAME, {
      latitude: 4.05,
      longitude: 9.76,
      accuracy: 40,
      capturedAt: 1_760_000_000_000,
    });
  });

  it("nouvelle mesure en précision équilibrée (réseau + GPS), pas en GPS seul", async () => {
    await renderScreen(watched());
    await acceptConsent();
    expect(location.getCurrentPositionAsync).toHaveBeenCalledWith({
      accuracy: location.Accuracy.Balanced,
    });
  });

  it("ma position reçue, celle de l’adversaire absente : la cause le nomme, sans accusation", async () => {
    sendPosition.mockResolvedValue({
      distances: [
        { playerId: "p2", meters: null, unavailable: "WAITING", missingPosition: "OTHER" },
        { playerId: "p3", meters: 420 },
      ],
    });
    await renderScreen(watched());
    await acceptConsent();
    await waitFor(() =>
      expect(screen.getByTestId("p2").props.children).toBe("Position adverse non reçue"),
    );
    expect(screen.getByTestId("p3").props.children).toBe("420 m");
    expect(distanceLabel({ kind: "other-missing" }, "Hugo")).toBe("Position de Hugo non reçue");
  });

  it("permission refusée puis accordée dans les réglages : relue au retour, sans redemande", async () => {
    location.requestForegroundPermissionsAsync.mockResolvedValue(permission(false));
    const view = await renderScreen(watched());
    await waitFor(() => expect(screen.getByText(CONSENT_TITLE)).toBeTruthy());
    await fireEvent.press(screen.getByText("CONTINUER"));
    await waitFor(() =>
      expect(screen.getByTestId("p2").props.children).toBe("Localisation refusée"),
    );
    // Le joueur quitte l'écran (réglages Android), accorde la permission, puis revient.
    focused.mockReturnValue(false);
    await view.rerenderWith(gameView());
    location.getForegroundPermissionsAsync.mockResolvedValue(permission(true));
    focused.mockReturnValue(true);
    await view.rerenderWith(gameView());
    await waitFor(() => expect(sendPosition).toHaveBeenCalledTimes(1));
    expect(location.requestForegroundPermissionsAsync).toHaveBeenCalledTimes(1);
  });

  it("état GPS propre à chaque partie : un refus dans A ne touche pas B", () => {
    const store = useGameUiStore.getState();
    store.setLocalGps("game-a", "refused");
    store.setLocalGps("game-b", null);
    expect(useGameUiStore.getState().localGps).toEqual({ "game-a": "refused" });
    store.setLocalGps("game-a", null);
    expect(useGameUiStore.getState().localGps).toEqual({});
  });
});
