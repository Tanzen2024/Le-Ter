import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import * as Location from 'expo-location';
import { router, useIsFocused } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';

import { ApiError, userErrorMessage } from '../../lib/api-client';
import { useAppState } from '../../lib/app-lifecycle';
import { geolocationApi } from '../../services/geolocation-api';
import { useGameUiStore } from '../../stores/game-ui-store';
import type { GeolocationStatus } from '../../types/geolocation';
import { withAccessToken } from '../auth/session';
import { gameKeys, isGameId } from '../games/hooks';
import { useLeaveSession } from '../sessions/hooks';

/**
 * Géolocalisation de la détection anti-collusion (R-36, étape 2, D-046), côté téléphone.
 *
 * - Le SERVEUR décide si la partie est surveillée (`suspicionDetectionEnabled` de la table)
 *   et à quelle cadence collecter. Partie non surveillée : aucune permission demandée,
 *   aucune position lue ni envoyée.
 * - Premier plan seulement : écran de la partie affiché ET application active. Aucune
 *   géolocalisation en arrière-plan.
 * - Une explication est toujours montrée avant la demande de permission native. Le
 *   consentement (« Continuer ») est ENREGISTRÉ PAR LE SERVEUR pour la participation du joueur
 *   à la table (D-095) : il est relu du serveur à chaque ouverture, jamais déduit d'un état
 *   local. Refuser (« Non merci »), c'est quitter la table (`useDeclineAndLeave`).
 * - Consentement donné mais permission système refusée : le joueur joue normalement, sans
 *   position envoyée ; ses distances affichent « Localisation refusée » (D-046).
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
/** Lecture en échec : nouvel essai après ce délai (sans attendre toute la cadence du serveur). */
export const GPS_RETRY_MS = 15_000;
/**
 * Dernière position connue du système acceptée si elle a moins de 60 s : réponse immédiate en
 * intérieur, où une nouvelle mesure peut prendre longtemps. C'est une vraie mesure du
 * téléphone, datée de sa capture (le serveur refuse au-delà de 2 min).
 */
export const LAST_KNOWN_MAX_AGE_MS = 60_000;
/** Une position plus imprécise serait refusée par le serveur : elle n'est pas envoyée. */
const MAX_SENT_ACCURACY_METERS = 1_000;
/** Refus définitifs du serveur : la collecte s'arrête pour cette partie. */
const STOP_CODES = new Set([
  'DETECTION_DISABLED',
  'GAME_FINISHED',
  'NOT_A_MEMBER',
  'GAME_NOT_FOUND',
]);

/**
 * Tables où la permission système a déjà été demandée pendant cette exécution : un refus
 * n'est pas redemandé à chaque partie de la même table. Ce n'est PAS le consentement (serveur).
 */
const permissionAskedByTable = new Set<string>();

/** Réservé aux tests : oublie les demandes de permission mémorisées. */
export function resetGeolocationConsent(): void {
  permissionAskedByTable.clear();
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

/** Pourquoi la position n'a pas pu être lue (diagnostic local, jamais envoyé). */
export class GpsReadError extends Error {
  constructor(readonly reason: 'SERVICES_OFF' | 'TIMEOUT' | 'UNAVAILABLE') {
    super(reason);
    this.name = 'GpsReadError';
  }
}

/**
 * Position du téléphone : services de localisation vérifiés d'abord (désactivés = cause
 * distincte), puis dernière position récente du système, sinon nouvelle mesure en précision
 * « équilibrée » (réseau + GPS, environ 100 m) : la précision « haute » (GPS seul) n'aboutit
 * souvent pas en intérieur dans le délai, d'où « GPS indisponible » en permanence.
 */
async function readPosition(): Promise<Location.LocationObject> {
  let servicesOn = true;
  try {
    servicesOn = await Location.hasServicesEnabledAsync();
  } catch {
    // Vérification impossible : la lecture dira elle-même si la position est disponible.
  }
  if (!servicesOn) throw new GpsReadError('SERVICES_OFF');
  try {
    const last = await Location.getLastKnownPositionAsync({
      maxAge: LAST_KNOWN_MAX_AGE_MS,
      requiredAccuracy: MAX_SENT_ACCURACY_METERS,
    });
    if (last) return last;
  } catch {
    // Pas de position en cache : nouvelle mesure.
  }
  return freshPosition();
}

/** Nouvelle mesure, ou rejet si elle ne répond pas à temps. */
function freshPosition(): Promise<Location.LocationObject> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new GpsReadError('TIMEOUT')), POSITION_TIMEOUT_MS);
    Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced }).then(
      (position) => {
        clearTimeout(timer);
        resolve(position);
      },
      (err: unknown) => {
        clearTimeout(timer);
        // Android rejette notamment quand la localisation est coupée pendant la mesure.
        if (__DEV__) {
          console.info('[gps] mesure refusée par le système', {
            code: (err as { code?: unknown } | null)?.code,
          });
        }
        reject(new GpsReadError('UNAVAILABLE'));
      },
    );
  });
}

/** Premier plan, sauf état explicitement « arrière-plan » (iOS peut annoncer `unknown` au lancement). */
const isForeground = (state: unknown) => state !== 'background' && state !== 'inactive';

/** Écran de la partie affiché et application au premier plan. */
export function useScreenActive(): boolean {
  const focused = useIsFocused();
  const foreground = isForeground(useAppState());
  return focused && foreground;
}

type Permission = 'unknown' | 'granted' | 'refused';

/**
 * Collecte des positions d'UNE partie. Renvoie `askConsent` tant que le serveur n'a pas
 * enregistré le consentement du joueur (explication bloquante), et `accept` : consentement
 * envoyé au serveur, confirmé, PUIS permission système demandée. Aucune position n'est lue
 * avant la confirmation du serveur.
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
  const [permission, setPermission] = useState<Permission>('unknown');
  const [stopped, setStopped] = useState(false);

  const server: GeolocationStatus | undefined = status.data;
  const watched = server?.detectionEnabled === true && server.collecting && !finished && !stopped;
  const consentGiven = server?.detectionEnabled === true && server.consentGiven === true;

  // Consentement : enregistré par le serveur, jamais supposé. Un seul envoi à la fois.
  const consent = useMutation({
    mutationFn: () => withAccessToken((t) => geolocationApi.consent(t, gameId)),
    onSuccess: (confirmed) => {
      queryClient.setQueryData(geolocationKeys.status(gameId), confirmed);
    },
  });
  const intervalMs = Math.max(
    MIN_COLLECTION_INTERVAL_MS,
    server?.detectionEnabled ? server.collectionIntervalMs : 0,
  );

  // Permission système : seulement APRÈS le consentement confirmé par le serveur. Demandée
  // une fois par table (l'explication a été acceptée) ; ensuite seulement lue.
  useEffect(() => {
    if (!watched || !consentGiven || permission !== 'unknown') return;
    let cancelled = false;
    const settle = (granted: boolean) => {
      if (!cancelled) setPermission(granted ? 'granted' : 'refused');
    };
    Location.getForegroundPermissionsAsync()
      .then((current) => {
        if (current.granted || !current.canAskAgain || permissionAskedByTable.has(tableKey)) {
          settle(current.granted);
          return;
        }
        permissionAskedByTable.add(tableKey);
        return Location.requestForegroundPermissionsAsync().then((answer) =>
          settle(answer.granted),
        );
      })
      .catch(() => settle(false));
    return () => {
      cancelled = true;
    };
  }, [watched, consentGiven, permission, tableKey]);

  // Permission refusée puis accordée dans les réglages Android : relue (jamais redemandée)
  // au retour sur l'écran de jeu, sans boucle de demandes.
  useEffect(() => {
    if (!active || permission !== 'refused' || !watched) return;
    let cancelled = false;
    Location.getForegroundPermissionsAsync()
      .then((current) => {
        if (!cancelled && current.granted) setPermission('granted');
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [active, permission, watched]);

  // Double appui : un seul envoi tant que le premier n'a pas répondu (le serveur est en plus
  // idempotent). Le verrou est synchrone : deux appuis dans la même image n'envoient qu'un appel.
  const { mutate: sendConsent } = consent;
  const sending = useRef(false);
  const accept = useCallback(() => {
    if (sending.current) return;
    sending.current = true;
    sendConsent(undefined, {
      onSettled: () => {
        sending.current = false;
      },
    });
  }, [sendConsent]);

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
    let timer: ReturnType<typeof setTimeout> | undefined;
    let located = false;
    const next = (ms: number) => {
      if (!cancelled) timer = setTimeout(() => void tick(), ms);
    };
    const tick = async () => {
      // Première mesure en cours : « Recherche GPS… », jamais « en attente » sans cause.
      if (!located) setLocalGps(gameId, 'acquiring');
      let position: Location.LocationObject;
      try {
        position = await readPosition();
      } catch (err) {
        // Localisation coupée, refusée par le système en cours de partie ou sans réponse :
        // rien n'est envoyé, jamais de position fictive ; nouvel essai bientôt.
        if (cancelled) return;
        const off = err instanceof GpsReadError && err.reason === 'SERVICES_OFF';
        setLocalGps(gameId, off ? 'services-off' : 'unavailable');
        next(GPS_RETRY_MS);
        return;
      }
      if (cancelled) return;
      const { latitude, longitude, accuracy } = position.coords;
      if (accuracy == null || accuracy <= 0 || accuracy > MAX_SENT_ACCURACY_METERS) {
        // Position trop imprécise : le serveur la refuserait, elle n'est pas envoyée.
        setLocalGps(gameId, 'unavailable');
        next(GPS_RETRY_MS);
        return;
      }
      located = true;
      setLocalGps(gameId, null);
      next(intervalMs);
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
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [collecting, intervalMs, gameId, queryClient, setLocalGps]);

  return {
    /** Explication bloquante : table surveillée, consentement pas encore confirmé. */
    askConsent: watched && !consentGiven,
    accept,
    accepting: consent.isPending,
    /** Échec de l'enregistrement : le panneau reste affiché, « Continuer » réessaie. */
    acceptError: consent.error,
  };
}

/**
 * Départ non confirmé : jamais une fausse confirmation. Refus du serveur : son message ;
 * erreur système : rien à l'écran (D-168).
 */
export function departureFailureMessage(error: unknown): string {
  return userErrorMessage(error) ?? '';
}

/**
 * « Non merci » (D-095) : refuser la localisation, c'est QUITTER la table. Départ réel par
 * l'API existante (`POST /api/sessions/:id/leave`, idempotente côté serveur) :
 * - un seul départ à la fois (double appui ignoré) ;
 * - confirmé par le serveur : retour au panneau Partie privée (création / recherche de
 *   partie), que le joueur soit ou non le créateur de la table ; à la
 *   disparition de l'écran, l'état local de CETTE partie seule est oublié (requêtes
 *   ['games', gameId] dont chat et géolocalisation, état d'interface) ; les relectures, le
 *   chat temps réel et les minuteries de l'écran s'arrêtent avec lui ;
 * - échec (réseau, refus) : aucune navigation, l'erreur est rendue et le panneau reste
 *   affiché : la partie n'est pas accessible tant que le départ n'est pas confirmé.
 */
export function useDeclineAndLeave(game: { gameId: string; sessionId?: string | null }) {
  const queryClient = useQueryClient();
  const forgetGame = useGameUiStore((s) => s.forgetGame);
  const { mutateAsync: leaveSession } = useLeaveSession();
  const [leaving, setLeaving] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const inFlight = useRef(false);
  const left = useRef(false);
  const { gameId, sessionId } = game;

  useEffect(
    () => () => {
      if (!left.current) return;
      void queryClient.cancelQueries({ queryKey: gameKeys.detail(gameId) });
      queryClient.removeQueries({ queryKey: gameKeys.detail(gameId) });
      void queryClient.invalidateQueries({ queryKey: gameKeys.active });
      forgetGame(gameId);
    },
    [queryClient, forgetGame, gameId],
  );

  const decline = useCallback(async () => {
    if (inFlight.current || left.current) return;
    inFlight.current = true;
    setLeaving(true);
    setError(null);
    try {
      if (!sessionId) throw new Error('Partie sans table : départ impossible.');
      await leaveSession(sessionId);
      left.current = true;
      router.dismissTo({ pathname: '/', params: { panel: 'private' } });
    } catch (err) {
      setError(err);
    } finally {
      inFlight.current = false;
      setLeaving(false);
    }
  }, [leaveSession, sessionId]);

  return {
    decline,
    leaving,
    error: error ? departureFailureMessage(error) : null,
  };
}
