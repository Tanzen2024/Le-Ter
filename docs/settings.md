# Module Réglages — Le Ter

Décision : [D-052](decisions.md). Le panneau Réglages s'ouvre depuis l'accueil, l'écran
Tournois (bouton ⚙️ en bas à gauche) et la table de jeu (⚙️ en haut à gauche). Son design
est celui de la maquette ; seules les fonctions ont été branchées.

## Architecture

```
frontend/
├── app/legal/[document].tsx              Route /legal/terms et /legal/privacy (hors garde auth)
└── src/
    ├── features/lobby/SettingsPanel.tsx  Panneau (Son, Langues, Assistance, liens légaux, X)
    ├── features/lobby/LobbyUi.tsx        LobbyPanel (cadre + X), PanelButton, ChoiceGroup
    ├── features/legal/                   Écran de lecture, documents FR/EN, repères légaux
    │   ├── LegalDocumentScreen.tsx
    │   ├── documents.ts                  getLegalDocument(id, langue)
    │   ├── types.ts                      Repères « [Nom légal de l'éditeur] »…
    │   └── content/{terms,privacy}.{fr,en}.ts
    ├── stores/preferences-store.ts       SOURCE DE VÉRITÉ : soundEnabled, language (persistés)
    ├── services/preferences-storage.ts   Stockage local (SecureStore ; localStorage sur le web)
    ├── services/audio-service.ts         playSound() : point d'entrée unique de tous les sons
    ├── services/support-service.ts       openSupport() : bouton Assistance
    ├── constants/app-config.ts           SUPPORT_URL, LEGAL_INFO
    └── lib/i18n/{index,fr,en}.ts         Dictionnaires typés, useMessages(), getMessages()
```

Les préférences sont des préférences de l'APPAREIL : indépendantes de toute partie (aucun
`gameId`), jamais envoyées au serveur. Changer le son ou la langue ne touche ni l'état d'une
partie, ni ses timers, ni la connexion temps réel : seuls les composants qui lisent les
textes ou la préférence sont re-rendus.

## Persistance

`usePreferencesStore` (Zustand + `persist`) enregistre `{ soundEnabled, language }` sous la
clé `le-ter.preferences`, via `expo-secure-store` déjà utilisé par l'application (aucune
nouvelle dépendance, aucun nouveau module natif). Valeurs par défaut : son activé,
français. Au lancement, l'état est relu puis nettoyé (`sanitizePreferences`) : un champ
absent ou corrompu reprend sa valeur par défaut. Un stockage indisponible ne bloque jamais
l'application (lecture → défauts, écriture ignorée, la préférence reste en mémoire). Seules
ces deux valeurs non sensibles sont stockées : jamais de jeton, mot de passe ni clé.

## Son

```
UI (PanelButton, IconButton, PillButton, support-service)
 → playSound(name)                      services/audio-service.ts (point d'entrée unique)
 → soundEnabled ?  non → rien           préférence lue AU MOMENT de l'appel
 → lecteur enregistré                   services/expo-sound-player.ts (expo-audio)
 → lecture
```

- **Bibliothèque** : `expo-audio` ~57.0.5 (module audio officiel du SDK 57, `expo-av` n'en
  fait plus partie) et son pair `expo-asset` ~57.0.19, installés par `npx expo install`.
- **Plugin** (`app.json`) : `microphonePermission: false`, `recordAudioAndroid: false`,
  `enableBackgroundPlayback: false`. Les valeurs par défaut du plugin ajouteraient le micro
  (`RECORD_AUDIO`), un service de premier plan et le mode audio d'arrière-plan iOS : Le Ter
  n'enregistre rien et ne joue pas en arrière-plan. Seule reste `MODIFY_AUDIO_SETTINGS`.
- **Mode audio** : `playsInSilentMode: false` (le mode silencieux d'iOS est respecté),
  `interruptionMode: 'mixWithOthers'` (la musique de l'utilisateur n'est pas coupée),
  `shouldPlayInBackground: false`.
- **Sons** (`assets/audio/`, WAV PCM mono 22 050 Hz, 2 à 12 Ko) :

  | Fichier | `SoundName` | Joué par |
  |---|---|---|
  | `ui-click.wav` | `uiClick` | boutons (panneaux, boutons carrés, boutons pilule) |
  | `ui-confirm.wav` | `uiConfirm` | Réglages : passage sur ON, choix d'une langue |
  | `ui-error.wav` | `uiError` | Assistance : adresse invalide ou ouverture impossible |

  Ils sont générés par synthèse (`node scripts/generate-ui-sounds.mjs`) : aucun fichier
  téléchargé, aucune licence tierce. Pour les remplacer par des sons conçus par un
  designer : déposer un fichier sous le même nom (ou changer `SOUND_SOURCES`).
- **ON / OFF** : chaque bouton joue son son APRÈS son action. Appuyer sur OFF est donc
  silencieux (l'état est déjà OFF quand `playSound` vérifie) ; appuyer sur ON joue
  `uiConfirm` une fois le son réactivé.
- **Passage sur OFF** : chaque lecteur est mis en pause puis libéré (`remove()`) ; aucun
  lecteur ne reste ouvert tant que le son est coupé.
- **Lecteurs** : un seul par son, créé à sa première lecture puis réutilisé (retour au
  début, lecture). `installSoundPlayer()` (appelé dans `app/_layout.tsx`) ne s'exécute
  qu'une fois : ni le retour de l'arrière-plan ni un rechargement ne créent de doublon.
- **Erreurs** : aucune erreur audio ne remonte à l'interface ; un lecteur défaillant est
  libéré et recréé à la lecture suivante.
- **Ajouter un son** : déposer le fichier dans `assets/audio/`, ajouter son nom à
  `SoundName` et à `SOUND_SOURCES`, puis appeler `playSound('…')`. Ne jamais créer de
  lecteur dans un composant.

**Limite des tests** : les tests Jest vérifient toute la chaîne logicielle avec un faux
lecteur natif ; ils ne prouvent pas qu'un son sort du haut-parleur. À vérifier sur appareil.

**Lancer sur appareil** :

- **Expo Go** (le projet n'a ni `eas.json`, ni `expo-dev-client`, ni dossiers natifs) :
  Expo Go SDK 57 contient déjà expo-audio et expo-asset. Aucune reconstruction : relancer
  Metro avec `npx expo start -c` et recharger l'application.
- **Build natif** (APK, development build) : expo-audio et expo-asset ajoutent du code
  natif, une reconstruction est OBLIGATOIRE :
  - local : `npx expo run:android` (Android SDK requis ; génère `android/`, jamais modifié à
    la main) ;
  - cloud : `npx eas-cli@latest build:configure` (crée `eas.json`), puis
    `npx eas-cli@latest build --profile development --platform android` (un development
    build demande aussi `npx expo install expo-dev-client`).

## Langues

`lib/i18n` fournit un dictionnaire typé par langue (`fr.ts` définit la forme, `en.ts` doit
avoir les mêmes clés : vérifié par TypeScript et par un test). Dans un composant :
`const t = useMessages();` puis `t.settings.title`. Hors composant : `getMessages()`. Le
changement est immédiat, sans redémarrage.

Traduits aujourd'hui : panneau Réglages, documents légaux, accueil (titre, modes,
« Rejoindre »), HUD et boutons de la coquille (Profil, Réglages, retour, solde, X des
panneaux). Les autres écrans (connexion, table de jeu, chat, boutique, profil, partie privée,
tournois) restent en français : pour les traduire, remplacer leurs textes par des clés de
`fr.ts` / `en.ts`.

**Ajouter une langue** (ex. `es`) :

1. Ajouter `'es'` à `LANGUAGES` (`stores/preferences-store.ts`).
2. Créer `lib/i18n/es.ts` (`export const es: Messages = { … }`) et l'ajouter à `MESSAGES`
   (`lib/i18n/index.ts`).
3. Ajouter `content/terms.es.ts` et `content/privacy.es.ts`, puis les déclarer dans
   `features/legal/documents.ts` et ajouter les repères dans `features/legal/types.ts`.
4. Ajouter le bouton dans `SettingsPanel.tsx` (libellé et nom accessible dans les
   dictionnaires).

## Assistance

Bouton « Assistance » → `openSupport()`. L'adresse vient de `SUPPORT_URL`
(`constants/app-config.ts`), lue dans la variable `EXPO_PUBLIC_SUPPORT_URL`.

- **Définir l'URL** : ajouter `EXPO_PUBLIC_SUPPORT_URL=https://…` dans `frontend/.env`
  (développement) et dans les variables d'environnement EAS du profil de build. Relancer
  Metro (`npx expo start -c`). Seules les adresses `http(s)://` complètes sont ouvertes.
- **Sans URL** (cas actuel) : aucune adresse n'est ouverte, un message localisé annonce le
  service (« Le service d'assistance sera bientôt disponible. »).
- **URL invalide** (non vide mais pas `http(s)://…`) : rien n'est ouvert, message d'erreur
  localisé et son `uiError`.
- **Échec d'ouverture** : message localisé et son `uiError`, aucune erreur levée.

## Documents légaux

- Conditions d'utilisation : `features/legal/content/terms.{fr,en}.ts` (18 sections).
- Politique de confidentialité : `features/legal/content/privacy.{fr,en}.ts` (18 sections),
  rédigée d'après les données réellement traitées (comptes, sessions, parties, chat, compte
  de jeu, géolocalisation des tables surveillées supprimée sous 24 h, aucune IP conservée,
  aucun outil d'analyse ou de publicité ; CinetPay prévu mais pas encore actif). À mettre à
  jour à chaque nouvelle donnée collectée, en particulier à l'activation des paiements.
- Informations inconnues (éditeur, adresse, email, date, juridiction, âge minimum) :
  `LEGAL_INFO` (`constants/app-config.ts`). `null` → repère entre crochets affiché.

> ⚠ Ces textes sont des PROJETS. Ils n'ont été relus par aucun professionnel du droit et
> doivent être validés avant toute publication officielle.

## Tests

`stores/preferences-store.test.ts`, `services/audio-service.test.ts`,
`services/expo-sound-player.test.ts`,
`services/support-service.test.ts`, `lib/i18n/i18n.test.ts`,
`features/lobby/SettingsPanel.test.tsx`, `features/legal/LegalDocumentScreen.test.tsx`.
