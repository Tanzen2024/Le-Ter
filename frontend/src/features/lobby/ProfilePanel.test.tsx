/// <reference types="jest" />
import { fireEvent, render, screen } from '@testing-library/react-native';

import type { PublicUser } from '../../types/auth';
import { useCurrentUser } from '../auth/hooks';
import { ProfilePanel } from './ProfilePanel';

// Réponse du serveur simulée : succès (204) du changement de mot de passe.
const mockChangePassword = jest.fn((_payload: unknown, options: { onSuccess: () => void }) =>
  options.onSuccess(),
);

jest.mock('../auth/hooks', () => ({
  useCurrentUser: jest.fn(),
  useLogout: () => ({ isPending: false, mutate: jest.fn() }),
  useChangePassword: () => ({ isPending: false, mutate: mockChangePassword }),
}));

const USER: PublicUser = {
  id: 'u-1',
  firstName: 'Hugues',
  lastName: 'Nwameh',
  email: 'roly@example.com',
  username: 'roly',
  phone: '+237692130271',
  phoneVerified: false,
  role: 'user',
  createdAt: '2026-10-01T00:00:00.000Z',
};

const serve = (user: PublicUser) =>
  (useCurrentUser as jest.Mock).mockReturnValue({
    data: user,
    isPending: false,
  });

describe('ProfilePanel : informations en lecture seule, seul le mot de passe se modifie', () => {
  it('affiche pays lisible et téléphone national, sans indicatif ni drapeau', async () => {
    serve(USER);
    await render(<ProfilePanel onClose={jest.fn()} />);
    for (const text of ['roly', 'Hugues', 'Nwameh', 'roly@example.com', 'Cameroun', '692130271']) {
      expect(screen.getByText(text)).toBeTruthy();
    }
    expect(screen.queryByText(/\+237/)).toBeNull();
    expect(screen.queryByText(/🇨🇲/)).toBeNull();
  });

  it('aucun champ de saisie ; un seul bouton « Modifier », celui du mot de passe', async () => {
    serve(USER);
    await render(<ProfilePanel onClose={jest.fn()} />);
    // Aucun champ de saisie (ni prénom, ni téléphone, ni sélecteur de pays).
    const hostsOfType = (type: string) => screen.root?.queryAll((node) => node.type === type);
    expect(hostsOfType('Text')?.length).toBeGreaterThan(0);
    expect(hostsOfType('TextInput')).toHaveLength(0);
    expect(screen.getAllByText('Modifier')).toHaveLength(1);
    expect(screen.getByLabelText('Modifier le mot de passe')).toBeTruthy();
  });

  it('« Modifier » ouvre le formulaire (3 champs masquables) ; « Annuler » le referme', async () => {
    serve(USER);
    await render(<ProfilePanel onClose={jest.fn()} />);
    await fireEvent.press(screen.getByLabelText('Modifier le mot de passe'));
    for (const name of [
      'Mot de passe actuel',
      'Nouveau mot de passe',
      'Confirmer le nouveau mot de passe',
    ]) {
      expect(screen.getByLabelText(name)).toBeTruthy();
    }
    expect(screen.getAllByLabelText('Afficher le mot de passe')).toHaveLength(3);
    await fireEvent.press(screen.getByText('Annuler'));
    expect(screen.queryByLabelText('Mot de passe actuel')).toBeNull();
    expect(screen.getByLabelText('Modifier le mot de passe')).toBeTruthy();
    // Le reste du profil est inchangé.
    expect(screen.getByText('roly@example.com')).toBeTruthy();
  });

  it.each([false, true])(
    'aucun statut de certification, quel que soit phoneVerified (%s)',
    async (phoneVerified) => {
      serve({ ...USER, phoneVerified });
      await render(<ProfilePanel onClose={jest.fn()} />);
      expect(screen.queryByText(/certifi/i)).toBeNull();
      expect(screen.queryByText(/v[ée]rifi/i)).toBeNull();
      expect(screen.queryByText('✓')).toBeNull();
      // Les informations et actions du profil restent présentes.
      expect(screen.getByText('roly')).toBeTruthy();
      expect(screen.getByLabelText('Modifier le mot de passe')).toBeTruthy();
      expect(screen.getByText('Déconnexion')).toBeTruthy();
    },
  );

  it('succès du serveur : formulaire refermé, champs vidés, confirmation visible', async () => {
    serve(USER);
    await render(<ProfilePanel onClose={jest.fn()} />);
    expect(screen.queryByText('Mot de passe modifié.')).toBeNull();
    await fireEvent.press(screen.getByLabelText('Modifier le mot de passe'));
    await fireEvent.changeText(screen.getByLabelText('Mot de passe actuel'), 'Secret123');
    await fireEvent.changeText(screen.getByLabelText('Nouveau mot de passe'), 'Nouveau456');
    await fireEvent.changeText(
      screen.getByLabelText('Confirmer le nouveau mot de passe'),
      'Nouveau456',
    );
    await fireEvent.press(screen.getByLabelText('Enregistrer le nouveau mot de passe'));
    expect(mockChangePassword).toHaveBeenCalledTimes(1);
    expect(screen.getByText('Mot de passe modifié.')).toBeTruthy();
    expect(screen.queryByLabelText('Mot de passe actuel')).toBeNull();
    // Réouverture : champs vides.
    await fireEvent.press(screen.getByLabelText('Modifier le mot de passe'));
    expect(screen.getByLabelText('Mot de passe actuel').props.value).toBe('');
  });

  it('numéro d’un pays inconnu : affiché complet, pays non deviné', async () => {
    serve({ ...USER, phone: '+33612345678' });
    await render(<ProfilePanel onClose={jest.fn()} />);
    expect(screen.getByText('+33612345678')).toBeTruthy();
    expect(screen.queryByText('Cameroun')).toBeNull();
    expect(screen.getByText('—')).toBeTruthy();
  });
});
