import { useQueryClient, type QueryClient } from '@tanstack/react-query';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useEffectEvent, useRef, useSyncExternalStore } from 'react';
import { AppState, type AppStateStatus } from 'react-native';

import { sessionsApi } from '../../services/sessions-api';
import type { GameView } from '../../types/game';
import { withAccessToken } from '../auth/session';
import { restoreLastRoute, useRememberRoute } from '../navigation/last-route';
import { fetchActiveGames, gameKeys } from './hooks';
import { isConnectivityError } from './use-game-reconnection';

/**
 * Partie à retrouver parmi les parties actives du joueur (R-18 : au plus une) : la partie en
 * cours d'abord, sinon celle où il attend à la table.
 */
export function gameToReturnTo(games: readonly GameView[]): GameView | undefined {
  return games.find((g) => g.status === 'in_progress') ?? games.find((g) => g.status === 'waiting');
}

/** Route d'une partie reprise : l'écran affiche « Reconnexion » jusqu'au premier état reçu. */
export function resumeRoute(gameId: string): string {
  return `/game/${gameId}?reprise=1`;
}

/**
 * Partie où renvoyer le joueur, lue sur le SERVEUR (jamais le cache) :
 * 1. sa partie active (en cours, sinon en attente) ;
 * 2. sinon, une partie terminée pendant son absence dont la ronde Poursuivre/Quitter est
 *    encore ouverte à sa table (il y est encore présent) : l'écran de fin s'affiche.
 * Une partie quittée (départ enregistré, ou départ automatique à l'échéance) n'y figure plus.
 */
export async function findGameToRestore(queryClient: QueryClient): Promise<string | null> {
  const games = await queryClient.fetchQuery({
    queryKey: gameKeys.active,
    queryFn: fetchActiveGames,
    staleTime: 0,
  });
  const game = gameToReturnTo(games);
  if (game) return game.gameId;
  const { sessions } = await withAccessToken((t) => sessionsApi.listMine(t));
  // Ronde encore ouverte ET avant son échéance (horloge du serveur) : passé l'échéance, le
  // départ automatique s'applique, l'écran de fin n'a plus rien à proposer.
  const ended = sessions.find(
    (s) =>
      s.status === 'open' &&
      s.decision?.open === true &&
      Date.parse(s.decision.deadlineAt) > Date.parse(s.serverNow),
  );
  return ended?.decision?.gameId ?? null;
}

/**
 * Une seule vérification à la fois pour toute l'application (lancement, retour au premier
 * plan, arrivée sur l'accueil peuvent coïncider), et une seule navigation par vérification.
 */
let inflight: { promise: Promise<string | null>; navigated: boolean } | null = null;

export async function restoreActiveGame(
  queryClient: QueryClient,
  isCancelled: () => boolean = () => false,
): Promise<'opened' | 'none'> {
  if (!inflight) {
    const entry = { promise: findGameToRestore(queryClient), navigated: false };
    inflight = entry;
    entry.promise
      .finally(() => {
        if (inflight === entry) inflight = null;
      })
      .catch(() => undefined);
  }
  const entry = inflight;
  const gameId = await entry.promise;
  if (!gameId) return 'none';
  if (!isCancelled() && !entry.navigated) {
    entry.navigated = true;
    router.push(resumeRoute(gameId));
  }
  return 'opened';
}

/**
 * Hors de l'aire de jeu, le joueur qui a une partie active (en attente ou en cours) y est
 * renvoyé automatiquement, sans bouton « Reprendre ma partie ». La liste est relue sur le
 * SERVEUR à chaque arrivée sur l'écran (jamais le cache) : après « Quitter », le départ déjà
 * enregistré n'y renvoie donc pas. Une erreur réseau laisse simplement le joueur sur l'écran.
 */
export function useReturnToActiveGame(enabled: boolean) {
  const queryClient = useQueryClient();
  useFocusEffect(
    useCallback(() => {
      if (!enabled) return;
      let cancelled = false;
      restoreActiveGame(queryClient, () => cancelled).catch(() => undefined);
      return () => {
        cancelled = true;
      };
    }, [enabled, queryClient]),
  );
}

/** Écrans où la reprise automatique ne s'applique pas. */
const NOT_RESTORED = [/^\/game\//, /^\/payment\//, /^\/legal\//, /^\/login/, /^\/register/];

export type RestorePhase = 'idle' | 'restoring' | 'failed';

/**
 * État de la reprise à l'échelle de l'application : un système EXTERNE aux composants (la
 * vérification partagée ci-dessus), lu par useSyncExternalStore.
 */
let restorePhase: RestorePhase = 'idle';
const phaseListeners = new Set<() => void>();
function setRestorePhase(next: RestorePhase): void {
  if (next === restorePhase) return;
  restorePhase = next;
  for (const listener of [...phaseListeners]) listener();
}
function subscribePhase(listener: () => void): () => void {
  phaseListeners.add(listener);
  return () => phaseListeners.delete(listener);
}
const readPhase = () => restorePhase;

/**
 * Reprise de session à l'échelle de l'application : au lancement (une fois connecté) et à
 * chaque retour au premier plan, quel que soit l'écran, la partie active est recherchée et
 * ouverte. Pendant la recherche, `phase` vaut `restoring` (panneau « Reconnexion ») ; si le
 * serveur reste injoignable, `failed` (Réessayer, ou continuer sans attendre). Sur l'écran
 * d'une partie, c'est l'écran lui-même qui relit son état (useGameReconnection).
 *
 * Une session expirée est renouvelée par `withAccessToken` ; si elle ne peut pas l'être, la
 * connexion s'affiche, puis la reprise est relancée dès que le joueur est reconnecté.
 */
export function useActiveGameRestorer(enabled: boolean, pathname: string) {
  const queryClient = useQueryClient();
  const phase = useSyncExternalStore(subscribePhase, readPhase, readPhase);
  // Écran affiché, lu au moment de rouvrir le dernier écran (après la recherche serveur).
  const pathnameRef = useRef(pathname);
  useEffect(() => {
    pathnameRef.current = pathname;
  }, [pathname]);
  useRememberRoute(enabled, pathname);

  /**
   * `silent` (retour au premier plan) : l'écran consulté reste affiché tel quel pendant la
   * vérification, sans panneau « Reconnexion » ; seule une partie réellement active (lue sur
   * le serveur) y renvoie, et une erreur réseau laisse le joueur où il était.
   */
  const check = (silent = false) => {
    if (!enabled) return;
    // Processus relancé (Android l'avait détruit) : sans partie active à reprendre, le
    // dernier écran consulté est rouvert. Une seule fois par processus (`restoreLastRoute`).
    const reopenLastScreen = (gameOpened: boolean) => {
      if (!silent) void restoreLastRoute(() => (gameOpened ? '' : pathnameRef.current));
    };
    if (NOT_RESTORED.some((r) => r.test(pathname))) {
      reopenLastScreen(true);
      return;
    }
    if (!silent) setRestorePhase('restoring');
    restoreActiveGame(queryClient)
      .then((result) => {
        if (!silent) setRestorePhase('idle');
        reopenLastScreen(result === 'opened');
      })
      .catch((err: unknown) => {
        if (!silent) setRestorePhase(isConnectivityError(err) ? 'failed' : 'idle');
        reopenLastScreen(false);
      });
  };
  const onCheck = useEffectEvent(check);

  // Lancement de l'application, ou nouvelle connexion après une session expirée.
  useEffect(() => {
    if (enabled) onCheck();
  }, [enabled]);

  // Retour au premier plan (`inactive` seul n'est pas une absence) : vérification silencieuse.
  useEffect(() => {
    let previous: AppStateStatus = AppState.currentState;
    const subscription = AppState.addEventListener('change', (next) => {
      if (previous === 'background' && next === 'active') onCheck(true);
      previous = next;
    });
    return () => subscription.remove();
  }, []);

  const dismiss = useCallback(() => setRestorePhase('idle'), []);
  // Déconnecté (session expirée) : aucun panneau ; la reprise repart après la connexion.
  // « Réessayer » relance une vérification visible (l'événement du bouton n'est pas passé).
  return { phase: enabled ? phase : 'idle', retry: () => check(), dismiss };
}
