/// <reference types="jest" />
import { act, cleanup, renderHook } from '@testing-library/react-native';
import { router } from 'expo-router';

import { preferencesStorage } from '../../services/preferences-storage';
import {
  forgetLastRoute,
  isRestorable,
  LAST_ROUTE_MAX_AGE_MS,
  LAST_ROUTE_STORAGE_KEY,
  parseLastRoute,
  rememberRoute,
  resetLastRouteForTests,
  restoreLastRoute,
  useRememberRoute,
} from './last-route';

/**
 * Processus détruit par Android puis relancé : le dernier écran consulté est rouvert, une
 * seule fois, s'il est récent ; jamais une partie (décidée par le serveur) ni un écran de
 * connexion ou de paiement.
 */

jest.mock('expo-router', () => ({ router: { push: jest.fn() } }));
const mockMemory = new Map<string, string>();
jest.mock('../../services/preferences-storage', () => ({
  preferencesStorage: {
    getItem: jest.fn(async (key: string) => mockMemory.get(key) ?? null),
    setItem: jest.fn(async (key: string, value: string) => void mockMemory.set(key, value)),
    removeItem: jest.fn(async (key: string) => void mockMemory.delete(key)),
  },
}));

const push = router.push as jest.Mock;
const NOW = Date.parse('2026-10-14T20:00:00.000Z');
const saved = (pathname: string, savedAt = NOW - 60_000) =>
  mockMemory.set(LAST_ROUTE_STORAGE_KEY, JSON.stringify({ pathname, savedAt }));
const flush = () => act(async () => {});

beforeEach(() => {
  mockMemory.clear();
  resetLastRouteForTests();
});
afterEach(async () => {
  await cleanup();
  jest.clearAllMocks();
});

describe('écrans rouvrables', () => {
  it('tournois, administration et documents légaux seulement', () => {
    for (const path of ['/tournament', '/tournament/t-42', '/admin', '/admin/tournaments/t-1', '/legal/cgu']) {
      expect([path, isRestorable(path)]).toEqual([path, true]);
    }
    // Partie : reprise décidée par le serveur ; connexion, paiement, accueil : jamais.
    for (const path of ['/', '/game/g-1', '/login', '/register', '/payment/return']) {
      expect([path, isRestorable(path)]).toEqual([path, false]);
    }
  });

  it('valeur relue : récente et valide, sinon ignorée', () => {
    const value = (pathname: unknown, savedAt: unknown) => JSON.stringify({ pathname, savedAt });
    expect(parseLastRoute(value('/tournament/t-1', NOW - 1_000), NOW)).toBe('/tournament/t-1');
    expect(parseLastRoute(value('/tournament/t-1', NOW - LAST_ROUTE_MAX_AGE_MS - 1), NOW)).toBeNull();
    expect(parseLastRoute(value('/tournament/t-1', NOW + 60_000), NOW)).toBeNull();
    expect(parseLastRoute(value('/game/g-1', NOW - 1_000), NOW)).toBeNull();
    expect(parseLastRoute('{pas du json', NOW)).toBeNull();
    expect(parseLastRoute(null, NOW)).toBeNull();
  });
});

describe('relancement après destruction du processus', () => {
  it('rouvre le dernier écran récent, une seule fois par processus', async () => {
    saved('/tournament/t-42');
    expect(await restoreLastRoute(() => '/', () => NOW)).toBe('opened');
    expect(push).toHaveBeenCalledWith('/tournament/t-42');
    // Nouvelle vérification (retour au premier plan, reconnexion) : rien de plus.
    expect(await restoreLastRoute(() => '/', () => NOW)).toBe('none');
    expect(push).toHaveBeenCalledTimes(1);
  });

  it('écran trop ancien : l’accueil reste affiché', async () => {
    saved('/tournament/t-42', NOW - LAST_ROUTE_MAX_AGE_MS - 1);
    expect(await restoreLastRoute(() => '/', () => NOW)).toBe('none');
    expect(push).not.toHaveBeenCalled();
  });

  it('joueur déjà ailleurs (partie reprise, lien ouvert) : aucune navigation', async () => {
    saved('/tournament/t-42');
    expect(await restoreLastRoute(() => '/game/g-1', () => NOW)).toBe('none');
    expect(push).not.toHaveBeenCalled();
  });

  it('aucun écran enregistré : accueil', async () => {
    expect(await restoreLastRoute(() => '/', () => NOW)).toBe('none');
    expect(push).not.toHaveBeenCalled();
  });
});

describe('enregistrement de l’écran affiché', () => {
  it('écran rouvrable gardé ; accueil ou partie : l’ancien est oublié', async () => {
    await rememberRoute('/tournament/t-1', NOW);
    expect(parseLastRoute(mockMemory.get(LAST_ROUTE_STORAGE_KEY) ?? null, NOW)).toBe('/tournament/t-1');
    await rememberRoute('/game/g-1', NOW);
    expect(mockMemory.has(LAST_ROUTE_STORAGE_KEY)).toBe(false);
  });

  it('avant la décision de lancement, l’accueil initial n’efface pas le dernier écran', async () => {
    saved('/tournament/t-42');
    const hook = await renderHook(
      ({ path }: { path: string }) => useRememberRoute(true, path),
      { initialProps: { path: '/' } },
    );
    await flush();
    expect(mockMemory.has(LAST_ROUTE_STORAGE_KEY)).toBe(true);
    expect(preferencesStorage.removeItem).not.toHaveBeenCalled();

    // Décision prise (dernier écran rouvert) : l'écran affiché est désormais enregistré.
    await act(async () => {
      await restoreLastRoute(() => '/', () => NOW);
    });
    await hook.rerender({ path: '/tournament/t-42' });
    await flush();
    expect(JSON.parse(mockMemory.get(LAST_ROUTE_STORAGE_KEY)!).pathname).toBe('/tournament/t-42');
  });

  it('déconnecté : rien n’est enregistré', async () => {
    resetLastRouteForTests();
    await restoreLastRoute(() => '/', () => NOW);
    await renderHook(() => useRememberRoute(false, '/tournament/t-1'));
    await flush();
    expect(preferencesStorage.setItem).not.toHaveBeenCalled();
  });

  it('déconnexion réelle : l’écran est oublié', async () => {
    saved('/tournament/t-42');
    await forgetLastRoute();
    expect(mockMemory.has(LAST_ROUTE_STORAGE_KEY)).toBe(false);
  });
});
