import { focusManager } from '@tanstack/react-query';
import { AppState, Platform } from 'react-native';

let installed = false;

/**
 * Premier plan de l'application = « focus » de TanStack Query (recette React Native) :
 * au retour au premier plan, les requêtes affichées (la partie en cours notamment) sont
 * relues aussitôt sur le serveur ; en arrière-plan, les relectures périodiques s'arrêtent
 * (aucune requête d'une application suspendue). Sans cela, l'état n'était relu qu'au cycle
 * suivant. Sur le web, le comportement par défaut (visibilité de la page) est conservé.
 */
export function installAppFocusManager(): void {
  if (installed || Platform.OS === 'web') return;
  installed = true;
  focusManager.setEventListener((setFocused) => {
    const subscription = AppState.addEventListener('change', (state) => {
      setFocused(state === 'active');
    });
    return () => subscription.remove();
  });
}
