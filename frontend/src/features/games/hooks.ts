import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { randomUUID } from 'expo-crypto';

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

/** Parties actives du joueur (en attente ou en cours), lues sur le serveur. */
export async function fetchActiveGames(): Promise<GameView[]> {
  return (await withAccessToken((t) => gamesApi.listActive(t))).games;
}

export function useActiveGames() {
  return useQuery({ queryKey: gameKeys.active, queryFn: fetchActiveGames });
}

export function useGame(gameId: string) {
  const queryClient = useQueryClient();
  return useQuery({
    queryKey: gameKeys.detail(gameId),
    queryFn: async () => {
      const fetched = (await withAccessToken((t) => gamesApi.get(t, gameId))).game;
      // Cache lu À LA RÉCEPTION, jamais au départ de la relecture : une carte acceptée pendant
      // la relecture (réponse de l'action déjà enregistrée) n'est pas écrasée par l'état
      // d'avant, qui ramènerait l'ancien tour et son chrono.
      return newestGame(queryClient.getQueryData<GameView>(gameKeys.detail(gameId)), fetched);
    },
    enabled: isGameId(gameId),
    refetchInterval: GAME_REFRESH_MS,
  });
}

/**
 * Relecture partie AVANT une action mais reçue APRÈS sa réponse : son état (ancien tour,
 * ancienne échéance) ne remplace jamais une version plus récente déjà affichée. L'heure du
 * serveur de la réponse est gardée : elle correspond à l'heure de réception (`dataUpdatedAt`)
 * qui sert à recaler le compte à rebours.
 */
export function newestGame(cached: GameView | undefined, fetched: GameView): GameView {
  if (!cached || cached.gameId !== fetched.gameId || cached.version <= fetched.version) {
    return fetched;
  }
  return { ...cached, serverNow: fetched.serverNow ?? cached.serverNow };
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
    // Refus, état périmé ou réponse perdue (réseau coupé : la commande a pu être appliquée) :
    // la partie est relue aussitôt sur le serveur, source de vérité. Sans attendre cette
    // relecture : le refus s'affiche et les boutons se réactivent tout de suite.
    onError: () => {
      void queryClient.invalidateQueries({ queryKey: gameKeys.detail(gameId) });
    },
  });
  return {
    ...mutation,
    /**
     * Une carte se joue sur la version affichée (`expectedVersion`). « Se coucher » et « Main
     * spéciale » n'en dépendent pas : le serveur les revalide sur l'état réel ; une carte
     * jouée par un autre juste avant l'appui ne doit pas les faire échouer en silence.
     */
    send: (action: GameAction, expectedVersion?: number) =>
      mutation.mutate({
        commandId: randomUUID(),
        action,
        ...(action.type === 'PLAY_CARD' && { expectedVersion }),
      }),
  };
}
