/// <reference types="jest" />
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react-native';
import { router } from 'expo-router';
import type { ReactNode } from 'react';

import { tournamentsApi } from '../../services/tournaments-api';
import { useAuthStore } from '../../stores/auth-store';
import type { TournamentSummary, TournamentView } from '../../types/tournament';
import { participant, registration, tournamentView } from './tournament-fixtures.test-utils';
import { TournamentScreen } from './TournamentScreen';

jest.mock('../../services/tournaments-api', () => ({
  tournamentsApi: { list: jest.fn(), mine: jest.fn() },
}));
const mockParams: { searchCancelled?: string } = {};
jest.mock('expo-router', () => {
  const { useEffect } = jest.requireActual('react');
  return {
    router: { push: jest.fn(), replace: jest.fn(), back: jest.fn(), canGoBack: () => true },
    useFocusEffect: (effect: () => void) => useEffect(effect, [effect]),
    useLocalSearchParams: () => mockParams,
  };
});
// La coquille (HUD, portefeuille, profil) n'est pas l'objet de ces tests.
jest.mock('../lobby/LobbyShell', () => ({
  LobbyShell: ({ children }: { children: ReactNode }) => children,
}));

const api = tournamentsApi as jest.Mocked<typeof tournamentsApi>;
const push = router.push as jest.Mock;

// Heures LOCALES : l'affichage suit le fuseau du téléphone, quel que soit celui des tests.
const at = (day: number, h: number) => new Date(2026, 9, day, h, 0).toISOString();
const NOW = at(12, 16);
const view = (id: string, day: number, overrides: Partial<TournamentView> = {}) =>
  tournamentView({
    tournamentId: id,
    startsAt: at(day, 18),
    endsAt: at(day, 19),
    registrationClosesAt: at(day, 18),
    serverNow: NOW,
    ...overrides,
  });

const LIVE = '11111111-1111-4111-8111-111111111111';
const SOON = '22222222-2222-4222-8222-222222222222';
const LATER = '33333333-3333-4333-8333-333333333333';
const OLD = '44444444-4444-4444-8444-444444444444';

const clients: QueryClient[] = [];
async function renderList() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: Infinity } },
  });
  clients.push(queryClient);
  await render(
    <QueryClientProvider client={queryClient}>
      <TournamentScreen />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  jest.clearAllMocks();
  delete mockParams.searchCancelled;
  useAuthStore.getState().signIn('jeton');
  // Par défaut, le joueur connecté n'a proposé aucun tournoi.
  api.mine.mockResolvedValue({ tournaments: [] });
});
afterEach(async () => {
  await cleanup();
  clients.splice(0).forEach((client) => client.clear());
});

describe('écran Tournois : liste complète (D-065)', () => {
  it('quatre groupes (ouvertes, clôturées/complets, en cours, historique), avec leur statut', async () => {
    api.list.mockResolvedValue({
      tournaments: [
        view(LIVE, 12, {
          status: 'IN_PROGRESS',
          startsAt: at(12, 15),
          endsAt: at(12, 17),
          registration,
          account: participant,
          canRegister: false,
          canJoin: true,
        }),
        view(SOON, 13, { registration, canRegister: false, canUnregister: true }),
        view(LATER, 14, { status: 'REGISTRATION_CLOSED', canRegister: false }),
      ],
      history: [view(OLD, 5, { status: 'CANCELLED', cancellationReason: 'INSUFFICIENT_PLAYERS' })],
      serverNow: NOW,
    });
    await renderList();
    await screen.findByTestId('tournament-list', {}, { timeout: 10_000 });

    const ids = screen
      .getAllByTestId(/^tournament-card-/)
      .map((card) => String(card.props.testID).replace('tournament-card-', ''));
    expect(ids).toEqual([SOON, LATER, LIVE, OLD]);
    const group = (key: string, id: string) =>
      within(screen.getByTestId(`tournament-group-${key}`)).getByTestId(`tournament-card-${id}`);
    expect(group('open', SOON)).toBeTruthy();
    expect(group('closed', LATER)).toBeTruthy();
    expect(group('inProgress', LIVE)).toBeTruthy();
    expect(group('history', OLD)).toBeTruthy();
    for (const title of [
      'Inscriptions ouvertes',
      'Inscriptions clôturées ou tournois complets',
      'Tournois en cours',
      'Historique',
    ]) {
      expect(screen.getAllByRole('header').map((h) => h.props.children)).toContain(title);
    }

    const live = within(screen.getByTestId(`tournament-card-${LIVE}`));
    expect(live.getByText('En cours')).toBeTruthy();
    expect(live.getByText('✓ Inscrit')).toBeTruthy();
    const soon = within(screen.getByTestId(`tournament-card-${SOON}`));
    expect(soon.getByText('13 octobre 2026')).toBeTruthy();
    expect(soon.getByText('Inscriptions ouvertes')).toBeTruthy();
    expect(soon.getByText('🕐 18:00 — 19:00')).toBeTruthy();
    expect(soon.getByText('💰 1 000 FCFA')).toBeTruthy();
    expect(soon.getByText('👥 Inscrits : 12 / 100 · minimum 20')).toBeTruthy();
    // Plus de « 20 min » : le minimum de joueurs ne doit pas se lire comme une durée.
    expect(soon.queryByText(/\d+ min\b/)).toBeNull();
    expect(soon.getByText('🏆 3 premiers rangs récompensés')).toBeTruthy();
    // Jetons de départ : plus affichés nulle part côté joueur.
    expect(soon.queryByText(/jetons de départ/)).toBeNull();
    expect(soon.queryByText(/🪙/)).toBeNull();
    const later = within(screen.getByTestId(`tournament-card-${LATER}`));
    expect(later.getByText('Inscriptions clôturées')).toBeTruthy();
    expect(later.getByText('Non inscrit')).toBeTruthy();
    expect(within(screen.getByTestId(`tournament-card-${OLD}`)).getByText('Annulé')).toBeTruthy();
  });

  it('tournoi complet non démarré : « clôturées ou complets », jamais « en cours » ; groupes vides masqués', async () => {
    api.list.mockResolvedValue({
      tournaments: [view(SOON, 13, { registeredCount: 100, maximumPlayers: 100 }), view(LATER, 14)],
      history: [],
      serverNow: NOW,
    });
    await renderList();
    await screen.findByTestId('tournament-list', {}, { timeout: 10_000 });
    expect(
      within(screen.getByTestId('tournament-group-closed')).getByTestId(`tournament-card-${SOON}`),
    ).toBeTruthy();
    expect(
      within(screen.getByTestId('tournament-group-open')).getByTestId(`tournament-card-${LATER}`),
    ).toBeTruthy();
    expect(screen.queryByTestId('tournament-group-inProgress')).toBeNull();
    expect(screen.queryByTestId('tournament-group-history')).toBeNull();
    expect(screen.getAllByTestId(/^tournament-card-/)).toHaveLength(2);
  });

  it('retour après « Annuler la recherche » : confirmation discrète', async () => {
    mockParams.searchCancelled = '1';
    api.list.mockResolvedValue({ tournaments: [view(SOON, 13)], history: [], serverNow: NOW });
    await renderList();
    expect(
      await screen.findByText('Recherche annulée. Votre inscription au tournoi est conservée.'),
    ).toBeTruthy();
  });

  it('la flèche (à droite de chaque carte) ouvre la fiche, sans affecter de table', async () => {
    api.list.mockResolvedValue({ tournaments: [view(SOON, 13)], history: [], serverNow: NOW });
    await renderList();
    const arrow = await screen.findByTestId(`tournament-open-${SOON}`);
    expect(arrow.props.accessibilityLabel).toBe('Ouvrir le tournoi du 13 octobre 2026');
    await fireEvent.press(arrow);
    expect(push).toHaveBeenCalledWith(`/tournament/${SOON}`);
    expect(push).toHaveBeenCalledTimes(1);
  });

  it('heure de début dépassée sur l’horloge du serveur : « Démarrage », jamais « À venir »', async () => {
    api.list.mockResolvedValue({
      tournaments: [view(SOON, 12, { status: 'SCHEDULED', startsAt: at(12, 15) })],
      history: [],
      serverNow: NOW,
    });
    await renderList();
    await screen.findByTestId('tournament-list', {}, { timeout: 10_000 });
    expect(screen.getByText('Démarrage')).toBeTruthy();
    expect(screen.queryByText('À venir')).toBeNull();
  });

  it('aucun tournoi : état vide discret, « Proposer un tournoi » reste accessible', async () => {
    api.list.mockResolvedValue({ tournaments: [], history: [], serverNow: NOW });
    await renderList();
    expect(await screen.findByText('Aucun tournoi programmé pour le moment.')).toBeTruthy();
    await fireEvent.press(screen.getByText('＋ Proposer un tournoi'));
    expect(push).toHaveBeenCalledWith('/tournament/propose');
  });

  it('serveur injoignable : message et nouvelle tentative', async () => {
    api.list.mockRejectedValueOnce(new Error('réseau'));
    api.list.mockResolvedValueOnce({ tournaments: [view(SOON, 13)], history: [], serverNow: NOW });
    await renderList();
    expect(await screen.findByText('Impossible de charger les tournois.')).toBeTruthy();
    await fireEvent.press(screen.getByText('Réessayer'));
    expect(await screen.findByTestId(`tournament-card-${SOON}`)).toBeTruthy();
  });
});

describe('badge « ✓ Proposition approuvée » : initiateur uniquement', () => {
  // Proposition telle que GET /api/tournaments/mine la renvoie (créateur = jeton, serveur).
  const proposal = (id: string, status: TournamentSummary['status']): TournamentSummary => {
    const {
      registration: _r,
      account: _a,
      podium: _p,
      canRegister: _c1,
      canUnregister: _c2,
      canJoin: _c3,
      serverNow: _s,
      registeredCount: _n,
      ...rest
    } = view(id, 13);
    return { ...rest, creatorType: 'PLAYER', status };
  };
  const badge = (id: string) => screen.queryByTestId(`tournament-approved-proposal-${id}`);
  /** Attend que « mes propositions » soit relu, pour qu'une absence de badge soit probante. */
  async function settleProposals() {
    await waitFor(() => expect(api.mine).toHaveBeenCalled());
    await act(async () => {});
  }

  it('initiateur + proposition approuvée : badge en haut de SA carte, à côté de la date', async () => {
    api.list.mockResolvedValue({
      tournaments: [view(SOON, 13), view(LATER, 14, { creatorType: 'PLAYER' })],
      history: [],
      serverNow: NOW,
    });
    api.mine.mockResolvedValue({ tournaments: [proposal(SOON, 'REGISTRATION_OPEN')] });
    await renderList();

    const shown = await screen.findByTestId(`tournament-approved-proposal-${SOON}`);
    expect(within(shown).getByText('✓ Proposition approuvée')).toBeTruthy();
    // Dans la carte du tournoi, sur la première ligne (date, statut, inscription) : rien n'est masqué.
    const card = within(screen.getByTestId(`tournament-card-${SOON}`));
    expect(card.getByTestId(`tournament-approved-proposal-${SOON}`)).toBeTruthy();
    expect(within(shown.parent!.parent!).getByText('13 octobre 2026')).toBeTruthy();
    expect(card.getByText('Inscriptions ouvertes')).toBeTruthy();
    expect(card.getByText('Non inscrit')).toBeTruthy();
    expect(card.getByText('💰 1 000 FCFA')).toBeTruthy();
    // Proposé par un autre joueur : aucun badge, même publié.
    expect(badge(LATER)).toBeNull();
    expect(screen.getAllByText('✓ Proposition approuvée')).toHaveLength(1);
  });

  it('autre joueur, même tournoi approuvé, même inscrit : aucun badge', async () => {
    api.list.mockResolvedValue({
      tournaments: [
        view(SOON, 13, { creatorType: 'PLAYER', registration, canRegister: false }),
      ],
      history: [],
      serverNow: NOW,
    });
    await renderList();
    await screen.findByTestId(`tournament-card-${SOON}`);
    await settleProposals();
    // Inscrit, mais pas initiateur : seul « ✓ Inscrit » apparaît.
    expect(within(screen.getByTestId(`tournament-card-${SOON}`)).getByText('✓ Inscrit')).toBeTruthy();
    expect(badge(SOON)).toBeNull();
    expect(screen.queryByText('✓ Proposition approuvée')).toBeNull();
  });

  it('initiateur + proposition non approuvée (en attente, refusée) : pas de carte, pas de badge', async () => {
    const PENDING = '55555555-5555-4555-8555-555555555555';
    const REJECTED = '66666666-6666-4666-8666-666666666666';
    // La liste ne contient que des tournois publiés : ses propositions non approuvées n'y sont pas.
    api.list.mockResolvedValue({ tournaments: [view(SOON, 13)], history: [], serverNow: NOW });
    api.mine.mockResolvedValue({
      tournaments: [
        proposal(PENDING, 'PENDING_APPROVAL'),
        { ...proposal(REJECTED, 'CANCELLED'), cancellationReason: 'APPROVAL_REJECTED' },
      ],
    });
    await renderList();
    await screen.findByTestId(`tournament-card-${SOON}`);
    await settleProposals();
    expect(screen.queryByTestId(`tournament-card-${PENDING}`)).toBeNull();
    expect(screen.queryByTestId(`tournament-card-${REJECTED}`)).toBeNull();
    expect(screen.queryByText('✓ Proposition approuvée')).toBeNull();
  });

  it('propositions illisibles : liste affichée normalement, sans badge', async () => {
    api.list.mockResolvedValue({ tournaments: [view(SOON, 13)], history: [], serverNow: NOW });
    api.mine.mockRejectedValue(new Error('réseau'));
    await renderList();
    expect(await screen.findByTestId(`tournament-card-${SOON}`)).toBeTruthy();
    await settleProposals();
    expect(badge(SOON)).toBeNull();
  });

  it('carte avec badge : l’ouverture de la fiche est inchangée', async () => {
    api.list.mockResolvedValue({ tournaments: [view(SOON, 13)], history: [], serverNow: NOW });
    api.mine.mockResolvedValue({ tournaments: [proposal(SOON, 'REGISTRATION_OPEN')] });
    await renderList();
    await screen.findByTestId(`tournament-approved-proposal-${SOON}`);
    await fireEvent.press(screen.getByTestId(`tournament-open-${SOON}`));
    await fireEvent.press(screen.getByTestId(`tournament-card-${SOON}`));
    expect(push).toHaveBeenNthCalledWith(1, `/tournament/${SOON}`);
    expect(push).toHaveBeenNthCalledWith(2, `/tournament/${SOON}`);
  });
});
