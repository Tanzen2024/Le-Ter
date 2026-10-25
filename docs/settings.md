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

`usePreferencesStore` (Zustand + `persist`) enregistre `{ soundEnabled, effectsVolume, language }` sous la
clé `le-ter.preferences`, via `expo-secure-store` déjà utilisé par l'application (aucune
nouvelle dépendance, aucun nouveau module natif). Valeurs par défaut : son activé,
volume des effets « fort » (`high`, niveau des fichiers), français. Au lancement, l'état est relu puis nettoyé (`sanitizePreferences`) : un champ
absent ou corrompu reprend sa valeur par défaut. Un stockage indisponible ne bloque jamais
l'application (lecture → défauts, écriture ignorée, la préférence reste en mémoire). Seules
ces trois valeurs non sensibles sont stockées : jamais de jeton, mot de passe ni clé.

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
  | `ui-error.wav` | `uiError` | Assistance : adresse invalide ou ouverture impossible ; table : action refusée par le serveur (hors conflit de version) |
  | `card-deal.wav` | `cardDeal` | Table : un lot de la distribution part vers son joueur (un son par lot, jamais par carte) |
  | `card-pick.wav` | `cardPick` | Table : saisie d'une carte jouable de ma main (très discret) |
  | `card-place.wav` | `cardPlace` | Table : une carte jouée apparaît sur la table (elle est dans l'état du serveur) |
  | `turn-chime.wav` | `turnChime` | Table : le serveur me donne la main (`canPlayCard` + échéance du tour) |
  | `result-win.wav` | `resultWin` | Table : résultat annoncé, victoire du joueur désignée par le serveur |
  | `result-neutral.wav` | `resultNeutral` | Table : résultat annoncé, autre issue (défaite, égalité, arrêt) |

  **Sons de la table** (LOT 5, `features/games/game-sounds.ts`) : seuls les CHANGEMENTS d'état
  du serveur observés écran ouvert sonnent, une fois. L'état présent à l'ouverture (arrivée,
  reconnexion, reprise) ne rejoue rien ; un nouveau rendu non plus ; aucun minuteur ne décide
  d'un son. Le dépôt d'une carte (en attente du serveur) ne joue aucun son de confirmation : le
  son `cardPlace` n'arrive qu'avec la carte jouée du serveur. Le gagnant n'est jamais calculé
  localement (`result.winnerId`).
- **Volume des effets** (Réglages : Doux / Moyen / Fort → 0,35 / 0,65 / 1, indépendant de celui de la musique) : appliqué à tous
  les lecteurs, ouverts et futurs (`SoundPlayer.setVolume`). Le son de confirmation, joué
  après le choix, fait entendre le nouveau niveau.
- **Niveau des fichiers** : chaque son est normalisé en crête par le script (virgule
  flottante, avant la quantification 16 bits) : -1 dBFS pour les sons d'événement (carte
  posée, tour, refus, confirmation, résultat), -2 dBFS pour la distribution, -3 dBFS pour la
  saisie d'une carte, -4 dBFS pour le clic. Les anciens fichiers culminaient entre -7 et
  -16 dBFS (RMS -24 à -32 dBFS) alors que le volume « Fort » valait déjà 1 : c'était la cause
  du manque d'audibilité, aucun réglage logiciel ne pouvait la compenser. Le choc de la carte
  posée a reçu une composante à 320 Hz, reproductible par un haut-parleur de téléphone.
- **Musique de partie** : composition originale générée par synthèse (voir « Musique de
  partie » ci-dessous).

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

## Musique de partie

```
GameTableScreen → useGameMusic(game, résultat annoncé)     features/games/game-sounds.ts
 → setMusicScene('match' | 'victory' | 'roundEnd' | null)   services/audio-service.ts
 → musicEnabled ?  non → silence                            préférence distincte des effets
 → lecteur de musique (un seul lecteur natif à la fois)     services/expo-music-player.ts
```

- **Scènes** (état du serveur uniquement) : `match` dès que la partie est en cours
  (distribution comprise) et jusqu'à l'annonce du résultat ; `victory` si le serveur me
  désigne gagnant (`result.winnerId`), `roundEnd` sinon (défaite, égalité, arrêt) ; silence
  en salle d'attente, pour une partie déjà terminée à l'ouverture, et à la sortie de l'écran.
- **Lecteur** : un seul lecteur ouvert ; changer de scène libère le précédent (aucune
  superposition, y compris en changeant de partie). Même scène et même partie : sans effet,
  un rendu React ne relance jamais la musique. `match` joue le générique de la partie : son
  thème d'entrée (s'il existe) puis sa boucle. **10 génériques** : chaque nouvelle partie
  (`gameId`) en tire un AU HASARD, jamais celui de la partie précédente ; la même partie
  garde le sien (rendu, Musique OFF puis ON). Arrière-plan : pause, reprise au retour.
- **Préférences** : `musicEnabled` (défaut ON ; un joueur qui avait coupé le son avant cette
  version garde la musique coupée) et `musicVolume` (Doux / Moyen / Fort → 0,2 / 0,4 / 0,65,
  toujours sous les effets). Les lignes « Musique » des Réglages n'apparaissent que si au
  moins une piste est déclarée. Passer Musique sur ON reprend la boucle de partie, jamais un
  thème de résultat déjà passé.
- **Pistes** (`assets/audio/music/`, AAC `.m4a` mono 44,1 kHz 96 kbit/s, ~3,9 Mo au total) :
  composition ORIGINALE écrite dans `scripts/generate-music.mjs` (mélodie, grille d'accords,
  rythmique) et rendue par synthèse : aucun échantillon, aucun fichier téléchargé, aucune
  reprise d'une œuvre protégée. Style arcade au son d'une console 16 bits : batterie, basse,
  accords ponctués, mélodie avec écho. Le générique 01 est écrit note à note ; les
  génériques 02 à 10 sont composés par le script à partir de leur fiche (`THEMES` : tonalité,
  mode, grille d'accords, tempo, styles de basse et de batterie, timbre) et d'une graine fixe
  (mêmes fichiers à chaque génération).
- **Régénérer** (Windows) : `node scripts/generate-music.mjs` (~1 min). Le script rend les
  sources WAV PCM 22 050 Hz dans `frontend/audio-src/music/` (sources de travail ignorées par
  git et par EAS, jamais embarquées), les encode en AAC avec l'encodeur intégré à Windows
  (`scripts/encode-music.ps1`, Media Foundation : aucun outil à installer, aucune dépendance
  ajoutée), puis ajoute à chaque `.m4a` une liste d'édition MP4 (`scripts/mp4-edit-list.mjs`).
  Hors Windows : `--wav-only` produit seulement les sources. L'encodeur de Windows ne descend
  pas sous 96 kbit/s et n'accepte ce débit qu'à 44,1/48 kHz (à 22 050 Hz il impose 32 kbit/s,
  trop pauvre pour les cymbales).
- **Lecture sans trou** : l'AAC abîme les ~10 premières ms d'un fichier et complète la fin par
  du silence ; une boucle aurait ainsi un trou d'environ 20 ms à chaque tour. Chaque source est
  donc encadrée de 1 024 échantillons (une boucle : sa propre fin devant, son début derrière ;
  sinon du silence) que la liste d'édition (`elst`) retire : Android (Media3, `loop` =
  `REPEAT_MODE_ONE`) et iOS (AVFoundation) ne jouent que la piste exacte. Mesuré au décodage
  (Windows) : aucun décalage, durées exactes, graves intacts, raccord de boucle identique à
  celui de la source. Non vérifié à l'écoute sur appareil.

  | Générique | Tonalité, tempo | Style |
  |---|---|---|
  | 01 | la mineur, 148 BPM | Arcade de combat, basse en octaves (boucle de 24 mesures) |
  | 02 | ré dorien, 132 BPM | Basse marchante, batterie quatre temps |
  | 03 | mi mineur, 160 BPM | Rapide, mélodie en dents de scie |
  | 04 | do majeur, 126 BPM | Lumineux, basse pompée, arpège |
  | 05 | sol mineur, 140 BPM | Batterie cassée, basse syncopée |
  | 06 | fa majeur, 118 BPM | Swing, mélodie douce, arpège |
  | 07 | si mineur, 152 BPM | Arcade, basse en octaves, arpège |
  | 08 | ré majeur, 136 BPM | Demi-temps, basse syncopée |
  | 09 | do mineur, 144 BPM | Batterie cassée, arpège |
  | 10 | la mixolydien, 128 BPM | Quatre temps, basse pompée |

  Les génériques 02 à 10 ont une boucle de 16 mesures (24 à 33 s).

  | Fichier | Clé de `MUSIC_TRACKS` | Contenu |
  |---|---|---|
  | `theme-NN-intro.m4a` | `themes[n].intro` | Roulement et accords frappés (3 à 4 s), enchaîne sur la boucle |
  | `theme-NN-loop.m4a` | `themes[n].loop` | Boucle du générique : thème, pont, reprise intense ; raccord circulaire |
  | `result-victory.m4a` | `victory` | Fanfare en la majeur (4 s) |
  | `result-round-end.m4a` | `roundEnd` | Descente mineure et résolution (4 s) |

  Pour passer à des pistes de compositeur (AAC .m4a, crête -1 dBFS, ~-16 LUFS) : les déposer
  dans `assets/audio/music/` et changer les `require` de `MUSIC_TRACKS`
  (`services/expo-music-player.ts`), puis relancer Metro (`-c`). Ajouter ou retirer un
  générique : une entrée `{ intro, loop }` de `MUSIC_TRACKS.themes`. Une boucle fournie par un
  compositeur doit porter sa propre information de lecture sans trou (liste d'édition ou
  `iTunSMPB`), sinon un court silence s'entendra à chaque tour.

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
