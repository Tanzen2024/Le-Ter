import { useEffect, useState } from 'react';

import { displayedDeadline, HIDDEN_MARGIN_MS } from '../../../hooks/use-server-countdown';
import type { GameView } from '../../../types/game';
import { DEFAULT_TURN_MS } from './turn-signal';

/**
 * Tour de jeu en cours, tel que le SERVEUR le décrit : joueur attendu, échéance et durée.
 * Source unique des barres de progression des joueurs et du chrono en bas à gauche
 * (« roulette ») : les deux suivent toujours le même tour. Échéance et durée sont celles
 * AFFICHÉES (D-098) : 10 s sur les 13 s du serveur.
 *
 * `null` quand aucune carte n'est attendue d'un joueur : partie en attente ou terminée (dont
 * le 5e tour automatique, présenté après la fin, D-041), distribution, ou état sans échéance.
 */
export interface TurnPhase {
  /** Identité du tour (joueur + échéance) : un état plus ancien ne la reproduit jamais. */
  key: string;
  playerId: string;
  /** Échéance affichée (serveur − 3 s), ramenée à l'horloge du téléphone (ms, `Date.now()`). */
  localDeadline: number;
  /** Durée affichée du tour (début → échéance affichée), pour l'échelle des barres. */
  totalMs: number;
  /** Échéance dépassée selon le serveur : coup automatique attendu (D-036). */
  timedOut: boolean;
}

/** Écart d'horloge en dessous duquel l'échéance locale n'est pas recalée (bruit réseau). */
export const CLOCK_JITTER_MS = 250;

/**
 * Description pure du tour à partir de l'état synchronisé. `offsetMs` = heure du serveur −
 * heure du téléphone, mesuré à la réception.
 */
export function turnPhaseOf(
  game: GameView,
  { dealing, offsetMs }: { dealing: boolean; offsetMs: number },
): TurnPhase | null {
  // Le Ter (`play`) ou GARAM TIA (`garam`, D-119) : même tour, même échéance du serveur.
  const nextPlayerId = game.play?.nextPlayerId ?? game.garam?.nextPlayerId;
  if (game.status !== 'in_progress' || !(game.play || game.garam) || dealing) return null;
  // D-102 : aucun tour tant que le serveur n'a pas confirmé la distribution.
  if (game.dealEndsAt) return null;
  const playerId = game.activePlayerId ?? nextPlayerId;
  if (!playerId || !game.turnDeadlineAt) return null;
  const fled = game.players.find((p) => p.playerId === playerId)?.fledAt;
  if (fled) return null;
  const deadline = Date.parse(game.turnDeadlineAt);
  if (!Number.isFinite(deadline)) return null;
  const started = game.turnStartedAt ? Date.parse(game.turnStartedAt) : NaN;
  // Le Ter et GARAM TIA (D-122) : 10 s affichées sur les 13 s du serveur (D-098).
  const shown = displayedDeadline(deadline);
  const totalMs =
    Number.isFinite(started) && shown > started
      ? shown - started
      : Number.isFinite(started)
        ? Math.max(1, deadline - started - HIDDEN_MARGIN_MS)
        : DEFAULT_TURN_MS;
  return {
    key: `${playerId}|${game.turnDeadlineAt}`,
    playerId,
    localDeadline: shown - offsetMs,
    totalMs,
    timedOut: Boolean(game.turnTimedOutAt),
  };
}

/**
 * Barre de progression d'une plaque (D-099) : affichée si le joueur de la plaque est le joueur
 * attendu par le serveur ET n'est pas le joueur connecté (chacun voit la barre des autres, jamais
 * la sienne : il a son chrono). Comparaison sur les identifiants réels, jamais sur les sièges.
 */
export function seatTurnFor(
  phase: TurnPhase | null,
  seatPlayerId: string | undefined,
  viewerId: string,
): TurnPhase | null {
  if (!phase || !seatPlayerId || seatPlayerId === viewerId) return null;
  return phase.playerId === seatPlayerId ? phase : null;
}

/**
 * Chrono et roulette (D-099) : seulement sur le téléphone du joueur attendu, pendant un tour où
 * il doit jouer une carte (état du serveur, échéance non dépassée selon lui). Rien pendant la
 * distribution, entre deux tours, en fin de partie ni pendant le 5e tour automatique.
 */
export function dialVisibleFor(phase: TurnPhase | null, viewerId: string): boolean {
  return phase !== null && !phase.timedOut && phase.playerId === viewerId;
}

/** Part du tour restante (0 à 1) à l'instant `now` (horloge du téléphone). */
export function remainingFraction(phase: TurnPhase, now: number): number {
  if (phase.timedOut) return 0;
  return Math.min(1, Math.max(0, (phase.localDeadline - now) / phase.totalMs));
}

/**
 * Écart d'horloge serveur − téléphone, mesuré sur `serverNow` et l'heure de réception. Recalé
 * seulement si l'écart bouge de plus de `CLOCK_JITTER_MS` : une relecture régulière (toutes
 * les 3 s) ne fait ni sauter ni redémarrer les barres.
 */
export function useClockOffset(serverNow: string | undefined, receivedAt: number): number {
  const measured = serverNow && receivedAt ? Date.parse(serverNow) - receivedAt : 0;
  const value = Number.isFinite(measured) ? measured : 0;
  const [offset, setOffset] = useState(value);
  if (Math.abs(value - offset) > CLOCK_JITTER_MS) setOffset(value);
  return Math.abs(value - offset) > CLOCK_JITTER_MS ? value : offset;
}

/** Tour courant, recalculé à chaque état du serveur (relecture, action, reconnexion). */
export function useTurnPhase(
  game: GameView,
  receivedAt: number,
  dealing: boolean,
): TurnPhase | null {
  const offsetMs = useClockOffset(game.serverNow, receivedAt);
  return turnPhaseOf(game, { dealing, offsetMs });
}

const TICK_MS = 250;

/** Millisecondes restantes du tour (rafraîchies 4 fois par seconde), `null` sans tour. */
export function useRemainingMs(phase: TurnPhase | null): number | null {
  const [now, setNow] = useState(() => Date.now());
  const running = Boolean(phase && !phase.timedOut);
  useEffect(() => {
    if (!running) return;
    // Recalage immédiat au début d'un tour (l'horloge mémorisée peut dater du tour précédent).
    const first = setTimeout(() => setNow(Date.now()), 0);
    const handle = setInterval(() => setNow(Date.now()), TICK_MS);
    return () => {
      clearTimeout(first);
      clearInterval(handle);
    };
  }, [running, phase?.key]);
  if (!phase) return null;
  if (phase.timedOut) return 0;
  // Jamais plus que la durée du tour, même avant le premier recalage de l'horloge.
  return Math.min(phase.totalMs, Math.max(0, phase.localDeadline - now));
}
