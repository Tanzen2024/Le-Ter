/// <reference types="jest" />
import { fireEvent, render, screen } from '@testing-library/react-native';
import { router } from 'expo-router';
import { Alert } from 'react-native';

import { en } from '../../lib/i18n/en';
import { fr } from '../../lib/i18n/fr';
import { registerSoundPlayer } from '../../services/audio-service';
import { DEFAULT_PREFERENCES, usePreferencesStore } from '../../stores/preferences-store';
import { SettingsPanel } from './SettingsPanel';

jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn(async () => null),
  setItemAsync: jest.fn(async () => undefined),
  deleteItemAsync: jest.fn(async () => undefined),
}));
jest.mock('expo-router', () => ({
  router: { push: jest.fn(), back: jest.fn(), replace: jest.fn(), canGoBack: jest.fn(() => true) },
}));

// Les liens légaux sont dans une plaque en fondu (opacité 0 tant que l'animation n'a pas tourné).
const hidden = { includeHiddenElements: true };
const isSelected = (label: string) =>
  screen.getByLabelText(label).props.accessibilityState?.selected;

beforeEach(() => {
  usePreferencesStore.setState(DEFAULT_PREFERENCES);
  jest.clearAllMocks();
});

describe('SettingsPanel', () => {
  it('affiche les réglages en français par défaut, son ON et Français sélectionnés', async () => {
    await render(<SettingsPanel onClose={jest.fn()} />);
    for (const text of ['Réglages', 'Son', 'Langues', 'Assistance', 'Français', 'English']) {
      expect(screen.getByText(text)).toBeTruthy();
    }
    expect(screen.getByText("Conditions d'utilisations ↗", hidden)).toBeTruthy();
    expect(screen.getByText('Confidentialité ↗', hidden)).toBeTruthy();
    expect(isSelected('Activer les sons')).toBe(true);
    expect(isSelected('Désactiver les sons')).toBe(false);
    expect(isSelected('Sélectionner le français')).toBe(true);
  });

  it('se ferme avec le bouton X', async () => {
    const onClose = jest.fn();
    await render(<SettingsPanel onClose={onClose} />);
    await fireEvent.press(screen.getByRole('button', { name: 'Fermer les paramètres' }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('ON / OFF pilote la préférence unique et le son réel', async () => {
    const player = { play: jest.fn() };
    registerSoundPlayer(player);
    await render(<SettingsPanel onClose={jest.fn()} />);

    await fireEvent.press(screen.getByLabelText('Désactiver les sons'));
    expect(usePreferencesStore.getState().soundEnabled).toBe(false);
    expect(isSelected('Désactiver les sons')).toBe(true);
    expect(isSelected('Activer les sons')).toBe(false);
    expect(player.play).not.toHaveBeenCalled();

    await fireEvent.press(screen.getByLabelText('Activer les sons'));
    expect(usePreferencesStore.getState().soundEnabled).toBe(true);
    expect(player.play).toHaveBeenCalledWith('uiConfirm');
    registerSoundPlayer(null);
  });

  it("passe en anglais immédiatement, puis revient au français", async () => {
    await render(<SettingsPanel onClose={jest.fn()} />);
    await fireEvent.press(screen.getByLabelText("Sélectionner l'anglais"));

    expect(usePreferencesStore.getState().language).toBe('en');
    for (const text of ['Settings', 'Sound', 'Language', 'Support', 'French', 'English']) {
      expect(screen.getByText(text)).toBeTruthy();
    }
    expect(screen.getByText('Terms of Use ↗', hidden)).toBeTruthy();
    expect(screen.getByText('Privacy Policy ↗', hidden)).toBeTruthy();
    expect(isSelected('Select English')).toBe(true);
    expect(screen.getByRole('button', { name: 'Close settings' })).toBeTruthy();

    await fireEvent.press(screen.getByLabelText('Select French'));
    expect(usePreferencesStore.getState().language).toBe('fr');
    expect(screen.getByText('Réglages')).toBeTruthy();
  });

  it("en anglais, aucun texte ni nom accessible français ne reste dans le panneau", async () => {
    await render(<SettingsPanel onClose={jest.fn()} />);
    await fireEvent.press(screen.getByLabelText("Sélectionner l'anglais"));

    const english = new Set<string>([...Object.values(en.settings), en.common.close]);
    const french = [...Object.values(fr.settings), fr.common.close].filter(
      (text) => !english.has(text),
    );
    for (const text of french) {
      expect(screen.queryByText(text, { ...hidden, exact: false })).toBeNull();
      expect(screen.queryByLabelText(text, hidden)).toBeNull();
    }

    // Retour au français sans redémarrage : plus aucun texte anglais propre.
    await fireEvent.press(screen.getByLabelText('Select French'));
    const frenchSet = new Set<string>(Object.values(fr.settings));
    for (const text of Object.values(en.settings).filter((t) => !frenchSet.has(t))) {
      expect(screen.queryByText(text, hidden)).toBeNull();
    }
  });

  it('ouvre les conditions et la politique de confidentialité', async () => {
    await render(<SettingsPanel onClose={jest.fn()} />);
    await fireEvent.press(screen.getByLabelText("Ouvrir les conditions d'utilisation", hidden));
    expect(router.push).toHaveBeenCalledWith('/legal/terms');
    await fireEvent.press(screen.getByLabelText('Ouvrir la politique de confidentialité', hidden));
    expect(router.push).toHaveBeenCalledWith('/legal/privacy');
  });

  it("Assistance ouvre l'aide et les réclamations dans l'application (D-114)", async () => {
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
    await render(<SettingsPanel onClose={jest.fn()} />);
    await fireEvent.press(screen.getByLabelText("Ouvrir l'assistance"));
    expect(router.push).toHaveBeenCalledWith('/support');
    expect(alert).not.toHaveBeenCalled();
    alert.mockRestore();
  });

  it('conserve les préférences après fermeture et réouverture', async () => {
    await render(<SettingsPanel onClose={jest.fn()} />);
    await fireEvent.press(screen.getByLabelText('Désactiver les sons'));
    await fireEvent.press(screen.getByLabelText("Sélectionner l'anglais"));
    await screen.unmount();

    await render(<SettingsPanel onClose={jest.fn()} />);
    expect(isSelected('Turn sound off')).toBe(true);
    expect(isSelected('Select English')).toBe(true);
  });
});
