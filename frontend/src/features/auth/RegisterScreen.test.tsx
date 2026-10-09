/// <reference types="jest" />
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen } from '@testing-library/react-native';
import * as ReactNative from 'react-native';

import RegisterScreen from '../../../app/(auth)/register';
import { ApiError } from '../../lib/api-client';
import { authApi } from '../../services/auth-api';
import { storeSession } from './session';

jest.mock('../../services/auth-api', () => ({
  authApi: { register: jest.fn(), login: jest.fn(), me: jest.fn() },
}));
jest.mock('./session', () => ({
  storeSession: jest.fn(),
  signOut: jest.fn(),
  withAccessToken: jest.fn(),
}));
jest.mock('expo-router', () => ({
  router: { back: jest.fn(), replace: jest.fn(), canGoBack: () => false },
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
      <RegisterScreen />
    </QueryClientProvider>,
  );
}

const type = async (label: string, text: string) =>
  fireEvent.changeText(screen.getByLabelText(label), text);

async function fillIdentity() {
  await type('Prénom', 'Hugues');
  await type('Nom', 'Nwameh');
  await type('Pseudo', 'Roly_237');
  await fireEvent.press(screen.getByText('Continuer →'));
}

async function fillCredentials() {
  await type('Email', ' roly@example.com ');
  await type('Téléphone', '+237 6 99 99 99 99');
  await type('Mot de passe', 'secret123');
  await type('Confirmer le mot de passe', 'secret123');
}

afterEach(async () => {
  await cleanup();
  clients.splice(0).forEach((c) => c.clear());
  jest.restoreAllMocks();
});
beforeEach(() => jest.clearAllMocks());

describe('inscription (R-15) : champs, validation et parcours inchangés', () => {
  it('étape 1 : champs obligatoires, messages par champ, on reste à l’étape 1', async () => {
    await renderScreen();
    expect(screen.getByLabelText('Étape 1 sur 2 : Identité')).toBeTruthy();
    await fireEvent.press(screen.getByText('Continuer →'));
    expect(screen.getAllByText('Ce champ est obligatoire.')).toHaveLength(3);
    expect(screen.queryByLabelText('Email')).toBeNull();
  });

  it('pseudo invalide refusé avant l’envoi', async () => {
    await renderScreen();
    await type('Prénom', 'Hugues');
    await type('Nom', 'Nwameh');
    await type('Pseudo', 'ab');
    await fireEvent.press(screen.getByText('Continuer →'));
    expect(screen.queryByLabelText('Email')).toBeNull();
    expect(api.register).not.toHaveBeenCalled();
  });

  it('étape 2 : confirmation différente refusée, aucun appel au serveur', async () => {
    await renderScreen();
    await fillIdentity();
    expect(screen.getByLabelText('Étape 2 sur 2 : Accès et téléphone')).toBeTruthy();
    await fillCredentials();
    await type('Confirmer le mot de passe', 'autre1234');
    await fireEvent.press(screen.getByText('Créer mon compte'));
    expect(api.register).not.toHaveBeenCalled();
  });

  it('crée le compte (téléphone normalisé, email nettoyé) puis connecte', async () => {
    api.register.mockResolvedValue({ user: {} } as never);
    api.login.mockResolvedValue({ user: {}, accessToken: 'a', refreshToken: 'r' } as never);
    await renderScreen();
    await fillIdentity();
    await fillCredentials();
    await fireEvent.press(screen.getByText('Créer mon compte'));
    expect(api.register).toHaveBeenCalledWith({
      firstName: 'Hugues',
      lastName: 'Nwameh',
      username: 'Roly_237',
      email: 'roly@example.com',
      phone: '+237699999999',
      password: 'secret123',
      confirmPassword: 'secret123',
    });
    expect(await screen.findByText('Compte créé ! Connexion en cours…')).toBeTruthy();
    expect(api.login).toHaveBeenCalledWith({ email: 'roly@example.com', password: 'secret123' });
    expect(storeSession).toHaveBeenCalledWith({ accessToken: 'a', refreshToken: 'r' });
  });

  it('pseudo déjà pris (erreur du serveur) : retour à l’étape 1 avec le message du champ', async () => {
    api.register.mockRejectedValue(
      new ApiError(409, 'VALIDATION', 'Invalide', { username: 'Ce pseudo est déjà utilisé.' }),
    );
    await renderScreen();
    await fillIdentity();
    await fillCredentials();
    await fireEvent.press(screen.getByText('Créer mon compte'));
    expect(await screen.findByText('Ce pseudo est déjà utilisé.')).toBeTruthy();
    expect(screen.getByLabelText('Étape 1 sur 2 : Identité')).toBeTruthy();
  });

  it('erreur générale : bandeau d’alerte avec le message du serveur', async () => {
    api.register.mockRejectedValue(
      new ApiError(0, 'NETWORK_ERROR', 'Impossible de joindre le serveur.'),
    );
    await renderScreen();
    await fillIdentity();
    await fillCredentials();
    await fireEvent.press(screen.getByText('Créer mon compte'));
    expect(await screen.findByText('Impossible de joindre le serveur.')).toBeTruthy();
    expect(screen.getByRole('alert')).toBeTruthy();
  });

  it('petit écran (paysage, 360 dp) : formulaire resserré, toujours complet', async () => {
    jest
      .spyOn(ReactNative, 'useWindowDimensions')
      .mockReturnValue({ width: 740, height: 360, scale: 2, fontScale: 1 });
    await renderScreen();
    for (const label of ['Prénom', 'Nom', 'Pseudo']) expect(screen.getByLabelText(label)).toBeTruthy();
    expect(screen.getByText('Continuer →')).toBeTruthy();
    expect(screen.getByText('Se connecter')).toBeTruthy();
  });
});
