# Authentification — Le Ter

> Statut : implémentée (phase B, octobre 2026). Décision : D-029. Règles métier : R-10, R-15, R-32.

## 1. Règles métier officielles

| Règle | Contenu |
|---|---|
| **R-10** | Le mode invité est **supprimé**. Aucun compte invité, anonyme ou temporaire, aucune session invitée, aucune identité de repli. Toute action de joueur exige un compte authentifié. |
| **R-15** | Inscription : **Prénom, Nom, Pseudo, Pays, Téléphone, Mot de passe, Confirmation**, et **Email facultatif** pour un joueur (D-135 ; Pays : D-070). Le pays et le téléphone sont obligatoires. Connexion : **téléphone + mot de passe** ou **email + mot de passe** (D-135). Le pseudo est le nom visible en jeu, pas un identifiant de connexion. Un administrateur a toujours un email. |
| **R-35** | Mot de passe oublié : **code de récupération** (D-135), sans SMS. Voir §6 « Récupération ». |
| **R-32** | **Une seule session active par utilisateur.** Une nouvelle connexion révoque toute session précédente. Cette règle ne limite pas le nombre de parties d'un joueur (R-18 reste ouverte). |

## 2. Vue d'ensemble

```
Client ──POST /api/auth/login──▶ AuthService ──▶ PostgreSQL (users, refresh_tokens)
       ◀── user + accessToken (JWT 15 min) + refreshToken (opaque, 30 j)

Client ──Authorization: Bearer <JWT>──▶ requireAuth ──▶ res.locals.auth = { userId, role, sessionId }
                                                         └─ vérifie la session en base (R-32)
```

- PostgreSQL est la seule source de vérité. **Redis n'intervient pas** : inscription, connexion,
  refresh, logout et `/me` fonctionnent sans lui.
- `AuthService` ne connaît pas HTTP. `GameService` et le moteur ne connaissent ni JWT ni
  `AuthService`.

## 3. Identité : UserId et PlayerId

- `UserId` (`domain/users/user.ts`) : UUID v4, clé de `users`.
- `PlayerId` (`domain/game/game-id.ts`) : identité d'un participant dans le domaine de jeu.
  **Sa valeur est l'identifiant du compte.** Il n'existe pas de table « joueurs » séparée.
- `playerIdOf(userId)` est le seul passage de l'un à l'autre. Il n'est appelé qu'avec
  `getAuth(res).userId`, c'est-à-dire le `sub` d'un JWT vérifié.
- Depuis la migration `0003`, `games.creator_id` et `game_players.player_id` sont des `uuid`
  avec clé étrangère vers `users(id)` (`ON DELETE RESTRICT` : un compte ayant joué se
  désactive, il ne se supprime pas).

**Règle absolue** : le client ne détermine jamais l'identité. Un `userId` ou un `playerId`
envoyé dans le corps, l'URL ou un en-tête est ignoré pour décider qui agit (test
« ANTI-USURPATION »).

## 4. Schéma

### `users` (migration 0002)

| Colonne | Type | Contraintes |
|---|---|---|
| `id` | uuid | PK |
| `first_name`, `last_name` | text | 1 à 50 caractères |
| `email` | text | minuscules, ≤ 254, **unique** ; **NULL** possible pour un joueur, obligatoire pour un `admin` (migration 0054, D-135) |
| `username` | text | `^[A-Za-z0-9_]{3,20}$`, **unique sans tenir compte de la casse** (`lower(username)`) |
| `phone` | text | E.164 `^\+[1-9][0-9]{7,14}$`, **unique** |
| `phone_verified` | boolean | `false` par défaut |
| `password_hash` | text | bcrypt ; jamais exposé |
| `role` | text | `'user'` ou `'admin'` (migration 0017 ; `admin` = `SUPER_ADMIN`, D-061) |
| `status` | text | `'active'` ou `'disabled'` |
| `created_at`, `updated_at` | timestamptz | |
| `recovery_code_hash` | text | empreinte bcrypt du code de récupération actif ; NULL : aucun (migration 0054) |
| `recovery_code_created_at`, `recovery_code_used_at` | timestamptz | création du code actif, dernière utilisation |
| `recovery_failed_attempts`, `recovery_locked_until` | integer, timestamptz | codes faux consécutifs, blocage temporaire |

Aucune colonne de solde, portefeuille ou tournoi : elles appartiennent aux phases ultérieures.

### `password_reset_grants` (migration 0054)

Autorisation temporaire de réinitialisation, donnée après un code valide : `user_id`,
`token_hash` (empreinte SHA-256, **unique** ; le jeton n'est jamais stocké), `created_at`,
`expires_at` (10 min), `used_at` (usage unique ; une nouvelle autorisation annule les
précédentes du compte).

### `refresh_tokens` (migration 0002)

| Colonne | Rôle |
|---|---|
| `id` | PK |
| `user_id` | FK `users`, `ON DELETE CASCADE` |
| `session_id` | Session à laquelle appartient le jeton (constante au fil des rotations ; c'est le `sid` du JWT) |
| `token_hash` | Empreinte SHA-256 du jeton, **unique**. Le jeton lui-même n'est jamais stocké |
| `created_at`, `expires_at` | |
| `revoked_at`, `revoked_reason` | `rotated`, `logout` ou `new_login` |

Index unique partiel `refresh_tokens_one_active_per_user (user_id) WHERE revoked_at IS NULL` :
**la base elle-même** interdit deux jetons actifs pour un utilisateur.

## 5. Jetons

| | Access token | Refresh token |
|---|---|---|
| Format | JWT HS256 | 32 octets aléatoires, base64url (43 caractères), opaque |
| Durée | 15 min (`JWT_ACCESS_TOKEN_EXPIRES_IN`) | 30 jours, renouvelés à chaque rotation (`REFRESH_TOKEN_EXPIRES_IN`) |
| Contenu | `sub` (UserId), `role`, `sid` (session), `iat`, `exp`, `iss`, `aud` | aucun |
| Stockage serveur | aucun | empreinte SHA-256 |
| Stockage client | mémoire seulement | SecureStore (iOS / Android) |

Vérification d'un access token : algorithme imposé (HS256, « none » refusé), signature,
`iss`, `aud`, expiration, `sub` UUID, `role` connu, puis **session encore active et compte
actif en base**. Conséquence de R-32 : une connexion sur un autre appareil ou un logout
invalide immédiatement les access tokens de l'ancienne session, sans attendre leurs 15 min.
Coût : une requête indexée par requête authentifiée.

## 6. Flux

### Inscription — `POST /api/auth/register`

Validation serveur (`validators/auth.validators.ts`), puis contrôle d'unicité, hachage bcrypt
(coût 12) et insertion. Un **code de récupération** est créé avec le compte (D-135). Réponse
**201** `{ user, recoveryCode }` : le code en clair n'existe QUE dans cette réponse (empreinte
bcrypt en base). Aucune session n'est créée : le client affiche le code, puis se connecte.
`confirmPassword` n'est jamais stocké. Les champs `id`, `role`, `phoneVerified` envoyés par le
client sont ignorés. Email vide ou absent : `NULL` (joueur sans email).

Normalisation : email en minuscules ; téléphone sans espaces, points, tirets ni parenthèses,
« 00 » initial remplacé par « + », puis numéro E.164 reconstruit par le serveur à partir du
pays (`country`, ISO alpha-2) et du numéro national (D-070) ; noms sans espaces superflus.

Règles : prénom et nom (lettres, espaces, apostrophes, tirets, 50 max) ; email valide s'il est
fourni ; pseudo
3 à 20 `[A-Za-z0-9_]` ; pays connu de libphonenumber ; téléphone valide selon les règles de
ce pays (un indicatif d'un autre pays est refusé) ; mot de passe de 8 caractères
minimum et 72 octets maximum (limite de bcrypt), avec au moins une lettre et un chiffre ;
confirmation identique.

Erreurs : **400** `VALIDATION_ERROR` avec `fields` ; **409** `CONFLICT` avec `fields`
(email, pseudo ou téléphone déjà utilisé).

### Connexion — `POST /api/auth/login`

Corps `{ email, password }` ou `{ country, phone, password }` (D-135 : pays + numéro national,
E.164 reconstruit comme à l'inscription).

1. Recherche par email ou par téléphone. Si le compte est inconnu, une comparaison bcrypt
   factice est faite pour que la durée de réponse ne révèle pas son existence.
2. Échec : **401** `INVALID_CREDENTIALS`, « Email ou mot de passe incorrect. » ou
   « Téléphone ou mot de passe incorrect. » (identique pour un compte inconnu et un mauvais
   mot de passe).
3. Compte désactivé (mot de passe correct) : **403** `ACCOUNT_DISABLED`.
4. Transaction : `SELECT … FROM users WHERE id = $1 FOR UPDATE`, révocation de **tous** les
   jetons actifs (`new_login`), création du jeton de la nouvelle session, COMMIT.
5. Réponse **200** `{ user, accessToken, refreshToken }`.

### Rotation — `POST /api/auth/refresh` `{ refreshToken }`

Transaction : propriétaire du jeton, **verrou de la ligne `users`**, relecture du jeton sous
verrou, contrôle révocation / expiration / compte actif, révocation (`rotated`), nouveau jeton
dans la même session, COMMIT. Réponse `{ accessToken, refreshToken }`. Deux rotations
concurrentes du même jeton : la seconde relit un jeton révoqué et reçoit **401**
`INVALID_REFRESH_TOKEN`.

### Déconnexion — `POST /api/auth/logout` `{ refreshToken }`

Révoque le jeton s'il est actif (`logout`). Répond toujours **204**, y compris pour un second
logout ou un jeton inconnu. Ne crée aucune session. L'access token de la session est refusé
dès la requête suivante.

### Utilisateur courant — `GET /api/auth/me`

`Authorization: Bearer <accessToken>`. Renvoie `{ user }` pour `getAuth(res).userId`.
**401** `UNAUTHENTICATED` (en-tête `WWW-Authenticate: Bearer`) si le jeton est absent,
mal formé, invalide ou expiré, si la session est révoquée, ou si le compte est inexistant
ou désactivé.

### Changement du mot de passe — `POST /api/auth/password` (connecté)

`{ currentPassword, newPassword, confirmPassword }` : mot de passe actuel vérifié, nouveau
selon la même politique, différent de l'actuel ; **204**. Aucun code de récupération n'est
demandé. La session courante reste ouverte. Mobile : Profil → Mot de passe → « Modifier ».

### Récupération (« Mot de passe oublié ? », D-135, sans SMS)

1. `POST /api/auth/recovery/verify` `{ country, phone, code }` → **200** `{ resetToken,
   expiresAt }` (autorisation de 10 min, usage unique). Le code est saisi librement (casse,
   espaces, tirets, O/0 et I/L/1 confondus). Numéro inconnu, compte sans code, administrateur,
   compte inactif ou bloqué, code faux : **400** `RECOVERY_FAILED`, même message et même durée.
2. `POST /api/auth/recovery/reset` `{ resetToken, newPassword, confirmPassword }` → **200**
   `{ recoveryCode }`. En une transaction : mot de passe remplacé, ancien code invalidé et
   remplacé par un nouveau (renvoyé une fois), autorisation consommée, toutes les sessions
   fermées (`revoked_reason = 'password_reset'`). Autorisation absente, expirée ou déjà
   utilisée : **400** `RESET_GRANT_INVALID`.
3. Nouveau code depuis le Profil : `POST /api/auth/recovery-code` `{ currentPassword }`
   (connecté) → `{ recoveryCode }` ; l'ancien code cesse de fonctionner.
4. Code perdu : l'assistance fait « Réinitialiser l'accès » dans l'administration
   (`POST /api/admin/users/:id/recovery { reason }`) ; nouveau code montré une fois à
   l'administrateur, audit `PLAYER_ACCOUNT_RECOVERY`. Aucun mot de passe vu ni fixé.

Code : `LT-XXXX-XXXX-XXXX`, 12 caractères aléatoires (alphabet de Crockford, 60 bits).
Blocage : 5 codes faux → compte bloqué 15 min, compté en base.

## 7. Concurrence (R-32)

Toutes les opérations qui créent ou révoquent un jeton commencent par verrouiller la ligne
`users` de l'utilisateur. Elles sont donc sérialisées **par utilisateur**, y compris entre
plusieurs instances du backend. Les utilisateurs différents ne s'attendent pas. L'index unique
partiel est le dernier filet de sécurité.

Vérifié sur PostgreSQL réel (`tests/integration/auth/postgres-concurrency.test.ts`, avec
`TEST_DATABASE_URL`) : 10 connexions simultanées donnent une seule session active ;
10 rotations simultanées du même jeton donnent un seul succès ; connexions, rotations et
déconnexions entremêlées ne laissent jamais deux sessions actives et ne provoquent aucune
panne.

## 8. `requireAuth`

`middleware/require-auth.ts` : en-tête `Bearer <jwt>` → `AuthService.authenticate` →
`res.locals.auth: AuthContext`, typé par augmentation de `Express.Locals` (aucun cast). Les
contrôleurs lisent l'identité avec `getAuth(res)`. Il n'existe **aucune identité par défaut** :
sans jeton, la réponse est 401.

## 9. Sécurité et journalisation

- Jamais journalisés : mot de passe, `password_hash`, access token, refresh token, en-tête
  `Authorization`, corps de requête, code de récupération (ni son empreinte), autorisation de
  réinitialisation.
- Journalisés (JSON, avec `requestId`) : `register succeeded/rejected`, `login
  succeeded/failed` (avec la raison), `previous session revoked`, `refresh
  succeeded/rejected` (avec la raison : `malformed`, `unknown`, `revoked`, `expired`,
  `account_disabled`), `logout succeeded/ignored`, `auth rejected` (avec la raison).
- Limitation de débit en mémoire, par instance (`routes/auth.routes.ts`) :
  - inscription : 20 par heure et par IP ;
  - connexion : 10 par 15 min et par couple IP + email, et 100 par 15 min et par IP (valeur
    large, car de nombreux mobiles partagent une IP) ;
  - refresh : 300 par 15 min et par IP ;
  - récupération (D-135) : 30 par 15 min et par IP, 10 par 15 min et par numéro ;
    réinitialisations et nouveaux codes : 10 par 15 min ; en plus, blocage du compte EN BASE
    après 5 codes faux (15 min) ;
  - au-delà, **429** `RATE_LIMITED` avec `Retry-After`.
- Sans `DATABASE_URL` ou sans `JWT_SECRET`, `/api/auth/*` répond **503** `AUTH_UNAVAILABLE`.

## 10. Variables d'environnement

| Variable | Défaut | Règle |
|---|---|---|
| `JWT_SECRET` | aucun | 32 caractères minimum ; **obligatoire en production** ; jamais commité |
| `JWT_ACCESS_TOKEN_EXPIRES_IN` | `15m` | format `<n>s|m|h|d` |
| `REFRESH_TOKEN_EXPIRES_IN` | `30d` | format `<n>s|m|h|d` |

## 11. Frontend

| Élément | Emplacement |
|---|---|
| Routes | `app/(auth)/login.tsx` (`/login`), `app/(auth)/register.tsx` (`/register`), `app/index.tsx` (accueil connecté ou redirection) |
| Garde | `Stack.Protected guard={status !== 'signedIn'}` sur le groupe `(auth)` dans `app/_layout.tsx` |
| API | `src/lib/api-client.ts` (`EXPO_PUBLIC_API_URL`), `src/services/auth-api.ts` |
| Refresh token | `src/services/token-storage.ts` : SecureStore sur iOS et Android, mémoire seulement sur le web, jamais AsyncStorage |
| État client | `src/stores/auth-store.ts` (Zustand) : `status` et `accessToken` uniquement |
| État serveur | TanStack Query, clé `['auth', 'me']` (`src/features/auth/hooks.ts`) |
| Session | `src/features/auth/session.ts` : restauration au lancement, rotation en vol unique (une seule rotation à la fois, puisque le serveur n'en accepte qu'une par jeton), un nouvel essai après un 401 |

Écrans, en paysage (D-028).

- **Connexion** (`src/features/auth/LoginLayout.tsx`, D-139, décor D-140) : fond sombre décoré
  (reflet bordeaux, étoiles, 3 cartes Le Ter de chaque côté), un panneau centré (5 cartes
  L E T E R, titre « CONNEXION »), UN champ « Téléphone ou email » (drapeau, icône) avec
  l'indicatif (Cameroun `+237` présélectionné, autre pays par la liste existante), mot de passe
  (masqué, œil pour l'afficher), « Mot de passe oublié ? » (D-135, ouvre
  `app/(auth)/forgot-password.tsx`), « Se connecter », puis « Vous n'avez pas de compte ?
  S'inscrire ». Un « @ » ou une lettre → `{ email }`, sinon `{ country, phone }` (numéro
  national ; « +237… » accepté). Dimensionné depuis la surface paysage sûre
  (`src/hooks/use-landscape-viewport.ts`) : tout tient sur un petit téléphone en paysage, le
  panneau défile si le clavier le réduit. Un seul message d'erreur (validation ou serveur)
  au-dessus du bouton, désactivé tant qu'un champ est vide et verrouillé pendant l'envoi.
- **Mot de passe oublié** (`app/(auth)/forgot-password.tsx`, D-139) : même modèle que la
  connexion (`LoginLayout`, indicateur d'étapes `LoginSteps`) ; Téléphone (indicatif dans le
  champ, Cameroun présélectionné) → Code → Nouveau mot de passe → nouveau code → connexion.
- **Code de récupération** (`src/features/auth/RecoveryCodeCard.tsx`) : affiché une fois après
  l'inscription, après une réinitialisation et dans le Profil ; « Copier le code »
  (`expo-clipboard`), « J'ai enregistré mon code ». Jamais écrit dans un stockage local.
- **Inscription** (D-139, décor D-140) : même modèle que la connexion (`LoginLayout`, panneau
  large, décoré) : cartes L E T E R, titre « Inscription », champs sombres par deux (prénom | nom, email |
  téléphone, mot de passe | confirmation), erreur sous chaque champ et aide tant qu'il a le
  focus. Téléphone identique à la connexion : indicatif dans le champ (Cameroun `+237`
  présélectionné, autre pays par la liste existante), numéro national seul ; changer de pays
  efface le numéro.
- **Inscription en 2 étapes** :
  1. Prénom, Nom, Pseudo, puis « Continuer » ;
  2. Email, Téléphone, Mot de passe, Confirmation, puis « Créer mon compte » ;
  - validation inline ;
  - les erreurs du serveur s'affichent par champ, et l'écran revient à l'étape 1 si le pseudo
    est déjà pris ;
  - email facultatif (D-135) ;
  - compte créé : le code de récupération s'affiche, puis connexion (par téléphone) quand le
    joueur confirme l'avoir enregistré.

## 12. Non implémenté (volontairement)

- Vérification du téléphone par SMS : aucun fournisseur n'est choisi ; `phone_verified` est
  prêt.
- Réinitialisation par email ou SMS : non prévue ; la récupération passe par le code (D-135).
- Session d'administration dédiée (8 h absolues, 30 min d'inactivité) : voir `docs/admin/SECURITY.md`.
- Détection de réutilisation d'un refresh token avec révocation de toute la session : écartée
  pour l'instant, car un double envoi réseau légitime déconnecterait l'utilisateur. Le second
  essai est seulement refusé.
- Limitation de débit partagée entre instances (Redis).
