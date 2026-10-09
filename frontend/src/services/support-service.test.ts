/// <reference types="jest" />
import { DEFAULT_PREFERENCES, usePreferencesStore } from '../stores/preferences-store';
import { isSupportUrl, openSupport } from './support-service';

jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn(async () => null),
  setItemAsync: jest.fn(async () => undefined),
  deleteItemAsync: jest.fn(async () => undefined),
}));

beforeEach(() => usePreferencesStore.setState(DEFAULT_PREFERENCES));

describe('assistance', () => {
  it("ouvre l'URL configurée", async () => {
    const openURL = jest.fn(async () => true);
    const alert = jest.fn();
    await expect(
      openSupport({ url: 'https://support.example.test/le-ter', openURL, alert }),
    ).resolves.toBe('opened');
    expect(openURL).toHaveBeenCalledWith('https://support.example.test/le-ter');
    expect(alert).not.toHaveBeenCalled();
  });

  it("sans URL : n'ouvre rien et annonce le service, dans la langue choisie", async () => {
    const openURL = jest.fn();
    const alert = jest.fn();
    await expect(openSupport({ url: '', openURL, alert })).resolves.toBe('unavailable');
    expect(openURL).not.toHaveBeenCalled();
    expect(alert).toHaveBeenCalledWith(
      'Assistance',
      "Le service d'assistance sera bientôt disponible.",
    );

    usePreferencesStore.getState().setLanguage('en');
    await openSupport({ url: '   ', openURL, alert });
    expect(alert).toHaveBeenLastCalledWith('Support', 'Support will be available soon.');
    expect(openURL).not.toHaveBeenCalled();
  });

  it("URL invalide : n'ouvre rien et affiche un message d'erreur", async () => {
    const openURL = jest.fn();
    const alert = jest.fn();
    for (const url of ['https://YOUR SUPPORT PLATFORM', 'javascript:alert(1)', 'support']) {
      await expect(openSupport({ url, openURL, alert })).resolves.toBe('invalid');
    }
    expect(openURL).not.toHaveBeenCalled();
    expect(alert).toHaveBeenLastCalledWith(
      'Assistance',
      "Impossible d'ouvrir l'assistance pour le moment. Réessayez plus tard.",
    );
  });

  it("gère l'échec de Linking sans lever d'erreur", async () => {
    const alert = jest.fn();
    await expect(
      openSupport({
        url: 'https://support.example.test',
        openURL: () => Promise.reject(new Error('no handler')),
        alert,
      }),
    ).resolves.toBe('failed');
    expect(alert).toHaveBeenCalledWith(
      'Assistance',
      "Impossible d'ouvrir l'assistance pour le moment. Réessayez plus tard.",
    );
  });

  it("n'accepte que des adresses web complètes", () => {
    expect(isSupportUrl('https://a.b')).toBe(true);
    expect(isSupportUrl('')).toBe(false);
    expect(isSupportUrl('https://YOUR SUPPORT PLATFORM')).toBe(false);
    expect(isSupportUrl('javascript:alert(1)')).toBe(false);
  });
});
