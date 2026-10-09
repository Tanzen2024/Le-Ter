/// <reference types="jest" />
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { router } from 'expo-router';

import { DEFAULT_PREFERENCES, usePreferencesStore } from '../../stores/preferences-store';
import { getLegalDocument } from './documents';
import { LegalDocumentScreen } from './LegalDocumentScreen';

jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn(async () => null),
  setItemAsync: jest.fn(async () => undefined),
  deleteItemAsync: jest.fn(async () => undefined),
}));
jest.mock('expo-router', () => ({
  router: { push: jest.fn(), back: jest.fn(), replace: jest.fn(), canGoBack: jest.fn(() => true) },
}));

beforeEach(() => {
  usePreferencesStore.setState(DEFAULT_PREFERENCES);
  jest.clearAllMocks();
});

describe('documents légaux', () => {
  it.each(['terms', 'privacy'] as const)('%s : 18 sections en français et en anglais', (id) => {
    for (const language of ['fr', 'en'] as const) {
      const document = getLegalDocument(id, language);
      expect(document?.sections).toHaveLength(18);
      for (const section of document!.sections) {
        expect(section.heading).toBeTruthy();
        expect(section.paragraphs.length).toBeGreaterThan(0);
      }
    }
  });

  it("affiche des repères au lieu d'informations légales inconnues", () => {
    const fr = JSON.stringify(getLegalDocument('terms', 'fr'));
    expect(fr).toContain("[Nom légal de l'éditeur]");
    expect(fr).toContain('[Pays / juridiction]');
    expect(JSON.stringify(getLegalDocument('privacy', 'en'))).toContain('[Publisher legal name]');
  });

  it('reprend les informations légales une fois renseignées', () => {
    const document = getLegalDocument('privacy', 'fr', {
      publisherName: 'Éditeur Test',
      address: '1 rue Test',
      email: 'contact@example.test',
      lastUpdated: '8 octobre 2026',
      jurisdiction: 'Pays Test',
      minimumAge: 18,
    });
    const text = JSON.stringify(document);
    expect(text).toContain('Éditeur Test');
    expect(text).toContain('contact@example.test');
    for (const marker of ["[Nom légal de l'éditeur]", '[Adresse]', '[Email]', '[Âge minimum]']) {
      expect(text).not.toContain(marker);
    }
    expect(text).not.toContain('[Date de dernière mise à jour]');
    expect(text).not.toContain('[Pays / juridiction]');
  });

  it('refuse un document inconnu', () => {
    expect(getLegalDocument('cookies', 'fr')).toBeNull();
  });
});

describe('LegalDocumentScreen', () => {
  it("affiche les conditions d'utilisation en français", async () => {
    await render(<LegalDocumentScreen documentId="terms" />);
    expect(screen.getByText("Conditions d'utilisation")).toBeTruthy();
    expect(screen.getByText('1. Objet')).toBeTruthy();
    expect(screen.getByTestId('legal-document-scroll')).toBeTruthy();
  });

  it('affiche la politique de confidentialité en anglais', async () => {
    usePreferencesStore.getState().setLanguage('en');
    await render(<LegalDocumentScreen documentId="privacy" />);
    expect(screen.getByText('Privacy Policy')).toBeTruthy();
    expect(screen.getByText('3. Account data')).toBeTruthy();
  });

  it('suit un changement de langue sans quitter la page', async () => {
    await render(<LegalDocumentScreen documentId="privacy" />);
    expect(screen.getByText('Politique de confidentialité')).toBeTruthy();
    await act(() => usePreferencesStore.getState().setLanguage('en'));
    expect(await screen.findByText('Privacy Policy')).toBeTruthy();
  });

  it("revient à l'écran précédent, ou à l'accueil s'il n'y en a pas", async () => {
    await render(<LegalDocumentScreen documentId="terms" />);
    await fireEvent.press(screen.getByLabelText("Revenir à l'écran précédent"));
    expect(router.back).toHaveBeenCalledTimes(1);

    jest.mocked(router.canGoBack).mockReturnValueOnce(false);
    await fireEvent.press(screen.getByLabelText("Revenir à l'écran précédent"));
    expect(router.replace).toHaveBeenCalledWith('/');
  });

  it('affiche un message pour un document introuvable', async () => {
    await render(<LegalDocumentScreen documentId="inconnu" />);
    expect(screen.getAllByText('Document introuvable.').length).toBeGreaterThan(0);
  });
});
