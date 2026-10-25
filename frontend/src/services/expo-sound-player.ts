import { createAudioPlayer, setAudioModeAsync } from 'expo-audio';

import {
  registerMusicPlayer,
  registerSoundPlayer,
  type SoundName,
  type SoundPlayer,
} from './audio-service';
import { createExpoMusicPlayer } from './expo-music-player';

/** Fichiers des sons (générés par scripts/generate-ui-sounds.mjs, voir docs/settings.md). */
const SOUND_SOURCES: Record<SoundName, number> = {
  uiClick: require('../../assets/audio/ui-click.wav'),
  uiConfirm: require('../../assets/audio/ui-confirm.wav'),
  uiError: require('../../assets/audio/ui-error.wav'),
  cardDeal: require('../../assets/audio/card-deal.wav'),
  cardPick: require('../../assets/audio/card-pick.wav'),
  cardPlace: require('../../assets/audio/card-place.wav'),
  turnChime: require('../../assets/audio/turn-chime.wav'),
  resultWin: require('../../assets/audio/result-win.wav'),
  resultNeutral: require('../../assets/audio/result-neutral.wav'),
};

/** Ce dont le lecteur a besoin d'un `AudioPlayer` d'expo-audio (remplaçable en test). */
export interface AudioHandle {
  play(): void;
  pause(): void;
  seekTo(seconds: number): Promise<void>;
  remove(): void;
  /** Volume du lecteur (0..1), propriété d'un `AudioPlayer` d'expo-audio. */
  volume?: number;
}

export interface ExpoSoundPlayer extends SoundPlayer {
  /** Nombre de lecteurs natifs actuellement ouverts (au plus un par son). */
  activeCount(): number;
}

/**
 * Lecteur réel des sons, au-dessus d'expo-audio :
 * - un lecteur natif PAR SON, créé à sa première lecture (jamais pour un son inutilisé),
 *   puis réutilisé : aucun doublon, y compris au retour de l'arrière-plan ;
 * - rejouer = revenir au début puis lire (un clic rapide relance le son) ;
 * - `stopAll` (passage sur OFF) met en pause ET libère tous les lecteurs ;
 * - une erreur native ne remonte jamais jusqu'à l'interface.
 */
export function createExpoSoundPlayer(
  createPlayer: (source: number) => AudioHandle = (source) => createAudioPlayer(source),
): ExpoSoundPlayer {
  const players = new Map<SoundName, AudioHandle>();
  let volume = 1;
  const applyTo = (handle: AudioHandle) => {
    try {
      handle.volume = volume;
    } catch {
      // Lecteur sans réglage de volume : il joue à son niveau.
    }
  };

  const release = (handle: AudioHandle) => {
    try {
      handle.pause();
    } catch {
      // Lecteur déjà arrêté.
    }
    try {
      handle.remove();
    } catch {
      // Lecteur déjà libéré.
    }
  };

  return {
    play(sound) {
      let handle = players.get(sound);
      if (!handle) {
        handle = createPlayer(SOUND_SOURCES[sound]);
        players.set(sound, handle);
        applyTo(handle);
      }
      try {
        handle.seekTo(0).catch(() => undefined);
        handle.play();
      } catch {
        // Lecteur inutilisable : il sera recréé à la prochaine lecture.
        players.delete(sound);
        release(handle);
      }
    },
    setVolume(next) {
      volume = Math.min(1, Math.max(0, next));
      for (const handle of players.values()) applyTo(handle);
    },
    stopAll() {
      for (const handle of players.values()) release(handle);
      players.clear();
    },
    activeCount: () => players.size,
  };
}

let installed = false;

/**
 * Branche le lecteur réel sur `playSound`, une seule fois pour toute la vie de
 * l'application (appel répété, rechargement rapide : sans effet), avec le lecteur de musique
 * de partie. Sons d'interface courts et musique :
 * ils respectent le mode silencieux d'iOS, se mélangent à la musique de l'utilisateur au lieu
 * de la couper, et ne jouent jamais en arrière-plan.
 */
export function installSoundPlayer(): void {
  if (installed) return;
  installed = true;
  setAudioModeAsync({
    playsInSilentMode: false,
    interruptionMode: 'mixWithOthers',
    shouldPlayInBackground: false,
  }).catch(() => undefined);
  registerSoundPlayer(createExpoSoundPlayer());
  // Musique de partie : même mode audio, lecteur distinct (préférences Musique distinctes).
  registerMusicPlayer(createExpoMusicPlayer());
}
