/**
 * Configuration publique de l'application (aucun secret : tout ce qui est ici est lisible
 * dans le bundle mobile). Procédures de mise à jour : docs/settings.md.
 */

/**
 * Plateforme d'assistance. Aucune n'est encore choisie : laissée vide, le bouton
 * « Assistance » annonce que le service arrive, sans ouvrir d'adresse fictive.
 * Renseigner `EXPO_PUBLIC_SUPPORT_URL` (frontend/.env ou variables EAS) avec une adresse
 * https:// complète.
 */
export const SUPPORT_URL: string = (process.env.EXPO_PUBLIC_SUPPORT_URL ?? '').trim();

/**
 * Informations légales reprises dans les Conditions d'utilisation et la Politique de
 * confidentialité. `null` = encore inconnue : le document affiche un repère entre crochets
 * (« [Nom légal de l'éditeur] ») au lieu d'une valeur inventée.
 *
 * ⚠ Les documents juridiques sont des projets : ils doivent être relus et validés par un
 * professionnel du droit avant toute publication officielle.
 */
export interface LegalInfo {
  publisherName: string | null;
  address: string | null;
  email: string | null;
  /** Date de dernière mise à jour des documents, telle qu'elle doit être affichée. */
  lastUpdated: string | null;
  jurisdiction: string | null;
  minimumAge: number | null;
}

export const LEGAL_INFO: LegalInfo = {
  publisherName: null,
  address: null,
  email: null,
  lastUpdated: null,
  jurisdiction: null,
  minimumAge: null,
};
