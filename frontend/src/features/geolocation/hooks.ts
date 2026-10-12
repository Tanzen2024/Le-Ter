import { useQuery, useQueryClient } from '@tanstack/react-query';
import * as Location from 'expo-location';
import { useIsFocused } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { AppState } from 'react-native';

import { ApiError } from '../../lib/api-client';
import { geolocationApi } from '../../services/geolocation-api';
import { useGameUiStore } from '../../stores/game-ui-store';
import type { GeolocationStatus } from '../../types/geolocation';
import { withAccessToken } from '../auth/session';
import { isGameId } from '../games/hooks';

/**
 * Géolocalisation de la détection anti-collusion (R-36, étape 2, D-046), côté téléphone.
 *
 * - Le SERVEUR décide si la partie est surveillée (`suspicionDetectionEnabled` de la table)
 *   et à quelle cadence collecter. Partie non surveillée : aucune permission demandée,
 *   aucune position lue ni envoyée.
 * - Premier plan seulement : écran de la partie affiché ET application active. Aucune
 *   géolocalisation en arrière-plan.
 * - Une explication est toujours montrée avant la demande de permission native. Le refus
 *   n'est jamais transmis au serveur : la partie continue normalement, sans distances.
 * - Le téléphone n'envoie que latitude, longitude, précision et date ; il ne calcule
 *   aucune distance (elles viennent du serveur).
 */
export const geolocationKeys = {
  status: (gameId: string) => ['games', gameId, 'geolocation'] as const,
};

/** Jamais plus d'une position toutes les 30 s, quelle que soit la réponse du serveur. */
export const MIN_COLLECTION_INTERVAL_MS = 30_000;
/** Lecture GPS sans réponse au-delà de ce délai : GPS indisponible, on réessaie plus tard. */
export const POSITION_TIMEOUT_MS = 20_000;
/** Une position plus imprécise serait refusée par le serveur : elle n'est pas envoyée. */
const MAX_SENT_ACCURACY_METERS = 1_000;
/** Refus définitifs du serveur : la collecte s'arrête pour cette partie. */
const STOP_CODES = new Set([
  'DETECTION_DISABLED',
  'GAME_FINISHED',
  'NOT_A_MEMBER',
  'GAME_NOT_FOUND',
]);

/** Choix du joueur, par table, pour la durée de l'application (jamais envoyé au serveur). */
const consentByTable = new Map<string, 'accepted' | 'declined'>();

/** Réservé aux tests : oublie les choix mémorisés. */
export function resetGeolocationConsent(): void {
  consentByTable.clear();
}

/**
 * État de la géolocalisation d'UNE partie. Tant que le serveur collecte, il est relu à sa
 * cadence : les distances suivent les positions des AUTRES joueurs même si ce téléphone n'en
 * envoie pas (refus, GPS coupé). Relu aussi au retour du réseau ; arrêté dès que plus aucun
 * écran de cette partie ne l'utilise.
 */
export function useGeolocationStatus(gameId: string) {
  return useQuery({
    queryKey: geolocationKeys.status(gameId),
    queryFn: () => withAccessToken((t) => geolocationApi.status(t, gameId)),
    enabled: isGameId(gameId),
    refetchInterval: (query) => {
      const data = query.state.data;
      return data?.detectionEnabled && data.collecting
        ? Math.max(MIN_COLLECTION_INTERVAL_MS, data.collectionIntervalMs)
        : false;
    },
  });
}

/** Position du téléphone, ou rejet si le GPS ne répond pas à temps. */
function readPosition(): Promise<Location.LocationObject> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('GPS_TIMEOUT')), POSITION_TIMEOUT_MS);
    Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High }).then(
      (position) => {
        clearTimeout(timer);
        resolve(position);
      },
      (err: unknown) => {
        clearTimeout(timer);
        reject(err instanceof Error ? err : new Error('GPS_UNAVAILABLE'));
      },
    );
  });
}

/** Premier plan, sauf état explicitement « arrière-plan » (iOS peut annoncer `unknown` au lancement). */
const isForeground = (state: unknown) => state !== 'background' && state !== 'inactive';

/** Écran de la partie affiché et application au premier plan. */
export function useScreenActive(): boolean {
  const focused = useIsFocused();
  const [foreground, setForeground] = useState(() => isForeground(AppState.currentState));
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) =>
      setForeground(isForeground(state)),
    );
    return () => subscription.remove();
  }, []);
  return focused && foreground;
}

type Permission = 'unknown' | 'explain' | 'granted' | 'refused';

/**
 * Collecte des positions d'UNE partie. Renvoie `askConsent` quand l'explication doit être
 * affichée, et les choix du joueur (`accept`, `decline`).
 */
export function useGameGeolocation({
  gameId,
  tableKey,
  finished,
  active,
}: {
  gameId: string;
  /** Table (session) : l'explication n'est montrée qu'une fois par table. */
  tableKey: string;
  finished: boolean;
  active: boolean;
}) {
  const queryClient = useQueryClient();
  const status = useGeolocationStatus(gameId);
  const setLocalGps = useGameUiStore((s) => s.setLocalGps);
  // Un refus déjà exprimé pour cette table est respecté : aucune nouvelle explication.
  const [permission, setPermission] = useState<Permission>(() =>
    consentByTable.get(tableKey) === 'declined' ? 'refused' : 'unknown',
  );
  const [stopped, setStopped] = useState(false);

  const server: GeolocationStatus | undefined = status.data;
  const watched = server?.detectionEnabled === true && server.collecting && !finished && !stopped;
  const intervalMs = Math.max(
    MIN_COLLECTION_INTERVAL_MS,
    server?.detectionEnabled ? server.collectionIntervalMs : 0,
  );

  // Permission : lue sans jamais la demander ; l'explication précède toute demande native.
  useEffect(() => {
    if (!watched || permission !== 'unknown') return;
    let cancelled = false;
    Location.getForegroundPermissionsAsync()
      .then((current) => {
        if (cancelled) return;
        if (current.granted && consentByTable.get(tableKey) === 'accepted') {
          setPermission('granted');
        } else if (current.granted || current.canAskAgain) {
          setPermission('explain');
        } else {
          setPermission('refused');
        }
      })
      .catch(() => {
        if (!cancelled) setPermission('refused');
      });
    return () => {
      cancelled = true;
    };
  }, [watched, permission, tableKey]);

  const accept = useCallback(() => {
    consentByTable.set(tableKey, 'accepted');
    Location.requestForegroundPermissionsAsync()
      .then((answer) => setPermission(answer.granted ? 'granted' : 'refused'))
      .catch(() => setPermission('refused'));
  }, [tableKey]);

  const decline = useCallback(() => {
    // Le refus reste sur le téléphone : aucun appel, aucun signal, aucune pénalité.
    consentByTable.set(tableKey, 'declined');
    setPermission('refused');
  }, [tableKey]);

  // État GPS local (affichage des distances indisponibles), propre à CETTE partie et
  // oublié à la sortie de la partie.
  const refused = watched && permission === 'refused';
  useEffect(() => {
    if (refused) setLocalGps(gameId, 'refused');
    else setLocalGps(gameId, null);
  }, [refused, gameId, setLocalGps]);
  useEffect(() => () => setLocalGps(gameId, null), [gameId, setLocalGps]);

  // Collecte : tout de suite, puis à la cadence du serveur, tant que tout est réuni.
  const collecting = watched && active && permission === 'granted';
  useEffect(() => {
    if (!collecting) return;
    let cancelled = false;
    const tick = async () => {
      let position: Location.LocationObject;
      try {
        position = await readPosition();
      } catch {
        // GPS coupé, refusé par le système en cours de partie ou sans réponse : rien n'est
        // envoyé, jamais de position fictive ; on réessaie au prochain intervalle.
        if (!cancelled) setLocalGps(gameId, 'unavailable');
        return;
      }
      if (cancelled) return;
      const { latitude, longitude, accuracy } = position.coords;
      if (accuracy == null || accuracy <= 0 || accuracy > MAX_SENT_ACCURACY_METERS) {
        // Position trop imprécise : le serveur la refuserait, elle n'est pas envoyée.
        setLocalGps(gameId, 'unavailable');
        return;
      }
      setLocalGps(gameId, null);
      try {
        const { distances } = await withAccessToken((t) =>
          geolocationApi.sendPosition(t, gameId, {
            latitude,
            longitude,
            accuracy,
            capturedAt: position.timestamp,
          }),
        );
        if (cancelled) return;
        queryClient.setQueryData<GeolocationStatus>(geolocationKeys.status(gameId), (old) =>
          old?.detectionEnabled ? { ...old, distances } : old,
        );
      } catch (err) {
        if (cancelled) return;
        if (err instanceof ApiError && STOP_CODES.has(err.code)) {
          setStopped(true);
          void queryClient.invalidateQueries({
            queryKey: geolocationKeys.status(gameId),
          });
        }
        // Autre panne (réseau, serveur) : on réessaie au prochain intervalle.
      }
    };
    void tick();
    const timer = setInterval(() => void tick(), intervalMs);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [collecting, intervalMs, gameId, queryClient, setLocalGps]);

  return { askConsent: watched && permission === 'explain', accept, decline };
}
