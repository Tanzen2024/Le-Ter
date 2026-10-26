/// <reference types="jest" />
import { fireEvent, render, screen, within } from '@testing-library/react-native';

import type { PublicUser } from '../../types/auth';
import { useCurrentUser } from '../auth/hooks';
import { ProfilePanel } from './ProfilePanel';

// Réponse du serveur simulée : succès (204) du changement de mot de passe.
const mockChangePassword = jest.fn((_payload: unknown, options: { onSuccess: () => void }) =>
  options.onSuccess(),
);

// Nouveau code de récupération (D-135) : réponse du serveur simulée.
const mockRegenerate = jest.fn();
const mockLogout = jest.fn();
const mockPush = jest.fn();
jest.mock('expo-router', () => ({ router: { push: (path: string) => mockPush(path) } }));
let mockRegenerated: { recoveryCode: string } | undefined;

jest.mock('../auth/hooks', () => ({
  useCurrentUser: jest.fn(),
  useLogout: () => ({ isPending: false, mutate: mockLogout }),
  useChangePassword: () => ({ isPending: false, mutate: mockChangePassword }),
  useRegenerateRecoveryCode: () => ({
    isPending: false,
    mutate: mockRegenerate,
    reset: jest.fn(),
    data: mockRegenerated,
  }),
}));
jest.mock('expo-clipboard', () => ({ setStringAsync: jest.fn(async () => true) }));

beforeEach(() => {
  mockLogout.mockReset();
  mockPush.mockReset();
  mockRegenerate.mockReset();
  mockRegenerated = undefined;
});

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
  it('le bouton X ferme le panneau ; il est déclaré après le contenu (au premier plan)', async () => {
    serve(USER);
    const onClose = jest.fn();
    await render(<ProfilePanel onClose={onClose} />);
    const close = screen.getByRole('button', { name: 'Fermer' });
    await fireEvent.press(close);
    expect(onClose).toHaveBeenCalledTimes(1);
    // Dernier enfant du panneau : rien de défilant ne passe devant lui (toucher Android).
    const panel = close.parent?.parent;
    const siblings = panel?.children ?? [];
    expect(siblings[siblings.length - 1]).toBe(close.parent);
  });

  it('affiche pays lisible et téléphone national, sans indicatif ni drapeau', async () => {
    serve(USER);
    await render(<ProfilePanel onClose={jest.fn()} />);
    for (const text of ['roly', 'Hugues', 'Nwameh', 'roly@example.com', 'Cameroun', '692130271']) {
      expect(screen.getByText(text)).toBeTruthy();
    }
    expect(screen.queryByText(/\+237/)).toBeNull();
    expect(screen.queryByText(/🇨🇲/)).toBeNull();
  });

  it("n'affiche plus l'identifiant technique du joueur", async () => {
    serve(USER);
    await render(<ProfilePanel onClose={jest.fn()} />);
    expect(screen.queryByText('ID')).toBeNull();
    expect(screen.queryByText('u-1')).toBeNull();
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

describe('ProfilePanel : code de récupération (D-135)', () => {
  it('joueur sans email : « — » ; ancien compte sans code : « Créer un code »', async () => {
    serve({ ...USER, email: null, hasRecoveryCode: false });
    await render(<ProfilePanel onClose={jest.fn()} />);
    expect(screen.getAllByText('—').length).toBeGreaterThan(0);
    expect(screen.getByLabelText('Créer un code de récupération')).toBeTruthy();
  });

  it('mot de passe actuel exigé avant tout appel ; puis envoyé au serveur', async () => {
    serve({ ...USER, hasRecoveryCode: true });
    await render(<ProfilePanel onClose={jest.fn()} />);
    await fireEvent.press(screen.getByLabelText('Générer un nouveau code de récupération'));
    await fireEvent.press(screen.getByText('Afficher le code'));
    expect(mockRegenerate).not.toHaveBeenCalled();
    expect(screen.getByText('Saisissez votre mot de passe actuel.')).toBeTruthy();
    await fireEvent.changeText(screen.getByLabelText('Mot de passe actuel'), 'Secret123');
    await fireEvent.press(screen.getByText('Afficher le code'));
    expect(mockRegenerate).toHaveBeenCalledWith('Secret123', expect.any(Object));
  });

  it('code reçu : affiché une fois, avec « Copier le code »', async () => {
    mockRegenerated = { recoveryCode: 'LT-7K4P-92XM-0A1B' };
    serve({ ...USER, hasRecoveryCode: true });
    await render(<ProfilePanel onClose={jest.fn()} />);
    expect(screen.getByTestId('recovery-code')).toHaveTextContent('LT-7K4P-92XM-0A1B');
    await fireEvent.press(screen.getByText('Copier le code'));
    expect(await screen.findByText('Code copié.')).toBeTruthy();
  });
});

describe('ProfilePanel : tenu sans défiler (le formulaire remplace les informations)', () => {
  it('« Modifier » : les informations laissent la place au formulaire, puis reviennent', async () => {
    serve(USER);
    await render(<ProfilePanel onClose={jest.fn()} />);
    expect(screen.getByText('Hugues')).toBeTruthy();
    await fireEvent.press(screen.getByLabelText('Modifier le mot de passe'));
    expect(screen.getByLabelText('Mot de passe actuel')).toBeTruthy();
    // Informations et code de récupération masqués ; carte du joueur conservée. La zone
    // d'actions du panneau porte alors celles du formulaire (Annuler, Enregistrer).
    expect(screen.queryByText('Hugues')).toBeNull();
    expect(screen.queryByText('Code de récupération')).toBeNull();
    expect(screen.getByText('roly')).toBeTruthy();
    const actions = within(screen.getByTestId('panel-actions'));
    expect(actions.getByText('Annuler')).toBeTruthy();
    expect(actions.getByLabelText('Enregistrer le nouveau mot de passe')).toBeTruthy();
    expect(screen.queryByText('Déconnexion')).toBeNull();
    await fireEvent.press(screen.getByText('Annuler'));
    expect(screen.getByText('Hugues')).toBeTruthy();
    expect(screen.getByText('Code de récupération')).toBeTruthy();
    // Retour au profil : ses actions reviennent dans la zone d'actions.
    expect(within(screen.getByTestId('panel-actions')).getByText('Déconnexion')).toBeTruthy();
  });

  it('zone d’actions séparée des informations : « Aide et réclamations » et « Déconnexion »', async () => {
    serve(USER);
    await render(<ProfilePanel onClose={jest.fn()} />);
    const zone = screen.getByTestId('panel-actions');
    const actions = within(zone);
    expect(actions.getByRole('button', { name: 'Aide et réclamations' })).toBeTruthy();
    expect(actions.getByRole('button', { name: 'Déconnexion' })).toBeTruthy();
    // Les informations du compte ne sont pas dans la zone d'actions.
    expect(actions.queryByText('Hugues')).toBeNull();
    expect(actions.queryByLabelText('Modifier le mot de passe')).toBeNull();
    // Ouvrir le profil ne déconnecte jamais.
    expect(mockLogout).not.toHaveBeenCalled();
    await fireEvent.press(actions.getByRole('button', { name: 'Aide et réclamations' }));
    expect(mockPush).toHaveBeenCalledWith('/support');
    await fireEvent.press(actions.getByRole('button', { name: 'Déconnexion' }));
    expect(mockLogout).toHaveBeenCalledTimes(1);
  });

  it('code de récupération en cours : il prend la place, saisie conservée jusqu’à « Annuler »', async () => {
    serve({ ...USER, hasRecoveryCode: true });
    await render(<ProfilePanel onClose={jest.fn()} />);
    await fireEvent.press(screen.getByLabelText('Générer un nouveau code de récupération'));
    expect(screen.queryByText('Hugues')).toBeNull();
    expect(screen.queryByLabelText('Modifier le mot de passe')).toBeNull();
    await fireEvent.changeText(screen.getByLabelText('Mot de passe actuel'), 'Secret123');
    expect(screen.getByLabelText('Mot de passe actuel').props.value).toBe('Secret123');
    await fireEvent.press(screen.getByText('Annuler'));
    expect(screen.getByText('Hugues')).toBeTruthy();
    expect(screen.getByLabelText('Modifier le mot de passe')).toBeTruthy();
  });
});
