# APK Android de test (EAS Build, profil `preview`)

Objectif : une APK installable directement sur des téléphones Android, sans Expo Go, sans
serveur Metro, utilisable depuis n'importe quel réseau Internet (Wi-Fi, 4G/5G), le backend
étant joint par une **URL HTTPS publique**. Décision : D-093 (`docs/decisions.md`).

## 1. Ce qui est en place

| Fichier | Rôle |
|---|---|
| `frontend/eas.json` | Profils EAS. `preview` : distribution interne, **APK** (`buildType: apk`), environnement EAS `preview`, `versionCode` incrémenté par EAS à chaque build (`appVersionSource: remote`). |
| `frontend/app.config.js` | Reprend `app.json` sans le modifier. Sur un serveur EAS Build, **fait échouer le build** si `EXPO_PUBLIC_API_URL` est absente, non HTTPS ou `localhost`. |
| `frontend/.env.example` | Variables publiques du frontend, documentées (aucun secret). |

Points vérifiés dans le code :

- **Une seule source d'URL** : `EXPO_PUBLIC_API_URL`, lue par `frontend/src/lib/api-client.ts`.
  Le WebSocket temps réel en est dérivé (`realtimeUrl` dans `src/lib/realtime-client.ts`) :
  `https://hôte` → `wss://hôte/ws`. Aucune autre adresse réseau du backend n'existe dans le
  frontend (les pages de paiement CinetPay sont des URL renvoyées par le backend).
- **Bundle embarqué** : le projet n'utilise ni `expo-dev-client` ni `expo-updates`. Un build
  release (profil `preview`) embarque le bundle JavaScript et les assets dans l'APK ; l'APK
  démarre sans Metro, sans Expo Go et sans tunnel Expo/ngrok.
- **Sans URL au build, l'APK serait inutilisable** : `resolveApiUrl` retombe sur
  `http://localhost:3000` (le téléphone lui-même). D'où le garde-fou de `app.config.js`.
- **Temps réel** : WebSocket natif (`ws`) sur `/ws` (D-045), authentifié par message après
  ouverture (jamais de jeton dans l'URL), heartbeat serveur toutes les 30 s, reconnexion
  automatique côté client avec délai aléatoire. Les tunnels Cloudflare transmettent les
  WebSocket ; le heartbeat de 30 s maintient la connexion sous le délai d'inactivité du proxy.
- **TLS** : aucune validation de certificat n'est contournée. Android bloque le HTTP en clair
  dans un build release : l'URL **doit** être en HTTPS.

## 2. Variables `EXPO_PUBLIC_*` et EAS : à savoir

- Elles sont **inlinées dans le bundle au moment du build**. Modifier `frontend/.env` après
  coup ne change pas une APK déjà produite : il faut **recompiler**.
- `frontend/.env` est ignoré par Git, donc **n'est pas envoyé** au serveur EAS. La valeur se
  définit dans les variables d'environnement EAS, environnement `preview`.
- Elles sont **publiques** (lisibles dans l'APK) : jamais de clé CinetPay, mot de passe ou
  jeton. Les secrets restent dans `backend/.env`.

## 3. Construire l'APK (Windows PowerShell)

Prérequis : un compte Expo (gratuit), Node.js, le backend démarré et exposé en HTTPS public.

```powershell
cd C:\xampp\htdocs\le-ter\frontend

# 1. Connexion au compte Expo (une fois par poste)
npx eas-cli@latest login

# 2. Première fois seulement : lie le dossier à un projet EAS
#    (ajoute extra.eas.projectId et owner dans app.json : à commiter)
npx eas-cli@latest init

# 3. URL publique du backend pour l'environnement "preview" (sans / final).
#    env:set crée la variable ou remplace sa valeur (env:create est déprécié).
#    Serveur de test du VPS : https://api-beta.leter.cm (docs/deploiement-vps.md).
npx eas-cli@latest env:set --environment preview --name EXPO_PUBLIC_API_URL `
  --value "https://VOTRE-URL-PUBLIQUE" --visibility plaintext

#    Vérification
npx eas-cli@latest env:list --environment preview

# 4. Build APK dans le cloud
npx eas-cli@latest build --platform android --profile preview
```

Au premier build, EAS propose de **générer un keystore Android** : accepter (il est conservé
par EAS ; toutes les APK suivantes auront la même signature et pourront se mettre à jour par
dessus). À la fin, la CLI affiche l'URL de la page du build avec le lien de téléchargement et
un QR code. Les builds sont aussi listés sur https://expo.dev (projet `le-ter` → Builds).

### Quand l'URL du backend change (Quick Tunnel relancé…)

```powershell
cd C:\xampp\htdocs\le-ter\frontend
npx eas-cli@latest env:set --environment preview --name EXPO_PUBLIC_API_URL `
  --value "https://NOUVELLE-URL" --visibility plaintext
npx eas-cli@latest build --platform android --profile preview
```

Puis réinstaller la nouvelle APK sur chaque téléphone (elle remplace l'ancienne, les données
locales sont conservées puisque la signature est la même).

### Variante : compilation locale (sans compte Expo)

Possible avec le SDK Android et un JDK installés sur le PC. L'URL vient alors de
`frontend/.env` (lu au moment du bundling) :

```powershell
cd C:\xampp\htdocs\le-ter\frontend
# frontend/.env doit contenir : EXPO_PUBLIC_API_URL=https://VOTRE-URL-PUBLIQUE
npx expo prebuild --platform android --no-install
cd android
.\gradlew.bat assembleRelease
# APK : frontend\android\app\build\outputs\apk\release\app-release.apk
```

Limite : le modèle généré signe l'APK release avec la **clé de débogage** du PC. Suffisant pour
un test interne, mais une APK EAS (autre signature) ne pourra pas s'installer par-dessus : il
faudra d'abord désinstaller. Le garde-fou HTTPS de `app.config.js` ne s'applique qu'aux builds
EAS : vérifier soi-même `.env` avant une compilation locale.

Constat du 2026-10-12 sur le poste de développement (Windows Enterprise) : le bundle JS release
est bien produit, mais la compilation native échoue (téléchargements Maven interrompus au
handshake TLS par le réseau, compilation C++ de `react-native-screens`, écriture d'assets
bloquée par intermittence). Sur ce poste, utiliser **EAS Build**.

## 4. Installer l'APK sur Android

1. Ouvrir sur le téléphone le lien du build (ou scanner le QR code de la page EAS), ou copier
   le fichier `.apk` sur le téléphone (câble, messagerie, Drive).
2. Ouvrir le fichier téléchargé. Android demande d'autoriser l'installation d'applications
   inconnues **pour l'application utilisée** (navigateur, gestionnaire de fichiers) : accepter.
3. Si Play Protect affiche un avertissement (application non publiée) : « Installer quand
   même ».
4. Lancer **le-ter** depuis l'écran d'accueil. Aucun Expo Go ni PC sur le même réseau n'est
   nécessaire.

## 5. Exposer le backend

Le backend reste sur le PC du développeur pendant les tests. Il doit donc rester **démarré**
(`npm run dev` ou `npm start` dans `backend/`, PostgreSQL et Redis actifs) et joignable par
l'URL HTTPS publique pendant toute la session de test.

- Seul le port HTTP de l'API (3000) est exposé par le tunnel. **Jamais PostgreSQL ni Redis.**
  Aucune règle de pare-feu entrante n'est nécessaire (le tunnel est sortant).
- Quick Tunnel Cloudflare (test) : `cloudflared tunnel --url http://localhost:3000`. Il
  affiche une URL `https://….trycloudflare.com`.
- `TRUST_PROXY` (backend) : laisser vide sauf décision explicite (D-061). Derrière
  `cloudflared` local, l'adresse TCP vue par Express est `127.0.0.1` ; la limitation de débit
  par IP regroupe alors tous les joueurs (`TRUST_PROXY=loopback` changerait ce comportement :
  à décider, non activé ici).
- CinetPay : `CINETPAY_NOTIFY_URL`, `CINETPAY_RETURN_URL` (et URL de transfert) contiennent la
  même URL publique ; à mettre à jour dans `backend/.env` puis redémarrer le backend quand
  l'URL change.

## 5 bis. Mode tunnel stable (D-170, recommandé)

Remplace le Quick Tunnel, dont l'URL change à chaque relance. Le domaine ngrok gratuit est lié au
compte ngrok déjà configuré sur ce poste.

1. Tunnel vers le loopback **seulement** : `ngrok http 127.0.0.1:3000`. Noter l'URL
   `https://….ngrok-free.app`. Ce domaine est lié au compte ngrok : vérifier au 2ᵉ lancement
   qu'il est identique avant de construire l'APK.
2. Backend de test : `npm run dev:tunnel -- https://….ngrok-free.app` (dans `backend/`). La
   commande impose `HOST=127.0.0.1`, `TRUST_PROXY=loopback` et les URL CinetPay sur l'URL
   publique, puis vérifie `/api/health` en local et par l'URL publique. `backend/.env` n'est pas
   modifié.
3. CinetPay sandbox : l'IP publique ACTUELLE du poste doit figurer dans la liste blanche du
   compte marchand. Sinon : `PROVIDER_IP_NOT_ALLOWED` (2011) au démarrage et achats refusés,
   sans rien débiter (voir `docs/payments.md`).
4. Application : `EXPO_PUBLIC_API_URL=https://….ngrok-free.app` dans l'environnement EAS
   `preview`, puis **une** APK (section 3). Le WebSocket passe par la même URL (`wss://…/ws`).
5. Comptes de test fictifs : `TEST_ACCOUNT_PASSWORD=… npm run test:accounts -- https://….ngrok-free.app 4`.

Page d'avertissement du forfait gratuit ngrok : elle n'apparaît que pour une page HTML ouverte
dans un navigateur, donc pas pour l'application. Elle peut apparaître une fois sur la page de
retour après paiement : « Visit Site », puis elle reste masquée 7 jours sur ce téléphone.

## 6. Limites restantes

- **Quick Tunnel = URL temporaire.** L'URL `trycloudflare.com` change à chaque relance de
  `cloudflared` et disparaît à son arrêt (constaté le 2026-10-12 : l'ancienne URL ne résolvait
  plus). Chaque changement impose une **nouvelle APK**. Cloudflare ne garantit ni
  disponibilité ni débit pour les Quick Tunnels. Solution durable : un tunnel nommé Cloudflare
  sur un domaine possédé (URL fixe), ou un hébergement du backend.
- **Disponibilité** : PC éteint, en veille, sans Internet ou backend arrêté = application
  inutilisable pour tous les joueurs ; les parties en cours reprennent au redémarrage grâce aux
  échéances persistées (D-034, `DeadlineSupervisor`), mais les tours expirés pendant la coupure
  sont joués automatiquement.
- **WebSocket** : une coupure du tunnel ferme toutes les connexions ; le client se reconnecte
  automatiquement et resynchronise l'état par HTTP. Pendant la coupure, le joueur voit l'état
  « hors ligne ».
- **Identité de l'application** : `android.package` vaut `com.anonymous.leter` (valeur par
  défaut d'Expo) et le nom affiché `le-ter`. Les changer **avant** une diffusion large : un
  autre `package` est une autre application (pas de mise à jour par-dessus).

## 7. Plan de test sur deux téléphones distants

Préparation : téléphone A en **4G/5G (Wi-Fi coupé)**, téléphone B sur un **Wi-Fi différent**
de celui du PC. Deux comptes distincts. Backend démarré, URL publique vérifiée dans un
navigateur du téléphone : `https://URL/api/health` doit répondre
`{"status":"ok","database":"connected","redis":"connected"}`.

| # | Test | Attendu |
|---|---|---|
| 1 | Installer l'APK sur A et B, lancer | L'application s'ouvre sans Expo Go ni Metro |
| 2 | Créer un compte / se connecter sur A et B | Connexion réussie, pas d'erreur réseau |
| 3 | A crée une partie privée, B la rejoint | B voit la table ; A voit B arriver **sans rafraîchir** (temps réel) |
| 4 | A démarre la partie | Distribution 3 + 2 cartes visible sur les deux téléphones |
| 5 | Jouer plusieurs plis | Chaque carte jouée apparaît chez l'autre en moins de 2 s |
| 6 | Ne pas jouer pendant son tour | Délai de tour, puis carte automatique visible des deux côtés |
| 7 | Couper les données de A 30 s pendant la partie, puis rétablir | A se reconnecte seul et retrouve l'état exact de la partie |
| 8 | Mettre B en arrière-plan 1 min puis revenir | Reconnexion et état à jour |
| 9 | Fin de partie : ronde Poursuivre/Quitter | Décisions prises en compte des deux côtés |
| 10 | Historique / résultats | La partie apparaît avec le bon résultat chez A et B |
| 11 | Tournoi (si actif) : inscription des deux comptes | Inscription et démarrage de table visibles des deux côtés |
| 12 | Messagerie de table (si utilisée) | Messages reçus en temps réel |
| 13 | Arrêter le backend 1 min puis le relancer | Message « Impossible de joindre le serveur », puis reprise |
| 14 | Compte non administrateur : écran admin | Accès refusé (contrôle de rôle serveur) |
