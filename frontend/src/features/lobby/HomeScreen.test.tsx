/// <reference types="jest" />
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { router } from 'expo-router';
import type { ReactNode } from 'react';

import { tournamentsApi } from '../../services/tournaments-api';
import { useAuthStore } from '../../stores/auth-store';
import type { TournamentView } from '../../types/tournament';
import {
  participant,
  registration,
  tournamentView,
} from '../tournaments/tournament-fixtures.test-utils';
import { HomeScreen } from './HomeScreen';

jest.mock('../../services/tournaments-api', () => ({
  tournamentsApi: { list: jest.fn() },
}));
jest.mock('expo-router', () => {
  const { useEffect } = jest.requireActual('react');
  return {
    router: { push: jest.fn(), replace: jest.fn() },
    useFocusEffect: (effect: () => void) => useEffect(effect, [effect]),
  };
});
// La coquille (HUD, portefeuille, profil) n'est pas l'objet de ces tests.
const mockOpenPanel = jest.fn();
jest.mock('./LobbyShell', () => ({
  LobbyShell: ({ children }: { children: ReactNode }) => children,
  useLobbyPanels: () => ({ openPanel: mockOpenPanel }),
}));

const api = tournamentsApi as jest.Mocked<typeof tournamentsApi>;
const push = router.push as jest.Mock;

// Heures LOCALES : l'affichage suit le fuseau du téléphone, quel que soit celui des tests.
const local = (h: number, min = 0) => new Date(2026, 9, 12, h, min).toISOString();
const view = (overrides: Partial<TournamentView> = {}): TournamentView =>
  tournamentView({
    startsAt: local(18),
    endsAt: local(19, 30),
    registrationClosesAt: local(18),
    serverNow: local(16),
    ...overrides,
  });
const serve = (tournaments: TournamentView[]) =>
  api.list.mockResolvedValue({ tournaments, history: [], serverNow: local(16) });

const clients: QueryClient[] = [];
async function renderHome() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: Infinity } },
  });
  clients.push(queryClient);
  await render(
    <QueryClientProvider client={queryClient}>
      <HomeScreen />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  jest.clearAllMocks();
  useAuthStore.getState().signIn('jeton');
});
afterEach(async () => {
  await cleanup();
  clients.splice(0).forEach((client) => client.clear());
});

describe('accueil : panneau Tournois (D-059, D-065)', () => {
  it('« + Proposer un tournoi » présent une seule fois (Tournois), ouvre le parcours existant', async () => {
    serve([]);
    await renderHome();
    const buttons = screen.getAllByRole('button', { name: 'Proposer un tournoi' });
    expect(buttons).toHaveLength(1);
    expect(screen.getByText('+')).toBeTruthy();
    await fireEvent.press(buttons[0]!);
    expect(push).toHaveBeenCalledWith('/tournament/propose');
  });

  it('boutons existants inchangés : Rejoindre Privé et Rejoindre Tournois (liste complète)', async () => {
    serve([]);
    await renderHome();
    expect(screen.getByText('Choisis ton mode !')).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: 'Rejoindre : Privé' }));
    expect(mockOpenPanel).toHaveBeenCalledWith('private');
    await fireEvent.press(screen.getByRole('button', { name: 'Rejoindre : Tournois' }));
    expect(push).toHaveBeenCalledWith('/tournament');
  });

  it('résumé compact du prochain tournoi : date, horaires, statut, participation, inscrits / minimum, rangs, inscription', async () => {
    serve([view()]);
    await renderHome();
    const summary = await screen.findByTestId('home-tournament-summary');
    expect(screen.getByText('12/10/2026')).toBeTruthy();
    expect(screen.getByText('🕐 18:00 — 19:30')).toBeTruthy();
    expect(screen.getByText('Inscriptions ouvertes')).toBeTruthy();
    expect(screen.getByText('💰 1 000 FCFA  👥 12/20  🏆 3')).toBeTruthy();
    expect(screen.getByText('Non inscrit')).toBeTruthy();
    expect(api.list).toHaveBeenCalledWith('jeton');
    // Un appui ouvre la fiche (inscription) ; les boutons du panneau restent utilisables.
    await fireEvent.press(summary);
    expect(push).toHaveBeenCalledWith('/tournament/33333333-3333-4333-8333-333333333333');
    expect(screen.getByRole('button', { name: 'Proposer un tournoi' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Rejoindre : Tournois' })).toBeTruthy();
  });

  it('joueur inscrit : « ✓ Inscrit » ; tournoi en cours où il participe : prioritaire', async () => {
    const later = view({
      tournamentId: '55555555-5555-4555-8555-555555555555',
      startsAt: new Date(2026, 9, 13, 18).toISOString(),
      endsAt: new Date(2026, 9, 13, 19).toISOString(),
      registration,
      canRegister: false,
    });
    const live = view({
      status: 'IN_PROGRESS',
      startsAt: local(15),
      endsAt: local(17),
      registration,
      account: participant,
      canRegister: false,
      canJoin: true,
    });
    serve([live, later]);
    await renderHome();
    await screen.findByTestId('home-tournament-summary');
    expect(screen.getByText('En cours')).toBeTruthy();
    expect(screen.getByText('✓ Inscrit')).toBeTruthy();
  });

  it('tournoi « à venir » dont l’heure est passée sur l’horloge du serveur : jamais présenté à venir', async () => {
    serve([view({ startsAt: local(15), endsAt: local(17) })]);
    await renderHome();
    await waitFor(() => expect(api.list).toHaveBeenCalled());
    expect(screen.queryByTestId('home-tournament-summary')).toBeNull();
    expect(screen.queryByText('Inscriptions ouvertes')).toBeNull();
  });

  it('aucun tournoi : rien n’est affiché (aucune date inventée)', async () => {
    serve([]);
    await renderHome();
    await waitFor(() => expect(api.list).toHaveBeenCalled());
    expect(screen.queryByTestId('home-tournament-summary')).toBeNull();
  });

  it('serveur injoignable : rien n’est affiché, le panneau reste utilisable', async () => {
    api.list.mockRejectedValue(new Error('réseau'));
    await renderHome();
    await waitFor(() => expect(api.list).toHaveBeenCalled());
    expect(screen.queryByTestId('home-tournament-summary')).toBeNull();
    expect(screen.getByRole('button', { name: 'Proposer un tournoi' })).toBeTruthy();
  });
});
