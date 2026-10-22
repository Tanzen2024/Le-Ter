# TODO — Le Ter

## 1. Règles métier À CLARIFIER

> Ces points proviennent des documents de `docs/`. Ils **ne doivent pas** être résolus par
> une hypothèse dans le code. Chaque point attend une décision explicite du porteur du projet,
> à consigner ensuite dans [decisions.md](decisions.md).

| # | Sujet | Constat dans les documents | Sources |
|---|---|---|---|
| R-01 | ~~Condition de victoire~~ | **TRANCHÉ (D-035)** : victoire instantanée par six combinaisons RANGÉES sur les 5 cartes initiales (1 : trois 7 ; 2 : somme ≤ 21 ; 3 : cinq de même famille ; 4 : quatre de même valeur ; 5 : trois + deux ; 6 : trois 3). La lecture « ≥ 30 points » est écartée. | Socle de vérité, octobre 2026 |
| R-02 | **Kora / Double Kora** — *en partie TRANCHÉ (D-074, D-080)* | Tranché : Kora = le gagnant remporte le 5e tour avec un 3 ; chaque perdant perd 2 × la mise, taux de commission inchangé (D-080). **Reste À CLARIFIER : la Double Kora** (déclencheur et montant). | Spec fonctionnelle §5.2, §5.3 ; D-074 |
| R-03 | ~~Obligation de suivre la couleur~~ | **TRANCHÉ (D-035)** : qui possède la famille de la carte du meneur doit la jouer (même inférieure) ; sinon n'importe quelle carte. | Décisions 46-47, 50 |
| R-04 | ~~Combinaison 7 + 7 + 4 + 3~~ | **TRANCHÉ (D-118, modifie D-035)** : « Composition de 7 », main spéciale de rang 6 (avant « Trois 3 », rang 7). Écartée par D-035, réintroduite par le propriétaire. | Socle de vérité |
| R-05 | **Fuite** — *en partie TRANCHÉ (D-035)* | Tranché : avant la deuxième carte du joueur, tours 1 et 2 (D-089, révise D-035) ; un fuyard par partie ; le contrôleur peut fuir ; le fuyard reste dans la session à son siège. Partie à 2 **tranchée (D-086)** : le fuyard paie sa mise comme un perdant (commission habituelle). **Reste À CLARIFIER : le fuyard d'une partie à 3 ou 4 paie-t-il quelque chose ?** (finance) | Socle de vérité ; spec §2.5 |
| R-06 | **Minuteur** — *TRANCHÉ (D-034, D-036, D-064)* | **20 s par tour** (D-064, 10 s auparavant), server-authoritative ; à l'échéance, TURN_TIMEOUT puis le serveur joue **la plus petite carte de la famille du contrôle** si le joueur en possède, **sinon la plus petite carte de sa main** (D-036, déterministe). 5e tour : la carte unique est jouée sans timer (D-035). Tranché (correction D-036) : l'ouvreur de chaque tour 1 à 4 joue la plus petite carte de sa main ; jeu manuel = choix du joueur, sélection automatique UNIQUEMENT au timeout et au 5e tour. **Reste À CLARIFIER** : départage d'une égalité de valeur entre familles (ex. 3♣ / 3⭐) — aucune règle validée ; départage technique provisoire, non métier, `PROVISIONAL_TIE_BREAK_ORDER` (ordre de `SUITS` ♥, ♠, ♣, ⭐) en attendant. | Scénario §5 ; diagramme « déroulement de la partie » ; décision produit oct. 2026 |
| R-07 | ~~Gain instantané~~ | **TRANCHÉ (D-035)** : analyse automatique par le serveur ; une seule main gagnante → bouton facultatif (tour 1, avant sa première carte) ; plusieurs → meilleur rang automatique, égalité → reprise immédiate ; toujours une victoire SIMPLE. | Socle de vérité |
| R-08 | ~~Couleur~~ | **TRANCHÉ (D-035)** : « même couleur » = même famille (♥, ♠, ♣, ⭐). | Décisions 44-45 |
| R-09 | ~~Rôle d'administration et compte des commissions~~ | **TRANCHÉ (D-060, D-061)** : l'appellation « Katika » est supprimée. Le compte central des commissions est le **compte financier de la plateforme Le-Ter** (`platform_ledger`, D-060), qui n'est pas un compte utilisateur ; le seul rôle d'administration est `admin`, présenté comme `SUPER_ADMIN` (D-061). La commission sur les parties ordinaires reste ouverte (R-37). | Spec fonctionnelle §9, §13.2, §14 ; diagramme de classes ; diagramme « administration » |
| R-10 | ~~**Invité**~~ / Observateur | **TRANCHÉ (D-029) : le mode invité est supprimé.** Toute identité de joueur est un compte authentifié. Reste ouvert : le mode observateur (voir R-21). | Cas d'utilisation ; séquence connexion ; scénario §3 |
| R-11 | ~~Tournoi~~ | **TRANCHÉ (D-054, complète D-051)** : création par l’admin (publiée) ou proposée par un joueur (brouillon → approbation) ; pas de chevauchement (garanti en base) ; inscription = **réservation** du prix d’entrée (capturée au démarrage, libérée si annulation) ; minimum/maximum de joueurs ; commission plateforme copiée à la publication ; jetons de tournoi (1 000) et mise par partie (100), participation tant que jetons ≥ 2 × mise (D-063) ; classement par score pondéré jetons restants / parties jouées, 50 % / 50 % par défaut (D-062, remplace l’ordre jetons → parties jouées → gagnées → inscription) ; gains par rang (reste au 1er, rangs vides non attribués) ; notifications dans l’application ; export CSV ; liste des tournois, tables de 4 attribuées par le serveur (la plus remplie d’abord), démarrage par le premier joueur affecté ou automatique 20 s après l’arrivée du 2e joueur (D-065). | Spec fonctionnelle §14, §15, §16 ; séquence « gestion des tournois » |
| R-12 | **Noms cryptés** | *En partie TRANCHÉ (D-064) : les pseudos réels sont affichés à la table.* Reste : option à la création de la partie. S'agit-il de masquer les noms ou de les remplacer par des pseudonymes ? | Spec fonctionnelle §6.1 ; maquette « Partie privée » |
| R-13 | **Conversion FCFA / jetons** | **Partiellement TRANCHÉ** : 1 FCFA = 1 jeton pour l’ACHAT (D-050), les TOURNOIS (prix d’entrée, gains : D-054) et le RETRAIT (D-075). Reste ouvert : la mise des parties privées. | Spec fonctionnelle §5 ; maquette « Partie privée » |
| R-14 | ~~Modération du chat~~ | **TRANCHÉ (D-079)** : faite par l'administration (restriction d'envoi par joueur, toutes ses parties, motif, durée déterminée ou indéterminée, levable). Une modération par les joueurs est hors périmètre. | Scénario §4 ; cas d'utilisation ; D-079 |
| R-15 | ~~Inscription~~ | **TRANCHÉ (D-029) : téléphone obligatoire.** Champs : Prénom, Nom, Email, Pseudo, Téléphone, Mot de passe, Confirmation. Connexion par email + mot de passe ; le pseudo est le nom visible en jeu. | Spec fonctionnelle §8.1 ; séquence « création de compte » |
| R-32 | ~~Sessions~~ | **TRANCHÉ (D-029) : une seule session d'authentification active par utilisateur.** Une nouvelle connexion révoque la précédente. Sans effet sur le nombre de parties (R-18). | Décision produit, octobre 2026 |
| R-33 | ~~Téléphone : pays~~ | **TRANCHÉ (D-139)** : Cameroun (+237) présélectionné, modifiable par la liste des pays, à la connexion, à l'inscription et dans la récupération du mot de passe ; seul le numéro national est saisi, le serveur reconstruit le E.164. | R-15 |
| R-34 | Vérification du téléphone | Fournisseur SMS, règles OTP (durée, tentatives), et la vérification est-elle exigée avant de miser ou de retirer ? `phone_verified` existe, à `false`. | R-15, R-16 |
| R-35 | Mot de passe oublié | **TRANCHÉ par D-135** : code de récupération (sans SMS), réinitialisation depuis le mobile, récupération par l'assistance si le code est perdu. | Maquette « Connexion » |
| R-36 | **Détection anti-collusion** | Seul le réglage `suspicionDetectionEnabled` existe (D-043 : choisi à la création, désactivé par défaut, immuable, affiché 🛡️). Socle technique en place (D-044 : `DetectionService`, signaux et scores de risque par partie). Feuille de route ([detection.md](detection.md)) : étape 1 Fondation DONE (D-044) · étape 2 Géolocalisation DONE (D-046) · étape 3 Analyse comportementale DONE (D-047) · étape 4 Score + alertes internes DONE après validation (D-048) · étape 5 Administration DONE (D-049 : consultation et statut des alertes, audit, rôle `admin` PROVISOIRE attribué par `npm run user:role`) · interrupteur global DONE (D-053 : désactivé par défaut, écran `/admin`). GARAM TIA branché sur le même système (D-125).  Restent à définir : validation de TOUS les seuils, contributions et règles d'alerte provisoires, usage des parties non surveillées (exclues aujourd'hui), données réseau (aucune IP conservée), quelles conséquences (alerte, examen par l’administration, sanction), machine d'état des alertes provisoire (aucune réouverture), interface d'administration, quelle transparence envers les joueurs ? Analyse des choix de cartes propre à GARAM (CARD_CHOICE_ANOMALY ne s'applique qu'au Ter) ? | Demande produit (octobre 2026) |
| R-37 | ~~Commission sur les parties ordinaires~~ | **TRANCHÉ (D-074)** : prélevée sur les mises des perdants, au taux de la tranche de la mise (barème modifiable dans l'administration, 0 % à 10 % au départ) ; la Kora double la perte, pas le taux (D-080) ; aucun mouvement avant le règlement ; le gagnant récupère sa mise et reçoit le reste. | Spec fonctionnelle §9 ; D-060 ; D-074 ; D-080 |
| R-38 | **Retraits de la plateforme : contrat CinetPay** (D-078) | À confirmer : autorisation Mass Payout/transfert pour reverser les revenus de la plateforme à elle-même, barème des frais (`PLATFORM_PAYOUT_FEE_BPS`/`_FIXED`), plafonds, code de succès et format exacts de `GET /v1/balances`, frais renvoyés par `GET /v1/transfer`. Exécution désactivée tant que non confirmé. | D-078 ; SDK `cinetpay-js` |
| R-39 | **Retraits de la plateforme : rôles** (D-078) | Un seul rôle `admin` : la séparation initiateur ≠ approbateur est imposée, mais qui peut initier, approuver, mettre en exécution ou annuler n'est pas défini (rôle financier dédié ? seuils ? troisième validation au-delà d'un montant ?). | D-061 ; D-078 |
| R-40 | **Bénéficiaire de la plateforme** (D-078) | Qui est le bénéficiaire autorisé (compte de la société, dirigeant ?), quelles preuves de titularité exige CinetPay, conservation du numéro (chiffrement au repos ?). | D-078 |
| R-41 | **Sortie de `RECONCILIATION_REQUIRED`** (D-078) | Aucune voie manuelle n'existe : un retrait sans preuve reste réservé. Faut-il une clôture à double validation sur confirmation écrite de CinetPay (comme D-076) ? | D-076 ; D-078 |
| R-16 | Montants minimum | **TRANCHÉ** : achat d'un montant saisi, entier de 100 à 2 500 000 FCFA (limites du contrat CinetPay v1, D-085, remplace les montants fixes de D-050) ; retrait minimum 1 000 jetons, maximum 1 500 000 (plafond CinetPay) (D-075). | Séquence « gestion des soldes » |
| R-17 | ~~Distribution~~ | **TRANCHÉ (D-032, D-033, D-034)** : 5 cartes en deux passages (un lot de 3 par joueur, puis un lot de 2), dans le sens **antihoraire** à partir de J1, même ordre aux deux passages ; J1 commence et a le contrôle. J1 = créateur pour la 1re partie d'une session, puis gagnant précédent présent, sinon le premier siège occupé après celui du gagnant (sens antihoraire, sièges fixes). | Spec §2.2 ; décisions C.2, C.3, C.4 |

### Joueurs et parties simultanées

> Questions soulevées par l'architecture multi-parties ([multi-game-architecture.md](multi-game-architecture.md)).
> Les documents n'y répondent pas. L'architecture supporte toutes les réponses possibles :
> la règle de participation est une politique injectée (`ParticipationPolicy`), et aucune
> politique de production n'est encore câblée.

| # | Question | Ce que disent les documents | Point d'extension prévu |
|---|---|---|---|
| R-18 | ~~Plusieurs parties actives ?~~ | **TRANCHÉ (D-031) : une seule partie active (waiting ou in_progress) à la fois** ; plusieurs parties historiques ; une partie finished ne bloque pas. Garanti en base (index unique partiel), y compris en concurrence. | `singleActiveGameParticipation` + index `game_players_one_active_game_per_player` |
| R-19 | ~~Quitter une partie en attente~~ | **TRANCHÉ (D-037)** : partie EN ATTENTE → on quitte directement la session (et la partie) ; partie EN COURS → départ direct refusé (`PLAYER_IN_ACTIVE_GAME`), la fuite ne concerne que la partie ; partie TERMINÉE → Poursuivre / Quitter (20 s, D-064). Q1 : session sans joueur supprimée ; Q2 : J1 qui part → joueur suivant dans l'ordre d'arrivée ; Q3 : siège libéré, les autres ne bougent pas. Reste ouvert : la mise (R-13, finance). | `SessionService.leaveSession`, `SessionRepository.leave` |
| R-20 | Après une fuite ou la fin d'une partie, peut-on **rejoindre immédiatement** une autre partie ? | Rien. | `ParticipationPolicy.canJoin` |
| R-21 | **Observateurs** : qui peut observer, combien, que voient-ils, peut-on observer plusieurs parties ou observer en jouant ? (complète R-10) | Scénario §3 uniquement. | Rôle « observateur » à ajouter au contrôle d'accès |
| R-22 | **Invitations** : une partie privée se rejoint-elle seulement par mot de passe, ou aussi par invitation ? Un joueur peut-il avoir plusieurs invitations en attente ? | Mot de passe optionnel (séquence création de partie) : **implémenté (D-039)**. Reste ouvert : invitations. | Invitations : champ et commande à ajouter |
| R-23 | ~~Démarrage~~ | **TRANCHÉ (D-031)** : capacité 2, 3 ou 4 à la création (un maximum) ; démarrage **par le créateur seul**, dès **2 joueurs**, sans attendre une table pleine ; plus d'adhésion ensuite. Reste ouvert : que devient une partie jamais démarrée (expiration, annulation, remboursement) ? | `POST /api/games/:gameId/start`, `assertCanStart` |
| R-24 | ~~**Déconnexion**~~ *(TRANCHÉ, D-082 : aucune pause, aucune attente ; le serveur joue à chaque échéance jusqu'à la fin, reprise automatique au retour)* : le timer de tour (20 s, D-034, D-064) est-il mis en pause pendant une déconnexion ? Attend-on davantage un joueur déconnecté ? | « Le système joue à la place du joueur » si la reconnexion échoue (séquence déroulement), sans délai. Aujourd'hui : aucune pause, le timer de 20 s s'applique. | `GameTimerRegistry` / `TURN_TIMEOUT` |
| R-25 | **Partie bloquée / session suspendue** par un admin *(en partie TRANCHÉ, D-079 : un JOUEUR suspendu, désactivé ou déconnecté par un admin pendant une partie est traité comme une déconnexion ; tours joués à 20 s, règlement inchangé, départ automatique ensuite. Reste ouvert : bloquer une partie ou une session entière)* : la partie est-elle gelée (timers arrêtés), annulée, reprise plus tard ? Que deviennent les mises ? | Diagramme « administration » : statut mis à jour et notification, sans effet défini. | Statuts `blocked` / `suspended` à ajouter |

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
| R-30 | ~~**Fuite qui laisse un seul joueur** (partie à 2)~~ | **TRANCHÉ (D-086)** : dans une partie à 2, celui qui se couche perd ; le joueur restant gagne aussitôt (victoire SIMPLE, fin `OPPONENT_FLED`). La fuite du contrôleur reste autorisée (D-035). | Moteur `flee`, migration 0037 |
| R-31 | ~~Plusieurs conditions remplies~~ | **TRANCHÉ (D-035)** : le meilleur rang (le plus petit) est retenu. | Socle de vérité |

## 2. Choix techniques À CLARIFIER

| # | Sujet | Constat |
|---|---|---|
| T-01 | Temps réel | ~~Firebase Realtime Database (chat) contre WebSocket / Socket.IO~~ **Tranché (D-045)** : WebSocket natif (`ws`) sur `/ws`, Redis pour la diffusion entre instances. Utilisé par le chat ; les événements de partie restent à y brancher. |
| T-02 | Notifications push | FCM est imposé. Avec Expo, `expo-notifications` est l'approche naturelle (FCM sous Android). |
| T-03 | ~~Géolocalisation~~ | **TRANCHÉ (D-046)** : `expo-location`, premier plan seulement, parties surveillées uniquement. |
| T-04 | Modèle de données | Diagramme de classes : solde en double (`Joueur.solde` et `Compte.solde`), rôles de `SessionJeu`, `PartieJeu` et `SessionDevice` qui se chevauchent, `id : int` alors que les identifiants retenus sont des UUID (D-023). |
| T-05 | Déploiement | Docker et Heroku ou AWS pour le backend. EAS pour les builds mobiles n'est pas mentionné. |
| T-06 | Diagrammes manquants | Les critères de sprint citent des diagrammes d'état, de composants, d'architecture et de flux utilisateur absents de `docs/`. |
| T-07 | Conformité | Le jeu se joue en argent réel (FCFA, Mobile Money). Il faut vérifier la licence de jeux d'argent requise dans le pays visé et les règles de l'App Store et du Play Store. |
| T-08 | Plusieurs instances du backend | Diffusion inter-instances en place (Redis Pub/Sub, D-024) et écritures protégées par la version optimiste. Reste à choisir : affinité par `gameId` (commandes et timers sur la même instance) ou coordination des timers et des commandes via Redis. |
| T-09 | Réglages : informations externes (D-052, [settings.md](settings.md)) | À fournir : URL de la plateforme d'assistance (`EXPO_PUBLIC_SUPPORT_URL`) ; nom légal de l'éditeur, adresse, email officiel, juridiction, âge minimum et date des documents (`LEGAL_INFO`) ; relecture juridique des Conditions d'utilisation et de la Politique de confidentialité ; durées de conservation ; sons définitifs (les sons d'interface actuels sont synthétiques) ; traduction anglaise des écrans restants ; vérification du son sur appareil réel. |

## 3. Fondation technique — suite

- [x] Frontend : ESLint configuré (`npm run lint` = `expo lint`, eslint-config-expo).
- [x] Frontend : tests (Jest + React Native Testing Library) : `npm test` (jest-expo), premiers tests sur le chat (D-045).
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
- [ ] Adaptateur temps réel du port `GameEventPublisher` / `GameEventSubscriber` sur la passerelle WebSocket (T-01 tranché par D-045 ; seul le chat l'utilise encore).
- [x] Politique de participation de production : R-18 tranchée (D-031). R-20 (rejoindre juste après une fuite) reste ouverte : un fuyard reste membre de sa partie jusqu'à sa fin.
- [ ] Réarmement des timers au démarrage à partir de `turnDeadlineAt`.
- [x] `requestId` par requête HTTP (`X-Request-Id`, D-027).
- [ ] `requestId` par message temps réel (avec le transport, T-01).
- [ ] Frontend : route `app/game/[gameId].tsx`, hook `useGameChannel(gameId)`, clés TanStack Query par `gameId` (D-017).

## 5. Moteur de jeu — suite

- [x] Cartes, paquet, Fisher-Yates, distribution, contrôle, tours, fin, gain instantané, fuite, mise simple (D-018 à D-021).
- [x] **Jeu de règles de production** : `OFFICIAL_TER_RULES` (D-035, socle de vérité des 52 décisions). Restent ouverts : fuite dans une partie à 2 (R-30), coût de la fuite (R-05), Kora (R-02), finance.
- [ ] Double Kora (R-02), unité de mise (R-13). Kora simple et commission des parties ordinaires : D-074.
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
  - [x] Tournois financiers (D-054) : réservations du compte de jeu, registre plateforme, comptes de tournoi, résultats, notifications (migration 0021).
  - [x] Compte financier de la plateforme Le-Ter (D-060) : `platform_ledger` est ce compte (journal des recettes, entrées seulement). Aucun compte utilisateur ne le représente.
  - [ ] Sorties du compte financier de la plateforme (versement, retrait) : aucune règle définie.
  - [x] Interfaces joueur (proposer) et administration des tournois ; attribution des tables atomique et sûre en multi-instance (D-055).
  - [x] Corrections post-audit (D-056) : démarrage bloqué annulé en SYSTEM_ERROR, brouillons privés, plus de partie après la fin d’un tournoi, délai d’1 h revérifié, HUD sur le disponible.
  - [x] Durée d’un tournoi de 30 à 120 minutes, message « Durée entre 30 minutes et 120 minutes. » (D-058).
  - [x] Au plus 5 tournois en attente de démarrage (verrou PostgreSQL), non-chevauchement testé, bouton « + Proposer un tournoi » et prochain tournoi inscrit sur l’accueil (D-059).
  - [x] Exécuter `postgres-tournament-concurrency.test.ts` avec `TEST_DATABASE_URL` (base de test dédiée `le_ter_test`) : exécuté le 2026-10-09, 29/29 après la correction de l'entrée en partie entre instances (D-065).
  - [ ] Appliquer 0019 → 0022 sur la base réelle (sauvegarde, `npm run db:migrate`) : voir [tournaments-integration.md](tournaments-integration.md).
  - [ ] Notifications push (T-02) pour les notifications de tournoi (aujourd’hui : dans l’application).
  - [x] Socle du compte de jeu (D-040) : portefeuille en jetons, registre de transactions, achats/retraits idempotents, fournisseur Mobile Money non configuré.
  - [x] Achat par CinetPay v1 (D-050, `docs/payments.md`) : paiement vérifié serveur à serveur, règlement atomique et idempotent, retour `leter://payment/return`.
  - [ ] Validation de l'intégration CinetPay en **sandbox** (notification réelle, URL de retour, présence de `amount`/`currency` dans le statut, renvois de notification).
  - [x] Retrait Mobile Money (D-075) : API de transfert CinetPay v1, minimum 1 000 jetons, quota configurable, réconciliation, administration.
  - [x] Retraits : trois états indisponible / sandbox / production, motif annoncé, attestation de production `CINETPAY_TRANSFERS_LIVE_CONFIRMED` (D-077, à valider).
  - [ ] Retrait : premier transfert RÉEL en sandbox puis en production (identifiants, activation du transfert et approvisionnement du compte marchand CinetPay, URL publique de notification) ; exigence R-34 (téléphone vérifié) toujours ouverte.
  - [ ] Rapprochement des paiements restés `PENDING` sans notification ni lecture (tâche périodique), et des anomalies `PAID_AFTER_WALLET_FAILURE`.
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
  - [ ] Vérification du téléphone par SMS (R-34). Mot de passe oublié (R-35) : fait (D-135).
  - [x] Rôle d'administration : `admin` = `SUPER_ADMIN` (D-061, R-09 tranché).
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
  - [x] Quitter une session (R-19, D-037) : partie en attente, J1 par ordre d'arrivée, place
    libérée, session vide supprimée.
  - [ ] À confirmer : session vide AVEC historique (fermée aujourd'hui, D-037) ; J1 absent de la
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
  - [x] Ronde Poursuivre/Quitter de 20 s (D-064, 10 s auparavant), AUTO_LEAVE à l'échéance, persistée.
  - [x] Timer de tour de 20 s (D-064) persisté ; TURN_TIMEOUT ; coup tardif refusé.
  - [x] Timers reconstruits depuis PostgreSQL au redémarrage, balayage des échéances.
  - [x] Coup automatique après TURN_TIMEOUT : plus petite carte de la famille du contrôle,
    sinon plus petite carte de la main (D-036).
  - [ ] À confirmer : arrivée pendant une ronde de décision (refusée aujourd'hui) ; création
    automatique ou manuelle de la partie suivante (manuelle aujourd'hui).
  - [x] Partie jamais démarrée quittée par tous ses joueurs : supprimée (D-037, Q1/Q2).
  - [ ] Partie jamais démarrée : expiration après un délai (suite de R-23, non définie).
  - [x] Quitter une partie en attente (R-19, D-037).
  - [ ] Lobby public et parties privées (R-22).
  - [x] Pseudos réels de tous les joueurs dans la vue de partie (D-064). Reste ouvert : l'option « noms cryptés » (R-12).
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
