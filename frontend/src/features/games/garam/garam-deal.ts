import { useCallback, useEffect, useMemo, useState } from 'react';

import type { DealBatch } from '../../../types/game';

/**
 * Calendrier VISUEL de la distribution de GARAM TIA (D-123). Il ne décide de rien : l'état
 * officiel (mains, terre) est fixé par le serveur dès le démarrage, et le premier tour, avec
 * le temps du Ter, ne commence qu'à la confirmation de la distribution par le serveur
 * (`dealEndsAt`, D-102). Les mêmes valeurs fixent cette phase côté serveur
 * (`garamDealPhaseMs`, backend `garam-rules.ts`), plus une marge de réception de 500 ms :
 * l'animation se termine avant que le temps de décision ne commence.
 *
 * Intervalles mesurés d'un départ au suivant, dans l'ordre du serveur (`dealSequence`) :
 * - passage 1 : un lot de 2 cartes par joueur (un seul vol : les 2 cartes partent et
 *   arrivent ENSEMBLE), 600 ms entre deux joueurs ;
 * - passage 2 : la 3e carte de chaque joueur, 600 ms entre deux joueurs et avant le passage ;
 * - terre : 700 ms après la dernière carte des mains, puis une carte toutes les 700 ms.
 */
/** Premier envoi, comme la distribution du Ter. */
export const GARAM_DEAL_FIRST_MS = 250;
export const GARAM_DEAL_PLAYER_STEP_MS = 600;
export const GARAM_DEAL_PASS_PAUSE_MS = 600;
/** Vol d'une carte (360 ms, `DealFlight`) puis légère stabilisation (150 ms), comme le Ter. */
export const GARAM_DEAL_LANDING_MS = 510;
export const GARAM_DEAL_TERRE_PAUSE_MS = 700;
export const GARAM_DEAL_TERRE_STEP_MS = 700;

export type GaramDealStep = { at: number } & (
  | { kind: 'hand'; batch: DealBatch }
  | { kind: 'terre'; index: number }
);

/** Instants d'envoi de chaque carte (ms depuis le début) et fin de l'animation. */
export function garamDealSchedule(
  sequence: readonly DealBatch[],
  terreCount: number,
): { steps: GaramDealStep[]; endsAt: number } {
  const steps: GaramDealStep[] = [];
  let at = GARAM_DEAL_FIRST_MS;
  sequence.forEach((batch, i) => {
    const previous = sequence[i - 1];
    if (previous) {
      at += batch.pass !== previous.pass ? GARAM_DEAL_PASS_PAUSE_MS : GARAM_DEAL_PLAYER_STEP_MS;
    }
    steps.push({ at, kind: 'hand', batch });
  });
  for (let index = 0; index < terreCount; index++) {
    at +=
      index > 0 ? GARAM_DEAL_TERRE_STEP_MS : steps.length > 0 ? GARAM_DEAL_TERRE_PAUSE_MS : 0;
    steps.push({ at, kind: 'terre', index });
  }
  return { steps, endsAt: steps.length > 0 ? at + GARAM_DEAL_LANDING_MS : 0 };
}

/**
 * Progression de la distribution sur la table : les cartes partent une par une selon
 * `garamDealSchedule` ; `landed[playerId]` = cartes arrivées dans la main de ce joueur,
 * `terreLanded` = cartes déjà posées au terre (tête d'abord). `onDone` à la fin.
 */
export function useGaramDealProgress(
  sequence: readonly DealBatch[],
  terreCount: number,
  active: boolean,
  onDone: () => void,
) {
  // Calendrier stable tant que la séquence ne change pas : un nouveau tableau identique (vue
  // relue) ne relance pas les envois.
  const sequenceKey = JSON.stringify(sequence);
  const { steps } = useMemo(
    () => garamDealSchedule(JSON.parse(sequenceKey) as DealBatch[], terreCount),
    [sequenceKey, terreCount],
  );
  const [launched, setLaunched] = useState(0);
  const [landedCount, setLandedCount] = useState(0);

  useEffect(() => {
    if (!active) return;
    const next = steps[launched];
    if (next) {
      const previousAt = steps[launched - 1]?.at ?? 0;
      const timer = setTimeout(() => setLaunched((n) => n + 1), next.at - previousAt);
      return () => clearTimeout(timer);
    }
    const timer = setTimeout(onDone, GARAM_DEAL_LANDING_MS);
    return () => clearTimeout(timer);
  }, [active, launched, steps, onDone]);

  const landed: Record<string, number> = {};
  let terreLanded = 0;
  for (const step of steps.slice(0, landedCount)) {
    if (step.kind === 'hand') {
      landed[step.batch.playerId] = (landed[step.batch.playerId] ?? 0) + step.batch.count;
    } else {
      terreLanded += 1;
    }
  }
  /** Une carte a atterri (les vols, de même durée, arrivent dans l'ordre d'envoi). */
  const land = useCallback(() => setLandedCount((n) => n + 1), []);
  return {
    landed,
    terreLanded,
    /** Cartes en vol, avec leur rang dans le calendrier (clé stable). */
    flying: steps.slice(landedCount, launched).map((step, i) => ({ step, key: landedCount + i })),
    land,
  };
}
