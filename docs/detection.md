# Détection de potentielle collusion (R-36)

> Décisions : D-043 (réglage), D-044 (étape 1), D-046 (étape 2), D-047 (étape 3), D-048 (étape 4),
> D-049 (étape 5), D-053 (interrupteur global).
> Code : `backend/src/domain/detection/`, `backend/src/services/detection/`.

## Feuille de route

| Étape | Contenu | État |
|---|---|---|
| 1 | Fondation : `DetectionService`, signaux, scores préparés, activation par table | DONE |
| 2 | Géolocalisation : positions, distances, signaux géographiques | DONE |
| 3 | Analyse comportementale : 4 signaux | DONE |
| 4 | Score, niveaux, alertes internes, historique | DONE après validation |
| 5 | Administration : consultation, statut des alertes, audit (rôle `admin`) | DONE |
| — | Interrupteur global ON/OFF (administration) | DONE |

## Signal ≠ accusation

Un signal décrit **un comportement statistiquement ou contextuellement inhabituel**. Il ne
signifie jamais « le joueur triche », ni une intention, ni une entente. Aucun signal ne
déclenche de sanction, de bannissement, d'accusation, de notification ou d'affichage aux
joueurs. Signaux, scores et alertes ne sont visibles que par l'administration (étape 5, rôle `admin`).

## Principes communs

- **Activation** : uniquement si l'**interrupteur global** est activé (D-053, désactivé par
  défaut) ET si la table de la partie a `suspicionDetectionEnabled`. Sinon : aucune analyse
  lancée, aucune lecture de l'historique, aucune écriture (la condition de table est garantie
  aussi en base par des triggers).
- **Déclenchement** : en fin de partie (`GameService.onGameFinished`), en arrière-plan
  (`BackgroundTasks`), en file par partie (`KeyedSerialQueue`). Le jeu n'attend jamais.
- **Isolation** : un signal est rattaché à UNE partie (`gameId`) et ne cite que ses joueurs
  (vérifié par le service et par la base). Les analyses longitudinales distinguent la
  **partie observée** (`observedGameId`) de l'**historique utilisé** (`history`).
- **Historique** : uniquement des parties **surveillées** et terminées, sur une fenêtre de
  temps. Une partie non surveillée n'alimente jamais une analyse.
- **Idempotence** : un signal est unique par (partie, type, joueurs, version d'algorithme)
  — index `detection_signals_identity_key` (migration 0015). Rejouer une analyse, ou deux
  analyses simultanées de la même partie, ne crée aucun doublon.
- **Versions** : chaque type a sa version (`SIGNAL_ALGORITHM_VERSIONS`), enregistrée avec
  le signal ; identifiant lisible `TYPE_V1` (`evidence.algorithm`). Changer la signification
  d'un algorithme impose une nouvelle version.
- **Configuration** : `backend/src/domain/detection/detection-config.ts` uniquement.

## Étape 3 — Analyse comportementale

### Données utilisées (aucune copie, aucune nouvelle collecte)

| Donnée | Source | Usage |
|---|---|---|
| Parties terminées, joueurs, gagnant, raison de fin | `games`, `game_players` | coplay, victoires |
| Tours joués (cartes, ordre, contrôleur) | `games.state` (relu via `GameRepository`) | choix de cartes |
| Coups automatiques après timeout | `recentCommandIds` (`auto-play:{gameId}:{tour}:{position}`) | exclusion |
| Arrivée à une table | `session_players.joined_at` | connexion |
| Début de session d'authentification | `min(refresh_tokens.created_at)` par session | connexion |

### Données NON disponibles

- **Aucune adresse IP ni donnée réseau** n'est conservée par l'application (l'IP n'est lue
  qu'en mémoire par la limitation de débit). `SHARED_IP` reste désactivé ; la dimension
  « même environnement réseau » de CONNECTION_PATTERN n'est pas implémentée.
- **Pas d'historique des connexions WebSocket** ni des déconnexions.
- **Parties antérieures aux timeouts tracés** : sans `auto-play` dans l'historique (ou
  historique de commandes saturé), un coup automatique ne serait pas reconnaissable — ces
  parties sont exclues (`COMMAND_HISTORY_INCOMPLETE`) quand l'historique est saturé.

### FREQUENT_COPLAY_V1

Pour chaque paire de la partie observée, sur `coplay.windowDays` (30 j) : parties
communes, tables communes, parties de chacun. Signal si parties communes ≥ 5, tables
communes ≥ 2 et part des parties de CHACUN jouées avec l'autre ≥ 0,6. Documente une
fréquence ; deux joueurs fréquents ne sont pas présumés suspects.

### CARD_CHOICE_ANOMALY_V1

1. Reconstruction, pour chaque partie jouée jusqu'au 5e tour, des **vraies décisions** de
   prise de contrôle : un joueur suit (jamais le meneur) et, parmi ses cartes LÉGALES
   (règles officielles), certaines prennent le contrôle et d'autres non. La main au moment
   du choix est reconstruite à partir des cartes jouées ensuite.
2. Exclusions : victoire instantanée, égalité, arrêt administratif (partie non jouée
   jusqu'au bout) ; 5e tour (automatique) ; coups joués après TURN_TIMEOUT ; joueur ayant
   fui (aucune carte) ; situation à choix unique ; historique de commandes saturé.
3. Pour un joueur X et un contrôleur Y de la partie observée : taux de renoncement face à
   Y comparé au taux personnel de X face aux autres contrôleurs. Signal si ≥ 8 occasions
   face à Y ET ≥ 8 face aux autres, taux face à Y ≥ 0,7 et écart ≥ 0,4.
4. Signal orienté `[X, Y]` (décideur, contrôleur). Fenêtre 30 j, 100 parties au plus par
   joueur. Aucune carte ni main dans les éléments justificatifs.

### CORRELATED_WINS_V1

Parties communes surveillées **à 3 ou 4 joueurs** (à 2, la paire gagne toujours : non
informatif). Attendu par partie = taux personnel de A sans B + taux de B sans A (si ≥ 5
parties de référence, sinon le hasard 1/n). Signal si ≥ 8 parties communes, taux observé
− taux attendu ≥ 0,25 et écart réduit z ≥ 2,5 (variance de Poisson-binomiale). Un joueur
fort qui gagne aussi sans l'autre ne crée pas de signal. Observation statistique, jamais
causale.

### CONNECTION_PATTERN_V1

Tables surveillées communes à la paire : arrivées à moins de 15 s d'écart, ou débuts de
session d'authentification (dans les 30 min avant l'arrivée) à moins de 15 s d'écart.
Signal si ≥ 3 tables synchronisées représentant ≥ 60 % des tables communes. Éléments :
compteurs et écart médian (en secondes) ; `networkData: NOT_AVAILABLE`.

### Seuils PROVISOIRES

Aucun seuil de l'étape 3 n'est validé par le métier : tous sont marqués provisoires dans
`DETECTION_THRESHOLDS` (coplay, cardBehavior, correlatedWins, connection) et dans
`BEHAVIOR_CONTRIBUTIONS`. Ils devront être validés avant l'étape 4.

### Limitations

- Les analyses ne portent que sur les parties surveillées : un comportement réparti sur
  des tables non surveillées n'est pas visible (choix de confidentialité).
- Les arrivées synchronisées sont fréquentes entre amis qui s'invitent : le signal le
  documente sans le qualifier.
- Les seuils sont statiques (pas encore de comparaison à la population globale).

### Protection des données

Éléments justificatifs minimisés : compteurs, taux, période, identifiant de la partie
observée. Jamais d'IP, de coordonnées GPS, de carte, de main, ni d'identifiant d'une autre
partie. Aucun signal, score ou élément de détection n'est exposé à un joueur.

## Étape 4 — Score, niveaux et alertes internes (D-048)

Un **score** est un indicateur statistique (0 à 100), **jamais une preuve**. Une **alerte**
signifie seulement « plusieurs signaux statistiques ou comportementaux justifient une
analyse ». Aucune action automatique : ni bannissement, ni suspension, ni exclusion, ni
modification de gains, de mises ou de classement, ni accusation, ni notification.

### Formule `SUSPICION_SCORE_V2` (`DETECTION_ALGORITHM_VERSION = 2`)

Pour un **sujet** = joueur seul (`PLAYER`) ou paire (`PAIR`) ; `GROUP` est prévu par le
modèle, mais aucun signal n'en produit aujourd'hui. Clé : identifiants triés joints par
« | » ; un signal orienté (`CARD_CHOICE_ANOMALY` [décideur, contrôleur]) compte pour la
paire.

1. Signaux du sujet créés depuis `SCORING_CONFIG.signalValidityDays` (30 j, expiration
   explicite), toutes parties **surveillées** (les seules qui ont des signaux).
2. Chaque signal compte une fois (identité unique en base). **Par type, seule la plus forte
   contribution est retenue**, plafonnée par `SIGNAL_RULES[type].maxContribution` : un même
   constat longitudinal re-signalé à chaque partie n'est pas compté plusieurs fois.
3. Score = somme des contributions retenues, plafonnée à 100, entier. Départage à
   contribution égale : signal le plus récent, puis identifiant (déterministe).

Le score d'un joueur seul ne reprend jamais celui d'une paire, et inversement.

### Contributions (PROVISOIRES)

| Type | Contribution | Plafond du type |
|---|---|---|
| PROXIMITY | 20 (forte) / 10 (significative) | 35 |
| REPEATED_PROXIMITY | 15 | 25 |
| IMPOSSIBLE_TRAVEL | 15 | 20 |
| INCOHERENT_LOCATION | 10 | 15 |
| FREQUENT_COPLAY | 10 | 20 |
| CARD_CHOICE_ANOMALY | 20 | 30 |
| CORRELATED_WINS | 15 | 25 |
| CONNECTION_PATTERN | 10 | 15 |
| SHARED_IP | désactivé | 0 |

### Niveaux (PROVISOIRES, ceux de D-044)

0–24 faible (`low`) · 25–49 modéré (`moderate`) · 50–74 élevé (`high`) · 75–100 très élevé
(`very_high`).

### Alertes internes (PROVISOIRES)

- LOW, MODERATE : aucune alerte. HIGH : alerte `NORMAL`. VERY_HIGH : alerte `PRIORITY`.
- Au moins **2 types de signaux distincts** : un signal seul n'est jamais une alerte (avec
  les plafonds actuels, un seul type ne dépasse de toute façon pas 35).
- Contenu : type `SUSPICION_LEVEL`, sujet et portée, niveau, priorité, score, version,
  types de signaux, partie analysée, période, statut interne `NEW` (puis `REVIEWED`,
  `DISMISSED`, `RESOLVED` par l'administration, étape 5). Aucun élément justificatif recopié.
- Déduplication : clé unique `SUSPICION_LEVEL|sujet|niveau|v2|début de période` (périodes
  fixes de 30 jours, `ALERT_CONFIG.dedupWindowDays`). Une alerte HIGH n'est pas créée si une
  VERY_HIGH existe déjà pour le sujet sur la période ; une hausse vers VERY_HIGH crée une
  nouvelle alerte prioritaire.

### Déclenchement, idempotence, historique

- Calcul dans `DetectionService.recordSignals`, après l'enregistrement des signaux, dans la
  file de la partie, en arrière-plan (fin de partie) : le jeu n'attend jamais. Sujets
  recalculés : ceux cités par les signaux de la partie. 3 lectures groupées (signaux de la
  partie, signaux des sujets via l'index `subject_key`, scores précédents), puis une
  transaction d'écriture.
- Idempotence : signaux uniques (0015), instantané de score unique par (partie, sujet),
  réécrit seulement s'il change, alerte unique par clé de déduplication. Rejeu, double
  traitement, deux workers, redémarrage : aucun doublon.
- Historique (`detection_scores`) : un instantané par (partie analysée, sujet), avec
  `previous_score` (dernier score du sujet calculé lors d'une autre partie), `components`
  (type, contribution, identifiant du signal, partie source, version du signal),
  `signal_count`, `signals_since`, version et date. Rien n'est supprimé.

### Confidentialité

Scores et alertes ne contiennent que des identifiants de joueurs, de signaux et de parties
sources, des contributions et des niveaux : jamais de coordonnées, d'IP, de carte, de main
ni d'élément justificatif recopié. Seule l'administration (étape 5, rôle `admin`) les consulte ; aucun affichage joueur.

### Limitations

- Le score d'un sujet n'est recalculé que lorsqu'une nouvelle analyse produit un signal le
  concernant : quand ses signaux expirent sans nouveau signal, le dernier instantané reste
  le plus récent (pas de décroissance planifiée).
- Périodes de déduplication fixes (alignées sur l'époque Unix), pas glissantes.
- Formule linéaire simple, sans pondération par la sévérité ni par l'ancienneté.

## Étape 5 — Administration (D-049)

Consultation des alertes et changement de leur **statut**, rien d'autre : aucune sanction,
aucun bannissement, aucune accusation, aucune modification du jeu, des comptes, des gains,
des scores ou des résultats. Aucune interface joueur ; pas d'application d'administration à
ce stade (API seulement).

### Accès

- Toutes les routes sous `/api/admin/detection` : `requireAuth` (401), puis
  `requireRole('admin')` (403). Le rôle est lu dans la session serveur, **relu en base à
  chaque requête** : un retrait de rôle s'applique immédiatement, sans nouveau jeton.
- Rôle `admin` ajouté au système de rôles existant (`users.role`, migration 0017), PROVISOIRE
  et TECHNIQUE. Attribution uniquement par l'outil d'exploitation
  `npm run user:role -- <email> <user|admin>` (`user:role:prod` après build) ; aucune route.
  Ce rôle est désormais le rôle d'administration définitif, présenté comme `SUPER_ADMIN` (D-061).
- L'administrateur qui agit est toujours l'appelant authentifié : un `adminId` reçu dans le
  corps est refusé (400). Sans base ou sans authentification configurée : 503.

### Routes

| Méthode | Chemin | Rôle |
|---|---|---|
| GET | `/alerts` | Liste paginée, filtres, tri |
| GET | `/alerts/:alertId` | Détail + score au moment de l'analyse |
| GET | `/alerts/:alertId/signals` | Signaux examinés, éléments justificatifs minimisés |
| GET | `/subjects/:subjectKey/score-history` | Historique du score d'un sujet (lecture seule) |
| PATCH | `/alerts/:alertId/status` | `{ status, expectedStatus? }`, audité |

- **Liste** : `alertId`, `type`, `level`, `priority`, `status`, `subject` (clé, portée,
  joueurs), `score`, `algorithmVersion` / `scoreAlgorithm`, `gameId`, `createdAt`,
  `updatedAt`. Aucun élément justificatif.
- **Pagination** : `page` (1–10 000), `limit` (1–100, 20 par défaut) ; réponse avec `total`.
- **Filtres** : `status`, `level`, `priority`, `type`, `subject` (UUID triés joints par `|`),
  `playerId`, `from` / `to` (ISO 8601, sur `created_at`, `[from, to[`). Paramètre inconnu,
  répété ou invalide : 400. Requêtes paramétrées uniquement.
- **Tri** (liste blanche, la clé choisit un fragment SQL constant) : `created_at_desc`
  (défaut), `created_at_asc`, `score_desc`, `score_asc`, `priority` (PRIORITY d'abord),
  `level` (very_high d'abord).
- **Détail** : champs de la liste + types de signaux, période de déduplication, instantané du
  score de la partie analysée (score, score précédent et son niveau, version, signaux
  retenus : type, contribution, signal, partie source, algorithme).
- **Signaux** : ceux du sujet dans la fenêtre de l'instantané (`signalsSince` →
  `computedAt`), avec type, algorithme, sévérité, contribution, `retained`, partie source,
  joueurs, date, et éléments justificatifs en représentation administrative minimisée.
- **Historique** : instantanés du sujet, du plus récent au plus ancien, paginés. Aucune
  route d'écriture : un score ne se modifie pas à la main.

### Statuts

Machine d'état minimale (PROVISOIRE) : `NEW → REVIEWED → RESOLVED`, `NEW → DISMISSED`.
`DISMISSED` et `RESOLVED` sont finaux (aucune réouverture). Chaque statut cible a une seule
origine : une demande périmée ne peut pas passer par-dessus le travail d'un autre
administrateur.

- Transaction unique : lecture de l'alerte `FOR UPDATE`, vérification, mise à jour, ligne
  d'audit. Transition non prévue : 409 `ALERT_TRANSITION_NOT_ALLOWED`.
- `expectedStatus` (facultatif) : si le statut a changé depuis la lecture de
  l'administrateur, 409 `ALERT_STATUS_CONFLICT` ; rien n'est écrasé.
- Idempotence : demander le statut déjà atteint renvoie 200 avec `changed: false`, sans
  nouvelle ligne d'audit.
- Un changement de statut n'a aucun effet sur la détection : rejouer une analyse ne recrée
  pas une alerte écartée (déduplication de l'étape 4).

### Audit administratif

Table `admin_audit_log` (migration 0017) : `actor_id` (compte de la session), `action`
(`ALERT_STATUS_CHANGED`), `target_type` (`DETECTION_ALERT`), `target_id`, `details`
(`{ from, to }`), `created_at`. Jamais de jeton, de mot de passe, d'IP, de position ni de
donnée de jeu. Le journal technique ne contient que les identifiants et le statut.

### Confidentialité

- Défense en profondeur (`adminEvidenceOf`) : les clés de coordonnées, précision, IP,
  adresse, cartes, mains, message, jeton, mot de passe, secret sont retirées ; les valeurs
  ressemblant à une IP ou à une carte sont masquées (`[masqué]`). Restent les données
  dérivées : compteurs, taux, distances approximatives, périodes.
- Aucune latitude, longitude ni précision affichée ; aucune donnée personnelle de compte
  (email, téléphone, nom). `CONNECTION_PATTERN_V1` reste `networkData: NOT_AVAILABLE`,
  `SHARED_IP` reste désactivé ; aucune collecte d'IP ajoutée.

### Limitations

- Pas d'interface d'administration (API seulement) ; pas de consultation du journal d'audit
  par HTTP (lecture en base).
- Rôle `admin` unique et binaire ; pas de permissions fines.
- Pagination par décalage (`OFFSET`) ; suffisante au volume actuel.
- Les filtres de date portent sur la création de l'alerte, pas sur sa dernière mise à jour.

## Interrupteur global (D-053)

Un administrateur active ou désactive **tout** le module, depuis l'écran d'administration de
l'application (`/admin`, rôle `admin`) ou par l'API.

### Hiérarchie

`détection d'une partie = interrupteur global ACTIVÉ ET suspicionDetectionEnabled de sa table`

| Global | Table | Détection |
|---|---|---|
| OFF | OFF | non |
| OFF | ON | non |
| ON | OFF | non |
| ON | ON | oui |

### Persistance

- PostgreSQL, table `system_settings` (migration 0020), clé `detection_enabled` (booléen).
- **Valeur par défaut : désactivée.** Ligne absente = désactivée ; elle est créée au premier
  réglage par un administrateur.
- Relue en base à **chaque** consultation (aucun cache, pas de Redis) : un redémarrage ou une
  autre instance voient toujours la valeur en base.

### Point de contrôle unique

- `DetectionService.isEnabled(gameId)` lit d'abord l'interrupteur global ; désactivé, il
  renvoie faux **avant** toute lecture de la partie, de l'historique ou des positions, et
  avant toute analyse, écriture, calcul de score ou création d'alerte. `analyzeGame` et
  `recordSignals` passent tous deux par lui. Aucun analyseur n'est modifié.
- `GeolocationService` applique la même règle à l'accès d'un joueur (`requirePlayer`) :
  global désactivé, `GET /api/games/:gameId/geolocation` renvoie `{ detectionEnabled: false }`
  (exactement comme pour une table non surveillée) et `POST …/position` est refusé (409
  `DETECTION_DISABLED`), sans écriture. Le téléphone ne demande donc aucune permission GPS et
  n'envoie rien. Aucune autre fonctionnalité de l'application n'utilise le GPS.

### OFF / ON

- **OFF** : aucun nouveau signal, aucun score, aucune alerte, aucune analyse géographique,
  aucune position acceptée, aucune tâche de détection. Le jeu fonctionne normalement.
- **ON** : la détection fonctionne comme décrit aux étapes 1 à 5, pour les tables surveillées.

### Parties en cours

Désactiver pendant une partie surveillée : la partie continue (mêmes cartes, même résultat,
mêmes gains) ; les positions suivantes sont refusées ; l'analyse de fin de partie ne s'exécute
pas. Une analyse **déjà commencée** au moment du changement se termine (au plus une par
partie). Rien n'est supprimé : signaux, scores, alertes et audit restent consultables par
l'administration ; les positions déjà reçues suivent la conservation habituelle (24 h).
Réactiver ne rejoue pas les parties terminées pendant la désactivation.

### API (rôle `admin`)

| Méthode | Chemin | Corps / réponse |
|---|---|---|
| GET | `/api/admin/settings/detection` | → `{ enabled, updatedAt }` |
| PATCH | `/api/admin/settings/detection` | `{ enabled: boolean }` → `{ enabled, updatedAt, changed }` |

401 sans session, 403 sans le rôle `admin` en base (un JWT qui revendique `admin` ne suffit
pas), 400 pour tout autre champ (dont `adminId`) ou une valeur non booléenne, 503 si non
configuré. Même valeur demandée : 200 `changed: false`, aucun audit.

### Audit et concurrence

- Transaction unique : ligne créée si absente, verrou `FOR UPDATE`, mise à jour, ligne
  `admin_audit_log` : `DETECTION_ENABLED` ou `DETECTION_DISABLED`, cible `SYSTEM_SETTING`,
  `details` `{ key, from, to }`, acteur = compte de la session, date.
- Deux réglages simultanés sont sérialisés : chaque audit part de la valeur laissée par le
  précédent, la valeur finale est celle du dernier.
- Jamais de jeton, de mot de passe, d'IP, de position ni de donnée de jeu dans l'audit ou les
  journaux.

### Confidentialité et application joueur

Aucune route joueur ne lit ou ne renvoie l'interrupteur. L'application joueur est inchangée
(aucun écran, badge, texte ou indicateur ; `GameTableScreen` non modifié) ; le réglage 🛡️ de
table (D-043) reste affiché comme avant. Un joueur ne peut pas savoir si le module est actif.
L'écran `/admin` n'est lié depuis aucun écran joueur ; un compte non administrateur n'y voit
que « Page indisponible. » et n'appelle aucune route d'administration.

### Limitations

- Une analyse déjà en cours au moment de la désactivation se termine.
- Le réglage 🛡️ reste proposé aux joueurs même si le module est désactivé (choix : ne rien
  révéler de l'état global).
- Une requête de plus (clé primaire) par fin de partie surveillée et par position reçue.
- L'écran `/admin` s'ouvre par lien direct (aucun menu) ; testé en tests de composants, pas
  sur appareil.
