/// <reference types="jest" />
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react-native';

import { sessionsApi } from '../../services/sessions-api';
import { useAuthStore } from '../../stores/auth-store';
import type { OpenTable } from '../../types/session';
import { PrivateGamePanel } from './PrivateGamePanel';

jest.mock('../../services/sessions-api', () => ({
  sessionsApi: {
    listOpen: jest.fn(),
    listMine: jest.fn().mockResolvedValue({ sessions: [] }),
    create: jest.fn(),
  },
}));
jest.mock('../auth/hooks', () => ({
  useCurrentUser: () => ({ data: { id: 'me', username: 'roly' } }),
}));
jest.mock('expo-router', () => ({ router: { push: jest.fn(), replace: jest.fn() } }));
jest.mock('expo-crypto', () => ({
  randomUUID: () => jest.requireActual('crypto').randomUUID(),
}));

const api = sessionsApi as jest.Mocked<typeof sessionsApi>;

const guardedTable: OpenTable = {
  sessionId: '22222222-2222-4222-8222-222222222222',
  gameId: '33333333-3333-4333-8333-333333333333',
  name: 'Table surveillée',
  creatorName: 'kofi',
  stakeAmount: 100,
  hasPassword: false,
  suspicionDetectionEnabled: true,
  mine: false,
  maxPlayers: 4,
  playerCount: 1,
  createdAt: '2026-10-11T18:00:00.000Z',
};

/**
 * Bouton « Détection anti-collusion » (D-043) : proposé seulement si l'administration a activé
 * la détection globalement (D-053, D-081), d'après `detectionAvailable` du serveur.
 */
async function renderPanel(
  detectionAvailable: boolean | undefined,
  gameType: 'TER' | 'GARAM' = 'TER',
) {
  api.listOpen.mockResolvedValue({
    tables: [guardedTable],
    ...(detectionAvailable !== undefined && { detectionAvailable }),
  });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  await render(
    <QueryClientProvider client={client}>
      <PrivateGamePanel onClose={() => undefined} gameType={gameType} />
    </QueryClientProvider>,
  );
  await waitFor(() => expect(screen.getByText('Table surveillée')).toBeTruthy());
}

beforeEach(() => {
  jest.clearAllMocks();
  useAuthStore.getState().signIn('jeton');
});
afterEach(cleanup);

describe('option « Détection anti-collusion » et interrupteur global', () => {
  it('détection coupée par l’administration : ni bouton à la création, ni bouclier dans la liste', async () => {
    await renderPanel(false);
    expect(screen.queryByText('Détection anti-collusion')).toBeNull();
    expect(screen.queryByRole('switch', { name: 'Détection anti-collusion' })).toBeNull();
    expect(screen.queryByText('🛡️')).toBeNull();
    expect(JSON.stringify(screen.toJSON())).not.toContain('anti-collusion');
  });

  it('réponse d’un ancien serveur (champ absent) : option non proposée par défaut', async () => {
    await renderPanel(undefined);
    expect(screen.queryByText('Détection anti-collusion')).toBeNull();
  });

  it('détection activée : bouton proposé, éteint par défaut, et basculable', async () => {
    await renderPanel(true);
    const toggle = screen.getByRole('switch', { name: 'Détection anti-collusion' });
    expect(toggle).not.toBeChecked();
    await fireEvent.press(toggle);
    expect(screen.getByRole('switch', { name: 'Détection anti-collusion' })).toBeChecked();
  });

  it('détection coupée : la création n’envoie jamais l’option activée', async () => {
    api.create.mockReturnValue(new Promise(() => undefined));
    await renderPanel(false);
    await fireEvent.press(screen.getByText('Créer'));
    await waitFor(() => expect(api.create).toHaveBeenCalledTimes(1));
    expect(api.create.mock.calls[0]![1]).toMatchObject({ suspicionDetectionEnabled: false });
  });

  it('GARAM TIA (D-125) : même option, envoyée avec le jeu de la table', async () => {
    api.create.mockReturnValue(new Promise(() => undefined));
    await renderPanel(true, 'GARAM');
    await fireEvent.press(screen.getByRole('switch', { name: 'Détection anti-collusion' }));
    await fireEvent.press(screen.getByRole('radio', { name: 'GARAM 16' }));
    await fireEvent.press(screen.getByText('Créer'));
    await waitFor(() => expect(api.create).toHaveBeenCalledTimes(1));
    expect(api.create.mock.calls[0]![1]).toMatchObject({
      gameType: 'GARAM',
      garamVariant: 16,
      suspicionDetectionEnabled: true,
    });
  });

  it('GARAM TIA, détection coupée par l’administration : option non proposée', async () => {
    await renderPanel(false, 'GARAM');
    expect(screen.queryByRole('switch', { name: 'Détection anti-collusion' })).toBeNull();
  });
});

describe('variante GARAM TIA (D-127)', () => {
  it('15 présélectionnée ; sans autre choix, envoyée explicitement', async () => {
    api.create.mockReturnValue(new Promise(() => undefined));
    await renderPanel(true, 'GARAM');
    for (const v of [15, 16, 17, 18]) {
      const radio = screen.getByRole('radio', { name: `GARAM ${v}` });
      if (v === 15) expect(radio).toBeChecked();
      else expect(radio).not.toBeChecked();
    }
    await fireEvent.press(screen.getByText('Créer'));
    await waitFor(() => expect(api.create).toHaveBeenCalledTimes(1));
    expect(api.create.mock.calls[0]![1]).toMatchObject({ gameType: 'GARAM', garamVariant: 15 });
  });

  it.each([15, 16, 17, 18])('GARAM %i : choisie puis envoyée telle quelle', async (v) => {
    api.create.mockReturnValue(new Promise(() => undefined));
    await renderPanel(true, 'GARAM');
    await fireEvent.press(screen.getByRole('radio', { name: `GARAM ${v}` }));
    expect(screen.getByRole('radio', { name: `GARAM ${v}` })).toBeChecked();
    await fireEvent.press(screen.getByText('Créer'));
    await waitFor(() => expect(api.create).toHaveBeenCalledTimes(1));
    expect(api.create.mock.calls[0]![1]).toMatchObject({ gameType: 'GARAM', garamVariant: v });
  });

  it('Fap-Fap : aucun choix de variante, aucune variante envoyée', async () => {
    api.create.mockReturnValue(new Promise(() => undefined));
    await renderPanel(true, 'TER');
    expect(screen.queryByRole('radio', { name: 'GARAM 15' })).toBeNull();
    await fireEvent.press(screen.getByText('Créer'));
    await waitFor(() => expect(api.create).toHaveBeenCalledTimes(1));
    expect(api.create.mock.calls[0]![1]).not.toHaveProperty('garamVariant');
    expect(api.create.mock.calls[0]![1]).not.toHaveProperty('gameType');
  });

  it('liste GARAM : la variante de chaque table est affichée', async () => {
    api.listOpen.mockResolvedValue({
      tables: [{ ...guardedTable, gameType: 'GARAM', garamVariant: 17 }],
      detectionAvailable: true,
    });
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    await render(
      <QueryClientProvider client={client}>
        <PrivateGamePanel onClose={() => undefined} gameType="GARAM" />
      </QueryClientProvider>,
    );
    expect(await screen.findByText('Table surveillée · GARAM 17')).toBeTruthy();
  });
});
