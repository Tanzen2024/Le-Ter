/// <reference types="jest" />
import { act, cleanup, renderHook } from '@testing-library/react-native';
import { router } from 'expo-router';

import { preferencesStorage } from '../../services/preferences-storage';
import {
  beginNavigationRoot,
  forgetLastRoute,
  isRestorable,
  LAST_ROUTE_MAX_AGE_MS,
  LAST_ROUTE_STORAGE_KEY,
  parseLastRoute,
  parseLastScreen,
  rememberLobbyPanel,
  rememberRoute,
  resetLastRouteForTests,
  restoreLastRoute,
  takeLobbyPanelRequest,
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

/** Passages en arrière-plan simulés (le module natif n'émet rien en test). */
const mockStateListeners = new Set<(state: string) => void>();
jest.mock('../../lib/app-lifecycle', () => ({
  onAppStateChange: (listener: (state: string) => void) => {
    mockStateListeners.add(listener);
    return () => mockStateListeners.delete(listener);
  },
}));
const goBackground = () => mockStateListeners.forEach((listener) => listener('background'));

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

describe('limite d’ancienneté comptée depuis le départ de Le Ter', () => {
  it('écran consulté longtemps puis quitté : réenregistré au passage en arrière-plan', async () => {
    const clock = jest.spyOn(Date, 'now').mockReturnValue(NOW);
    try {
      await act(async () => {
        await restoreLastRoute(() => '/', () => NOW);
      });
      await renderHook(() => useRememberRoute(true, '/tournament/t-42'));
      await flush();
      // 40 min plus tard (même écran), le joueur passe dans une autre application.
      const leftAt = NOW + 40 * 60_000;
      clock.mockReturnValue(leftAt);
      goBackground();
      await flush();
      // Processus détruit 1 min après : l'écran est encore rouvrable.
      expect(parseLastRoute(mockMemory.get(LAST_ROUTE_STORAGE_KEY) ?? null, leftAt + 60_000)).toBe(
        '/tournament/t-42',
      );
      // Au-delà de 30 min d'absence : plus rouvert.
      expect(
        parseLastRoute(mockMemory.get(LAST_ROUTE_STORAGE_KEY) ?? null, leftAt + LAST_ROUTE_MAX_AGE_MS + 1),
      ).toBeNull();
    } finally {
      clock.mockRestore();
    }
  });

  it('déconnecté : le passage en arrière-plan n’enregistre rien', async () => {
    await restoreLastRoute(() => '/', () => NOW);
    await renderHook(() => useRememberRoute(false, '/tournament/t-42'));
    goBackground();
    await flush();
    expect(preferencesStorage.setItem).not.toHaveBeenCalled();
  });
});

describe('activité recréée par Android (racine React remontée, processus vivant)', () => {
  it('nouvelle arborescence : le dernier écran est de nouveau rouvert', async () => {
    saved('/tournament/t-42');
    expect(await restoreLastRoute(() => '/', () => NOW)).toBe('opened');
    // Même processus, nouvelle racine : la pile est repartie de l'accueil.
    beginNavigationRoot();
    expect(await restoreLastRoute(() => '/', () => NOW)).toBe('opened');
    expect(push).toHaveBeenCalledTimes(2);
    // Sans nouvelle racine (simple retour au premier plan) : rien.
    expect(await restoreLastRoute(() => '/', () => NOW)).toBe('none');
    expect(push).toHaveBeenCalledTimes(2);
  });
});

describe('résultats et panneaux de la coquille', () => {
  it('classement officiel d’un tournoi rouvrable', () => {
    expect(isRestorable('/tournament/results/t-9')).toBe(true);
    expect(isRestorable('/tournament/results')).toBe(true);
  });

  it('panneau ouvert (portefeuille) mémorisé avec l’écran, puis rouvert', async () => {
    await rememberRoute('/', NOW, 'shop');
    expect(parseLastScreen(mockMemory.get(LAST_ROUTE_STORAGE_KEY) ?? null, NOW)).toEqual({
      pathname: '/',
      panel: 'shop',
    });
    expect(await restoreLastRoute(() => '/', () => NOW)).toBe('opened');
    // Accueil déjà affiché : aucune navigation, seul le panneau est rouvert.
    expect(push).not.toHaveBeenCalled();
    expect(takeLobbyPanelRequest()).toBe('shop');
    expect(takeLobbyPanelRequest()).toBeNull();
  });

  it('liste des tournois avec le profil ouvert : écran ET panneau rouverts', async () => {
    await rememberRoute('/tournament', NOW, 'profile');
    expect(await restoreLastRoute(() => '/', () => NOW)).toBe('opened');
    expect(push).toHaveBeenCalledWith('/tournament');
    expect(takeLobbyPanelRequest()).toBe('profile');
  });

  it('panneau sur un écran sans coquille, ou inconnu : ignoré', async () => {
    const value = (o: object) => JSON.stringify({ ...o, savedAt: NOW - 1_000 });
    expect(parseLastScreen(value({ pathname: '/game/g-1', panel: 'shop' }), NOW)).toBeNull();
    expect(parseLastScreen(value({ pathname: '/', panel: 'hack' }), NOW)).toBeNull();
    expect(parseLastScreen(value({ pathname: '/tournament/t-1', panel: 'shop' }), NOW)).toEqual({
      pathname: '/tournament/t-1',
    });
  });

  it('écran affiché + panneau déclaré par la coquille : enregistrés ensemble', async () => {
    await act(async () => {
      await restoreLastRoute(() => '/', () => NOW);
    });
    await renderHook(() => useRememberRoute(true, '/'));
    await flush();
    expect(mockMemory.has(LAST_ROUTE_STORAGE_KEY)).toBe(false);
    rememberLobbyPanel('shop');
    await flush();
    expect(JSON.parse(mockMemory.get(LAST_ROUTE_STORAGE_KEY)!)).toMatchObject({
      pathname: '/',
      panel: 'shop',
    });
    // Panneau refermé : l'accueil seul n'est pas rouvrable, l'entrée est oubliée.
    rememberLobbyPanel(null);
    await flush();
    expect(mockMemory.has(LAST_ROUTE_STORAGE_KEY)).toBe(false);
  });
});
