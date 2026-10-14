/// <reference types="jest" />
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react-native";
import { router } from "expo-router";
import type { ReactElement } from "react";
import { Share } from "react-native";

import { ApiError } from "../../../lib/api-client";
import { adminTournamentsApi } from "../../../services/admin-tournaments-api";
import { authApi } from "../../../services/auth-api";
import { useAuthStore } from "../../../stores/auth-store";
import type { PublicUser } from "../../../types/auth";
import type {
  TournamentResultView,
  TournamentSummary,
} from "../../../types/tournament";
import { AdminTournamentDetailScreen } from "./AdminTournamentDetailScreen";
import { AdminTournamentFormScreen } from "./AdminTournamentFormScreen";
import { AdminTournamentSettingsScreen } from "./AdminTournamentSettingsScreen";
import { AdminTournamentsScreen } from "./AdminTournamentsScreen";

jest.mock("../../../services/admin-tournaments-api", () => ({
  adminTournamentsApi: {
    list: jest.fn(),
    get: jest.fn(),
    create: jest.fn(),
    approve: jest.fn(),
    reject: jest.fn(),
    cancel: jest.fn(),
    registrations: jest.fn(),
    results: jest.fn(),
    exportCsv: jest.fn(),
    settings: jest.fn(),
    updateSettings: jest.fn(),
  },
}));
// Règles réglées dans les Paramètres des tournois (D-103, D-104) : minimum 25 joueurs, ∞,
// durée 45 à 120 min.
jest.mock("../../../services/tournaments-api", () => ({
  tournamentsApi: {
    rules: jest.fn(async () => ({
      rules: {
        minimumPlayers: 25,
        maximumPlayers: null,
        minimumDurationMinutes: 45,
        maximumDurationMinutes: 120,
        minimumEntryFee: 500,
        maximumEntryFee: 100_000,
      },
    })),
  },
}));
jest.mock("../../../services/auth-api", () => ({ authApi: { me: jest.fn() } }));
jest.mock("expo-secure-store", () => ({
  getItemAsync: jest.fn(async () => null),
  setItemAsync: jest.fn(async () => undefined),
  deleteItemAsync: jest.fn(async () => undefined),
}));
const mockParams: { tournamentId?: string } = {};
jest.mock("expo-router", () => ({
  router: {
    back: jest.fn(),
    replace: jest.fn(),
    push: jest.fn(),
    canGoBack: jest.fn(() => true),
  },
  useLocalSearchParams: () => mockParams,
}));

const api = adminTournamentsApi as jest.Mocked<typeof adminTournamentsApi>;
const me = authApi.me as jest.Mock;
const WAIT = { timeout: 5000 };
const ID = "33333333-3333-4333-8333-333333333333";

const user = (role: PublicUser["role"]): { user: PublicUser } => ({
  user: {
    id: "11111111-1111-4111-8111-111111111111",
    firstName: "Awa",
    lastName: "Ndiaye",
    email: "awa@example.com",
    username: "awa",
    phone: "+237600000000",
    phoneVerified: true,
    role,
    createdAt: "2026-10-01T00:00:00.000Z",
  },
});

const tournament = (
  overrides: Partial<TournamentSummary> = {},
): TournamentSummary => ({
  tournamentId: ID,
  status: "REGISTRATION_OPEN",
  creatorType: "ADMIN",
  timezone: "Africa/Douala",
  startsAt: new Date(2026, 9, 12, 18, 0).toISOString(),
  endsAt: new Date(2026, 9, 12, 20, 0).toISOString(),
  registrationClosesAt: new Date(2026, 9, 12, 18, 0).toISOString(),
  entryFee: 1000,
  currency: "XAF",
  minimumPlayers: 20,
  maximumPlayers: 100,
  platformFeePercent: 10,
  initialTournamentTokens: 1000,
  stakePerGame: 100,
  prizeRules: [
    { rank: 1, percent: 50 },
    { rank: 2, percent: 30 },
    { rank: 3, percent: 20 },
  ],
  registeredCount: 12,
  creatorName: "roly",
  createdAt: "2026-10-08T09:00:00.000Z",
  ...overrides,
});

const result = (
  rank: number,
  username: string,
  prizeAmount: number,
): TournamentResultView => ({
  rank,
  username,
  initialTokens: 1000,
  remainingTokens: 1500 - rank * 100,
  gamesPlayed: 6,
  gamesWon: 4 - rank,
  score: 50 - rank / 8,
  prizePercent: 50,
  prizeAmount,
  paid: true,
});

const clients: QueryClient[] = [];
async function renderWith(ui: ReactElement) {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: Infinity },
      mutations: { retry: false, gcTime: Infinity },
    },
  });
  clients.push(queryClient);
  await render(
    <QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>,
  );
}

beforeEach(() => {
  jest.clearAllMocks();
  useAuthStore.getState().signIn("jeton");
  me.mockResolvedValue(user("admin"));
  mockParams.tournamentId = ID;
  api.registrations.mockResolvedValue({ registrations: [] });
});
afterEach(async () => {
  await cleanup();
  clients.splice(0).forEach((client) => client.clear());
});

describe("accès", () => {
  it("compte joueur : rien d’affiché, aucune route d’administration appelée", async () => {
    me.mockResolvedValue(user("user"));
    await renderWith(<AdminTournamentsScreen />);
    expect(
      await screen.findByText("Page indisponible.", {}, WAIT),
    ).toBeTruthy();
    expect(api.list).not.toHaveBeenCalled();
  });
});

describe("liste", () => {
  it("date, créateur, statut, horaires, participation, inscrits, min / max, commission, création", async () => {
    api.list.mockResolvedValue({ tournaments: [tournament()] });
    await renderWith(<AdminTournamentsScreen />);
    expect(await screen.findByText("12 octobre 2026", {}, WAIT)).toBeTruthy();
    expect(screen.getByText("Inscriptions ouvertes")).toBeTruthy();
    expect(screen.getByText(/18:00 — 20:00 · 1 000 FCFA/)).toBeTruthy();
    expect(
      screen.getByText(
        /Créateur : roly \(admin\) · Inscrits : 12 · Joueurs : 20–100 · Commission : 10 %/,
      ),
    ).toBeTruthy();
    expect(screen.getByText(/Créé le/)).toBeTruthy();
    expect(api.list).toHaveBeenCalledWith("jeton", undefined);
  });

  it("filtre « À approuver » : le serveur filtre par statut", async () => {
    api.list.mockResolvedValue({ tournaments: [] });
    await renderWith(<AdminTournamentsScreen />);
    await fireEvent.press(await screen.findByText("À approuver", {}, WAIT));
    await waitFor(() =>
      expect(api.list).toHaveBeenLastCalledWith("jeton", ["PENDING_APPROVAL"]),
    );
  });

  it("ouvre le détail, la création et les paramètres", async () => {
    api.list.mockResolvedValue({ tournaments: [tournament()] });
    await renderWith(<AdminTournamentsScreen />);
    await fireEvent.press(
      await screen.findByLabelText(
        "Tournoi du 12 octobre 2026, 18:00 — 20:00",
        {},
        WAIT,
      ),
    );
    expect(router.push).toHaveBeenCalledWith(`/admin/tournaments/${ID}`);
    await fireEvent.press(screen.getByText("Créer un tournoi"));
    expect(router.push).toHaveBeenCalledWith("/admin/tournaments/new");
    await fireEvent.press(screen.getByText("Paramètres"));
    expect(router.push).toHaveBeenCalledWith("/admin/tournaments/settings");
  });
});

describe("création", () => {
  it("publie le tournoi et ouvre son détail", async () => {
    api.create.mockResolvedValue({ tournament: tournament() });
    await renderWith(<AdminTournamentFormScreen />);
    await screen.findByLabelText("Date", {}, WAIT);
    await fireEvent.press(screen.getByText("Publier le tournoi"));
    await waitFor(() =>
      expect(router.replace).toHaveBeenCalledWith(`/admin/tournaments/${ID}`),
    );
    expect(api.create).toHaveBeenCalledWith(
      "jeton",
      expect.objectContaining({ entryFee: 1000 }),
    );
  });

  /** Formulaire affiché, règles réglées lues (minimum de joueurs par défaut : 25). */
  async function renderForm() {
    await renderWith(<AdminTournamentFormScreen />);
    await screen.findByLabelText("Date", {}, WAIT);
    await waitFor(() =>
      expect(screen.getByLabelText("Joueurs minimum").props.value).toBe("25"),
    );
  }

  it("valeurs par défaut prises dans les Paramètres des tournois", async () => {
    api.create.mockResolvedValue({ tournament: tournament() });
    await renderForm();
    await fireEvent.press(screen.getByText("Publier le tournoi"));
    await waitFor(() => expect(api.create).toHaveBeenCalled());
    expect(api.create.mock.calls[0][1]).toMatchObject({ minimumPlayers: 25 });
  });

  it("joueurs sous le minimum réglé : message du serveur, aucun appel API", async () => {
    await renderForm();
    await fireEvent.changeText(screen.getByLabelText("Joueurs minimum"), "24");
    await fireEvent.press(screen.getByText("Publier le tournoi"));
    expect(screen.getByText("Au moins 25.")).toBeTruthy();
    expect(api.create).not.toHaveBeenCalled();
  });

  it.each(["44", "121"])(
    "durée de %s minutes : message exact, aucun appel API",
    async (minutes) => {
      await renderForm();
      await fireEvent.changeText(
        screen.getByLabelText("Durée (minutes)"),
        minutes,
      );
      await fireEvent.press(screen.getByText("Publier le tournoi"));
      expect(
        screen.getByText("Durée entre 45 minutes et 120 minutes."),
      ).toBeTruthy();
      expect(api.create).not.toHaveBeenCalled();
    },
  );

  it.each(["45", "120"])(
    "durée de %s minutes : tournoi publié",
    async (minutes) => {
      api.create.mockResolvedValue({ tournament: tournament() });
      await renderForm();
      await fireEvent.changeText(
        screen.getByLabelText("Durée (minutes)"),
        minutes,
      );
      await fireEvent.press(screen.getByText("Publier le tournoi"));
      await waitFor(() => expect(api.create).toHaveBeenCalled());
      const payload = api.create.mock.calls[0][1];
      expect(Date.parse(payload.endsAt) - Date.parse(payload.startsAt)).toBe(
        Number(minutes) * 60_000,
      );
    },
  );

  it("chevauchement refusé par le serveur : message affiché", async () => {
    api.create.mockRejectedValue(
      new ApiError(
        409,
        "TOURNAMENT_OVERLAP",
        "Un autre tournoi est déjà programmé sur ce créneau.",
      ),
    );
    await renderWith(<AdminTournamentFormScreen />);
    await screen.findByLabelText("Date", {}, WAIT);
    await fireEvent.press(screen.getByText("Publier le tournoi"));
    expect(
      await screen.findByText(
        "Un autre tournoi est déjà programmé sur ce créneau.",
      ),
    ).toBeTruthy();
  });
});

describe("détail", () => {
  it("proposition joueur : approuver", async () => {
    api.get.mockResolvedValue({
      tournament: tournament({
        status: "PENDING_APPROVAL",
        creatorType: "PLAYER",
      }),
    });
    api.approve.mockResolvedValue({
      tournament: tournament({ status: "REGISTRATION_OPEN" }),
    });
    await renderWith(<AdminTournamentDetailScreen />);
    expect(
      (await screen.findByTestId("admin-tournament-status", {}, WAIT)).props
        .children,
    ).toBe("À approuver");
    // Le serveur renvoie ensuite le nouvel état (relu après l'action).
    api.get.mockResolvedValue({
      tournament: tournament({ status: "REGISTRATION_OPEN" }),
    });
    await fireEvent.press(screen.getByText("Approuver"));
    expect(api.approve).toHaveBeenCalledWith("jeton", ID);
    await waitFor(() =>
      expect(screen.getByTestId("admin-tournament-status").props.children).toBe(
        "Inscriptions ouvertes",
      ),
    );
  });

  it("proposition joueur : refuser (motif affiché)", async () => {
    api.get.mockResolvedValue({
      tournament: tournament({ status: "PENDING_APPROVAL" }),
    });
    api.reject.mockResolvedValue({
      tournament: tournament({
        status: "CANCELLED",
        cancellationReason: "APPROVAL_REJECTED",
      }),
    });
    await renderWith(<AdminTournamentDetailScreen />);
    await screen.findByText("Refuser", {}, WAIT);
    api.get.mockResolvedValue({
      tournament: tournament({
        status: "CANCELLED",
        cancellationReason: "APPROVAL_REJECTED",
      }),
    });
    await fireEvent.press(await screen.findByText("Refuser", {}, WAIT));
    expect(api.reject).toHaveBeenCalledWith("jeton", ID);
    expect(await screen.findByText("Motif : Proposition refusée")).toBeTruthy();
  });

  it("annulation avec confirmation ; refus du serveur affiché", async () => {
    api.get.mockResolvedValue({ tournament: tournament() });
    api.cancel.mockRejectedValue(
      new ApiError(409, "TOURNAMENT_STARTED", "Ce tournoi a déjà démarré."),
    );
    await renderWith(<AdminTournamentDetailScreen />);
    await fireEvent.press(
      await screen.findByText("Annuler le tournoi", {}, WAIT),
    );
    expect(api.cancel).not.toHaveBeenCalled();
    await fireEvent.press(screen.getByText("Confirmer l’annulation"));
    expect(api.cancel).toHaveBeenCalledWith("jeton", ID);
    expect(await screen.findByText("Ce tournoi a déjà démarré.")).toBeTruthy();
  });

  it("tournoi en cours : aucune action d’annulation proposée", async () => {
    api.get.mockResolvedValue({
      tournament: tournament({ status: "IN_PROGRESS" }),
    });
    await renderWith(<AdminTournamentDetailScreen />);
    expect(await screen.findByText("En cours", {}, WAIT)).toBeTruthy();
    expect(screen.queryByText("Annuler le tournoi")).toBeNull();
  });

  it("résultats et export CSV produit par le serveur", async () => {
    const share = jest
      .spyOn(Share, "share")
      .mockResolvedValue({ action: "sharedAction" });
    api.get.mockResolvedValue({
      tournament: tournament({
        status: "COMPLETED",
        pool: {
          participants: 3,
          grossPool: 3000,
          platformFee: 300,
          prizePool: 2700,
        },
      }),
    });
    api.results.mockResolvedValue({
      tournament: tournament(),
      results: [
        result(1, "Ana", 1350),
        result(2, "Ben", 810),
        result(3, "Cid", 540),
      ],
    });
    api.exportCsv.mockResolvedValue(
      "Tournament,Player,Rank\r\nTournoi du samedi,Ana,1\r\n",
    );
    await renderWith(<AdminTournamentDetailScreen />);
    expect(
      (await screen.findByTestId("admin-result-1", {}, WAIT)).props.children,
    ).toBe(
      "1. Ana · jetons 1000 → 1400 · 6 parties, 3 gagnées · score 49.88 · gain 1 350 FCFA",
    );
    expect(
      screen.getByText(
        /Cagnotte : 3 000 FCFA brut · commission 300 FCFA · gains 2 700 FCFA/,
      ),
    ).toBeTruthy();
    await fireEvent.press(screen.getByText("Exporter (CSV)"));
    await waitFor(() =>
      expect(share).toHaveBeenCalledWith({
        title: "Classement — tournoi du 12 octobre 2026.csv",
        message: "Tournament,Player,Rank\r\nTournoi du samedi,Ana,1\r\n",
      }),
    );
    expect(api.exportCsv).toHaveBeenCalledWith("jeton", ID);
    share.mockRestore();
  });
});

describe("paramètres", () => {
  const settings = {
    platformFeePercent: 10,
    initialTokensCoefficient: 10,
    stakePerGameCoefficient: 0.5,
    maximumPendingTournamentsPerPlayer: 1,
    tournamentTransitionMinutes: 0,
    rankingTokensWeightPercent: 50,
    rankingGamesWeightPercent: 50,
    tournamentMinimumEntryFee: 500,
  };

  it("montant minimal pour créer un tournoi : 500 lu sur le serveur, modifiable", async () => {
    api.settings.mockResolvedValue({ settings });
    api.updateSettings.mockResolvedValue({
      settings: { ...settings, tournamentMinimumEntryFee: 1000 },
    });
    await renderWith(<AdminTournamentSettingsScreen />);
    const minimum = await screen.findByLabelText(
      "Montant minimal pour créer un tournoi (FCFA)",
      {},
      WAIT,
    );
    expect(minimum.props.value).toBe("500");
    await fireEvent.changeText(minimum, "1000");
    await fireEvent.press(screen.getByText("Enregistrer"));
    expect(api.updateSettings).toHaveBeenCalledWith("jeton", {
      tournamentMinimumEntryFee: 1000,
    });
    expect(await screen.findByText("Paramètres enregistrés.")).toBeTruthy();
  });

  it("montant minimal : entier seulement, aucun envoi d’une valeur décimale", async () => {
    api.settings.mockResolvedValue({ settings });
    await renderWith(<AdminTournamentSettingsScreen />);
    await fireEvent.changeText(
      await screen.findByLabelText("Montant minimal pour créer un tournoi (FCFA)", {}, WAIT),
      "750,5",
    );
    await fireEvent.press(screen.getByText("Enregistrer"));
    expect(api.updateSettings).not.toHaveBeenCalled();
    expect(screen.getByText("Nombre attendu.")).toBeTruthy();
  });

  it("affiche les paramètres de l’API et n’envoie que les modifications", async () => {
    api.settings.mockResolvedValue({ settings });
    api.updateSettings.mockResolvedValue({
      settings: { ...settings, platformFeePercent: 12.5 },
    });
    await renderWith(<AdminTournamentSettingsScreen />);
    const fee = await screen.findByLabelText(
      "Commission plateforme (%)",
      {},
      WAIT,
    );
    expect(fee.props.value).toBe("10");
    await fireEvent.changeText(fee, "12,5");
    await fireEvent.press(screen.getByText("Enregistrer"));
    expect(api.updateSettings).toHaveBeenCalledWith("jeton", {
      platformFeePercent: 12.5,
    });
    expect(await screen.findByText("Paramètres enregistrés.")).toBeTruthy();
  });

  it("coefficients (D-071) : décimale à la virgule envoyée comme nombre", async () => {
    api.settings.mockResolvedValue({ settings });
    api.updateSettings.mockResolvedValue({
      settings: { ...settings, stakePerGameCoefficient: 0.25 },
    });
    await renderWith(<AdminTournamentSettingsScreen />);
    const stake = await screen.findByLabelText(
      "Coefficient de mise par partie de tournoi",
      {},
      WAIT,
    );
    expect(stake.props.value).toBe("0.5");
    expect(
      screen.getByLabelText("Coefficient de jetons de tournoi au départ").props
        .value,
    ).toBe("10");
    await fireEvent.changeText(stake, "0,25");
    await fireEvent.press(screen.getByText("Enregistrer"));
    expect(api.updateSettings).toHaveBeenCalledWith("jeton", {
      stakePerGameCoefficient: 0.25,
    });
  });

  it("poids du classement (D-062) : modifiés ensemble, somme refusée par le serveur", async () => {
    api.settings.mockResolvedValue({ settings });
    api.updateSettings.mockRejectedValue(
      new ApiError(
        400,
        "VALIDATION_ERROR",
        "Certaines informations sont invalides.",
        {
          rankingTokensWeightPercent:
            "La somme des poids doit être exactement 100 %.",
        },
      ),
    );
    await renderWith(<AdminTournamentSettingsScreen />);
    const tokens = await screen.findByLabelText(
      "Classement : poids des jetons restants (%)",
      {},
      WAIT,
    );
    expect(tokens.props.value).toBe("50");
    expect(
      screen.getByLabelText("Classement : poids des parties jouées (%)").props
        .value,
    ).toBe("50");
    await fireEvent.changeText(tokens, "60");
    await fireEvent.press(screen.getByText("Enregistrer"));
    expect(api.updateSettings).toHaveBeenCalledWith("jeton", {
      rankingTokensWeightPercent: 60,
    });
    expect(
      await screen.findByText("La somme des poids doit être exactement 100 %."),
    ).toBeTruthy();
  });

  it("valeur hors bornes refusée par le serveur : message sur le champ", async () => {
    api.settings.mockResolvedValue({ settings });
    api.updateSettings.mockRejectedValue(
      new ApiError(
        400,
        "VALIDATION_ERROR",
        "Certaines informations sont invalides.",
        {
          platformFeePercent: "Entre 0 et 50.",
        },
      ),
    );
    await renderWith(<AdminTournamentSettingsScreen />);
    await fireEvent.changeText(
      await screen.findByLabelText("Commission plateforme (%)", {}, WAIT),
      "90",
    );
    await fireEvent.press(screen.getByText("Enregistrer"));
    expect(await screen.findByText("Entre 0 et 50.")).toBeTruthy();
  });
});
