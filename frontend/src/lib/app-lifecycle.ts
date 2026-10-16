import { useEffect, useEffectEvent, useSyncExternalStore } from 'react';
import { AppState, type AppStateStatus } from 'react-native';

/**
 * Cycle de vie de l'application : UNE seule souscription native à `AppState` pour toute
 * l'application, partagée par le focus de TanStack Query, la reprise de session, la reprise
 * de la partie active, l'écran de jeu, le temps réel et la géolocalisation.
 *
 * Un « retour au premier plan » est une transition RÉELLE : l'application est passée par
 * `background` puis est redevenue `active`. `inactive` seul (centre de notifications, appel
 * entrant, boîte de dialogue système, demande de permission) n'est jamais une absence : il ne
 * déclenche aucune relecture.
 *
 * Rien ici ne recharge, ne remonte ni ne navigue : les abonnés décident eux-mêmes de ce qu'ils
 * relisent. La souscription native n'existe que tant qu'il y a des abonnés.
 */

export interface ForegroundEvent {
  /** Durée de l'absence (passage en arrière-plan → retour), en millisecondes. */
  awayMs: number;
}

type StateListener = (state: AppStateStatus) => void;
type ForegroundListener = (event: ForegroundEvent) => void;

const stateListeners = new Set<StateListener>();
const foregroundListeners = new Set<ForegroundListener>();
let subscription: { remove(): void } | null = null;
let current: AppStateStatus = 'active';
let backgroundedAt: number | null = null;
let clock: () => number = Date.now;

/** iOS peut annoncer `unknown` (ou rien) au lancement : l'application est alors affichée. */
function readNativeState(): AppStateStatus {
  const state = AppState.currentState as AppStateStatus | null | undefined;
  return state === 'background' || state === 'inactive' ? state : 'active';
}

function handleChange(next: AppStateStatus): void {
  if (next === current) return;
  current = next;
  if (next === 'background') {
    backgroundedAt ??= clock();
  }
  for (const listener of [...stateListeners]) listener(next);
  if (next === 'active' && backgroundedAt !== null) {
    const event = { awayMs: Math.max(0, clock() - backgroundedAt) };
    backgroundedAt = null;
    for (const listener of [...foregroundListeners]) listener(event);
  }
}

function retain(): void {
  if (subscription) return;
  current = readNativeState();
  backgroundedAt = current === 'background' ? clock() : null;
  subscription = AppState.addEventListener('change', handleChange);
}

function release(): void {
  if (stateListeners.size > 0 || foregroundListeners.size > 0) return;
  subscription?.remove();
  subscription = null;
}

/** Chaque changement d'état (`active`, `inactive`, `background`). */
export function onAppStateChange(listener: StateListener): () => void {
  stateListeners.add(listener);
  retain();
  return () => {
    stateListeners.delete(listener);
    release();
  };
}

/** Chaque retour RÉEL au premier plan (après `background`), une fois par retour. */
export function onAppForeground(listener: ForegroundListener): () => void {
  foregroundListeners.add(listener);
  retain();
  return () => {
    foregroundListeners.delete(listener);
    release();
  };
}

/** État courant (celui du système si personne n'écoute encore). */
export function getAppState(): AppStateStatus {
  return subscription ? current : readNativeState();
}

/** État de l'application, pour un composant (un seul abonnement natif partagé). */
export function useAppState(): AppStateStatus {
  return useSyncExternalStore(onAppStateChange, getAppState, getAppState);
}

/**
 * Exécute `callback` à chaque retour réel au premier plan. Le dernier `callback` rendu est
 * utilisé sans réabonnement : aucune boucle de rendu, un seul abonnement par composant.
 */
export function useAppForeground(callback: ForegroundListener): void {
  const onForeground = useEffectEvent(callback);
  useEffect(() => onAppForeground((event) => onForeground(event)), []);
}

/** Tests : nouveau processus simulé (aucun abonné, horloge réelle). */
export function resetAppLifecycleForTests(now: () => number = Date.now): void {
  stateListeners.clear();
  foregroundListeners.clear();
  subscription?.remove();
  subscription = null;
  current = 'active';
  backgroundedAt = null;
  clock = now;
}
