import { router } from 'expo-router';
import { useEffect } from 'react';

import { onAppStateChange } from '../../lib/app-lifecycle';
import { preferencesStorage } from '../../services/preferences-storage';

/**
 * Dernier écran consulté, pour le cas où l'arborescence React repart de zéro : processus
 * DÉTRUIT par Android pendant l'arrière-plan (relancement à froid), ou activité recréée par
 * le système (la racine React est remontée, la pile de navigation est perdue). Au simple retour
 * au premier plan, l'instance et sa navigation sont intactes : rien n'est relu ici.
 *
 * Seuls sont gardés le chemin d'un écran qui se rouvre sans risque et, sur un écran de la
 * coquille (accueil, liste des tournois), le NOM du panneau ouvert (portefeuille, profil…) :
 * jamais un jeton, une saisie de formulaire ni une donnée de jeu. Une partie n'y figure pas :
 * sa reprise se décide sur le serveur (useActiveGameRestorer), jamais d'après un état local.
 */
export const LAST_ROUTE_STORAGE_KEY = 'le-ter.last-route';
/**
 * Absence au-delà de laquelle le joueur repart de l'accueil : l'écran consulté n'a plus de
 * sens. Comptée depuis le passage en arrière-plan (l'écran y est réenregistré), pas depuis
 * l'arrivée sur l'écran.
 */
export const LAST_ROUTE_MAX_AGE_MS = 30 * 60_000;

/** Écrans rouverts au relancement : tournois (et leurs résultats), administration, légal. */
const RESTORABLE = [
  /^\/tournament(\/[\w-]+)?$/,
  /^\/tournament\/results\/[\w-]+$/,
  /^\/admin(\/[\w/-]*)?$/,
  /^\/legal\/[\w-]+$/,
];

/** Panneaux de la coquille (LobbyShell) rouvrables : leur contenu est relu sur le serveur. */
export const RESTORABLE_PANELS = ['profile', 'settings', 'private', 'garam', 'shop'] as const;
export type RestorablePanel = (typeof RESTORABLE_PANELS)[number];
/** Écrans qui portent la coquille et donc ses panneaux. */
const LOBBY_PATHS = ['/', '/tournament'];

export function isRestorable(pathname: string): boolean {
  return RESTORABLE.some((pattern) => pattern.test(pathname));
}

function isPanel(value: unknown): value is RestorablePanel {
  return typeof value === 'string' && (RESTORABLE_PANELS as readonly string[]).includes(value);
}

export interface LastScreen {
  pathname: string;
  panel?: RestorablePanel;
}

/** Écran (et panneau) à rouvrir, ou null (absent, illisible, trop ancien, non rouvrable). */
export function parseLastScreen(raw: string | null, now: number): LastScreen | null {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as { pathname?: unknown; panel?: unknown; savedAt?: unknown };
    if (typeof value.pathname !== 'string' || typeof value.savedAt !== 'number') return null;
    if (now - value.savedAt > LAST_ROUTE_MAX_AGE_MS || value.savedAt > now) return null;
    const panel = isPanel(value.panel) && LOBBY_PATHS.includes(value.pathname) ? value.panel : undefined;
    if (!isRestorable(value.pathname) && !panel) return null;
    return panel ? { pathname: value.pathname, panel } : { pathname: value.pathname };
  } catch {
    return null;
  }
}

/** Chemin à rouvrir, ou null. */
export function parseLastRoute(raw: string | null, now: number): string | null {
  return parseLastScreen(raw, now)?.pathname ?? null;
}

/**
 * Écran affiché : gardé s'il est rouvrable (ou s'il porte un panneau ouvert), sinon l'ancien est
 * oublié (accueil sans panneau, partie, paiement…).
 */
export async function rememberRoute(
  pathname: string,
  now = Date.now(),
  panel: RestorablePanel | null = null,
): Promise<void> {
  const withPanel = panel !== null && LOBBY_PATHS.includes(pathname);
  if (isRestorable(pathname) || withPanel) {
    await preferencesStorage.setItem(
      LAST_ROUTE_STORAGE_KEY,
      JSON.stringify({ pathname, ...(withPanel && { panel }), savedAt: now }),
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
 * Une seule décision par arborescence de navigation : au lancement (après la restauration de
 * la session), puis de nouveau si la racine React est remontée (`beginNavigationRoot`). Tant
 * qu'elle n'est pas prise, l'écran initial (l'accueil) n'efface pas le dernier écran enregistré.
 */
let launchDecided = false;
let launchListeners: (() => void)[] = [];

/**
 * Décision de lancement ACHEVÉE (dernier écran rouvert ou rien à rouvrir) : le rideau de
 * relancement (`LaunchCurtain`) se lève alors, sans montrer l'accueil puis l'écran rouvert.
 */
let launchSettled = false;
const settledListeners = new Set<() => void>();

export function isLaunchSettled(): boolean {
  return launchSettled;
}

export function onLaunchSettled(listener: () => void): () => void {
  settledListeners.add(listener);
  return () => settledListeners.delete(listener);
}

/** Écran et panneau affichés (connecté), réécrits ensemble à chaque changement. */
let shownPathname: string | null = null;
let shownPanel: RestorablePanel | null = null;

function persistShown(): void {
  if (!launchDecided || shownPathname === null) return;
  void rememberRoute(shownPathname, Date.now(), shownPanel);
}

/**
 * Nouvelle arborescence de navigation (racine React montée : lancement, ou activité recréée
 * par Android alors que le moteur JavaScript a survécu) : la pile repart de l'accueil, la
 * décision de rouvrir le dernier écran est donc à reprendre.
 */
export function beginNavigationRoot(): void {
  launchDecided = false;
  // Appelé pendant le rendu de la racine : aucun abonné à prévenir (le rideau lit l'état).
  launchSettled = false;
}

/** Panneau à rouvrir dans la coquille affichée, consommé une fois. */
let panelRequest: RestorablePanel | null = null;
const panelListeners = new Set<() => void>();

export function requestLobbyPanel(panel: RestorablePanel): void {
  panelRequest = panel;
  for (const listener of [...panelListeners]) listener();
}

export function takeLobbyPanelRequest(): RestorablePanel | null {
  const panel = panelRequest;
  panelRequest = null;
  return panel;
}

export function onLobbyPanelRequest(listener: () => void): () => void {
  panelListeners.add(listener);
  return () => panelListeners.delete(listener);
}

/** Panneau ouvert dans la coquille AFFICHÉE (null : aucun), enregistré avec l'écran. */
export function rememberLobbyPanel(panel: string | null): void {
  const next = isPanel(panel) ? panel : null;
  if (next === shownPanel) return;
  shownPanel = next;
  persistShown();
}

/**
 * Rouvre le dernier écran consulté s'il est récent et si le joueur est toujours sur l'écran
 * initial (`currentPathname`) : un lien ouvert au lancement ou une partie reprise priment.
 * Le panneau enregistré (portefeuille, profil…) est rouvert dans la coquille de cet écran.
 */
export async function restoreLastRoute(
  currentPathname: () => string,
  now: () => number = Date.now,
): Promise<'opened' | 'none'> {
  if (launchDecided) return 'none';
  launchDecided = true;
  try {
    const screen = parseLastScreen(await preferencesStorage.getItem(LAST_ROUTE_STORAGE_KEY), now());
    if (!screen || currentPathname() !== '/') return 'none';
    if (screen.pathname !== '/') router.push(screen.pathname as never);
    if (screen.panel) requestLobbyPanel(screen.panel);
    return 'opened';
  } finally {
    const listeners = launchListeners;
    launchListeners = [];
    for (const listener of listeners) listener();
    launchSettled = true;
    for (const listener of [...settledListeners]) listener();
  }
}

/**
 * Enregistre l'écran affiché (connecté seulement), une fois la décision de lancement prise.
 */
export function useRememberRoute(signedIn: boolean, pathname: string): void {
  useEffect(() => {
    if (!signedIn) {
      shownPathname = null;
      return;
    }
    // Le panneau suit la coquille AFFICHÉE : elle le déclare au focus et l'efface en le
    // quittant (LobbyShell), jamais déduit ici.
    shownPathname = pathname;
    if (launchDecided) {
      persistShown();
      return;
    }
    let active = true;
    const listener = () => {
      if (active) persistShown();
    };
    launchListeners.push(listener);
    return () => {
      active = false;
      launchListeners = launchListeners.filter((l) => l !== listener);
    };
  }, [signedIn, pathname]);

  // Passage en arrière-plan : l'écran affiché est réenregistré à cette heure, pour que la
  // limite d'ancienneté compte la durée d'ABSENCE (un écran consulté longtemps avant de
  // quitter Le Ter reste rouvrable si Android détruit le processus juste après).
  useEffect(
    () =>
      onAppStateChange((state) => {
        if (state === 'background') persistShown();
      }),
    [],
  );
}

/** Tests : nouveau processus simulé. */
export function resetLastRouteForTests(): void {
  launchDecided = false;
  launchListeners = [];
  launchSettled = false;
  settledListeners.clear();
  shownPathname = null;
  shownPanel = null;
  panelRequest = null;
  panelListeners.clear();
}
