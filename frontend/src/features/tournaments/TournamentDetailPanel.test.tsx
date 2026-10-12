/// <reference types="jest" />
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react-native';
import { router } from 'expo-router';

import { ApiError } from '../../lib/api-client';
import { sessionsApi } from '../../services/sessions-api';
import { tournamentsApi } from '../../services/tournaments-api';
import { useAuthStore } from '../../stores/auth-store';
import type { AppNotification, TournamentResultView, TournamentView } from '../../types/tournament';
import { useTournamentDetail } from './hooks';
import { participant, registration, tournamentView } from './tournament-fixtures.test-utils';
import { TournamentDetailPanel } from './TournamentDetailPanel';

jest.mock('../../services/tournaments-api', () => ({
  tournamentsApi: {
    get: jest.fn(),
    register: jest.fn(),
    join: jest.fn(),
    notifications: jest.fn(),
    markNotificationRead: jest.fn(),
  },
}));
jest.mock('../../services/sessions-api', () => ({
  sessionsApi: { leave: jest.fn() },
}));
jest.mock('expo-crypto', () => ({ randomUUID: () => jest.requireActual('crypto').randomUUID() }));
jest.mock('expo-router', () => {
  const { useEffect } = jest.requireActual('react');
  return {
    router: { replace: jest.fn(), push: jest.fn() },
    useFocusEffect: (effect: () => void) => useEffect(effect, [effect]),
  };
});

const api = tournamentsApi as jest.Mocked<typeof tournamentsApi>;
const sessions = sessionsApi as jest.Mocked<typeof sessionsApi>;
const replace = router.replace as jest.Mock;

const ID = '33333333-3333-4333-8333-333333333333';
const GAME = '44444444-4444-4444-8444-444444444444';
// Heures LOCALES : l'affichage suit le fuseau du téléphone, quel que soit celui des tests.
const local = (h: number) => new Date(2026, 9, 12, h, 0).toISOString();
const view = (overrides: Partial<TournamentView> = {}) =>
  tournamentView({
    startsAt: local(18),
    endsAt: local(20),
    registrationClosesAt: local(18),
    serverNow: local(16),
    ...overrides,
  });

const serve = (tournament: TournamentView) => api.get.mockResolvedValue({ tournament });

const result = (rank: number, username: string, prizeAmount: number): TournamentResultView => ({
  rank,
  username,
  initialTokens: 1000,
  remainingTokens: 2000 - rank * 300,
  gamesPlayed: 5,
  gamesWon: 4 - rank,
  prizePercent: [50, 30, 20][rank - 1] ?? 0,
  prizeAmount,
  paid: true,
});

/** La fiche telle que l'écran la monte : alimentée par la requête du détail. */
function Harness() {
  const { data, dataUpdatedAt } = useTournamentDetail(ID);
  return data ? <TournamentDetailPanel tournament={data} receivedAt={dataUpdatedAt} /> : null;
}

const clients: QueryClient[] = [];

async function renderDetail() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: Infinity },
      mutations: { retry: false, gcTime: Infinity },
    },
  });
  clients.push(queryClient);
  await render(
    <QueryClientProvider client={queryClient}>
      <Harness />
    </QueryClientProvider>,
  );
  await screen.findByTestId('tournament-details');
}

/** Bouton « Confirmer l'inscription » du dialogue (le titre porte le même texte). */
const confirmButton = () =>
  within(screen.getByTestId('tournament-register-dialog')).getByRole('button', {
    name: "Confirmer l'inscription",
  });

/** « S'inscrire », puis « Confirmer l'inscription » dans le dialogue. */
async function registerViaDialog() {
  await fireEvent.press(screen.getByText("S'inscrire"));
  await fireEvent.press(confirmButton());
}

afterEach(async () => {
  await cleanup();
  clients.splice(0).forEach((client) => client.clear());
});

beforeEach(() => {
  jest.clearAllMocks();
  useAuthStore.getState().signIn('jeton');
  api.notifications.mockResolvedValue({ notifications: [], unread: 0 });
});

describe('fiche d’un tournoi à venir', () => {
  it('date, début — fin, participation, inscrits / capacité / minimum, durée, rangs, statut (sans nom ni jetons de départ)', async () => {
    serve(view());
    await renderDetail();
    expect(screen.getByText('12 octobre 2026')).toBeTruthy();
    expect(screen.queryByText(/Tournoi du samedi/)).toBeNull();
    expect(screen.getByText(/18:00 — 20:00/)).toBeTruthy();
    const fact = (key: string) =>
      screen.getByTestId(`tournament-fact-${key}`).props.accessibilityLabel;
    expect(fact('entry')).toBe('💰 Inscription : 1 000 FCFA');
    expect(fact('players')).toBe('👥 Inscrits : 12 / 100 : minimum 20 joueurs');
    expect(fact('duration')).toBe('⏱️ Durée : 2 h');
    expect(fact('rewards')).toBe('🏆 Récompenses : 3 premiers rangs');
    expect(screen.getByText('12 / 100')).toBeTruthy();
    expect(screen.getByText('minimum 20 joueurs')).toBeTruthy();
    expect(screen.getByText('2 h')).toBeTruthy();
    expect(screen.queryByText(/jetons de départ/)).toBeNull();
    expect(screen.queryByText(/\d+ min\b/)).toBeNull();
    expect(screen.getByText('Inscriptions ouvertes')).toBeTruthy();
  });

  it('non inscrit : explique la réservation, confirme, puis affiche « Vous êtes inscrit à ce tournoi »', async () => {
    serve(view());
    const registered = view({
      registration,
      canRegister: false,
      canUnregister: true,
      registeredCount: 13,
    });
    api.register.mockResolvedValue({ tournament: registered });
    await renderDetail();
    expect(screen.getByText("Vous n'êtes pas encore inscrit.")).toBeTruthy();
    expect(
      screen.getByText(
        "Les frais d'inscription de 1 000 FCFA seront réservés sur votre compte de jeu. Le débit aura lieu uniquement au démarrage du tournoi. En cas d'annulation, le montant réservé sera libéré.",
      ),
    ).toBeTruthy();
    serve(registered); // l'état relu ensuite est celui du serveur
    await registerViaDialog();

    expect(api.register).toHaveBeenCalledTimes(1);
    expect(api.register).toHaveBeenCalledWith('jeton', ID);
    expect(await screen.findByText('Vous êtes inscrit à ce tournoi')).toBeTruthy();
    expect(screen.getByTestId('tournament-registered')).toBeTruthy();
    expect(screen.getByText('1 000 FCFA réservés')).toBeTruthy();
    expect(screen.getByText('En attente du début du tournoi')).toBeTruthy();
    expect(screen.queryByText("S'inscrire")).toBeNull();
    expect(screen.queryByTestId('tournament-register-dialog')).toBeNull();
  });

  it('déjà inscrit (état relu du serveur, après navigation ou reconnexion) : état inscrit, ni « S’inscrire » ni « Se désinscrire »', async () => {
    serve(view({ registration, canRegister: false, canUnregister: true }));
    await renderDetail();
    expect(screen.getByText('Vous êtes inscrit à ce tournoi')).toBeTruthy();
    expect(screen.getByText('1 000 FCFA réservés')).toBeTruthy();
    expect(screen.queryByText("S'inscrire")).toBeNull();
    expect(screen.queryByText('Se désinscrire')).toBeNull();
    expect(screen.queryByText(/désinscri/i)).toBeNull();
  });

  it('inscriptions clôturées : statut affiché, aucun bouton d’inscription', async () => {
    serve(view({ status: 'REGISTRATION_CLOSED', canRegister: false }));
    await renderDetail();
    expect(screen.getByText('Inscriptions clôturées')).toBeTruthy();
    expect(screen.queryByText("S'inscrire")).toBeNull();
  });

  it('solde disponible insuffisant : message clair dans le dialogue, nouvelle tentative possible', async () => {
    serve(view());
    api.register.mockRejectedValue(new ApiError(409, 'INSUFFICIENT_BALANCE', 'Solde insuffisant.'));
    await renderDetail();
    await registerViaDialog();
    expect(
      await screen.findByText(
        'Solde disponible insuffisant pour réserver la participation. Vous pouvez réessayer.',
      ),
    ).toBeTruthy();
    // Le dialogue reste ouvert : l'utilisateur peut réessayer (après avoir alimenté son compte).
    expect(screen.getByTestId('tournament-register-dialog')).toBeTruthy();
    expect(screen.queryByText('Vous êtes inscrit à ce tournoi')).toBeNull();
    await fireEvent.press(confirmButton());
    await waitFor(() => expect(api.register).toHaveBeenCalledTimes(2));
  });

  it('double inscription refusée par le serveur : le dialogue se ferme, l’état réel est relu', async () => {
    serve(view());
    api.register.mockRejectedValue(
      new ApiError(409, 'ALREADY_REGISTERED', 'Vous êtes déjà inscrit à ce tournoi.'),
    );
    await renderDetail();
    serve(view({ registration, canRegister: false }));
    await registerViaDialog();
    expect(await screen.findByText('Vous êtes inscrit à ce tournoi')).toBeTruthy();
    expect(screen.queryByTestId('tournament-register-dialog')).toBeNull();
    expect(api.register).toHaveBeenCalledTimes(1);
  });
});

describe('confirmation de l’inscription', () => {
  it('« S’inscrire » ouvre le dialogue : nom, prix d’entrée, message ; aucune requête', async () => {
    serve(view());
    await renderDetail();
    await fireEvent.press(screen.getByText("S'inscrire"));
    const dialog = within(screen.getByTestId('tournament-register-dialog'));
    expect(dialog.getAllByText("Confirmer l'inscription").length).toBeGreaterThan(0);
    expect(dialog.getByText('Tournoi du 12 octobre 2026 à 18:00')).toBeTruthy();
    expect(dialog.getByLabelText("Prix d'entrée : 1 000 FCFA")).toBeTruthy();
    expect(dialog.queryByText('Jetons requis')).toBeNull();
    expect(dialog.getByText(/Vous êtes sur le point de vous inscrire à ce tournoi/)).toBeTruthy();
    expect(dialog.getByText('Annuler')).toBeTruthy();
    expect(api.register).not.toHaveBeenCalled();
  });

  it('Annuler : aucune inscription, le dialogue se ferme', async () => {
    serve(view());
    await renderDetail();
    await fireEvent.press(screen.getByText("S'inscrire"));
    await fireEvent.press(screen.getByText('Annuler'));
    expect(screen.queryByTestId('tournament-register-dialog')).toBeNull();
    expect(api.register).not.toHaveBeenCalled();
    expect(screen.getByText("Vous n'êtes pas encore inscrit.")).toBeTruthy();
  });

  it('double clic sur « Confirmer » : une seule demande, chargement affiché, succès après la réponse', async () => {
    serve(view());
    let resolve!: (value: { tournament: TournamentView }) => void;
    api.register.mockReturnValue(new Promise((r) => (resolve = r)));
    await renderDetail();
    await fireEvent.press(screen.getByText("S'inscrire"));
    const confirm = confirmButton();
    await fireEvent.press(confirm);
    await fireEvent.press(confirm);
    expect(await screen.findByText('Inscription en cours…')).toBeTruthy();
    // Pendant le traitement, Annuler est inactif : le dialogue reste ouvert.
    await fireEvent.press(screen.getByText('Annuler'));
    expect(screen.getByTestId('tournament-register-dialog')).toBeTruthy();
    expect(api.register).toHaveBeenCalledTimes(1);
    // Aucun succès affiché avant la confirmation du serveur.
    expect(screen.queryByText('Vous êtes inscrit à ce tournoi')).toBeNull();

    const registered = view({ registration, canRegister: false });
    serve(registered);
    resolve({ tournament: registered });
    expect(await screen.findByText('Vous êtes inscrit à ce tournoi')).toBeTruthy();
    expect(api.register).toHaveBeenCalledTimes(1);
  });
});

describe('tournoi en cours : recherche de table', () => {
  it('joueur non inscrit : inscriptions fermées, aucune tentative de rejoindre', async () => {
    serve(view({ status: 'IN_PROGRESS', canRegister: false }));
    await renderDetail();
    expect(
      screen.getByText('Ce tournoi a déjà commencé et les inscriptions sont fermées.'),
    ).toBeTruthy();
    expect(screen.queryByText('Rejoindre le Tournoi')).toBeNull();
    expect(api.join).not.toHaveBeenCalled();
  });

  it('ouvrir la fiche n’affecte à aucune table ; « Rejoindre » affiche la recherche puis ouvre la table du serveur', async () => {
    serve(view({ status: 'IN_PROGRESS', registration, account: participant, canJoin: true }));
    let resolveJoin: (seat: {
      tournamentId: string;
      sessionId: string;
      gameId: string;
    }) => void = () => undefined;
    api.join.mockReturnValue(new Promise((resolve) => (resolveJoin = resolve)));
    await renderDetail();
    expect(screen.getByText('En cours')).toBeTruthy();
    expect(screen.getByText('🪙 1200 jetons · 3 parties')).toBeTruthy();
    expect(api.join).not.toHaveBeenCalled();

    await fireEvent.press(screen.getByText('Rejoindre le Tournoi'));
    expect(api.join).toHaveBeenCalledWith('jeton', ID);
    expect(await screen.findByText('Recherche d’une partie en cours…')).toBeTruthy();
    expect(screen.getByText('Recherche d’une table disponible…')).toBeTruthy();
    expect(screen.queryByText(/%/)).toBeNull(); // aucun faux pourcentage

    resolveJoin({ tournamentId: ID, sessionId: 'session-1', gameId: GAME });
    await waitFor(() => expect(replace).toHaveBeenCalledWith(`/game/${GAME}`));
    expect(api.join).toHaveBeenCalledTimes(1);
  });

  it('échec : message clair, nouvelle tentative possible (le serveur ne double pas l’affectation)', async () => {
    serve(view({ status: 'IN_PROGRESS', registration, account: participant, canJoin: true }));
    api.join.mockRejectedValueOnce(
      new ApiError(409, 'ALREADY_IN_SESSION', 'Déjà dans une partie.'),
    );
    api.join.mockResolvedValueOnce({ tournamentId: ID, sessionId: 'session-1', gameId: GAME });
    await renderDetail();
    await fireEvent.press(screen.getByText('Rejoindre le Tournoi'));
    expect(
      await screen.findByText(
        'Terminez votre partie en cours (ou quittez sa table) avant de rejoindre le tournoi.',
      ),
    ).toBeTruthy();
    expect(screen.getByText('Aucune table n’a pu vous être attribuée.')).toBeTruthy();
    expect(replace).not.toHaveBeenCalled();

    await fireEvent.press(screen.getByText('Réessayer'));
    await waitFor(() => expect(replace).toHaveBeenCalledWith(`/game/${GAME}`));
    expect(api.join).toHaveBeenCalledTimes(2);
  });

  describe('« Annuler la recherche »', () => {
    const SEAT = { tournamentId: ID, sessionId: 'session-1', gameId: GAME };
    const CANCELLED = 'Recherche annulée. Votre inscription au tournoi est conservée.';
    let resolveJoin: (seat: typeof SEAT) => void;
    let rejectJoin: (err: Error) => void;

    async function startSearch() {
      serve(view({ status: 'IN_PROGRESS', registration, account: participant, canJoin: true }));
      api.join.mockReturnValue(
        new Promise((resolve, reject) => {
          resolveJoin = resolve;
          rejectJoin = reject;
        }),
      );
      await renderDetail();
      await fireEvent.press(screen.getByText('Rejoindre le Tournoi'));
      expect(await screen.findByText('Recherche d’une partie en cours…')).toBeTruthy();
      await fireEvent.press(screen.getByText('Annuler la recherche'));
      expect(screen.getByText('Annulation de la recherche…')).toBeTruthy();
      // Une seule demande, même pendant l'annulation (pas de double affectation).
      expect(screen.queryByText('Annuler la recherche')).toBeNull();
    }

    it('place déjà attribuée : libérée une fois, pas d’écran de jeu, inscription conservée', async () => {
      sessions.leave.mockResolvedValue({ session: null } as never);
      await startSearch();
      resolveJoin(SEAT);
      expect(await screen.findByText(CANCELLED)).toBeTruthy();
      expect(sessions.leave).toHaveBeenCalledTimes(1);
      expect(sessions.leave).toHaveBeenCalledWith('jeton', 'session-1');
      expect(replace).not.toHaveBeenCalled();
      expect(screen.getByText('Rejoindre le Tournoi')).toBeTruthy();
    });

    it('aucune place attribuée (échec du serveur) : rien à libérer', async () => {
      await startSearch();
      rejectJoin(new ApiError(503, 'UNAVAILABLE', 'Indisponible.'));
      expect(await screen.findByText(CANCELLED)).toBeTruthy();
      expect(sessions.leave).not.toHaveBeenCalled();
      expect(replace).not.toHaveBeenCalled();
    });

    it('erreur réseau pendant la libération : message, nouvelle tentative sans nouvelle recherche', async () => {
      sessions.leave.mockRejectedValueOnce(new Error('réseau'));
      sessions.leave.mockResolvedValueOnce({ session: null } as never);
      await startSearch();
      resolveJoin(SEAT);
      expect(
        await screen.findByText(
          'L’annulation n’a pas abouti. Vérifiez votre connexion et réessayez.',
        ),
      ).toBeTruthy();
      await fireEvent.press(screen.getByText('Annuler la recherche'));
      expect(await screen.findByText(CANCELLED)).toBeTruthy();
      expect(sessions.leave).toHaveBeenCalledTimes(2);
      expect(api.join).toHaveBeenCalledTimes(1);
      expect(replace).not.toHaveBeenCalled();
    });

    it('la partie a démarré entre-temps : départ refusé par le serveur, la table s’ouvre', async () => {
      sessions.leave.mockRejectedValue(
        new ApiError(409, 'PLAYER_IN_ACTIVE_GAME', 'Partie en cours.'),
      );
      await startSearch();
      resolveJoin(SEAT);
      await waitFor(() => expect(replace).toHaveBeenCalledWith(`/game/${GAME}`));
      expect(screen.queryByText(CANCELLED)).toBeNull();
    });
  });

  it('plus assez de jetons : pas de table, classement conservé', async () => {
    serve(
      view({
        status: 'IN_PROGRESS',
        registration,
        account: { ...participant, currentTokens: 40, status: 'OUT_OF_TOKENS' },
        canJoin: false,
      }),
    );
    await renderDetail();
    expect(screen.getByText(/Plus assez de jetons/)).toBeTruthy();
    expect(screen.queryByText('Rejoindre le Tournoi')).toBeNull();
  });
});

describe('tournoi terminé ou annulé', () => {
  it('affiche les résultats : podium, gains, mon rang', async () => {
    serve(
      view({
        status: 'COMPLETED',
        registration,
        account: { ...participant, rank: 2, prizeAmount: 27000 },
        podium: [result(1, 'Ana', 45000), result(2, 'Ben', 27000), result(3, 'Cid', 18000)],
      }),
    );
    await renderDetail();
    expect(screen.getByText('Terminé')).toBeTruthy();
    expect(screen.getByText('🏆 TOURNOI TERMINÉ')).toBeTruthy();
    expect(screen.getByText('🥇 Ana — 45 000 FCFA')).toBeTruthy();
    expect(screen.getByText('🥈 Ben — 27 000 FCFA')).toBeTruthy();
    expect(screen.getByText('🥉 Cid — 18 000 FCFA')).toBeTruthy();
    expect(screen.getByText('Votre rang : 2 · gain : 27 000 FCFA')).toBeTruthy();
    expect(screen.queryByText("S'inscrire")).toBeNull();
    expect(screen.queryByText('Rejoindre le Tournoi')).toBeNull();
  });

  it('annulé faute de participants : raison et réservation libérée', async () => {
    serve(
      view({ status: 'CANCELLED', cancellationReason: 'INSUFFICIENT_PLAYERS', canRegister: false }),
    );
    await renderDetail();
    expect(screen.getByText('Annulé')).toBeTruthy();
    expect(screen.getByText('Tournoi annulé')).toBeTruthy();
    expect(
      screen.getByText('Pas assez de participants : votre réservation a été libérée.'),
    ).toBeTruthy();
  });
});

describe('notifications', () => {
  it('affiche les notifications non lues et les marque lues au toucher', async () => {
    const notice: AppNotification = {
      id: '55555555-5555-4555-8555-555555555555',
      type: 'TOURNAMENT_PRIZE_CREDITED',
      payload: { startsAt: new Date(2026, 9, 12, 18, 0).toISOString(), amount: 27000 },
      createdAt: '2026-10-12T19:05:00.000Z',
    };
    serve(view({ status: 'COMPLETED' }));
    api.notifications.mockResolvedValue({ notifications: [notice], unread: 1 });
    api.markNotificationRead.mockResolvedValue({ read: true });
    await renderDetail();
    const line = await screen.findByText(
      '🔔 Tournoi du 12/10/2026 18:00 : gain de 27 000 FCFA crédité.',
    );
    await fireEvent.press(line);
    expect(api.markNotificationRead).toHaveBeenCalledWith('jeton', notice.id);
  });

  it('approbation de proposition : plus affichée sous « S’inscrire », les autres restent', async () => {
    const startsAt = new Date(2026, 9, 12, 18, 0).toISOString();
    const approved: AppNotification = {
      id: '66666666-6666-4666-8666-666666666666',
      type: 'TOURNAMENT_APPROVED',
      payload: { startsAt },
      createdAt: '2026-10-10T09:00:00.000Z',
    };
    const prize: AppNotification = {
      id: '77777777-7777-4777-8777-777777777777',
      type: 'TOURNAMENT_PRIZE_CREDITED',
      payload: { startsAt, amount: 27000 },
      createdAt: '2026-10-12T19:05:00.000Z',
    };
    serve(view());
    api.notifications.mockResolvedValue({ notifications: [approved, prize], unread: 2 });
    await renderDetail();
    expect(
      await screen.findByText('🔔 Tournoi du 12/10/2026 18:00 : gain de 27 000 FCFA crédité.'),
    ).toBeTruthy();
    expect(screen.getByText(/^S.inscrire$/)).toBeTruthy();
    expect(screen.queryByText(/votre proposition est approuvée/)).toBeNull();
  });
});

describe('tournoi complet (D-057)', () => {
  const FULL_REGISTER =
    'Ce tournoi a atteint son nombre maximum de participants. Merci pour ton intérêt ! Découvre les autres tournois disponibles pour participer à la prochaine partie.';
  const FULL_JOIN =
    'Toutes les places de ce tournoi sont prises. Merci pour ton intérêt, on te retrouve au prochain tournoi !';

  it('inscription refusée car complet (requête concurrente) : message convivial, pas d’alerte', async () => {
    serve(view());
    api.register.mockRejectedValue(
      new ApiError(409, 'TOURNAMENT_FULL', 'Tournoi complet 🎉 Ce tournoi a atteint…'),
    );
    await renderDetail();
    serve(view({ registeredCount: 100, canRegister: false }));
    await registerViaDialog();
    expect(await screen.findByText('Tournoi complet 🎉')).toBeTruthy();
    expect(screen.getByText(FULL_REGISTER)).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();
    await waitFor(() => expect(screen.getAllByTestId('tournament-full')).toHaveLength(1));
  });

  it('tournoi déjà complet : places prises, aucun bouton d’inscription', async () => {
    serve(view({ registeredCount: 100, canRegister: false }));
    await renderDetail();
    expect(screen.getByText('Tournoi complet 🎉')).toBeTruthy();
    expect(screen.getByText(FULL_JOIN)).toBeTruthy();
    expect(screen.queryByText("S'inscrire")).toBeNull();
  });

  it('erreur réseau : message de connexion inchangé, pas de message « complet »', async () => {
    serve(view());
    api.register.mockRejectedValue(
      new ApiError(
        0,
        'NETWORK_ERROR',
        'Impossible de joindre le serveur. Vérifiez votre connexion.',
      ),
    );
    await renderDetail();
    await registerViaDialog();
    expect(
      await screen.findByText(/Impossible de joindre le serveur. Vérifiez votre connexion./),
    ).toBeTruthy();
    expect(screen.queryByText('Tournoi complet 🎉')).toBeNull();
  });
});
