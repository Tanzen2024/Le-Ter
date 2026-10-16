import type { UseQueryResult } from '@tanstack/react-query';
import { useCallback, useState } from 'react';

import { ApiError } from '../../lib/api-client';
import { useAppForeground } from '../../lib/app-lifecycle';
import type { ReconnectionState } from './ReconnectionPanel';

/**
 * Échecs CONSÉCUTIFS de relecture avant de proposer « Réessayer » (la relecture automatique
 * continue toutes les 3 s). Compté sur les réponses réelles, jamais sur une durée.
 */
export const FAILURES_BEFORE_RETRY_PROMPT = 3;

/** Serveur injoignable ou indisponible (réseau coupé, redémarrage) : rien n'est perdu. */
export function isConnectivityError(error: unknown): boolean {
  return error instanceof ApiError && (error.status === 0 || error.status >= 500);
}

/**
 * Reconnexion de l'écran d'UNE partie. La partie ne dépend jamais du téléphone : pendant
 * l'absence, le serveur joue les cartes à l'échéance (D-034, D-036). Ce hook ne fait que
 * RELIRE l'état autoritaire et dire à l'écran s'il est périmé :
 *
 * - retour au premier plan (`background` → `active`) : relecture immédiate ; « restauration »
 *   jusqu'à la première réponse POSTÉRIEURE au retour ;
 * - arrivée par la reprise automatique (`resume`) : « restauration » jusqu'au premier état reçu ;
 * - relecture en échec (réseau, serveur redémarré) alors que la table est affichée :
 *   « restauration », puis « échec » avec Réessayer après plusieurs échecs consécutifs.
 *
 * L'état affiché n'est jamais reconstruit localement : seul le serveur le fournit, et une
 * réponse plus ancienne que le cache n'écrase jamais une version plus récente (useStoreGame).
 */
export function useGameReconnection(
  game: Pick<
    UseQueryResult<unknown>,
    'data' | 'error' | 'isFetching' | 'dataUpdatedAt' | 'errorUpdatedAt' | 'refetch'
  >,
  options: { resume?: boolean } = {},
): { state: ReconnectionState | null; retry: () => void } {
  const [resumedAt, setResumedAt] = useState<number | null>(null);
  const { refetch } = game;

  // Retour RÉEL au premier plan (`inactive` seul n'est pas une absence) : l'état officiel est
  // relu. `cancelRefetch: false` rejoint la relecture déjà lancée par le focus de TanStack
  // Query au lieu de l'annuler : UNE requête par retour, jamais deux.
  useAppForeground(() => {
    setResumedAt(Date.now());
    void refetch({ cancelRefetch: false });
  });

  // Échecs consécutifs : un par réponse en erreur, remis à zéro par une réponse réussie.
  // État ajusté pendant le rendu, quand les dates de réponse de la requête changent.
  const [tracked, setTracked] = useState({
    dataAt: game.dataUpdatedAt,
    errorAt: game.errorUpdatedAt,
    failures: 0,
  });
  if (tracked.dataAt !== game.dataUpdatedAt || tracked.errorAt !== game.errorUpdatedAt) {
    const succeeded = tracked.dataAt !== game.dataUpdatedAt;
    const failed =
      tracked.errorAt !== game.errorUpdatedAt && game.errorUpdatedAt > game.dataUpdatedAt;
    setTracked({
      dataAt: game.dataUpdatedAt,
      errorAt: game.errorUpdatedAt,
      failures: (succeeded ? 0 : tracked.failures) + (failed ? 1 : 0),
    });
  }
  const failures = tracked.failures;

  const retry = useCallback(() => void refetch(), [refetch]);

  const hasData = game.data !== undefined;
  const failing =
    hasData && game.errorUpdatedAt > game.dataUpdatedAt && isConnectivityError(game.error);
  const resuming = resumedAt !== null && game.dataUpdatedAt < resumedAt;
  const initialResume = options.resume === true && !hasData && !game.error;

  let state: ReconnectionState | null = null;
  if (failing) {
    state = failures >= FAILURES_BEFORE_RETRY_PROMPT && !game.isFetching ? 'failed' : 'restoring';
  } else if (resuming || initialResume) {
    state = 'restoring';
  }
  return { state, retry };
}

/**
 * Contenu de l'écran d'une partie. Les DONNÉES passent avant l'erreur : une relecture
 * échouée (réseau coupé) garde la table affichée sous le panneau « Reconnexion » au lieu de la
 * remplacer par un message ; sans données, un serveur injoignable propose de réessayer (la
 * partie continue côté serveur) ; un refus (non membre, introuvable) affiche son message,
 * sans navigation forcée.
 */
export type GameScreenContent = 'table' | 'retry' | 'message' | 'restoring' | 'loading';

export function gameScreenContent(game: {
  hasData: boolean;
  error: unknown;
  reconnecting: boolean;
}): GameScreenContent {
  if (game.hasData) return 'table';
  if (game.error) return isConnectivityError(game.error) ? 'retry' : 'message';
  return game.reconnecting ? 'restoring' : 'loading';
}
