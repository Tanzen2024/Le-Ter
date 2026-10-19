import { CardGallery } from '../../src/features/games/table/CardGallery';

/**
 * Planche des cartes (développement seulement) : comparaison avec la planche de référence.
 * En production, la route n'affiche rien.
 */
export default function DevCardsScreen() {
  return __DEV__ ? <CardGallery /> : null;
}
