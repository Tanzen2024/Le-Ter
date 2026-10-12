import { useEffect, useState } from 'react';
import { AccessibilityInfo } from 'react-native';

import type { GameView } from '../../../types/game';

/**
 * Durée du halo lumineux sur la zone du joueur qui devient actif : 5 s exactement. Purement
 * visuel : n'a aucun effet sur le temps de jeu, fixé par le serveur (`turnDeadlineAt`).
 */
export const TURN_SIGNAL_MS = 5000;

/**
 * Durée d'un tour (D-034, 10 s depuis D-092), seulement pour l'échelle de l'anneau quand le
 * serveur n'envoie pas le début du tour. Le compte à rebours suit TOUJOURS `turnDeadlineAt`
 * du serveur (`TURN_DURATION_MS` côté backend) : le client ne décide jamais du délai.
 */
export const DEFAULT_TURN_MS = 10_000;

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
 * Halo de 5 s au changement effectif du joueur actif. Renvoie la clé du tour à
 * signaler, ou `null` une fois les 5 s écoulées. Une même clé n'est signalée qu'une fois ; le
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

/** Durée du halo sur la plaque du joueur qui OBTIENT le contrôle. */
export const CONTROL_SIGNAL_MS = 3000;

/**
 * Détenteur du contrôle selon l'état officiel du serveur (`play.controllerId`, D-035 : le
 * contrôle se décide en fin de tour). Distinct du joueur attendu (`activePlayerId`) et du
 * gagnant. `undefined` hors partie en cours et pendant la distribution.
 */
export function controllerOf(game: GameView, dealing: boolean): string | undefined {
  if (dealing || game.status !== 'in_progress' || !game.play) return undefined;
  return game.play.controllerId || undefined;
}

/**
 * Halo de 3 s quand le contrôle change RÉELLEMENT de main (y compris le premier contrôle,
 * à la fin de la distribution). Renvoie un jeton `<joueur>#<n>` tant que le halo est visible,
 * sinon `null`.
 * - Même détenteur dans un nouvel état (rafraîchissement, événement reçu deux fois) : rien.
 * - Détenteur présent dès l'ouverture de l'écran (reconnexion) : pas de halo, rien n'a changé.
 * - Nouveau changement avant la fin : le halo précédent s'arrête, le nouveau démarre.
 * Chaque appareil le déduit du même état officiel : tous les joueurs voient le même halo.
 */
export function useControlSignal(controllerId: string | undefined): string | null {
  const [seen, setSeen] = useState({ controllerId, change: 0, signal: false });
  // Mémorisation du rendu précédent (motif React « état dérivé ») : pas d'effet en cascade.
  if (seen.controllerId !== controllerId) {
    setSeen({ controllerId, change: seen.change + 1, signal: Boolean(controllerId) });
  }
  const token =
    seen.signal && controllerId && seen.controllerId === controllerId
      ? `${controllerId}#${seen.change}`
      : undefined;
  const [expired, setExpired] = useState<string | null>(null);
  useEffect(() => {
    if (!token) return;
    const timer = setTimeout(() => setExpired(token), CONTROL_SIGNAL_MS);
    return () => clearTimeout(timer);
  }, [token]);
  return token && token !== expired ? token : null;
}

/** Joueur désigné par un jeton de contrôle. */
export function playerOfControlSignal(token: string): string {
  return token.slice(0, token.lastIndexOf('#'));
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
