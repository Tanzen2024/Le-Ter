/// <reference types="jest" />
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react-native';

import { ApiError } from '../../lib/api-client';
import { adminApi } from '../../services/admin-api';
import { authApi } from '../../services/auth-api';
import { useAuthStore } from '../../stores/auth-store';
import type { PublicUser } from '../../types/auth';
import { AdminScreen } from './AdminScreen';

jest.mock('../../services/admin-api', () => ({
  adminApi: { detectionSetting: jest.fn(), setDetection: jest.fn() },
}));
jest.mock('../../services/auth-api', () => ({ authApi: { me: jest.fn() } }));
jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn(async () => null),
  setItemAsync: jest.fn(async () => undefined),
  deleteItemAsync: jest.fn(async () => undefined),
}));
jest.mock('expo-router', () => ({
  router: {
    back: jest.fn(),
    replace: jest.fn(),
    canGoBack: jest.fn(() => true),
  },
}));

const me = authApi.me as jest.Mock;
const getSetting = adminApi.detectionSetting as jest.Mock;
const setDetection = adminApi.setDetection as jest.Mock;

const user = (role: PublicUser['role']): { user: PublicUser } => ({
  user: {
    id: '11111111-1111-4111-8111-111111111111',
    firstName: 'Awa',
    lastName: 'Ndiaye',
    email: 'awa@example.com',
    username: 'awa',
    phone: '+237600000000',
    phoneVerified: true,
    role,
    createdAt: '2026-10-01T00:00:00.000Z',
  },
});

// Deux requêtes enchaînées (compte, puis réglage) : marge pour une machine chargée.
const WAIT = { timeout: 5000 };

const clients: QueryClient[] = [];
async function renderScreen() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  clients.push(queryClient);
  await render(
    <QueryClientProvider client={queryClient}>
      <AdminScreen />
    </QueryClientProvider>,
  );
}
const toggle = () => screen.findByLabelText('Détection anti-collusion', {}, WAIT);

beforeEach(() => {
  jest.clearAllMocks();
  useAuthStore.getState().signIn('jeton');
});
afterEach(async () => {
  await cleanup();
  clients.splice(0).forEach((client) => client.clear());
});

describe('AdminScreen', () => {
  it('compte joueur : aucun réglage affiché, aucune route admin appelée', async () => {
    me.mockResolvedValue(user('user'));
    await renderScreen();
    expect(await screen.findByText('Page indisponible.', {}, WAIT)).toBeTruthy();
    expect(screen.queryByText('Détection anti-collusion')).toBeNull();
    expect(getSetting).not.toHaveBeenCalled();
  });

  it('admin : statut lu sur le serveur (désactivée par défaut)', async () => {
    me.mockResolvedValue(user('admin'));
    getSetting.mockResolvedValue({ enabled: false, updatedAt: null });
    await renderScreen();
    expect(await screen.findByText('Statut : Désactivée', {}, WAIT)).toBeTruthy();
    expect((await toggle()).props.value).toBe(false);
    expect(getSetting).toHaveBeenCalledWith('jeton');
  });

  it('activation puis désactivation : confirmées par le serveur', async () => {
    me.mockResolvedValue(user('admin'));
    getSetting.mockResolvedValue({ enabled: false, updatedAt: null });
    await renderScreen();

    setDetection.mockResolvedValueOnce({
      enabled: true,
      updatedAt: 'x',
      changed: true,
    });
    await fireEvent(await toggle(), 'valueChange', true);
    expect(await screen.findByText('Détection anti-collusion activée.', {}, WAIT)).toBeTruthy();
    expect(screen.getByText('Statut : Activée')).toBeTruthy();
    expect(setDetection).toHaveBeenCalledWith('jeton', true);

    setDetection.mockResolvedValueOnce({
      enabled: false,
      updatedAt: 'y',
      changed: true,
    });
    await fireEvent(await toggle(), 'valueChange', false);
    expect(await screen.findByText('Détection anti-collusion désactivée.', {}, WAIT)).toBeTruthy();
    expect(screen.getByText('Statut : Désactivée')).toBeTruthy();
  });

  it('refus du serveur : l’interrupteur garde la valeur confirmée', async () => {
    me.mockResolvedValue(user('admin'));
    getSetting.mockResolvedValue({ enabled: false, updatedAt: null });
    setDetection.mockRejectedValue(new ApiError(403, 'FORBIDDEN', 'Interdit'));
    await renderScreen();
    await fireEvent(await toggle(), 'valueChange', true);
    expect(
      await screen.findByText("Le changement n'a pas pu être enregistré.", {}, WAIT),
    ).toBeTruthy();
    await waitFor(async () => expect((await toggle()).props.value).toBe(false));
    expect(screen.getByText('Statut : Désactivée')).toBeTruthy();
  });
});
