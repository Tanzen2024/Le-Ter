import { focusManager } from '@tanstack/react-query';
import { Platform } from 'react-native';

import { onAppForeground, onAppStateChange } from './app-lifecycle';

let installed = false;

/**
 * Premier plan de l'application = « focus » de TanStack Query (recette React Native), via le
 * cycle de vie centralisé (`app-lifecycle`) :
 * - passage en arrière-plan : focus perdu, les relectures périodiques s'arrêtent (aucune
 *   requête d'une application suspendue) ;
 * - retour RÉEL au premier plan : focus rendu ; seules les requêtes affichées et PÉRIMÉES
 *   (au-delà de leur `staleTime`) sont relues, une fois chacune (requêtes identiques
 *   dédoublonnées). `inactive` seul ne relit rien.
 * Sur le web, le comportement par défaut (visibilité de la page) est conservé.
 */
export function installAppFocusManager(): void {
  if (installed || Platform.OS === 'web') return;
  installed = true;
  focusManager.setEventListener((setFocused) => {
    const offState = onAppStateChange((state) => {
      if (state === 'background') setFocused(false);
    });
    const offForeground = onAppForeground(() => setFocused(true));
    return () => {
      offState();
      offForeground();
    };
  });
}

/** Tests : le gestionnaire peut être réinstallé. */
export function resetAppFocusManagerForTests(): void {
  installed = false;
}
