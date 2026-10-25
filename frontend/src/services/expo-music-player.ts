import { createAudioPlayer } from 'expo-audio';
import { AppState, type AppStateStatus } from 'react-native';

import type { MusicPlayer, MusicScene } from './audio-service';

/**
 * Pistes musicales de partie : composition ORIGINALE générée par synthèse
 * (`node scripts/generate-music.mjs`), aucun échantillon ni œuvre tierce. Pour les remplacer
 * par des pistes d'un compositeur (voir docs/settings.md, « Musique de partie ») : déposer les
 * fichiers dans `assets/audio/music/` sous les mêmes noms, ou changer les `require` ci-dessous.
 * Toute piste absente est simplement silencieuse.
 */
export interface MusicTheme {
  /** Thème d'entrée, joué une fois au début de la partie, avant la boucle. */
  intro?: number;
  /** Boucle de partie du générique. */
  loop: number;
}

export interface MusicTracks {
  /** Génériques de partie : un tiré au hasard à chaque nouvelle partie. */
  themes: MusicTheme[];
  victory?: number;
  roundEnd?: number;
}

export const MUSIC_TRACKS: MusicTracks = {
  themes: [
    {
      intro: require('../../assets/audio/music/theme-01-intro.m4a'),
      loop: require('../../assets/audio/music/theme-01-loop.m4a'),
    },
    {
      intro: require('../../assets/audio/music/theme-02-intro.m4a'),
      loop: require('../../assets/audio/music/theme-02-loop.m4a'),
    },
    {
      intro: require('../../assets/audio/music/theme-03-intro.m4a'),
      loop: require('../../assets/audio/music/theme-03-loop.m4a'),
    },
    {
      intro: require('../../assets/audio/music/theme-04-intro.m4a'),
      loop: require('../../assets/audio/music/theme-04-loop.m4a'),
    },
    {
      intro: require('../../assets/audio/music/theme-05-intro.m4a'),
      loop: require('../../assets/audio/music/theme-05-loop.m4a'),
    },
    {
      intro: require('../../assets/audio/music/theme-06-intro.m4a'),
      loop: require('../../assets/audio/music/theme-06-loop.m4a'),
    },
    {
      intro: require('../../assets/audio/music/theme-07-intro.m4a'),
      loop: require('../../assets/audio/music/theme-07-loop.m4a'),
    },
    {
      intro: require('../../assets/audio/music/theme-08-intro.m4a'),
      loop: require('../../assets/audio/music/theme-08-loop.m4a'),
    },
    {
      intro: require('../../assets/audio/music/theme-09-intro.m4a'),
      loop: require('../../assets/audio/music/theme-09-loop.m4a'),
    },
    {
      intro: require('../../assets/audio/music/theme-10-intro.m4a'),
      loop: require('../../assets/audio/music/theme-10-loop.m4a'),
    },
  ],
  victory: require('../../assets/audio/music/result-victory.m4a'),
  roundEnd: require('../../assets/audio/music/result-round-end.m4a'),
};

/** Ce dont le lecteur a besoin d'un `AudioPlayer` d'expo-audio (remplaçable en test). */
export interface MusicHandle {
  play(): void;
  pause(): void;
  remove(): void;
  volume?: number;
  loop?: boolean;
  playing?: boolean;
  addListener(
    event: 'playbackStatusUpdate',
    listener: (status: { didJustFinish?: boolean }) => void,
  ): { remove(): void };
}

interface AppStateLike {
  addEventListener(
    type: 'change',
    listener: (state: AppStateStatus) => void,
  ): { remove(): void };
}

/**
 * Tire le générique d'une nouvelle partie parmi `count`, jamais `previous` (le générique de la
 * partie précédente) quand il y en a au moins deux.
 */
export function pickThemeIndex(
  count: number,
  previous: number | undefined,
  random: () => number,
): number {
  if (count <= 1) return 0;
  const pool = previous === undefined ? count : count - 1;
  const drawn = Math.min(pool - 1, Math.floor(random() * pool));
  return previous !== undefined && drawn >= previous ? drawn + 1 : drawn;
}

/**
 * Lecteur de musique au-dessus d'expo-audio :
 * - UN SEUL lecteur natif ouvert à la fois : changer de scène libère le précédent avant d'en
 *   créer un autre (jamais deux pistes superposées, y compris en changeant de partie) ;
 * - même scène et même clé : sans effet (un rendu React ne relance jamais la musique) ;
 * - `match` : générique tiré au hasard pour chaque nouvelle clé (partie), jamais celui de la
 *   partie précédente ; la même partie garde son générique (reprise après Musique OFF/ON) ;
 *   thème d'entrée puis boucle ; `victory` / `roundEnd` : une fois, puis libéré ;
 * - arrière-plan : pause, reprise au retour si la scène n'a pas changé ;
 * - aucune erreur native ne remonte à l'interface.
 */
export function createExpoMusicPlayer(
  tracks: MusicTracks = MUSIC_TRACKS,
  createPlayer: (source: number) => MusicHandle = (source) => createAudioPlayer(source),
  appState: AppStateLike = AppState,
  random: () => number = Math.random,
): MusicPlayer & { activeCount(): number } {
  let scene: MusicScene | null = null;
  let themeKey: string | undefined;
  /** Générique tiré pour la dernière partie (clé). */
  let chosen: { key: string | undefined; index: number } | null = null;
  let handle: MusicHandle | null = null;
  let subscription: { remove(): void } | null = null;
  let volume = 0.4;
  let suspended = false;
  let foreground = true;

  const release = () => {
    subscription?.remove();
    subscription = null;
    if (!handle) return;
    const current = handle;
    handle = null;
    try {
      current.pause();
    } catch {
      // Lecteur déjà arrêté.
    }
    try {
      current.remove();
    } catch {
      // Lecteur déjà libéré.
    }
  };

  const start = (source: number, loop: boolean, onFinish?: () => void) => {
    release();
    suspended = false;
    try {
      const next = createPlayer(source);
      handle = next;
      next.volume = volume;
      next.loop = loop;
      subscription = next.addListener('playbackStatusUpdate', (status) => {
        // Événement d'un lecteur déjà remplacé : ignoré.
        if (!status.didJustFinish || handle !== next) return;
        if (onFinish) onFinish();
        else if (!loop) release();
      });
      if (foreground) next.play();
      else suspended = true;
    } catch {
      release();
    }
  };

  const matchTheme = (): MusicTheme | undefined => {
    if (tracks.themes.length === 0) return undefined;
    if (!chosen || chosen.key !== themeKey) {
      chosen = { key: themeKey, index: pickThemeIndex(tracks.themes.length, chosen?.index, random) };
    }
    return tracks.themes[chosen.index];
  };

  const playScene = () => {
    if (scene === 'match') {
      const theme = matchTheme();
      const loop = theme?.loop;
      if (theme?.intro !== undefined) {
        start(theme.intro, false, () => {
          if (loop !== undefined) start(loop, true);
          else release();
        });
      } else if (loop !== undefined) start(loop, true);
      else release();
    } else if (scene) {
      const source = tracks[scene];
      if (source !== undefined) start(source, false);
      else release();
    } else {
      release();
    }
  };

  appState.addEventListener('change', (state) => {
    foreground = state === 'active';
    if (!handle) return;
    try {
      if (!foreground && !suspended) {
        suspended = true;
        handle.pause();
      } else if (foreground && suspended) {
        suspended = false;
        handle.play();
      }
    } catch {
      release();
    }
  });

  return {
    setScene(nextScene, nextKey) {
      if (nextScene === scene && (nextScene !== 'match' || nextKey === themeKey)) return;
      scene = nextScene;
      themeKey = nextKey;
      playScene();
    },
    setVolume(next) {
      volume = Math.min(1, Math.max(0, next));
      try {
        if (handle) handle.volume = volume;
      } catch {
        // Lecteur sans réglage de volume.
      }
    },
    hasMusic: () =>
      tracks.themes.length > 0 ||
      tracks.victory !== undefined ||
      tracks.roundEnd !== undefined,
    activeCount: () => (handle ? 1 : 0),
  };
}
