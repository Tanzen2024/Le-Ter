/// <reference types="jest" />
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react-native';
import { router } from 'expo-router';
import type { ReactNode } from 'react';

import { tournamentsApi } from '../../services/tournaments-api';
import { useAuthStore } from '../../stores/auth-store';
import type { TournamentView } from '../../types/tournament';
import { participant, registration, tournamentView } from './tournament-fixtures.test-utils';
import { TournamentScreen } from './TournamentScreen';

jest.mock('../../services/tournaments-api', () => ({
  tournamentsApi: { list: jest.fn() },
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
    expect(soon.getByText('💰 1 000 FCFA')).toBeTruthy();
    expect(soon.getByText('👥 12 inscrits · 20 min · 100 max')).toBeTruthy();
    expect(soon.getByText('🏆 3 rangs récompensés')).toBeTruthy();
    expect(soon.getByText('🪙 1000 jetons de départ')).toBeTruthy();
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
