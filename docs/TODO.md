# TODO — Le Ter

## 1. Règles métier À CLARIFIER

> Ces points proviennent des documents de `docs/`. Ils **ne doivent pas** être résolus par
> une hypothèse dans le code. Chaque point attend une décision explicite du porteur du projet,
> à consigner ensuite dans [decisions.md](decisions.md).

| # | Sujet | Constat dans les documents | Sources |
|---|---|---|---|
| R-01 | **Condition de victoire** | La spec fonctionnelle donne un gain instantané si la somme des cartes est **≤ 21**. Le document `checkWinCondition` propose une victoire à **≥ 30 points** et parle de valets, dames et rois, absents du paquet. | Spec fonctionnelle §4 ; « Pour intégrer la vérification des points… » |
| R-02 | **Kora / Double Kora** | Seuls les montants sont donnés (100 → 200 → 300 FCFA). Le **déclencheur** (« korater une carte ») n'est pas défini, et on ne sait pas si ce sont des multiples de la mise ou des montants fixes. | Spec fonctionnelle §5.2, §5.3 |
| R-03 | **Obligation de suivre la couleur** | Pour prendre le contrôle, il faut jouer une carte plus forte de la même couleur. Rien n'est dit sur le cas où le joueur n'a pas la couleur, ni sur le fait de devoir suivre. | Spec fonctionnelle §2.4 |
| R-04 | **Combinaison 7 + 7 + 4 + 3** | La combinaison ne décrit que 4 cartes sur une main de 5. La 5e carte n'est pas précisée. | Spec fonctionnelle §4 |
| R-05 | **Fuite** | « Pas joué plus d'une carte » (spec) contre « avant le 2e tour » (diagramme de séquence). On ne sait pas si le fuyard paie quelque chose. Limite : un fuyard par partie. | Spec fonctionnelle §2.5 ; diagramme « déroulement de la partie » ; scénario §6 |
| R-06 | **Minuteur** | Durée du « temps imparti » non définie. Le scénario dit que le tour est **passé**, le diagramme dit que le **système joue** à la place du joueur (en cas de déconnexion). | Scénario §5 ; diagramme « déroulement de la partie » |
| R-07 | **Gain instantané** | Détection automatique ou bouton « Main gagnante » ? Jusqu'à quel moment peut-on le déclarer ? Que se passe-t-il s'il n'est pas déclaré ? Le cas « 4 cartes de même valeur » est impossible avec le 10 (pas de 10 de pique). | Spec fonctionnelle §2.3, §4 ; scénario §6 ; diagramme « déroulement » |
| R-08 | **Couleur** | « Même couleur » désigne probablement la famille (cœur, pique, trèfle, étoile) et non rouge/noir. Ce n'est pas écrit explicitement. | Spec fonctionnelle §2.1, §2.4, §4 |
| R-09 | **Rôle Katika / Admin** | Le Katika est le garant de la partie, prélève un **pourcentage non chiffré** et organise les tournois. Les diagrammes parlent d'un Administrateur. Même rôle ou non ? | Spec fonctionnelle §9, §13.2, §14 ; diagramme de classes ; diagramme « administration » |
| R-10 | **Invité / Observateur** | Connexion en invité (cas d'utilisation, séquence connexion) et mode observateur (scénario) absents de la spec fonctionnelle. Un invité peut-il miser ? Que voit un observateur ? | Cas d'utilisation ; séquence connexion ; scénario §3 |
| R-11 | **Tournoi** | Création par le Katika (spec) **ou** par un joueur (cas d'utilisation, séquence). Limite « un tournoi par jour ». Partie attribuée au hasard (séquence) ou créée par les joueurs (spec). Nombre de jetons, barème des primes et départage des égalités non définis. | Spec fonctionnelle §14, §15, §16 ; séquence « gestion des tournois » ; cas d'utilisation |
| R-12 | **Noms cryptés** | Option à la création de la partie. S'agit-il de masquer les noms ou de les remplacer par des pseudonymes ? | Spec fonctionnelle §6.1 ; maquette « Partie privée » |
| R-13 | **Conversion FCFA / jetons** | La spec raisonne en FCFA, la maquette affiche des jetons « T ». Taux de conversion et usage (hors tournoi) non définis. | Spec fonctionnelle §5 ; maquette « Partie privée » |
| R-14 | Modération du chat | Faite par un Admin (scénario) ou par un Joueur (cas d'utilisation) ? | Scénario §4 ; cas d'utilisation |
| R-15 | Inscription | Téléphone exigé (spec) mais absent du diagramme de création de compte. | Spec fonctionnelle §8.1 ; séquence « création de compte » |
| R-16 | Montants minimum | Montant minimum de dépôt et de retrait non chiffré. | Séquence « gestion des soldes » |
| R-17 | Ordre de jeu | « Le premier joueur à recevoir ses cartes commence. » Comment est choisi le donneur ? Y a-t-il une rotation entre les parties ? | Spec fonctionnelle §2.2 |

### Joueurs et parties simultanées

> Questions soulevées par l'architecture multi-parties ([multi-game-architecture.md](multi-game-architecture.md)).
> Les documents n'y répondent pas. L'architecture supporte toutes les réponses possibles :
> la règle de participation est une politique injectée (`ParticipationPolicy`), et aucune
> politique de production n'est encore câblée.

| # | Question | Ce que disent les documents | Point d'extension prévu |
|---|---|---|---|
| R-18 | Un joueur peut-il être membre de **plusieurs parties actives** en même temps, ou d'une seule ? | Rien. La spec gère « plusieurs groupes de jeu simultanément » (§7) sans parler d'un même joueur. | `ParticipationPolicy.canJoin` |
| R-19 | Peut-on **quitter une partie en attente** (avant la distribution) ? La mise est-elle rendue ? Est-ce différent de la fuite (R-05) ? | Cas d'utilisation « Quitter Partie » distinct de « Fuir une Session », sans règle. | Future commande `LEAVE_GAME` |
| R-20 | Après une fuite ou la fin d'une partie, peut-on **rejoindre immédiatement** une autre partie ? | Rien. | `ParticipationPolicy.canJoin` |
| R-21 | **Observateurs** : qui peut observer, combien, que voient-ils, peut-on observer plusieurs parties ou observer en jouant ? (complète R-10) | Scénario §3 uniquement. | Rôle « observateur » à ajouter au contrôle d'accès |
| R-22 | **Invitations** : une partie privée se rejoint-elle seulement par mot de passe, ou aussi par invitation ? Un joueur peut-il avoir plusieurs invitations en attente ? | Mot de passe optionnel (séquence création de partie). Aucune notion d'invitation. | Champ de partie et commande à ajouter |
| R-23 | **Démarrage** : automatique quand la partie est complète, ou à l'initiative du créateur ? Que devient une partie jamais complétée (expiration, annulation, remboursement) ? | « En attente de (max−1) joueurs pour démarrer » (séquence création de partie). | Transition `waiting → in_progress` |
| R-24 | **Déconnexion** : combien de temps attend-on un joueur déconnecté avant que le système joue pour lui ? Le timer est-il mis en pause ? | « Le système joue à la place du joueur » si la reconnexion échoue (séquence déroulement), sans délai. Lié à R-06. | `GameTimerRegistry` / `TURN_TIMEOUT` |
| R-25 | **Partie bloquée / session suspendue** par un admin : la partie est-elle gelée (timers arrêtés), annulée, reprise plus tard ? Que deviennent les mises ? | Diagramme « administration » : statut mis à jour et notification, sans effet défini. | Statuts `blocked` / `suspended` à ajouter |

### Moteur de jeu

> Points relevés en construisant le moteur ([game-domain.md](game-domain.md)). Les points DÉDUITS
> sont codés mais doivent être confirmés. Les autres sont des politiques injectées ou lèvent
> `UnresolvedRuleError`.

| # | Question | Constat | Traitement dans le code |
|---|---|---|---|
| R-26 | **Cartes restantes** : que deviennent les 21, 16 ou 11 cartes non distribuées (pioche, défausse, rien) ? | Les documents ne parlent que de la distribution de 5 cartes. | Conservées dans `play.stock`, jamais utilisées ni exposées |
| R-27 | **Meneur des tours 2 à 5** : est-ce le joueur qui a le contrôle ? | DÉDUIT : la prise de contrôle se mesure à « la carte jouée par le joueur ayant le contrôle » (§2.4), ce qui suppose qu'il joue en premier. | Le contrôleur ouvre chaque tour (`openTrick`) |
| R-28 | **Ordre de jeu** dans un tour : sens horaire, ordre de distribution, ordre d'arrivée ? | Non dit. | `PlayOrderPolicy` |
| R-29 | **Contenu d'un tour** : chaque joueur joue-t-il exactement une carte par tour ? | DÉDUIT : 5 cartes en main, 5 tours, une carte par itération dans la séquence « déroulement ». | Un coup par joueur en jeu et par tour |
| R-30 | **Fuite du contrôleur** (le premier servi a le contrôle avant même de jouer) ; **fuite qui laisse un seul joueur** (partie à 2) | Non dit. | `UnresolvedRuleError` : la fuite est refusée dans ces deux cas |
| R-31 | **Plusieurs conditions de gain instantané remplies** : laquelle est « la méthode » affichée (§17) ? Influence-t-elle le gain (Kora) ? | Non dit. | Toutes listées dans `result.instantWinConditions`, sans priorité |

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

- [ ] Frontend : configurer ESLint (`npx expo lint`) et les tests (Jest + React Native Testing Library).
- [ ] Backend : documentation Swagger/OpenAPI de l'API.
- [ ] Backend : stratégie de validation des entrées (`validators/`).
- [ ] Frontend : client API (`src/services/`) pointant vers `/api/health`.
- [x] Commit initial de la nouvelle structure.

## 4. Multi-parties — suite

- [x] Socle d'isolation backend : `GameId`, agrégat `Game`, `GameService`, file par partie, timers par partie, salles `game:{gameId}`, contrôle d'accès, dépôt versionné, logs structurés, tests d'isolation.
- [x] ~~Modèle Mongoose `Game` + `MongoGameRepository`~~ : abandonné (D-022). Remplacé par `PostgresGameRepository`, tables `games` + `game_players` et index de D-025.
- [x] Diffusion inter-instances des événements de partie : `PubSubGameEventBus` sur Redis (D-024).
- [ ] Middleware `/api/games/:gameId` (validation → 404 → 403) et routes REST de partie.
- [ ] Adaptateur temps réel du port `GameEventPublisher` / `GameEventSubscriber`, une fois T-01 tranché.
- [ ] Politique de participation de production, une fois R-18 et R-20 tranchés.
- [ ] Réarmement des timers au démarrage à partir de `turnDeadlineAt`.
- [ ] `requestId` par requête HTTP et par message temps réel.
- [ ] Frontend : route `app/game/[gameId].tsx`, hook `useGameChannel(gameId)`, clés TanStack Query par `gameId` (D-017).

## 5. Moteur de jeu — suite

- [x] Cartes, paquet, Fisher-Yates, distribution, contrôle, tours, fin, gain instantané, fuite, mise simple (D-018 à D-021).
- [ ] **Jeu de règles de production** : trancher R-01, R-03, R-05, R-07, R-08, R-17, R-28 (et confirmer R-27, R-29), puis assembler un `TerRuleSet` et le consigner dans `decisions.md`.
- [ ] Kora / Double Kora (R-02), prélèvement du Katika (R-09), unité de mise (R-13).
- [ ] Effet de l'expiration du timer et de la déconnexion (R-06, R-24).
- [ ] Routes REST et transport temps réel des commandes `start`, `play-card`, `declare-win`, `flee`.

## 6. PostgreSQL et Redis — suite

- [x] PostgreSQL source de vérité, pilote `pg`, port `SqlClient`, migrations versionnées (D-022, D-026).
- [x] `gameId` en UUID (D-023).
- [x] Redis : connexions, Pub/Sub inter-instances, état dans `/api/health` (D-024).
- [ ] Câbler `GameService` au démarrage (`PostgresGameRepository` + `PubSubGameEventBus`) avec les routes de partie.
- [ ] Test d'intégration contre un vrai PostgreSQL et un vrai Redis en CI (aujourd'hui : PGlite et courtier en mémoire).
- [ ] Schémas des comptes, de la finance (portefeuilles, transactions, paiements) et des tournois, une fois les règles correspondantes clarifiées (R-02, R-05, R-09 à R-16, T-04, T-07).
- [ ] Journal d'audit `game_events` (append-only).
- [ ] Configuration production : TLS PostgreSQL et Redis (`rediss://`), taille du pool, sauvegardes PostgreSQL.
