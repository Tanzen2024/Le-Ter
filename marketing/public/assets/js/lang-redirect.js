import { chooseLanguage } from './lib.js';

/**
 * Page racine uniquement : ouvre la version de la langue choisie. Ordre : choix mémorisé par
 * le sélecteur FR | EN (site.js), sinon première langue fr/en du navigateur, sinon le
 * français. Garde ?ref= (lien de parrainage) et #section. Les pages /fr/ et /en/ ne chargent
 * jamais ce script : aucune boucle de redirection, accès direct toujours possible.
 */
let stored = null;
try {
  stored = window.localStorage.getItem('leter-language');
} catch {
  // Stockage indisponible (navigation privée) : on s'en tient au navigateur.
}
const languages = navigator.languages?.length ? navigator.languages : [navigator.language];
const language = chooseLanguage(stored, languages);
window.location.replace(`${language}/${window.location.search}${window.location.hash}`);
