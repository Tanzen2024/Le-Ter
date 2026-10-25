import { useEffect, useRef } from 'react';

import { ApiError } from '../../lib/api-client';
import { playSound, setMusicScene, type MusicScene } from '../../services/audio-service';
import type { GameView } from '../../types/game';

/**
 * Sons de la table qui suivent un CHANGEMENT d'état du serveur (LOT 5). Règles communes :
 * - l'état présent à l'ouverture de l'écran (arrivée, reconnexion, reprise) ne joue rien :
 *   seul un changement observé pendant que l'écran est ouvert déclenche un son ;
 * - un nouveau rendu avec le même état ne rejoue jamais un son ;
 * - aucun minuteur : le son est joué au moment où le nouvel état est reçu ;
 * - `playSound` respecte la préférence et n'interrompt jamais le jeu en cas d'erreur audio.
 */

/**
 * Identité de « mon tour » selon le serveur : il m'autorise à jouer (`canPlayCard`) pour CE
 * tour (échéance fixée par le serveur). `null` quand ce n'est pas à moi, pendant la
 * distribution, ou hors partie en cours.
 */
export function myTurnKeyOf(game: GameView, dealing: boolean): string | null {
  if (dealing || game.status !== 'in_progress' || game.dealEndsAt) return null;
  if (!game.myActions.canPlayCard) return null;
  return `${game.gameId}|${game.turnDeadlineAt ?? game.turnStartedAt ?? 'tour'}`;
}

/** Petite cloche quand le serveur me donne la main ; une seule fois par tour. */
export function useMyTurnSound(game: GameView, dealing: boolean): void {
  const key = myTurnKeyOf(game, dealing);
  // Valeur de départ = état à l'ouverture : il ne sonne pas.
  const previous = useRef(key);
  useEffect(() => {
    if (key && key !== previous.current) playSound('turnChime');
    previous.current = key;
  }, [key]);
}

/**
 * Son d'erreur quand le SERVEUR refuse une action (coup, fuite, main spéciale). Un conflit
 * de version n'est pas un refus (la partie est relue en silence) et une coupure réseau n'est
 * pas une décision du serveur : ni l'un ni l'autre ne sonne. Une même erreur ne sonne qu'une fois.
 */
export function useRefusalSound(error: unknown): void {
  const previous = useRef(error);
  useEffect(() => {
    const fresh = error !== previous.current;
    previous.current = error;
    if (fresh && error instanceof ApiError && error.code !== 'VERSION_CONFLICT') {
      playSound('uiError');
    }
  }, [error]);
}

/** Son du résultat, choisi uniquement d'après le résultat officiel du serveur. */
export function resultSoundOf(game: GameView): 'resultWin' | 'resultNeutral' {
  return game.result?.winnerId === game.viewerId ? 'resultWin' : 'resultNeutral';
}

/**
 * Son du résultat au moment où il est ANNONCÉ à l'écran (`announced`, après la présentation
 * des dernières cartes), et seulement si la partie a été vue en cours sur cet écran : rouvrir
 * une partie déjà terminée ne rejoue rien.
 */
export function useResultSound(game: GameView, announced: boolean): void {
  const sawLive = useRef(game.status !== 'finished');
  const played = useRef(false);
  useEffect(() => {
    if (game.status !== 'finished') sawLive.current = true;
  }, [game.status]);
  useEffect(() => {
    if (!announced || played.current || !sawLive.current) return;
    played.current = true;
    playSound(resultSoundOf(game));
  }, [announced, game]);
}

/**
 * Scène musicale d'après l'état du serveur :
 * - partie en cours (distribution comprise) : `match` ; elle continue pendant la présentation
 *   des dernières cartes d'une partie terminée vue en cours sur cet écran ;
 * - résultat annoncé : `victory` si le serveur me désigne gagnant, sinon `roundEnd` (même
 *   choix que le son du résultat, jamais calculé ici) ;
 * - salle d'attente, ou partie déjà terminée à l'ouverture de l'écran : silence.
 */
export function musicSceneOf(
  game: GameView,
  announced: boolean,
  sawLive: boolean,
): MusicScene | null {
  if (game.status === 'in_progress') return 'match';
  if (game.status !== 'finished' || !sawLive) return null;
  if (!announced) return 'match';
  return resultSoundOf(game) === 'resultWin' ? 'victory' : 'roundEnd';
}

/**
 * Musique de la table : déclare la scène au service audio, qui ne relance rien tant qu'elle
 * ne change pas (un rendu ne redémarre jamais la musique) et n'ouvre jamais deux pistes. La
 * clé de thème est la partie (`gameId`) : chaque nouvelle partie tire un autre générique au
 * hasard, la même partie garde le sien. Sortie de l'écran : silence.
 */
export function useGameMusic(game: GameView, announced: boolean): void {
  const sawLive = useRef(game.status !== 'finished');
  const themeKey = game.gameId;
  const iWon = resultSoundOf(game) === 'resultWin';
  useEffect(() => {
    if (game.status !== 'finished') sawLive.current = true;
    setMusicScene(musicSceneOf(game, announced, sawLive.current), themeKey);
    // `game` complet exclu : seuls ces champs décident de la scène.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [game.status, announced, iWon, themeKey]);
  useEffect(() => () => setMusicScene(null), []);
}
