import { useEffect, useState } from 'react';
import { AccessibilityInfo } from 'react-native';

import type { GameView } from '../../../types/game';

/** Durée du signal lumineux sur la zone du joueur qui devient actif. */
export const TURN_SIGNAL_MS = 2000;

/**
 * Durée d'un tour (D-034, 20 s depuis D-064), seulement pour l'échelle de l'anneau quand le
 * serveur n'envoie pas le début du tour. Le compte à rebours suit TOUJOURS `turnDeadlineAt`
 * du serveur (`TURN_DURATION_MS` côté backend) : le client ne décide jamais du délai.
 */
export const DEFAULT_TURN_MS = 20_000;

/**
 * Identité d'UN tour de jeu, tirée de l'état synchronisé : joueur attendu + échéance fixée par
 * le serveur. Elle ne change qu'avec un vrai changement de tour (même joueur qui rejoue après
 * avoir pris le contrôle compris), jamais sur un nouveau rendu ni sur un événement temps réel
 * reçu deux fois. `undefined` : aucun tour à signaler (distribution, partie finie, attente).
 */
export function turnKeyOf(game: GameView, dealing: boolean): string | undefined {
  const play = game.play;
  if (dealing || game.status !== 'in_progress' || !play) return undefined;
  const playerId = game.activePlayerId ?? play.nextPlayerId;
  if (!playerId) return undefined;
  const marker =
    game.turnDeadlineAt ?? game.turnStartedAt ?? `${play.trickNumber}:${play.currentTrick.length}`;
  return `${playerId}|${marker}`;
}

/** Joueur désigné par une clé de tour. */
export function playerOfTurnKey(key: string): string {
  return key.slice(0, key.indexOf('|'));
}

/**
 * Signal lumineux de 2 s au changement effectif du joueur actif. Renvoie la clé du tour à
 * signaler, ou `null` une fois les 2 s écoulées. Une même clé n'est signalée qu'une fois ; le
 * minuteur est annulé au changement de tour et au démontage (nouvelle partie = nouvel écran).
 */
export function useTurnSignal(turnKey: string | undefined): string | null {
  const [expiredKey, setExpiredKey] = useState<string | null>(null);
  useEffect(() => {
    if (!turnKey) return;
    const timer = setTimeout(() => setExpiredKey(turnKey), TURN_SIGNAL_MS);
    return () => clearTimeout(timer);
  }, [turnKey]);
  return turnKey && turnKey !== expiredKey ? turnKey : null;
}

/** Préférence système « réduire les animations » (suivie en direct). */
export function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    let alive = true;
    AccessibilityInfo.isReduceMotionEnabled()
      .then((value) => alive && setReduced(value))
      .catch(() => undefined);
    const subscription = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduced);
    return () => {
      alive = false;
      subscription.remove();
    };
  }, []);
  return reduced;
}
