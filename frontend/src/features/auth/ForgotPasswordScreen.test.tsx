/// <reference types="jest" />
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react-native';
import { router } from 'expo-router';

import ForgotPasswordScreen from '../../../app/(auth)/forgot-password';
import { ApiError } from '../../lib/api-client';
import { authApi } from '../../services/auth-api';

jest.mock('../../services/auth-api', () => ({
  authApi: { verifyRecovery: jest.fn(), resetPassword: jest.fn() },
}));
jest.mock('expo-router', () => ({
  router: { push: jest.fn(), back: jest.fn(), replace: jest.fn(), canGoBack: () => false },
}));
jest.mock('expo-clipboard', () => ({ setStringAsync: jest.fn(async () => true) }));

const api = authApi as jest.Mocked<typeof authApi>;
const clients: QueryClient[] = [];
const WRONG =
  'Numéro ou code de récupération incorrect. Après plusieurs essais, patientez 15 minutes avant de réessayer.';

async function renderScreen() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  clients.push(client);
  await render(
    <QueryClientProvider client={client}>
      <ForgotPasswordScreen />
    </QueryClientProvider>,
  );
}

const type = async (label: string, text: string) =>
  fireEvent.changeText(screen.getByLabelText(label), text);

/** Étape 1 : Cameroun présélectionné (D-139), numéro national seul, puis « Continuer ». */
async function enterPhone() {
  await type('Téléphone ou email', '6 99 99 99 99');
  await fireEvent.press(screen.getByText('Continuer'));
}

afterEach(async () => {
  await cleanup();
  clients.splice(0).forEach((c) => c.clear());
});
beforeEach(() => jest.clearAllMocks());

describe('« Mot de passe oublié ? » (D-135)', () => {
  it('téléphone au modèle de la connexion : +237 dans le champ, autre pays possible', async () => {
    api.verifyRecovery.mockResolvedValue({ resetToken: 'tok', expiresAt: '2026-10-21T10:10:00Z' });
    await renderScreen();
    expect(screen.getByLabelText('Étape 1 sur 3 : Identifiant')).toBeTruthy();
    expect(screen.getByText('+237')).toBeTruthy();
    const input = screen.getByLabelText('Téléphone ou email');
    expect(input.props.value).toBe('');
    expect(input.props.placeholder).toBe('Téléphone ou email');
    expect(screen.getByTestId('country-flag-CM', { includeHiddenElements: true })).toBeTruthy();
    await fireEvent.press(screen.getByTestId('country-select'));
    await type('Rechercher un pays', 'France');
    await fireEvent.press(within(screen.getByTestId('country-options')).getByText('France'));
    expect(screen.getByText('+33')).toBeTruthy();
    await type('Téléphone ou email', '6 12 34 56 78');
    await fireEvent.press(screen.getByText('Continuer'));
    await type('Code', 'LT-7K4P-92XM-0A1B');
    await fireEvent.press(screen.getByText('Vérifier'));
    expect(api.verifyRecovery).toHaveBeenCalledWith({
      country: 'FR',
      phone: '612345678',
      code: 'LT-7K4P-92XM-0A1B',
    });
  });

  it('numéro invalide : message sous le champ, on reste à l’étape 1', async () => {
    await renderScreen();
    await type('Téléphone ou email', '12');
    await fireEvent.press(screen.getByText('Continuer'));
    expect(screen.getByText('Numéro invalide pour ce pays.')).toBeTruthy();
    expect(screen.queryByLabelText('Code')).toBeNull();
  });

  it('adresse e-mail du compte : envoyée telle quelle avec le code (D-142)', async () => {
    api.verifyRecovery.mockResolvedValue({ resetToken: 'tok', expiresAt: '2026-10-21T10:10:00Z' });
    await renderScreen();
    await type('Téléphone ou email', ' joueur@example.com ');
    await fireEvent.press(screen.getByText('Continuer'));
    await type('Code', 'LT-7K4P-92XM-0A1B');
    await fireEvent.press(screen.getByText('Vérifier'));
    expect(api.verifyRecovery).toHaveBeenCalledWith({
      email: 'joueur@example.com',
      code: 'LT-7K4P-92XM-0A1B',
    });
  });

  it('adresse e-mail invalide : message sous le champ, on reste à l’étape 1', async () => {
    await renderScreen();
    await type('Téléphone ou email', 'joueur@');
    await fireEvent.press(screen.getByText('Continuer'));
    expect(screen.getByText('Adresse e-mail invalide.')).toBeTruthy();
    expect(screen.queryByLabelText('Code')).toBeNull();
  });

  it('le numéro seul ne suffit pas : étape code, rien n’est envoyé sans code', async () => {
    await renderScreen();
    await enterPhone();
    expect(
      screen.getByText(
        'Saisissez le code de récupération fourni lors de la création de votre compte.',
      ),
    ).toBeTruthy();
    await fireEvent.press(screen.getByText('Vérifier'));
    expect(screen.getByText('Saisissez votre code de récupération.')).toBeTruthy();
    expect(api.verifyRecovery).not.toHaveBeenCalled();
  });

  it('mauvais code : message générique, on reste à l’étape du code', async () => {
    api.verifyRecovery.mockRejectedValue(new ApiError(400, 'RECOVERY_FAILED', WRONG, {}));
    await renderScreen();
    await enterPhone();
    await type('Code', 'LT-0000-0000-0000');
    await fireEvent.press(screen.getByText('Vérifier'));
    expect(await screen.findByText(WRONG)).toBeTruthy();
    expect(screen.queryByLabelText('Nouveau mot de passe')).toBeNull();
  });

  it('parcours complet : code → nouveau mot de passe → nouveau code → connexion', async () => {
    api.verifyRecovery.mockResolvedValue({ resetToken: 'tok', expiresAt: '2026-10-21T10:10:00Z' });
    api.resetPassword.mockResolvedValue({ recoveryCode: 'LT-NEW0-CODE-0000' });
    await renderScreen();
    await enterPhone();
    await type('Code', 'lt-7k4p-92xm-0a1b');
    await fireEvent.press(screen.getByText('Vérifier'));
    expect(api.verifyRecovery).toHaveBeenCalledWith({
      country: 'CM',
      phone: '699999999',
      code: 'lt-7k4p-92xm-0a1b',
    });

    await screen.findByLabelText('Nouveau mot de passe');
    await type('Nouveau mot de passe', 'Nouveau456');
    await type('Confirmer le nouveau mot de passe', 'Autre4567');
    await fireEvent.press(screen.getByText('Réinitialiser le mot de passe'));
    expect(screen.getByText('Les mots de passe ne correspondent pas.')).toBeTruthy();
    expect(api.resetPassword).not.toHaveBeenCalled();

    await type('Confirmer le nouveau mot de passe', 'Nouveau456');
    await fireEvent.press(screen.getByText('Réinitialiser le mot de passe'));
    expect(api.resetPassword).toHaveBeenCalledWith({
      resetToken: 'tok',
      newPassword: 'Nouveau456',
      confirmPassword: 'Nouveau456',
    });
    expect(await screen.findByTestId('recovery-code')).toHaveTextContent('LT-NEW0-CODE-0000');
    expect(
      screen.getByLabelText(
        'Mot de passe modifié avec succès. Vous pouvez maintenant vous connecter.',
      ),
    ).toBeTruthy();
    await fireEvent.press(screen.getByText('Se connecter'));
    expect(router.replace).toHaveBeenCalledWith('/login');
  });

  it('autorisation expirée : message et retour à l’étape du code', async () => {
    api.verifyRecovery.mockResolvedValue({ resetToken: 'tok', expiresAt: '2026-10-21T10:10:00Z' });
    api.resetPassword.mockRejectedValue(
      new ApiError(400, 'RESET_GRANT_INVALID', 'Cette demande de réinitialisation a expiré.', {}),
    );
    await renderScreen();
    await enterPhone();
    await type('Code', 'LT-7K4P-92XM-0A1B');
    await fireEvent.press(screen.getByText('Vérifier'));
    await type('Nouveau mot de passe', 'Nouveau456');
    await type('Confirmer le nouveau mot de passe', 'Nouveau456');
    await fireEvent.press(screen.getByText('Réinitialiser le mot de passe'));
    expect(await screen.findByText('Cette demande de réinitialisation a expiré.')).toBeTruthy();
    await fireEvent.press(screen.getByText('← Saisir à nouveau le code'));
    expect(screen.getByLabelText('Code')).toBeTruthy();
  });
});
