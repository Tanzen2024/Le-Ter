import { usePreferencesStore } from '../stores/preferences-store';

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
export type SoundName = 'uiClick' | 'uiConfirm' | 'uiError';

export interface SoundPlayer {
  play(sound: SoundName): void | Promise<void>;
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
  if (previous.soundEnabled && !state.soundEnabled) {
    try {
      player?.stopAll?.();
    } catch {
      // Un lecteur défaillant ne doit pas bloquer la préférence.
    }
  }
});
