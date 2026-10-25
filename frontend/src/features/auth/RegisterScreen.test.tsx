/// <reference types="jest" />
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react-native';
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
// Paramètres du lien d'invitation (D-161) : aucun par défaut.
let mockSearchParams: Record<string, string> = {};
jest.mock('expo-router', () => ({
  router: { back: jest.fn(), replace: jest.fn(), canGoBack: () => false },
  useLocalSearchParams: () => mockSearchParams,
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
  await fireEvent.press(screen.getByText('Continuer'));
}

/** Ouvre le menu Pays, cherche par nom puis choisit l'option. */
async function selectCountry(name: string, query = name) {
  await fireEvent.press(screen.getByTestId('country-select'));
  await type('Rechercher un pays', query);
  await fireEvent.press(within(screen.getByTestId('country-options')).getByText(name));
}

async function fillCredentials() {
  // Cameroun présélectionné (D-139) : le numéro national suffit.
  await type('Email', ' roly@example.com ');
  await type('Téléphone', '6 99 99 99 99');
  await type('Mot de passe', 'secret123');
  await type('Confirmer le mot de passe', 'secret123');
}

afterEach(async () => {
  await cleanup();
  clients.splice(0).forEach((c) => c.clear());
  jest.restoreAllMocks();
});
beforeEach(() => {
  jest.clearAllMocks();
  mockSearchParams = {};
});

describe('inscription (R-15) : champs, validation et parcours inchangés', () => {
  it('étape 1 : champs obligatoires, messages par champ, on reste à l’étape 1', async () => {
    await renderScreen();
    expect(screen.getByLabelText('Étape 1 sur 2 : Identité')).toBeTruthy();
    await fireEvent.press(screen.getByText('Continuer'));
    expect(screen.getAllByText('Ce champ est obligatoire.')).toHaveLength(3);
    expect(screen.queryByLabelText('Email')).toBeNull();
  });

  it('pseudo invalide refusé avant l’envoi', async () => {
    await renderScreen();
    await type('Prénom', 'Hugues');
    await type('Nom', 'Nwameh');
    await type('Pseudo', 'ab');
    await fireEvent.press(screen.getByText('Continuer'));
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

  it('crée le compte (téléphone normalisé, email nettoyé), montre le code, puis connecte', async () => {
    api.register.mockResolvedValue({ user: {}, recoveryCode: 'LT-7K4P-92XM-0A1B' } as never);
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
      country: 'CM',
      phone: '699999999',
      password: 'secret123',
      confirmPassword: 'secret123',
    });
    // Code de récupération (D-135) affiché avant toute connexion.
    expect(await screen.findByTestId('recovery-code')).toHaveTextContent('LT-7K4P-92XM-0A1B');
    expect(screen.getByText('Ce code ne sera plus affiché après cette étape.')).toBeTruthy();
    expect(api.login).not.toHaveBeenCalled();
    await fireEvent.press(screen.getByText('J’ai enregistré mon code'));
    expect(api.login).toHaveBeenCalledWith({
      country: 'CM',
      phone: '699999999',
      password: 'secret123',
    });
    await screen.findByTestId('recovery-code');
    expect(storeSession).toHaveBeenCalledWith({ accessToken: 'a', refreshToken: 'r' });
  });

  it('sans email (D-135) : accepté, email vide envoyé, aucune erreur sur l’email', async () => {
    api.register.mockResolvedValue({ user: {}, recoveryCode: 'LT-7K4P-92XM-0A1B' } as never);
    await renderScreen();
    await fillIdentity();
    await fillCredentials();
    await type('Email', '');
    await fireEvent.press(screen.getByText('Créer mon compte'));
    expect(api.register).toHaveBeenCalledWith(expect.objectContaining({ email: '' }));
    expect(await screen.findByTestId('recovery-code-card')).toBeTruthy();
  });

  describe('téléphone au modèle de la connexion (D-139)', () => {
    const phoneInput = () => screen.getByLabelText('Téléphone');

    it('Cameroun présélectionné : +237 dans le champ, filigrane seulement, numéro national seul', async () => {
      await renderScreen();
      await fillIdentity();
      expect(screen.getByText('+237')).toBeTruthy();
      expect(screen.getByTestId('country-flag-CM', { includeHiddenElements: true })).toBeTruthy();
      expect(screen.getByTestId('country-select').props.accessibilityValue).toEqual({
        text: 'Cameroun +237',
      });
      expect(phoneInput().props.editable).not.toBe(false);
      expect(phoneInput().props.value).toBe('');
      expect(phoneInput().props.placeholder).toBe('695 122 301');
      // Un « + » ou un indicatif tapé ne remplace pas l'indicatif affiché.
      await type('Téléphone', '+33 6a92');
      expect(phoneInput().props.value).toBe('33 692');
      expect(screen.getByText('+237')).toBeTruthy();
    });

    it('les options n’affichent que des noms de pays (ni drapeau, ni indicatif, ni devise)', async () => {
      await renderScreen();
      await fillIdentity();
      await fireEvent.press(screen.getByTestId('country-select'));
      const options = within(screen.getByTestId('country-options')).getAllByRole('button');
      expect(options.length).toBeGreaterThan(5);
      for (const option of options) {
        const label = String(option.props.accessibilityLabel);
        expect(label).not.toMatch(/[+\d]|XAF|XOF|FCFA|[\u{1F1E6}-\u{1F1FF}]/u);
        expect(within(option).getByText(label)).toBeTruthy();
      }
    });

    it('recherche sans accent : « cote d’ivoire » trouve Côte d’Ivoire', async () => {
      await renderScreen();
      await fillIdentity();
      await selectCountry("Côte d'Ivoire", "cote d'ivoire");
      expect(screen.getByText('+225')).toBeTruthy();
    });

    it('changement de pays : indicatif remplacé, ancien numéro effacé (jamais validé à tort)', async () => {
      await renderScreen();
      await fillIdentity();
      await type('Téléphone', '692130271');
      await selectCountry('France');
      expect(screen.getByText('+33')).toBeTruthy();
      expect(screen.queryByText('+237')).toBeNull();
      expect(phoneInput().props.value).toBe('');
    });

    it('numéro invalide pour le pays choisi : message sous le champ, aucun appel au serveur', async () => {
      await renderScreen();
      await fillIdentity();
      await fillCredentials();
      await type('Téléphone', '600000001');
      await fireEvent.press(screen.getByText('Créer mon compte'));
      expect(screen.getByText('Numéro invalide pour ce pays.')).toBeTruthy();
      expect(api.register).not.toHaveBeenCalled();
    });

    it('pays et numéro conservés entre les étapes', async () => {
      await renderScreen();
      await fillIdentity();
      await selectCountry('Sénégal', 'senegal');
      await type('Téléphone', '77 123 45 67');
      await fireEvent.press(screen.getByText('← Retour'));
      expect(screen.getByLabelText('Étape 1 sur 2 : Identité')).toBeTruthy();
      await fireEvent.press(screen.getByText('Continuer'));
      expect(screen.getByText('+221')).toBeTruthy();
      expect(phoneInput().props.value).toBe('77 123 45 67');
    });

    it('envoie le pays et le numéro national ; le serveur reconstruit le numéro international', async () => {
      api.register.mockResolvedValue({ user: {} } as never);
      api.login.mockResolvedValue({ user: {}, accessToken: 'a', refreshToken: 'r' } as never);
      await renderScreen();
      await fillIdentity();
      await fillCredentials();
      await selectCountry('France');
      await type('Téléphone', '06 12 34 56 78');
      await fireEvent.press(screen.getByText('Créer mon compte'));
      expect(api.register).toHaveBeenCalledWith(
        expect.objectContaining({ country: 'FR', phone: '0612345678' }),
      );
    });
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
    for (const label of ['Prénom', 'Nom', 'Pseudo'])
      expect(screen.getByLabelText(label)).toBeTruthy();
    expect(screen.getByText('Continuer')).toBeTruthy();
    expect(screen.getByText('Se connecter')).toBeTruthy();
  });
});

describe('code de parrainage (D-161)', () => {
  it('reste facultatif : aucun champ de parrainage envoyé sans code', async () => {
    api.register.mockResolvedValue({ user: {}, recoveryCode: 'LT-7K4P-92XM-0A1B' } as never);
    await renderScreen();
    expect(screen.getByLabelText('Code de parrainage').props.value).toBe('');
    await fillIdentity();
    await fillCredentials();
    await fireEvent.press(screen.getByText('Créer mon compte'));
    const payload = api.register.mock.calls[0]![0];
    expect(payload).not.toHaveProperty('referralCode');
    expect(payload).not.toHaveProperty('referralSource');
  });

  it('prérempli depuis le lien leter://register?ref=CODE et envoyé avec l’origine LINK', async () => {
    mockSearchParams = { ref: 'abcd-efgh' };
    api.register.mockResolvedValue({ user: {}, recoveryCode: 'LT-7K4P-92XM-0A1B' } as never);
    await renderScreen();
    expect(screen.getByLabelText('Code de parrainage').props.value).toBe('ABCDEFGH');
    await fillIdentity();
    await fillCredentials();
    await fireEvent.press(screen.getByText('Créer mon compte'));
    expect(api.register).toHaveBeenCalledWith(
      expect.objectContaining({ referralCode: 'ABCDEFGH', referralSource: 'LINK' }),
    );
  });

  it('saisi à la main avant la création du compte : origine MANUAL', async () => {
    api.register.mockResolvedValue({ user: {}, recoveryCode: 'LT-7K4P-92XM-0A1B' } as never);
    await renderScreen();
    await type('Code de parrainage', 'k7m9 p2qr');
    await fillIdentity();
    await fillCredentials();
    await fireEvent.press(screen.getByText('Créer mon compte'));
    expect(api.register).toHaveBeenCalledWith(
      expect.objectContaining({ referralCode: 'K7M9P2QR', referralSource: 'MANUAL' }),
    );
  });

  it('forme impossible refusée avant l’envoi', async () => {
    await renderScreen();
    await type('Code de parrainage', '12');
    await fillIdentity();
    expect(screen.getByText('Code de parrainage invalide : 8 lettres ou chiffres.')).toBeTruthy();
    expect(screen.getByLabelText('Étape 1 sur 2 : Identité')).toBeTruthy();
  });

  it('code refusé par le serveur : retour à l’étape 1, message sous le champ, aucun compte', async () => {
    const message = 'Ce code de parrainage est inconnu. Vérifiez-le ou laissez le champ vide.';
    api.register.mockRejectedValue(
      new ApiError(422, 'INVALID_REFERRAL_CODE', message, { referralCode: message }),
    );
    await renderScreen();
    await type('Code de parrainage', 'ABCDEFGH');
    await fillIdentity();
    await fillCredentials();
    await fireEvent.press(screen.getByText('Créer mon compte'));
    expect(await screen.findByText(message)).toBeTruthy();
    expect(screen.getByLabelText('Étape 1 sur 2 : Identité')).toBeTruthy();
    expect(screen.queryByTestId('recovery-code-card')).toBeNull();
  });
});
