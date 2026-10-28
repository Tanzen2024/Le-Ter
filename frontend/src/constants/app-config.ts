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
/** Texte identique dans toutes les langues, ou traduit (« Cameroun » / « Cameroon »). */
export type LegalText = string | { fr: string; en: string };

export interface LegalInfo {
  publisherName: LegalText | null;
  address: LegalText | null;
  email: string | null;
  /** Date de dernière mise à jour des documents, telle qu'elle doit être affichée. */
  lastUpdated: LegalText | null;
  jurisdiction: LegalText | null;
  minimumAge: number | null;
}

/** Informations fournies par le propriétaire du projet le 26/10/2026 (validation juridique à faire). */
export const LEGAL_INFO: LegalInfo = {
  publisherName: 'LAMAT',
  address: { fr: 'Douala, Cameroun', en: 'Douala, Cameroon' },
  email: 'hugueslamat16@gmail.com',
  lastUpdated: { fr: '26 octobre 2026', en: '26 October 2026' },
  /** Lu après « soumises au droit de » / « governed by the law of ». */
  jurisdiction: { fr: 'la République du Cameroun', en: 'the Republic of Cameroon' },
  minimumAge: 18,
};
