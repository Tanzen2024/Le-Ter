import { Stack } from 'expo-router';

import { colors } from '../../src/constants/theme';

/**
 * Pile d'authentification : `login` est l'écran d'entrée, `register` est empilé par-dessus
 * via « S'inscrire » et retiré par « Se connecter » (ou le bouton retour Android). Le fond
 * opaque couleur tapis évite que l'écran du dessous transparaisse pendant les transitions.
 */
export default function AuthLayout() {
  return (
    <Stack
      screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.felt } }}
    >
      <Stack.Screen name="login" />
      <Stack.Screen name="register" />
    </Stack>
  );
}
