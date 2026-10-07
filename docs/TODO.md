# TODO — Le Ter

## 1. Règles métier À CLARIFIER

> Ces points proviennent des documents de `docs/`. Ils **ne doivent pas** être résolus par
> une hypothèse dans le code. Chaque point attend une décision explicite du porteur du projet,
> à consigner ensuite dans [decisions.md](decisions.md).

| # | Sujet | Constat dans les documents | Sources |
|---|---|---|---|
| R-01 | ~~Condition de victoire~~ | **TRANCHÉ (D-035)** : victoire instantanée par six combinaisons RANGÉES sur les 5 cartes initiales (1 : trois 7 ; 2 : somme ≤ 21 ; 3 : cinq de même famille ; 4 : quatre de même valeur ; 5 : trois + deux ; 6 : trois 3). La lecture « ≥ 30 points » est écartée. | Socle de vérité, octobre 2026 |
| R-02 | **Kora / Double Kora** | Seuls les montants sont donnés (100 → 200 → 300 FCFA). Le **déclencheur** (« korater une carte ») n'est pas défini, et on ne sait pas si ce sont des multiples de la mise ou des montants fixes. | Spec fonctionnelle §5.2, §5.3 |
| R-03 | ~~Obligation de suivre la couleur~~ | **TRANCHÉ (D-035)** : qui possède la famille de la carte du meneur doit la jouer (même inférieure) ; sinon n'importe quelle carte. | Décisions 46-47, 50 |
| R-04 | ~~Combinaison 7 + 7 + 4 + 3~~ | **ÉCARTÉ (D-035)** : ne fait pas partie des combinaisons du socle. | Socle de vérité |
| R-05 | **Fuite** — *en partie TRANCHÉ (D-035)* | Tranché : tour 1 seulement, avant la première carte du joueur ; un fuyard par partie ; le contrôleur peut fuir ; le fuyard reste dans la session à son siège. **Reste À CLARIFIER : le fuyard paie-t-il quelque chose ?** (finance) | Socle de vérité ; spec §2.5 |
| R-06 | **Minuteur** — *TRANCHÉ (D-034, D-036)* | **10 s par tour**, server-authoritative ; à l'échéance, TURN_TIMEOUT puis le serveur joue **la plus petite carte de la famille du contrôle** si le joueur en possède, **sinon la plus petite carte de sa main** (D-036, déterministe). 5e tour : la carte unique est jouée sans timer (D-035). Tranché (correction D-036) : l'ouvreur de chaque tour 1 à 4 joue la plus petite carte de sa main ; jeu manuel = choix du joueur, sélection automatique UNIQUEMENT au timeout et au 5e tour. **Reste À CLARIFIER** : départage d'une égalité de valeur entre familles (ex. 3♣ / 3⭐) — aucune règle validée ; départage technique provisoire, non métier, `PROVISIONAL_TIE_BREAK_ORDER` (ordre de `SUITS` ♥, ♠, ♣, ⭐) en attendant. | Scénario §5 ; diagramme « déroulement de la partie » ; décision produit oct. 2026 |
| R-07 | ~~Gain instantané~~ | **TRANCHÉ (D-035)** : analyse automatique par le serveur ; une seule main gagnante → bouton facultatif (tour 1, avant sa première carte) ; plusieurs → meilleur rang automatique, égalité → reprise immédiate ; toujours une victoire SIMPLE. | Socle de vérité |
| R-08 | ~~Couleur~~ | **TRANCHÉ (D-035)** : « même couleur » = même famille (♥, ♠, ♣, ⭐). | Décisions 44-45 |
| R-09 | **Rôle Katika / Admin** | Le Katika est le garant de la partie, prélève un **pourcentage non chiffré** et organise les tournois. Les diagrammes parlent d'un Administrateur. Même rôle ou non ? | Spec fonctionnelle §9, §13.2, §14 ; diagramme de classes ; diagramme « administration » |
| R-10 | ~~**Invité**~~ / Observateur | **TRANCHÉ (D-029) : le mode invité est supprimé.** Toute identité de joueur est un compte authentifié. Reste ouvert : le mode observateur (voir R-21). | Cas d'utilisation ; séquence connexion ; scénario §3 |
| R-11 | **Tournoi** | Création par le Katika (spec) **ou** par un joueur (cas d'utilisation, séquence). Limite « un tournoi par jour ». Partie attribuée au hasard (séquence) ou créée par les joueurs (spec). Nombre de jetons, barème des primes et départage des égalités non définis. | Spec fonctionnelle §14, §15, §16 ; séquence « gestion des tournois » ; cas d'utilisation |
| R-12 | **Noms cryptés** | Option à la création de la partie. S'agit-il de masquer les noms ou de les remplacer par des pseudonymes ? | Spec fonctionnelle §6.1 ; maquette « Partie privée » |
| R-13 | **Conversion FCFA / jetons** | La spec raisonne en FCFA, la maquette affiche des jetons « T ». Taux de conversion et usage (hors tournoi) non définis. | Spec fonctionnelle §5 ; maquette « Partie privée » |
| R-14 | Modération du chat | Faite par un Admin (scénario) ou par un Joueur (cas d'utilisation) ? | Scénario §4 ; cas d'utilisation |
| R-15 | ~~Inscription~~ | **TRANCHÉ (D-029) : téléphone obligatoire.** Champs : Prénom, Nom, Email, Pseudo, Téléphone, Mot de passe, Confirmation. Connexion par email + mot de passe ; le pseudo est le nom visible en jeu. | Spec fonctionnelle §8.1 ; séquence « création de compte » |
| R-32 | ~~Sessions~~ | **TRANCHÉ (D-029) : une seule session d'authentification active par utilisateur.** Une nouvelle connexion révoque la précédente. Sans effet sur le nombre de parties (R-18). | Décision produit, octobre 2026 |
| R-33 | Téléphone : pays | Faut-il un indicatif pays par défaut (et lequel) ? Aujourd'hui le format international (+indicatif) est exigé, sans pays présumé. | R-15 |
| R-34 | Vérification du téléphone | Fournisseur SMS, règles OTP (durée, tentatives), et la vérification est-elle exigée avant de miser ou de retirer ? `phone_verified` existe, à `false`. | R-15, R-16 |
| R-35 | Mot de passe oublié | Flux de réinitialisation (email ? SMS ?) non défini. Le bouton affiche « bientôt disponible ». | Maquette « Connexion » |
| R-16 | Montants minimum | Montant minimum de dépôt et de retrait non chiffré. | Séquence « gestion des soldes » |
| R-17 | ~~Distribution~~ | **TRANCHÉ (D-032, D-033, D-034)** : 5 cartes en deux passages (un lot de 3 par joueur, puis un lot de 2), dans le sens **antihoraire** à partir de J1, même ordre aux deux passages ; J1 commence et a le contrôle. J1 = créateur pour la 1re partie d'une session, puis gagnant précédent présent, sinon le premier siège occupé après celui du gagnant (sens antihoraire, sièges fixes). | Spec §2.2 ; décisions C.2, C.3, C.4 |

### Joueurs et parties simultanées

> Questions soulevées par l'architecture multi-parties ([multi-game-architecture.md](multi-game-architecture.md)).
> Les documents n'y répondent pas. L'architecture supporte toutes les réponses possibles :
> la règle de participation est une politique injectée (`ParticipationPolicy`), et aucune
> politique de production n'est encore câblée.

| # | Question | Ce que disent les documents | Point d'extension prévu |
|---|---|---|---|
| R-18 | ~~Plusieurs parties actives ?~~ | **TRANCHÉ (D-031) : une seule partie active (waiting ou in_progress) à la fois** ; plusieurs parties historiques ; une partie finished ne bloque pas. Garanti en base (index unique partiel), y compris en concurrence. | `singleActiveGameParticipation` + index `game_players_one_active_game_per_player` |
| R-19 | Peut-on **quitter une partie en attente** (avant la distribution) ? La mise est-elle rendue ? Est-ce différent de la fuite (R-05) ? | Cas d'utilisation « Quitter Partie » distinct de « Fuir une Session », sans règle. | Future commande `LEAVE_GAME` |
| R-20 | Après une fuite ou la fin d'une partie, peut-on **rejoindre immédiatement** une autre partie ? | Rien. | `ParticipationPolicy.canJoin` |
| R-21 | **Observateurs** : qui peut observer, combien, que voient-ils, peut-on observer plusieurs parties ou observer en jouant ? (complète R-10) | Scénario §3 uniquement. | Rôle « observateur » à ajouter au contrôle d'accès |
| R-22 | **Invitations** : une partie privée se rejoint-elle seulement par mot de passe, ou aussi par invitation ? Un joueur peut-il avoir plusieurs invitations en attente ? | Mot de passe optionnel (séquence création de partie). Aucune notion d'invitation. | Champ de partie et commande à ajouter |
| R-23 | ~~Démarrage~~ | **TRANCHÉ (D-031)** : capacité 2, 3 ou 4 à la création (un maximum) ; démarrage **par le créateur seul**, dès **2 joueurs**, sans attendre une table pleine ; plus d'adhésion ensuite. Reste ouvert : que devient une partie jamais démarrée (expiration, annulation, remboursement) ? | `POST /api/games/:gameId/start`, `assertCanStart` |
| R-24 | **Déconnexion** : le timer de tour (10 s, D-034) est-il mis en pause pendant une déconnexion ? Attend-on davantage un joueur déconnecté ? | « Le système joue à la place du joueur » si la reconnexion échoue (séquence déroulement), sans délai. Aujourd'hui : aucune pause, le timer de 10 s s'applique. | `GameTimerRegistry` / `TURN_TIMEOUT` |
| R-25 | **Partie bloquée / session suspendue** par un admin : la partie est-elle gelée (timers arrêtés), annulée, reprise plus tard ? Que deviennent les mises ? | Diagramme « administration » : statut mis à jour et notification, sans effet défini. | Statuts `blocked` / `suspended` à ajouter |

### Moteur de jeu

> Points relevés en construisant le moteur ([game-domain.md](game-domain.md)). Les points DÉDUITS
> sont codés mais doivent être confirmés. Les autres sont des politiques injectées ou lèvent
> `UnresolvedRuleError`.

| # | Question | Constat | Traitement dans le code |
|---|---|---|---|
| R-26 | ~~Cartes restantes~~ | **TRANCHÉ (D-032)** : les cartes non distribuées (21, 16 ou 11) ne sont pas une pioche, ne sont pas accessibles et ne servent pas pendant la partie. Aucune pioche, aucun remplacement. | Conservées dans `play.stock`, jamais exposées |
| R-27 | ~~Meneur des tours 2 à 5~~ | **TRANCHÉ (D-035)** : le contrôleur à la fin du tour précédent ouvre le tour suivant. | Décisions 38, 43 |
| R-28 | ~~Ordre de jeu~~ | **TRANCHÉ (D-033)** : sens antihoraire à partir du meneur, circulaire (J4 → J1). | `rotateFrom` (`domain/sessions/table-order.ts`) |
| R-29 | ~~Contenu d'un tour~~ | **TRANCHÉ (D-035)** : chaque joueur actif joue exactement une carte ; exactement 5 tours ; le 5e est joué automatiquement. | Décisions 35-36 |
| R-30 | **Fuite qui laisse un seul joueur** (partie à 2) | La fuite du contrôleur est **tranchée (D-035)** : autorisée. Reste **NON DÉFINI** : une fuite dans une partie à 2 laisserait un seul joueur actif. | `UnresolvedRuleError` : cette fuite est refusée (501) |
| R-31 | ~~Plusieurs conditions remplies~~ | **TRANCHÉ (D-035)** : le meilleur rang (le plus petit) est retenu. | Socle de vérité |

## 2. Choix techniques À CLARIFIER

| # | Sujet | Constat |
|---|---|---|
| T-01 | Temps réel | Firebase Realtime Database (chat) contre WebSocket / Socket.IO (latence, reconnexion). Un REST seul ne suffit pas pour l'état d'une partie. |
| T-02 | Notifications push | FCM est imposé. Avec Expo, `expo-notifications` est l'approche naturelle (FCM sous Android). |
| T-03 | Géolocalisation | « API Geolocation intégrée dans React Native » n'existe plus. Il faut utiliser `expo-location`. |
| T-04 | Modèle de données | Diagramme de classes : solde en double (`Joueur.solde` et `Compte.solde`), rôles de `SessionJeu`, `PartieJeu` et `SessionDevice` qui se chevauchent, `id : int` alors que les identifiants retenus sont des UUID (D-023). |
| T-05 | Déploiement | Docker et Heroku ou AWS pour le backend. EAS pour les builds mobiles n'est pas mentionné. |
| T-06 | Diagrammes manquants | Les critères de sprint citent des diagrammes d'état, de composants, d'architecture et de flux utilisateur absents de `docs/`. |
| T-07 | Conformité | Le jeu se joue en argent réel (FCFA, Mobile Money). Il faut vérifier la licence de jeux d'argent requise dans le pays visé et les règles de l'App Store et du Play Store. |
| T-08 | Plusieurs instances du backend | Diffusion inter-instances en place (Redis Pub/Sub, D-024) et écritures protégées par la version optimiste. Reste à choisir : affinité par `gameId` (commandes et timers sur la même instance) ou coordination des timers et des commandes via Redis. |

## 3. Fondation technique — suite

- [x] Frontend : ESLint configuré (`npm run lint` = `expo lint`, eslint-config-expo).
- [ ] Frontend : tests (Jest + React Native Testing Library).
- [ ] Backend : documentation Swagger/OpenAPI de l'API.
- [ ] Backend : stratégie de validation des entrées (`validators/`).
- [ ] Frontend : client API (`src/services/`) pointant vers `/api/health`.
- [ ] Frontend : vérifier le verrouillage paysage (D-028) sur un build de développement Android et iOS (téléphone et iPad), clavier ouvert compris.
- [x] Commit initial de la nouvelle structure.

## 4. Multi-parties — suite

- [x] Socle d'isolation backend : `GameId`, agrégat `Game`, `GameService`, file par partie, timers par partie, salles `game:{gameId}`, contrôle d'accès, dépôt versionné, logs structurés, tests d'isolation.
- [x] ~~Modèle Mongoose `Game` + `MongoGameRepository`~~ : abandonné (D-022). Remplacé par `PostgresGameRepository`, tables `games` + `game_players` et index de D-025.
- [x] Diffusion inter-instances des événements de partie : `PubSubGameEventBus` sur Redis (D-024).
- [x] Middleware `/api/games/:gameId` (validation → 404 → 403) et routes REST de partie (D-030).
- [ ] Adaptateur temps réel du port `GameEventPublisher` / `GameEventSubscriber`, une fois T-01 tranché.
- [x] Politique de participation de production : R-18 tranchée (D-031). R-20 (rejoindre juste après une fuite) reste ouverte : un fuyard reste membre de sa partie jusqu'à sa fin.
- [ ] Réarmement des timers au démarrage à partir de `turnDeadlineAt`.
- [x] `requestId` par requête HTTP (`X-Request-Id`, D-027).
- [ ] `requestId` par message temps réel (avec le transport, T-01).
- [ ] Frontend : route `app/game/[gameId].tsx`, hook `useGameChannel(gameId)`, clés TanStack Query par `gameId` (D-017).

## 5. Moteur de jeu — suite

- [x] Cartes, paquet, Fisher-Yates, distribution, contrôle, tours, fin, gain instantané, fuite, mise simple (D-018 à D-021).
- [x] **Jeu de règles de production** : `OFFICIAL_TER_RULES` (D-035, socle de vérité des 52 décisions). Restent ouverts : fuite dans une partie à 2 (R-30), coût de la fuite (R-05), Kora (R-02), finance.
- [ ] Kora / Double Kora (R-02), prélèvement du Katika (R-09), unité de mise (R-13).
- [x] Choix de la carte jouée automatiquement après TURN_TIMEOUT (R-06, D-036,
  `LowestCardAutomaticSelectionStrategy`).
- [ ] Effet de la déconnexion sur le timer (R-24).
- [x] Routes REST des commandes `play-card`, `declare-win`, `flee` (D-030).
- [x] Commande `start` (R-23, D-031).
- [ ] Transport temps réel des commandes (T-01).

## 6. PostgreSQL et Redis — suite

- [x] PostgreSQL source de vérité, pilote `pg`, port `SqlClient`, migrations versionnées (D-022, D-026).
- [x] `gameId` en UUID (D-023).
- [x] Redis : connexions, Pub/Sub inter-instances, état dans `/api/health` (D-024).
- [x] Câbler `GameService` au démarrage (`PostgresGameRepository` + `PubSubGameEventBus`) avec les routes de partie (D-030).
- [ ] Test d'intégration contre un vrai PostgreSQL et un vrai Redis en CI (aujourd'hui : PGlite et courtier en mémoire).
- [ ] Schémas des comptes, de la finance (portefeuilles, transactions, paiements) et des tournois, une fois les règles correspondantes clarifiées (R-02, R-05, R-09 à R-16, T-04, T-07).
- [ ] Journal d'audit `game_events` (append-only).
- [ ] Configuration production : TLS PostgreSQL et Redis (`rediss://`), taille du pool, sauvegardes PostgreSQL.

## 7. Audit backend (D-027) — suite

Corrigé pendant l'audit : ordre des événements (`sequence`), diffusion qui ne fait plus
échouer une commande enregistrée, réabonnement Pub/Sub après coupure Redis, délais du pool
PostgreSQL, `DATABASE_URL` obligatoire en production, `X-Request-Id`, statuts 4xx/500,
journal des commandes refusées, arrêt forcé.

À faire, dans l'ordre des phases :

- **Phase B — Authentification** : **faite** (D-029, [authentication.md](authentication.md)).
  - [x] Migrations `0002` (`users`, `refresh_tokens`) et `0003` (`creator_id`, `player_id`
    en `uuid` avec clés étrangères vers `users`).
  - [x] bcrypt, JWT 15 min, refresh token opaque haché, rotation, révocation, logout, `/me`.
  - [x] Session unique (R-32), y compris en concurrence (verrou par utilisateur + index unique).
  - [x] `requireAuth` / `getAuth(res)`, identité issue du JWT uniquement.
  - [x] Frontend : écrans connexion et inscription en 2 étapes, SecureStore, Zustand + TanStack Query.
  - [ ] Vérification du téléphone par SMS (R-34), mot de passe oublié (R-35).
  - [ ] Rôles Admin / Katika (R-09).
  - [ ] Limitation de débit partagée entre instances (Redis) si plusieurs instances.
- **Phase C — API de partie** : **faite** (D-030, multi-game-architecture.md §7).
  - [x] Composition au démarrage (`create-game-service.ts`) : `PostgresGameRepository` +
    `PubSubGameEventBus` sur Redis (`InMemoryGameEventHub` sans Redis) + timers, et
    `timers.cancelAll()` à l'arrêt.
  - [x] Validateurs `game.validators.ts` ; `:gameId` validé par `router.param` (400) ;
    erreurs du domaine traduites (`middleware/api-errors.ts` : 400, 403, 404, 409, 422, 501).
  - [x] Routes `POST /api/games`, `GET /api/games/me/active`, `GET /api/games/:gameId`,
    `POST /api/games/:gameId/join`, `POST /api/games/:gameId/actions`, toutes derrière
    `requireAuth` ; limitation de débit des écritures par utilisateur ; en-têtes de
    sécurité (`Cache-Control: no-store`, `nosniff`…) sans dépendance.
  - [x] Frontend : accueil (créer, rejoindre par identifiant, mes parties), écran
    `app/game/[gameId].tsx` provisoire, hooks TanStack Query indexés par `gameId`.
  - [x] R-18 tranchée et garantie en base (D-031) ; `GAME_PARTICIPATION_POLICY` supprimée.
  - [x] Démarrage `POST /api/games/:gameId/start` (R-23, D-031), créateur seul, dès 2 joueurs.
  - [x] Distribution au démarrage (D-032, D-033) : 5 cartes par joueur, lots de 3 puis de 2,
    sens antihoraire depuis J1, contrôle initial, dans la même transition que le démarrage.
  - [x] Ordre des joueurs dans un tour (R-28, D-033).
  - [x] Coups jouables en production (D-035 : R-03 et R-08 tranchées).
    `npm run game:finish -- <gameId>` termine une partie bloquée.
- **Phase C.3 — Sessions** : **faite** (D-033).
  - [x] Sessions OPEN/CLOSED, joueurs de session ≠ joueurs de partie, fermeture automatique,
    parties successives, J1 (créateur, gagnant précédent, suivant actif antihoraire).
  - [x] API `/api/sessions`, événements `session:*`, écrans session et accueil.
  - [ ] À confirmer : quitter une session pendant une partie (R-19, R-05) ; J1 absent de la
    partie ; partie précédente terminée sans gagnant ; retour d'un joueur (nouvelle place) ;
    présence dans plusieurs sessions ; nombre maximal de joueurs par session.
  - [ ] Abonnement temps réel aux événements de session (phase D).
- **Phase C.5 — Socle de vérité (52 décisions)** : **faite** (D-035).
  - [x] Règles officielles : famille, obligation de suivre, contrôle en fin de tour, 5 tours
    dont le 5e automatique, fuite au tour 1, victoire instantanée rangée (6 rangs),
    victoire automatique / égalité → reprise immédiate dans la session (même J1).
  - [x] Glisser-déposer des cartes ; boutons « Fuir » et « Gagner instantanément » pilotés
    par le serveur (`myActions`).
  - [ ] Non défini : fuite dans une partie à 2 (R-30) ; reprise après égalité si J1 ou un
    joueur a quitté la session entre-temps ; ronde Poursuivre/Quitter après un arrêt
    administratif (ouverte aujourd'hui, à confirmer).
- **Phase C.4 — Capacité, sièges, Poursuivre/Quitter, timers** : **faite** (D-034).
  - [x] `maxPlayers` 2/3/4 de session, immuable ; une seule session active par joueur.
  - [x] Sièges fixes, siège vacant réutilisé ; J1 change sans déplacer les sièges.
  - [x] Ronde Poursuivre/Quitter de 10 s, AUTO_LEAVE à l'échéance, persistée.
  - [x] Timer de tour de 10 s persisté ; TURN_TIMEOUT ; coup tardif refusé.
  - [x] Timers reconstruits depuis PostgreSQL au redémarrage, balayage des échéances.
  - [x] Coup automatique après TURN_TIMEOUT : plus petite carte de la famille du contrôle,
    sinon plus petite carte de la main (D-036).
  - [ ] À confirmer : arrivée pendant une ronde de décision (refusée aujourd'hui) ; création
    automatique ou manuelle de la partie suivante (manuelle aujourd'hui).
  - [ ] Partie jamais démarrée : expiration ou annulation (suite de R-23).
  - [ ] Quitter une partie en attente (R-19) ; lobby public et parties privées (R-22).
  - [ ] Pseudos des autres joueurs dans la vue de partie (bloqué par R-12, noms cryptés).
  - [x] Idempotence de la création (`Idempotency-Key` obligatoire, unique par créateur, D-031).
  - [ ] CORS : seulement si Expo web est visé (l'app native n'en a pas besoin).
- **Phase D — Temps réel** (T-01) :
  - [ ] Choisir le transport, authentifier la connexion par JWT, abonnement par
    `GameService.subscribe`, désabonnement à la déconnexion.
  - [ ] Nouvel essai automatique d'une commande sans `expectedVersion` refusée pour conflit
    de version entre instances, ou affinité par `gameId` (T-08).
- **Phase E — Cycle de vie** :
  - [x] Réarmement des timers au démarrage depuis PostgreSQL (D-034, `DeadlineSupervisor`) ;
    balayage périodique des échéances dépassées par chaque instance (idempotent).
  - [ ] Pause du timer pendant une déconnexion (R-24).
  - [ ] Sonde de disponibilité (`/api/health/ready`, 503 si PostgreSQL est indisponible),
    distincte de la vivacité `/api/health`.
- **Exploitation** :
  - [ ] Niveau de log configurable (`LOG_LEVEL`) ; journal d'accès HTTP sans corps ni
    en-têtes sensibles.
  - [ ] Tests d'intégration contre un vrai PostgreSQL et un vrai Redis en CI (Docker).
