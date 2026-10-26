import { Platform } from 'react-native';

/**
 * Comportement de `KeyboardAvoidingView` commun à TOUS les écrans et panneaux (D-132) :
 * `padding` sur iOS ; `height` sur Android, où l'affichage bord à bord (toujours actif) ne
 * redimensionne pas la fenêtre à l'ouverture du clavier : sans lui, le clavier recouvrirait le
 * bas de l'écran (champs, boutons d'envoi). Une seule valeur pour que deux écrans ne réagissent
 * jamais différemment au même clavier.
 */
export const keyboardAvoidingBehavior = Platform.OS === 'ios' ? 'padding' : 'height';
