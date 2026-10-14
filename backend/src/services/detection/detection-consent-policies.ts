import type { GameStartPolicy } from '../game/game.service';
import type { SessionContinuationPolicy } from '../sessions/session.service';
import type { GeolocationService } from './geolocation.service';

/**
 * Consentement à la géolocalisation d'une table surveillée (D-095), branché sur le cycle de
 * vie existant des parties et des sessions. Refuser, c'est quitter la table : un joueur sans
 * consentement ne peut donc jamais être servi dans une partie surveillée.
 */
type ConsentReader = Pick<
  GeolocationService,
  'assertConsentsBeforeStart' | 'playersWithoutConsent'
>;

/** Démarrage manuel refusé (409 DETECTION_CONSENT_PENDING) tant qu'un joueur n'a pas consenti. */
export function detectionConsentStartPolicy(geolocation: ConsentReader): GameStartPolicy {
  return { assertCanStart: (game) => geolocation.assertConsentsBeforeStart(game) };
}

/**
 * Partie suivante automatique (D-042) : un joueur assis sans consentement (arrivé pendant une
 * partie en cours) est écarté par le chemin normal de départ, comme les autres écartés.
 */
export function detectionConsentContinuation(
  geolocation: ConsentReader,
): SessionContinuationPolicy {
  return {
    allowsNewGame: () => Promise.resolve(true),
    playersBarredFromNextGame: (sessionId, playerIds) =>
      geolocation.playersWithoutConsent(sessionId, playerIds),
  };
}
