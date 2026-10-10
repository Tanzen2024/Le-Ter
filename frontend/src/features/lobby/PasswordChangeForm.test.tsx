/// <reference types="jest" />
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react-native';

import { ApiError } from '../../lib/api-client';
import { authApi } from '../../services/auth-api';
import { useAuthStore } from '../../stores/auth-store';
import { PasswordChangeForm } from './PasswordChangeForm';

jest.mock('../../services/auth-api', () => ({
  authApi: { changePassword: jest.fn(), refresh: jest.fn(), me: jest.fn() },
}));

const api = authApi as jest.Mocked<typeof authApi>;
const clients: QueryClient[] = [];

async function renderForm() {
  const onCancel = jest.fn();
  const onChanged = jest.fn();
  const client = new QueryClient({
    defaultOptions: { mutations: { retry: false } },
  });
  clients.push(client);
  await render(
    <QueryClientProvider client={client}>
      <PasswordChangeForm onCancel={onCancel} onChanged={onChanged} />
    </QueryClientProvider>,
  );
  return { onCancel, onChanged };
}

const type = (label: string, text: string) =>
  fireEvent.changeText(screen.getByLabelText(label), text);

async function fill(current: string, next: string, confirm = next) {
  await type('Mot de passe actuel', current);
  await type('Nouveau mot de passe', next);
  await type('Confirmer le nouveau mot de passe', confirm);
}

const save = () => fireEvent.press(screen.getByLabelText('Enregistrer le nouveau mot de passe'));

beforeEach(() => {
  useAuthStore.getState().signIn('access-token');
  api.changePassword.mockReset();
});
afterEach(async () => {
  await cleanup();
  clients.splice(0).forEach((c) => c.clear());
});

describe('PasswordChangeForm', () => {
  it('succès : appel de l’API avec le jeton, confirmation APRÈS la réponse du serveur', async () => {
    let resolve!: () => void;
    api.changePassword.mockReturnValue(
      new Promise<void>((r) => {
        resolve = r;
      }),
    );
    const { onChanged } = await renderForm();
    await fill('Secret123', 'Nouveau456');
    await save();
    expect(api.changePassword).toHaveBeenCalledWith('access-token', {
      currentPassword: 'Secret123',
      newPassword: 'Nouveau456',
      confirmPassword: 'Nouveau456',
    });
    // Chargement : bouton occupé, pas encore de confirmation, pas de double envoi.
    const button = screen.getByLabelText('Enregistrer le nouveau mot de passe');
    expect(button.props.accessibilityState).toMatchObject({
      busy: true,
      disabled: true,
    });
    expect(onChanged).not.toHaveBeenCalled();
    await save();
    expect(api.changePassword).toHaveBeenCalledTimes(1);
    await act(async () => resolve());
    expect(onChanged).toHaveBeenCalledTimes(1);
  });

  it('validation locale : champs vides, confirmation différente, mot de passe faible', async () => {
    await renderForm();
    await save();
    expect(screen.getAllByText('Ce champ est obligatoire.').length).toBeGreaterThanOrEqual(2);
    await fill('Secret123', 'Nouveau456', 'Autre789');
    await save();
    expect(screen.getByText('Les mots de passe ne correspondent pas.')).toBeTruthy();
    await fill('Secret123', 'court');
    await save();
    expect(screen.getByText('Au moins 8 caractères.')).toBeTruthy();
    expect(api.changePassword).not.toHaveBeenCalled();
  });

  it('mot de passe actuel refusé par le serveur : message sous le champ, saisie conservée', async () => {
    api.changePassword.mockRejectedValue(
      new ApiError(400, 'INVALID_CURRENT_PASSWORD', 'Le mot de passe actuel est incorrect.', {
        currentPassword: 'Le mot de passe actuel est incorrect.',
      }),
    );
    const { onChanged } = await renderForm();
    await fill('Mauvais999', 'Nouveau456');
    await save();
    expect(await screen.findByText('Le mot de passe actuel est incorrect.')).toBeTruthy();
    expect(screen.getByLabelText('Nouveau mot de passe').props.value).toBe('Nouveau456');
    expect(onChanged).not.toHaveBeenCalled();
  });

  it('erreur générale (réseau, limite) : message compréhensible', async () => {
    api.changePassword.mockRejectedValue(
      new ApiError(429, 'RATE_LIMITED', 'Trop de tentatives. Réessayez plus tard.'),
    );
    await renderForm();
    await fill('Secret123', 'Nouveau456');
    await save();
    expect(await screen.findByText('Trop de tentatives. Réessayez plus tard.')).toBeTruthy();
  });

  it('afficher / masquer chaque champ ; Annuler sans appel', async () => {
    const { onCancel } = await renderForm();
    expect(screen.getByLabelText('Nouveau mot de passe').props.secureTextEntry).toBe(true);
    await fireEvent.press(screen.getAllByLabelText('Afficher le mot de passe')[1]!);
    expect(screen.getByLabelText('Nouveau mot de passe').props.secureTextEntry).toBe(false);
    await fireEvent.press(screen.getByText('Annuler'));
    expect(onCancel).toHaveBeenCalled();
    expect(api.changePassword).not.toHaveBeenCalled();
  });
});
