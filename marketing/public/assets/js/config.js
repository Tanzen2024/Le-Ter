/**
 * Configuration publique du site vitrine LeTer.
 *
 * Tout ce fichier est lisible par les visiteurs : n'y mettez JAMAIS de secret, de jeton,
 * d'URL de base de données ou d'adresse d'administration.
 *
 * Règle : une valeur vide ('') signifie « pas encore disponible ». Le site affiche alors
 * « Bientôt disponible » ou masque le lien. N'inscrivez ici que des adresses officielles,
 * confirmées et en https:// (voir README.md, « Configuration »).
 */
export const SITE_CONFIG = {
  /** Liens officiels de téléchargement de l'application. */
  downloads: {
    /**
     * Android, https://… : la fiche Google Play dès qu'elle existe, sinon l'APK officiel hébergé
     * par LeTer. ⚠ Lien actuel : APK de TEST (serveur api-beta, /var/www/le-ter-downloads/test/),
     * publié à la demande du propriétaire le 26/10/2026 ; à remplacer par l'APK de production
     * (https://api.leter.cm/downloads/le-ter.apk) ou Google Play. Voir README.md.
     */
    android: 'https://api-beta.leter.cm/downloads/le-ter-test.apk',
    /**
     * Lien iOS officiel, https://… : la fiche App Store (https://apps.apple.com/…) ou, si la
     * version iOS n'est distribuée que par TestFlight, le lien public d'invitation
     * (https://testflight.apple.com/join/…). Vide : « Bientôt disponible sur iOS », bouton inactif.
     */
    ios: '',
  },

  /** Assistance publique (page d'aide ou formulaire), https://… Aucune pour l'instant. */
  supportUrl: '',
  /** Adresse e-mail officielle d'assistance (sans « mailto: »). */
  supportEmail: 'hugueslamat16@gmail.com',

  referral: {
    /**
     * Crédit des récompenses de parrainage annoncé comme actif (décision du propriétaire,
     * 26/10/2026). Doit correspondre à REFERRAL_REWARDS_ENABLED=true sur le serveur de production
     * (D-169) ; false réaffiche l'avertissement « crédit pas encore activé ».
     */
    rewardsActive: true,
  },

  analytics: {
    /**
     * Identifiant de mesure Google Analytics 4 (« G-XXXXXXXXXX », public, ce n'est pas un
     * secret). Vide : aucune mesure, aucun bandeau. Renseigné : GA4 n'est chargé qu'après
     * l'accord du visiteur dans le bandeau de consentement (assets/js/analytics.js).
     */
    ga4MeasurementId: '',
  },
};
