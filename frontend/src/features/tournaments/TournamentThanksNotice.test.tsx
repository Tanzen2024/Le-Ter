/// <reference types="jest" />
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { router } from 'expo-router';

import { tournamentsApi } from '../../services/tournaments-api';
import { useAuthStore } from '../../stores/auth-store';
import type { AppNotification } from '../../types/tournament';
import { TournamentThanksNotice } from './TournamentThanksNotice';

jest.mock('../../services/tournaments-api', () => ({
  tournamentsApi: {
    notifications: jest.fn(),
    markNotificationRead: jest.fn().mockResolvedValue({ read: true }),
  },
}));
jest.mock('expo-router', () => {
  const { useEffect } = jest.requireActual('react');
  return {
    router: { push: jest.fn(), replace: jest.fn() },
    useFocusEffect: (effect: () => void) => useEffect(effect, [effect]),
  };
});

const api = tournamentsApi as jest.Mocked<typeof tournamentsApi>;
const push = router.push as jest.Mock;
const T1 = '11111111-1111-4111-8111-111111111111';

const thanks = (overrides: Partial<AppNotification> = {}): AppNotification => ({
  id: 'thanks-1',
  type: 'TOURNAMENT_THANK_YOU',
  payload: { tournamentId: T1, startsAt: new Date(2026, 9, 12, 18, 0).toISOString() },
  createdAt: new Date(2026, 9, 12, 20, 5, 10).toISOString(),
  ...overrides,
});

const clients: QueryClient[] = [];
async function renderNotice(notifications: AppNotification[]) {
  api.notifications.mockResolvedValue({
    notifications,
    unread: notifications.filter((n) => !n.readAt).length,
  });
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: Infinity } },
  });
  clients.push(queryClient);
  await render(
    <QueryClientProvider client={queryClient}>
      <TournamentThanksNotice />
    </QueryClientProvider>,
  );
  await waitFor(() => expect(api.notifications).toHaveBeenCalled());
}

beforeEach(() => {
  jest.clearAllMocks();
  useAuthStore.getState().signIn('jeton');
});
afterEach(async () => {
  await cleanup();
  clients.splice(0).forEach((client) => client.clear());
});

describe('remerciement de fin de tournoi (D-117)', () => {
  it('titre, tournoi identifié par sa date ; le lien ouvre SES résultats et le marque lu', async () => {
    await renderNotice([thanks()]);
    expect(await screen.findByText(/Merci pour votre participation !/)).toBeTruthy();
    expect(
      screen.getByText(
        'Le tournoi du 12 octobre 2026 est terminé. Merci d’avoir participé à cette compétition avec Le Ter !',
      ),
    ).toBeTruthy();
    fireEvent.press(screen.getByRole('button', { name: 'Voir les résultats du tournoi' }));
    // Route existante des résultats détaillés, avec l'identifiant du bon tournoi.
    expect(push).toHaveBeenCalledWith(`/tournament/results/${T1}`);
    await waitFor(() =>
      expect(api.markNotificationRead).toHaveBeenCalledWith(expect.anything(), 'thanks-1'),
    );
  });

  it('« Fermer » le marque lu sans naviguer', async () => {
    await renderNotice([thanks()]);
    fireEvent.press(await screen.findByRole('button', { name: 'Fermer' }));
    await waitFor(() =>
      expect(api.markNotificationRead).toHaveBeenCalledWith(expect.anything(), 'thanks-1'),
    );
    expect(push).not.toHaveBeenCalled();
  });

  it('déjà lu (reconnexion, redémarrage) : plus jamais affiché', async () => {
    await renderNotice([thanks({ readAt: new Date(2026, 9, 12, 20, 6).toISOString() })]);
    expect(screen.queryByTestId('tournament-thanks')).toBeNull();
  });

  it('pas encore renvoyé par le serveur (moins de 10 s) : rien, même avec les résultats annoncés', async () => {
    await renderNotice([
      {
        id: 'results-1',
        type: 'TOURNAMENT_RESULTS_AVAILABLE',
        payload: { tournamentId: T1, startsAt: new Date(2026, 9, 12, 18, 0).toISOString() },
        createdAt: new Date(2026, 9, 12, 20, 5).toISOString(),
      },
    ]);
    expect(screen.queryByTestId('tournament-thanks')).toBeNull();
  });

  it('un seul message à la fois, même avec plusieurs tournois terminés', async () => {
    const T2 = '22222222-2222-4222-8222-222222222222';
    await renderNotice([
      thanks({ id: 'thanks-2', payload: { tournamentId: T2, startsAt: new Date(2026, 9, 13, 18).toISOString() } }),
      thanks(),
    ]);
    expect(await screen.findAllByTestId('tournament-thanks')).toHaveLength(1);
  });
});
