import { router } from 'expo-router';
import { useEffect } from 'react';

import { preferencesStorage } from '../../services/preferences-storage';

/**
 * Dernier écran consulté, pour le cas où Android a DÉTRUIT le processus pendant que
 * l'application était en arrière-plan (au simple retour au premier plan, l'instance et sa
 * navigation sont intactes : rien n'est relu ici).
 *
 * Seul le chemin d'un écran qui se rouvre sans risque est gardé : jamais un jeton, une
 * saisie de formulaire ni une donnée de jeu. Une partie n'y figure pas : sa reprise se décide
 * sur le serveur (useActiveGameRestorer), jamais d'après un état local.
 */
export const LAST_ROUTE_STORAGE_KEY = 'le-ter.last-route';
/** Au-delà, le joueur repart de l'accueil : l'écran consulté n'a plus de sens. */
export const LAST_ROUTE_MAX_AGE_MS = 30 * 60_000;

/** Écrans rouverts au relancement : tournois, administration, documents légaux. */
const RESTORABLE = [/^\/tournament(\/[\w-]+)?$/, /^\/admin(\/[\w/-]*)?$/, /^\/legal\/[\w-]+$/];

export function isRestorable(pathname: string): boolean {
  return RESTORABLE.some((pattern) => pattern.test(pathname));
}

/** Chemin à rouvrir, ou null (absent, illisible, trop ancien ou écran non rouvrable). */
export function parseLastRoute(raw: string | null, now: number): string | null {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as { pathname?: unknown; savedAt?: unknown };
    if (typeof value.pathname !== 'string' || typeof value.savedAt !== 'number') return null;
    if (now - value.savedAt > LAST_ROUTE_MAX_AGE_MS || value.savedAt > now) return null;
    return isRestorable(value.pathname) ? value.pathname : null;
  } catch {
    return null;
  }
}

/** Écran affiché : gardé s'il est rouvrable, sinon l'ancien est oublié (accueil, partie…). */
export async function rememberRoute(pathname: string, now = Date.now()): Promise<void> {
  if (isRestorable(pathname)) {
    await preferencesStorage.setItem(
      LAST_ROUTE_STORAGE_KEY,
      JSON.stringify({ pathname, savedAt: now }),
    );
  } else {
    await preferencesStorage.removeItem(LAST_ROUTE_STORAGE_KEY);
  }
}

/** Déconnexion réelle : le prochain compte ne retrouve pas l'écran du précédent. */
export async function forgetLastRoute(): Promise<void> {
  await preferencesStorage.removeItem(LAST_ROUTE_STORAGE_KEY);
}

/**
 * Une seule décision par processus JavaScript : au lancement (après la restauration de la
 * session). Tant qu'elle n'est pas prise, l'écran initial (l'accueil) n'efface pas le
 * dernier écran enregistré.
 */
let launchDecided = false;
let launchListeners: (() => void)[] = [];

/**
 * Rouvre le dernier écran consulté s'il est récent et si le joueur est toujours sur l'écran
 * initial (`currentPathname`) : un lien ouvert au lancement ou une partie reprise priment.
 */
export async function restoreLastRoute(
  currentPathname: () => string,
  now: () => number = Date.now,
): Promise<'opened' | 'none'> {
  if (launchDecided) return 'none';
  launchDecided = true;
  try {
    const pathname = parseLastRoute(await preferencesStorage.getItem(LAST_ROUTE_STORAGE_KEY), now());
    if (pathname && currentPathname() === '/') {
      router.push(pathname as never);
      return 'opened';
    }
    return 'none';
  } finally {
    const listeners = launchListeners;
    launchListeners = [];
    for (const listener of listeners) listener();
  }
}

/**
 * Enregistre l'écran affiché (connecté seulement), une fois la décision de lancement prise.
 */
export function useRememberRoute(signedIn: boolean, pathname: string): void {
  useEffect(() => {
    if (!signedIn) return;
    if (launchDecided) {
      void rememberRoute(pathname);
      return;
    }
    let active = true;
    const listener = () => {
      if (active) void rememberRoute(pathname);
    };
    launchListeners.push(listener);
    return () => {
      active = false;
      launchListeners = launchListeners.filter((l) => l !== listener);
    };
  }, [signedIn, pathname]);
}

/** Tests : nouveau processus simulé. */
export function resetLastRouteForTests(): void {
  launchDecided = false;
  launchListeners = [];
}
