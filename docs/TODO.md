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

## 2. Choix techniques À CLARIFIER

| # | Sujet | Constat |
|---|---|---|
| T-01 | Temps réel | Firebase Realtime Database (chat) contre WebSocket / Socket.IO (latence, reconnexion). Un REST seul ne suffit pas pour l'état d'une partie. |
| T-02 | Notifications push | FCM est imposé. Avec Expo, `expo-notifications` est l'approche naturelle (FCM sous Android). |
| T-03 | Géolocalisation | « API Geolocation intégrée dans React Native » n'existe plus. Il faut utiliser `expo-location`. |
| T-04 | Modèle de données | Diagramme de classes : solde en double (`Joueur.solde` et `Compte.solde`), rôles de `SessionJeu`, `PartieJeu` et `SessionDevice` qui se chevauchent, `id : int` alors que MongoDB utilise des ObjectId. |
| T-05 | Déploiement | Docker et Heroku ou AWS pour le backend. EAS pour les builds mobiles n'est pas mentionné. |
| T-06 | Diagrammes manquants | Les critères de sprint citent des diagrammes d'état, de composants, d'architecture et de flux utilisateur absents de `docs/`. |
| T-07 | Conformité | Le jeu se joue en argent réel (FCFA, Mobile Money). Il faut vérifier la licence de jeux d'argent requise dans le pays visé et les règles de l'App Store et du Play Store. |

## 3. Fondation technique — suite

- [ ] Frontend : configurer ESLint (`npx expo lint`) et les tests (Jest + React Native Testing Library).
- [ ] Backend : documentation Swagger/OpenAPI de l'API.
- [ ] Backend : stratégie de validation des entrées (`validators/`).
- [ ] Frontend : client API (`src/services/`) pointant vers `/api/health`.
- [ ] Commit initial de la nouvelle structure.
