import { Stack } from 'expo-router';

import { stableStackScreenOptions } from '../../src/features/navigation/stack-options';

/**
 * Pile d'authentification : `login` est l'écran d'entrée, `register` est empilé par-dessus
 * via « S'inscrire » et retiré par « Se connecter » (ou le bouton retour Android). Mêmes
 * transition et fond opaque que la pile racine : l'écran du dessous ne transparaît pas.
 */
export default function AuthLayout() {
  return (
    <Stack screenOptions={stableStackScreenOptions}>
      <Stack.Screen name="login" />
      <Stack.Screen name="register" />
      {/* « Mot de passe oublié ? » (D-135) : empilé depuis la connexion. */}
      <Stack.Screen name="forgot-password" />
    </Stack>
  );
}
