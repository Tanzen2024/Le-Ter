/**
 * Configuration Expo dynamique : reprend `app.json` tel quel et ajoute un garde-fou de build.
 *
 * Sur un serveur EAS Build (`EAS_BUILD=true`), l'URL de l'API est inlinée dans le bundle
 * embarqué de l'APK : sans `EXPO_PUBLIC_API_URL` en HTTPS, l'application retomberait sur
 * `http://localhost:3000` (le téléphone lui-même) et ne joindrait jamais le serveur. Le build
 * échoue donc tôt plutôt que de produire une APK inutilisable. La valeur vient des variables
 * d'environnement EAS (`eas env:create`, environnement du profil dans `eas.json`), jamais du
 * code source : `frontend/.env` est ignoré par Git et n'est pas envoyé au serveur de build.
 */
module.exports = ({ config }) => {
  if (process.env.EAS_BUILD === 'true') {
    const apiUrl = (process.env.EXPO_PUBLIC_API_URL ?? '').trim();
    if (!/^https:\/\/[^/\s]+/i.test(apiUrl) || /\/\/(localhost|127\.0\.0\.1)(:|\/|$)/i.test(apiUrl)) {
      throw new Error(
        'EXPO_PUBLIC_API_URL doit être une URL HTTPS publique pour un build EAS ' +
          `(valeur actuelle : "${apiUrl || 'absente'}"). ` +
          'Voir docs/android-apk-test.md.',
      );
    }
  }
  return config;
};
