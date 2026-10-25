import { usePreferencesStore, type EffectsVolume } from '../stores/preferences-store';

/**
 * Point d'entrée UNIQUE de tous les sons de l'application. Chaque son passe par
 * `playSound`, qui respecte la préférence `soundEnabled` (panneau Réglages) : aucun
 * composant ne teste la préférence lui-même.
 *
 *   UI → playSound() → soundEnabled ? → lecteur enregistré (expo-sound-player) → lecture
 *
 * Le lecteur réel (expo-audio) est branché une fois au démarrage par `installSoundPlayer`
 * (app/_layout.tsx). Sans lecteur (tests, avant le démarrage), les appels ne jouent rien.
 * Voir docs/settings.md.
 */
export type SoundName =
  | 'uiClick'
  | 'uiConfirm'
  | 'uiError'
  // Table de jeu (LOT 5) : chacun suit un état réel ou un geste du joueur, jamais un minuteur.
  /** Un lot de la distribution du serveur arrive chez son joueur. */
  | 'cardDeal'
  /** Je saisis une carte jouable de ma main. */
  | 'cardPick'
  /** Une carte jouée apparaît sur la table : elle est dans l'état du serveur (coup confirmé). */
  | 'cardPlace'
  /** Le serveur me donne la main (nouveau tour à moi). */
  | 'turnChime'
  /** Résultat annoncé : victoire du joueur désignée par le serveur. */
  | 'resultWin'
  /** Résultat annoncé : défaite, égalité ou partie arrêtée. */
  | 'resultNeutral';

/** Gain appliqué aux lecteurs pour chaque niveau de volume des effets (Réglages). */
export const EFFECTS_VOLUME_LEVELS: Record<EffectsVolume, number> = {
  low: 0.35,
  medium: 0.65,
  high: 1,
};

export interface SoundPlayer {
  play(sound: SoundName): void | Promise<void>;
  /** Volume des effets (0..1), appliqué à tous les lecteurs, présents et futurs. */
  setVolume?(volume: number): void;
  /**
   * Arrête immédiatement les sons en cours ET libère les lecteurs (appelé quand le joueur
   * passe sur OFF) : aucun lecteur ne reste actif tant que le son est coupé.
   */
  stopAll?(): void;
}

let player: SoundPlayer | null = null;

/** Branche le moteur audio réel ; `null` le débranche. */
export function registerSoundPlayer(next: SoundPlayer | null): void {
  player = next;
  applyVolume();
}

/** Transmet au lecteur le volume choisi dans les Réglages. */
function applyVolume(): void {
  try {
    player?.setVolume?.(EFFECTS_VOLUME_LEVELS[usePreferencesStore.getState().effectsVolume] ?? 1);
  } catch {
    // Un lecteur défaillant ne doit pas bloquer la préférence.
  }
}

export function isSoundEnabled(): boolean {
  return usePreferencesStore.getState().soundEnabled;
}

/**
 * Joue un son si la préférence le permet. Rend `true` si le son a été confié au lecteur.
 * Une erreur audio n'interrompt jamais l'interaction qui l'a déclenchée.
 */
export function playSound(sound: SoundName): boolean {
  if (!isSoundEnabled() || !player) return false;
  try {
    const result = player.play(sound);
    if (result instanceof Promise) result.catch(() => undefined);
    return true;
  } catch {
    return false;
  }
}

// Passage sur OFF : les sons en cours s'arrêtent aussitôt et les lecteurs sont libérés.
usePreferencesStore.subscribe((state, previous) => {
  // Volume changé (ou relu du stockage au lancement) : appliqué aussitôt aux lecteurs.
  if (state.effectsVolume !== previous.effectsVolume) applyVolume();
  if (previous.soundEnabled && !state.soundEnabled) {
    try {
      player?.stopAll?.();
    } catch {
      // Un lecteur défaillant ne doit pas bloquer la préférence.
    }
  }
});

// ---------------------------------------------------------------------------------------------
// Musique de partie : même point d'entrée que les effets, préférences distinctes
// (`musicEnabled`, `musicVolume`). Les écrans déclarent une SCÈNE, jamais une piste ni un
// lecteur ; le lecteur enregistré (expo-music-player) choisit les fichiers et évite toute
// superposition. Sans fichier musical déclaré, rien ne joue (voir docs/settings.md).
// ---------------------------------------------------------------------------------------------

/**
 * - `match` : partie en cours (thème d'entrée s'il existe, puis boucle) ;
 * - `victory` : thème court, victoire du joueur désignée par le serveur ;
 * - `roundEnd` : thème court, autre issue (défaite, égalité, partie arrêtée).
 */
export type MusicScene = 'match' | 'victory' | 'roundEnd';

/** Gains de la musique : toujours sous les effets, qui portent les informations du jeu. */
export const MUSIC_VOLUME_LEVELS: Record<EffectsVolume, number> = {
  low: 0.2,
  medium: 0.4,
  high: 0.65,
};

export interface MusicPlayer {
  /**
   * Passe à la scène demandée (`null` : silence, lecteur libéré). Même scène et même clé de
   * thème : sans effet, la musique en cours continue (aucun redémarrage à chaque rendu).
   */
  setScene(scene: MusicScene | null, themeKey?: string): void;
  setVolume?(volume: number): void;
  /** Au moins une piste musicale est déclarée. */
  hasMusic(): boolean;
}

let music: MusicPlayer | null = null;
/** Scène demandée par l'écran, gardée même musique coupée (reprise au passage sur ON). */
let requestedScene: { scene: MusicScene; themeKey?: string } | null = null;

export function registerMusicPlayer(next: MusicPlayer | null): void {
  try {
    music?.setScene(null);
  } catch {
    // Ancien lecteur déjà inutilisable.
  }
  music = next;
  applyMusicVolume();
  applyMusicScene();
}

export function isMusicEnabled(): boolean {
  return usePreferencesStore.getState().musicEnabled;
}

/** Des pistes musicales existent : sinon le réglage Musique n'est pas proposé. */
export function isMusicAvailable(): boolean {
  try {
    return music?.hasMusic() ?? false;
  } catch {
    return false;
  }
}

/** Déclare la scène musicale de l'écran ; `null` à la sortie de la partie. */
export function setMusicScene(scene: MusicScene | null, themeKey?: string): void {
  requestedScene = scene ? { scene, themeKey } : null;
  applyMusicScene();
}

function applyMusicScene(): void {
  const scene = isMusicEnabled() ? requestedScene : null;
  try {
    music?.setScene(scene?.scene ?? null, scene?.themeKey);
  } catch {
    // Une erreur audio n'interrompt jamais la partie.
  }
}

function applyMusicVolume(): void {
  try {
    music?.setVolume?.(MUSIC_VOLUME_LEVELS[usePreferencesStore.getState().musicVolume] ?? 0.4);
  } catch {
    // Un lecteur défaillant ne doit pas bloquer la préférence.
  }
}

usePreferencesStore.subscribe((state, previous) => {
  if (state.musicVolume !== previous.musicVolume) applyMusicVolume();
  if (state.musicEnabled === previous.musicEnabled) return;
  // Passage sur ON : seule la boucle de partie reprend ; un thème de résultat déjà passé ne
  // se rejoue pas à retardement.
  if (state.musicEnabled && requestedScene?.scene !== 'match') return;
  applyMusicScene();
});
