import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { randomUUID } from 'expo-crypto';

import { ApiError } from '../../lib/api-client';
import { gamesApi } from '../../services/games-api';
import type { GameAction, GameView } from '../../types/game';
import { withAccessToken } from '../auth/session';

/**
 * Clés TanStack Query, toujours paramétrées par gameId (D-017) : deux parties ont deux
 * entrées de cache distinctes, il n'existe pas de « partie courante ».
 */
export const gameKeys = {
  active: ['games', 'active'] as const,
  detail: (gameId: string) => ['games', gameId] as const,
};

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** Un gameId venant d'une route ou d'une saisie n'est utilisé que s'il est valide. */
export function isGameId(value: unknown): value is string {
  return typeof value === 'string' && UUID_PATTERN.test(value);
}

/**
 * Sans temps réel (phase D), l'état est relu régulièrement tant que l'écran est monté.
 * Les événements WebSocket remplaceront ce rafraîchissement.
 */
const GAME_REFRESH_MS = 3_000;

export function useActiveGames() {
  return useQuery({
    queryKey: gameKeys.active,
    queryFn: async () => (await withAccessToken((t) => gamesApi.listActive(t))).games,
  });
}

export function useGame(gameId: string) {
  return useQuery({
    queryKey: gameKeys.detail(gameId),
    queryFn: async () => (await withAccessToken((t) => gamesApi.get(t, gameId))).game,
    enabled: isGameId(gameId),
    refetchInterval: GAME_REFRESH_MS,
  });
}

/** Met à jour le cache d'UNE partie, sans jamais revenir à une version plus ancienne. */
function useStoreGame() {
  const queryClient = useQueryClient();
  return (game: GameView) => {
    queryClient.setQueryData<GameView>(gameKeys.detail(game.gameId), (cached) =>
      cached && cached.version > game.version ? cached : game,
    );
    void queryClient.invalidateQueries({ queryKey: gameKeys.active });
  };
}

/** Capacités proposées à la création (R-23) : un maximum, pas un minimum pour démarrer. */
export const MAX_PLAYER_CHOICES = [2, 3, 4] as const;
export type MaxPlayers = (typeof MAX_PLAYER_CHOICES)[number];

/** Minimum de joueurs pour démarrer (R-23), quelle que soit la capacité choisie. */
export const MIN_PLAYERS_TO_START = 2;

/** Démarrer la partie (créateur seulement) ; un commandId par intention. */
export function useStartGame(gameId: string) {
  const storeGame = useStoreGame();
  const queryClient = useQueryClient();
  const mutation = useMutation({
    mutationFn: async (commandId: string) =>
      (await withAccessToken((t) => gamesApi.start(t, gameId, commandId))).game,
    onSuccess: storeGame,
    // Démarrée entre-temps ou refusée : on relit l'état réel.
    onError: () => queryClient.invalidateQueries({ queryKey: gameKeys.detail(gameId) }),
  });
  return { ...mutation, start: () => mutation.mutate(randomUUID()) };
}

export function useJoinGame() {
  const storeGame = useStoreGame();
  return useMutation({
    mutationFn: async (gameId: string) =>
      (await withAccessToken((t) => gamesApi.join(t, gameId))).game,
    onSuccess: storeGame,
  });
}

interface GameCommand {
  commandId: string;
  action: GameAction;
  expectedVersion?: number;
}

/**
 * Action de jeu sur UNE partie. `send` crée le commandId une seule fois par intention du
 * joueur ; il fait partie des variables de la mutation, donc un renvoi
 * (`mutate(variables)` ou le nouvel essai après rafraîchissement du jeton) réutilise le
 * même et le serveur ne l'applique qu'une fois.
 */
export function useGameAction(gameId: string) {
  const storeGame = useStoreGame();
  const queryClient = useQueryClient();
  const mutation = useMutation({
    mutationFn: async (command: GameCommand) =>
      (await withAccessToken((t) => gamesApi.act(t, gameId, command))).game,
    onSuccess: storeGame,
    onError: (err) => {
      // État périmé : on relit la partie depuis le serveur, source de vérité.
      if (err instanceof ApiError && err.code === 'VERSION_CONFLICT') {
        void queryClient.invalidateQueries({ queryKey: gameKeys.detail(gameId) });
      }
    },
  });
  return {
    ...mutation,
    send: (action: GameAction, expectedVersion?: number) =>
      mutation.mutate({ commandId: randomUUID(), action, expectedVersion }),
  };
}
