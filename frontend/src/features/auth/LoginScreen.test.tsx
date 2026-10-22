/// <reference types="jest" />
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react-native';
import { router } from 'expo-router';

import LoginScreen from '../../../app/(auth)/login';
import { ApiError } from '../../lib/api-client';
import { authApi } from '../../services/auth-api';

jest.mock('../../services/auth-api', () => ({
  authApi: { login: jest.fn(), me: jest.fn() },
}));
jest.mock('./session', () => ({
  storeSession: jest.fn(),
  signOut: jest.fn(),
  withAccessToken: jest.fn(),
}));
jest.mock('expo-router', () => ({
  router: {
    push: jest.fn(),
    back: jest.fn(),
    replace: jest.fn(),
    canGoBack: () => false,
  },
}));

const api = authApi as jest.Mocked<typeof authApi>;
const clients: QueryClient[] = [];

async function renderScreen() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  clients.push(client);
  await render(
    <QueryClientProvider client={client}>
      <LoginScreen />
    </QueryClientProvider>,
  );
}

const type = async (label: string, text: string) =>
  fireEvent.changeText(screen.getByLabelText(label), text);

async function selectCountry(name: string) {
  await fireEvent.press(screen.getByTestId('country-select'));
  await type('Rechercher un pays', name);
  await fireEvent.press(within(screen.getByTestId('country-options')).getByText(name));
}

afterEach(async () => {
  await cleanup();
  clients.splice(0).forEach((c) => c.clear());
});
beforeEach(() => jest.clearAllMocks());

const IDENTIFIER = 'Téléphone ou email';
const button = () => screen.getByRole('button', { name: 'Se connecter' });

describe('connexion (D-135, D-139)', () => {
  it('titre CONNEXION sous les 5 cartes L E T E R', async () => {
    await renderScreen();
    expect(screen.getByRole('header')).toHaveTextContent('CONNEXION');
    expect(screen.getByLabelText('LETER')).toBeTruthy();
    for (const letter of ['L', 'T', 'R'])
      expect(screen.getAllByText(letter).length).toBeGreaterThan(0);
    expect(screen.getAllByText('E')).toHaveLength(2);
  });

  it('Cameroun présélectionné : numéro national seul, sans retaper +237', async () => {
    api.login.mockResolvedValue({
      user: {},
      accessToken: 'a',
      refreshToken: 'r',
    } as never);
    await renderScreen();
    expect(screen.getByText('+237')).toBeTruthy();
    expect(screen.getByTestId('country-flag-CM', { includeHiddenElements: true })).toBeTruthy();
    // Le libellé n'est qu'un filigrane : le champ est vide.
    expect(screen.getByLabelText(IDENTIFIER).props.value).toBe('');
    expect(screen.getByPlaceholderText('Téléphone ou email')).toBeTruthy();
    await type(IDENTIFIER, '695 122 301');
    await type('Mot de passe', 'Secret123');
    await fireEvent.press(button());
    expect(api.login).toHaveBeenCalledWith({
      country: 'CM',
      phone: '695122301',
      password: 'Secret123',
    });
  });

  it('numéro tapé avec son indicatif : accepté tel quel', async () => {
    api.login.mockResolvedValue({
      user: {},
      accessToken: 'a',
      refreshToken: 'r',
    } as never);
    await renderScreen();
    await type(IDENTIFIER, '+237 695 122 301');
    await type('Mot de passe', 'Secret123');
    await fireEvent.press(button());
    expect(api.login).toHaveBeenCalledWith({
      country: 'CM',
      phone: '695122301',
      password: 'Secret123',
    });
  });

  it('autre pays choisi dans la liste existante', async () => {
    api.login.mockResolvedValue({
      user: {},
      accessToken: 'a',
      refreshToken: 'r',
    } as never);
    await renderScreen();
    await selectCountry('France');
    await type(IDENTIFIER, '6 12 34 56 78');
    await type('Mot de passe', 'Secret123');
    await fireEvent.press(button());
    expect(api.login).toHaveBeenCalledWith({
      country: 'FR',
      phone: '612345678',
      password: 'Secret123',
    });
  });

  it('e-mail dans le même champ, sans choisir de mode', async () => {
    api.login.mockResolvedValue({
      user: {},
      accessToken: 'a',
      refreshToken: 'r',
    } as never);
    await renderScreen();
    await type(IDENTIFIER, ' exemple@email.com ');
    await type('Mot de passe', 'Secret123');
    await fireEvent.press(button());
    expect(api.login).toHaveBeenCalledWith({
      email: 'exemple@email.com',
      password: 'Secret123',
    });
  });

  it('bouton désactivé tant qu’un champ est vide', async () => {
    await renderScreen();
    expect(button().props.accessibilityState).toMatchObject({ disabled: true });
    await type(IDENTIFIER, '695122301');
    expect(button().props.accessibilityState).toMatchObject({ disabled: true });
    await type('Mot de passe', 'Secret123');
    expect(button().props.accessibilityState).toMatchObject({
      disabled: false,
    });
  });

  it('format invalide : message lisible, aucun appel au serveur', async () => {
    await renderScreen();
    await type(IDENTIFIER, '12');
    await type('Mot de passe', 'Secret123');
    await fireEvent.press(button());
    expect(screen.getByText('Numéro invalide pour ce pays.')).toBeTruthy();
    await type(IDENTIFIER, 'exemple@email');
    await fireEvent.press(button());
    expect(screen.getByText('Adresse e-mail invalide.')).toBeTruthy();
    expect(api.login).not.toHaveBeenCalled();
  });

  it('mot de passe masqué par défaut, affichable par l’œil', async () => {
    await renderScreen();
    expect(screen.getByLabelText('Mot de passe').props.secureTextEntry).toBe(true);
    await fireEvent.press(screen.getByLabelText('Afficher le mot de passe'));
    expect(screen.getByLabelText('Mot de passe').props.secureTextEntry).toBe(false);
    expect(screen.getByLabelText('Masquer le mot de passe')).toBeTruthy();
  });

  it('identifiants refusés : message générique du serveur', async () => {
    api.login.mockRejectedValue(
      new ApiError(401, 'INVALID_CREDENTIALS', 'Téléphone ou mot de passe incorrect.', {}),
    );
    await renderScreen();
    await type(IDENTIFIER, '699999999');
    await type('Mot de passe', 'Mauvais123');
    await fireEvent.press(button());
    expect(await screen.findByText('Téléphone ou mot de passe incorrect.')).toBeTruthy();
    // Bouton rétabli après l'échec.
    expect(button().props.accessibilityState).toMatchObject({
      disabled: false,
      busy: false,
    });
  });

  it('pendant l’envoi : « Connexion… », un seul appel malgré un double appui', async () => {
    api.login.mockReturnValue(new Promise(() => undefined) as never);
    await renderScreen();
    await type(IDENTIFIER, '695122301');
    await type('Mot de passe', 'Secret123');
    const ready = button();
    await fireEvent.press(ready);
    await fireEvent.press(ready);
    expect(await screen.findByText('Connexion…')).toBeTruthy();
    expect(api.login).toHaveBeenCalledTimes(1);
  });

  it('« Mot de passe oublié ? » ouvre la récupération existante', async () => {
    await renderScreen();
    await fireEvent.press(screen.getByText('Mot de passe oublié ?'));
    expect(router.push).toHaveBeenCalledWith('/forgot-password');
  });

  it('« S’inscrire » ouvre l’inscription', async () => {
    await renderScreen();
    await fireEvent.press(screen.getByText("S'inscrire"));
    expect(router.push).toHaveBeenCalledWith('/register');
  });
});
