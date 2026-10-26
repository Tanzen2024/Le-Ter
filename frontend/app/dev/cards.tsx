import { Redirect } from 'expo-router';

import { CardGallery } from '../../src/features/games/table/CardGallery';

/**
 * Planche des cartes (développement seulement) : comparaison avec la planche de référence.
 * En production, la route renvoie à l'accueil (jamais un écran vide sans issue).
 */
export default function DevCardsScreen() {
  return __DEV__ ? <CardGallery /> : <Redirect href="/" />;
}
