# Domaine du jeu — moteur du Ter

> Statut : moteur implémenté dans `backend/src/domain/` (octobre 2026).
> Règle absolue : **aucune règle métier n'est inventée**. Le **socle de vérité** (D-035, 52
> décisions validées et leurs précisions) fait foi ; il est codé dans `OFFICIAL_TER_RULES`, le
> moteur et `win-conditions.ts`. Les situations qu'il ne couvre pas lèvent `UnresolvedRuleError`
> au lieu d'être devinées.

## 1. Matrice des règles

Statuts :

- **CONFIRMÉ** : énoncé explicitement, sans contradiction.
- **DÉDUIT** : découle logiquement des documents, sans y être écrit. Codé, mais à confirmer.
- **AMBIGU** : plusieurs lectures possibles.
- **CONTRADICTOIRE** : des documents disent des choses différentes.
- **NON DÉFINI** : les documents n'en parlent pas.

Pour les trois derniers statuts, rien n'est codé en dur.

| Règle | Source | Valeur | Statut | Dans le code |
|---|---|---|---|---|
| Paquet | Spec §2.1 | 31 cartes : cœur 3-10, pique 3-9, trèfle 3-10, étoile 3-10 | CONFIRMÉ | `DECK_COMPOSITION`, `createDeck` |
| Figures (valet, dame, roi, as) | Spec §2.1 (absentes) | Aucune | CONFIRMÉ | Valeurs 3 à 10 uniquement |
| Mélange | Note « Melanger cartes » | Fisher-Yates | CONFIRMÉ (recommandation) | `shuffleDeck` + `RandomSource` |
| Nombre de joueurs | Spec §1 | 2, 3 ou 4 | CONFIRMÉ | `MIN_PLAYERS`, `MAX_PLAYERS` |
| Démarrage | Décision R-23 (D-031) | Au moins 2 joueurs ; la capacité (2, 3 ou 4) est un maximum, pas une condition. Remplace l'ancienne lecture « table complète » | TRANCHÉ | `assertCanStart` |
| Qui déclenche le démarrage | Décision R-23 (D-031) | Le créateur seul | TRANCHÉ | `GameService.startGame(gameId, actorId)` |
| Distribution au démarrage | Décision C.2 (D-032) | Faite à chaque démarrage, dans la même transition | TRANCHÉ | `startGame` |
| Distribution | Spec §2.2 | 5 cartes par joueur | CONFIRMÉ | `HAND_SIZE`, `dealInPasses` |
| Mode de distribution | Décision C.2 (D-032) | Passage 1 : un lot de 3 cartes par joueur, l'un après l'autre ; passage 2 : un lot de 2, même ordre. Jamais carte par carte | TRANCHÉ | `DEAL_PASSES = [3, 2]`, `dealInPasses` |
| Cartes restantes | Décision C.2 (D-032) | Ni pioche, ni accessibles, jamais utilisées ; aucun remplacement après un coup | TRANCHÉ (R-26) | `stock`, jamais exposé |
| Premier joueur | Spec §2.2 | Le premier servi commence et a le contrôle | CONFIRMÉ | `control = dealOrder[0]` |
| Ordre de distribution | Décision C.3 (D-033) | Sens ANTIHORAIRE à partir de J1, identique aux deux passages | TRANCHÉ | `tableOrder` : places de session, `rotateFrom(J1)` |
| Qui est J1 (premier servi) | Décision C.3 (D-033) | 1re partie : créateur de la session ; ensuite gagnant de la dernière partie terminée s'il est présent, sinon le suivant actif (antihoraire) | TRANCHÉ | `determineFirstPlayer`, `games.first_player_id` |
| Nombre de tours | Spec §2.4, séquence | 5 tours | CONFIRMÉ | `TRICKS_PER_GAME` |
| Contenu d'un tour | Décision 36 (D-035) | Chaque joueur actif joue exactement une carte ; les fuyards sont ignorés | TRANCHÉ (R-29) | `advance` |
| Manches | — | Aucune notion de manche au-dessus de la partie | Constat | Pas de modèle « Round » |
| Meneur des tours 2 à 5 | Décisions 38, 43 (D-035) | Le joueur qui a le contrôle à la fin du tour précédent ouvre le tour | TRANCHÉ (R-27) | `openTrick` |
| Ordre de jeu dans un tour | Décisions 39-40 (D-035) | Antihoraire depuis le meneur (ex. J3 → J4 → J1 → J2), fuyards exclus | TRANCHÉ (R-28) | `openTrick` → `rotateFrom` |
| Prise de contrôle | Décisions 41, 51-52 (D-035) | Seule une carte de la famille de la carte de contrôle du DÉBUT du tour (celle du meneur) et de valeur supérieure prend le contrôle ; en fin de tour, la plus haute carte de cette famille l'emporte (cartes des fuyards ignorées) ; sinon le contrôleur garde le contrôle ; il ne rejoue pas dans le tour | TRANCHÉ | `applyControl`, `trickController` |
| Sens de « couleur » | Décisions 44-45 (D-035) | Même FAMILLE : ♥, ♠, ♣, ⭐ | TRANCHÉ (R-08) | `sameSuit` (`official-rules.ts`) |
| Obligation de suivre | Décisions 46-47, 50 (D-035) | Qui possède la famille de la carte du meneur DOIT la jouer (même inférieure) ; sinon n'importe quelle carte. Le meneur est libre | TRANCHÉ (R-03) | `mustFollowLeadColorWhenPossible`, `playableCards` |
| « Carte non jouable » | Scénario §5 | Le serveur vérifie et refuse | CONFIRMÉ | `CardNotPlayableError` |
| Fin normale | Décision 35 (D-035) | Exactement 5 tours ; le 5e est joué AUTOMATIQUEMENT (chaque joueur actif a une seule carte) ; le contrôleur final gagne, sans confirmation | TRANCHÉ | `playLastTrickAutomatically`, `CONTROL_AFTER_LAST_TRICK` |
| Visibilité | Spec §2.3 | Sa main seulement ; cartes jouées publiques | CONFIRMÉ | `toPlayerView`, `game:hand_dealt` privé |
| Révélation en cas de gain instantané | Spec §2.3 | Toutes les mains sont révélées | CONFIRMÉ | `result.revealedHands` |
| Égalité de priorité des mains instantanées | Décisions 17, 23 (D-035) | Aucun gagnant ; reprise immédiate dans une NOUVELLE partie de la même session, sans Poursuivre/Quitter : mêmes joueurs, mêmes sièges, même J1, nouveau mélange, répétée tant que l'égalité se reproduit | TRANCHÉ | `INSTANT_WIN_TIE`, `SessionService.ensureReplay`, `games.replay_of_game_id` |
| Victoire instantanée | D-035 | Analyse SERVEUR des 5 cartes initiales de chaque joueur dès la distribution. Une seule main gagnante : bouton « Gagner instantanément » (facultatif). Plusieurs, meilleur rang unique : victoire automatique. Même meilleur rang : égalité, reprise immédiate. Toujours une victoire SIMPLE | TRANCHÉ (R-07, R-31) | `startGame`, `declareWin`, `resolveInstantWins` |
| Main non gagnante | Séquence | Message, la partie continue | CONFIRMÉ | `NotAWinningHandError`, état inchangé |
| Moment de la déclaration | D-035 | Tour 1, avant la première carte du joueur ; droit perdu ensuite | TRANCHÉ (R-07) | `declareBeforeFirstCard` |
| Rang 6 : trois 3 | D-035 | 3 cartes de valeur 3 | TRANCHÉ | `INSTANT_WIN_CONDITIONS` |
| Rang 4 : quatre de même valeur | D-035 | 4 cartes de même valeur | TRANCHÉ | `INSTANT_WIN_CONDITIONS` |
| Rang 3 : cinq de même famille | D-035 | 5 cartes de la même famille | TRANCHÉ | `INSTANT_WIN_CONDITIONS` |
| Rang 2 : somme | D-035 | Somme des 5 cartes initiales ≤ 21 (la lecture « ≥ 30 » est écartée) | TRANCHÉ (R-01) | `INSTANT_WIN_CONDITIONS` |
| 7 + 7 + 4 + 3 | D-035 | Ne fait pas partie des six combinaisons du socle | ÉCARTÉ (R-04) | Supprimé |
| Rang 5 : trois + deux | D-035 | 3 cartes d'une valeur + 2 d'une autre | TRANCHÉ | `INSTANT_WIN_CONDITIONS` |
| Rang 1 : trois 7 | D-035 | 3 cartes de valeur 7, quelle que soit la famille | TRANCHÉ | `INSTANT_WIN_CONDITIONS` |
| Plusieurs combinaisons dans une main | D-035 | Le meilleur rang (le plus petit) est retenu | TRANCHÉ (R-31) | `bestInstantWin` |
| Fuite autorisée | D-035 | Tour 1 seulement, avant la première carte du joueur ; le bouton disparaît ensuite | TRANCHÉ (R-05) | `fleeBeforeFirstCardOfFirstTrick` |
| Fuites par partie | Spec §2.5 | Une au maximum | CONFIRMÉ | `MAX_FLEES_PER_GAME` |
| Après une fuite | D-035 | Le fuyard est inactif pour la partie (jamais rejoué, ses cartes jamais jouées), reste dans la session à son siège, joue la partie suivante ; sa main gagnante ne compte plus | TRANCHÉ | Joueur sauté, `instantWins` retiré |
| Fuite du contrôleur | D-035 | Autorisée ; le joueur actif suivant (antihoraire) mène le tour (déduit des décisions 37-38) | TRANCHÉ (R-30, 1re partie) | `flee` |
| Fuite qui laisserait un seul joueur (partie à 2) | — | Non dit | NON DÉFINI (R-30, 2e partie) | `UnresolvedRuleError` (501) |
| Gagné simple | Spec §5.1 | Chaque perdant verse la mise | CONFIRMÉ | `stakeTransfers('SIMPLE', …)` |
| Kora / Double Kora | Spec §5.2-5.3 | Déclencheur inconnu ; 200 / 300 pour une mise de 100 | AMBIGU (R-02) | `PayoutKind`, `KoraDetector` sans implémentation |
| Le fuyard paie-t-il ? | — | Non dit | NON DÉFINI (R-05) | `fledPlayerIds` séparé dans le résultat |
| Prélèvement du Katika | Spec §9 | « Pourcentage minimal » non chiffré | AMBIGU (R-09) | Non modélisé |
| Unité de la mise | Spec §5 (FCFA) ; maquette (jetons) | FCFA ou jetons | AMBIGU (R-13) | `stakeAmount` entier, sans unité |
| Minuteur | D-034 | 10 s par tour (tours 1 à 4) ; TURN_TIMEOUT puis coup automatique ; le 5e tour n'a pas de timer | TRANCHÉ (R-06), choix de la carte : voir D-036 | `handleTurnTimeout`, `AutomaticCardSelectionStrategy` |
| Tournoi, jetons | Spec §14-15 | — | Hors périmètre | Non modélisé |

## 2. Modèle

### Card (`domain/cards/card.ts`)

- `Suit` = `COEUR | PIQUE | TREFLE | ETOILE` (famille), `CardValue` = 3 à 10.
- `CardId` = `"FAMILLE-VALEUR"`, par exemple `"PIQUE-7"`. C'est une chaîne sérialisable : l'état
  ne contient que des identifiants, donc aucun objet carte n'est partagé.
- `parseCardId` valide toute carte venant du client. `PIQUE-10` et les figures sont refusées.
- Le modèle ne parle **que de famille**. « Même couleur » est une règle injectée.

### Deck (`domain/cards/deck.ts`)

- `createDeck()` : les 31 cartes, dans l'ordre.
- `shuffleDeck(cards, random)` : Fisher-Yates. Renvoie un nouveau tableau.
- `dealInPasses(deck, dealOrder, passes)` : distribution par lots (D-032). Pour chaque
  passage, chaque joueur, dans l'ordre, reçoit d'un bloc `passes[i]` cartes du dessus du
  paquet. Renvoie `{ hands, stock, sequence }`. Si les cartes ne suffisent pas,
  `NotEnoughCardsError`.
- `dealSequence(dealOrder, passes)` : la séquence publique des lots, sans aucune carte.
- Hasard : interface `RandomSource`. En production, `cryptoRandomSource` (`crypto.randomInt`,
  sans biais), puisque de l'argent réel est en jeu. Dans les tests, des sources déterministes
  (`tests/fixtures/random.ts`), sans dépendance externe.

### User et PlayerInGame

- **User** : le compte. Il n'est pas modélisé dans le moteur, seulement référencé par `PlayerId`.
- **PlayerInGame** (`players[]` d'une partie) : `{ playerId, seat, joinedAt, fledAt? }`. C'est la
  participation à **une** partie. Un même utilisateur a un `PlayerInGame` distinct par partie.
  Plusieurs participations historiques sont possibles, mais une seule partie active à la fois
  (R-18, D-031).

### Game (`domain/game/game.ts`)

| Champ | Justification |
|---|---|
| `id`, `version`, `status`, `creatorId`, `maxPlayers`, `players`, dates | Socle multi-parties (D-011 à D-013) |
| `stakeAmount?` | Mise de la partie (séquence « création de partie ») ; unité R-13 |
| `play?` (`TerPlay`) | État de jeu, présent dès le démarrage |
| `play.dealOrder` | Ordre de distribution ; `[0]` = premier servi (§2.2) |
| `play.hands` | Mains, secrètes (§2.3) |
| `play.stock` | Talon (R-26) |
| `play.trickNumber`, `trickOrder`, `currentTrick`, `completedTricks` | 5 tours (§2.4) ; cartes jouées publiques (§2.3) |
| `play.control` | Contrôleur et carte de référence du tour (§2.2, §2.4) |
| `play.nextPlayerId` | Joueur attendu (scénario §5 : « joueur actif ») |
| `result?` | Gagnant, méthode, conditions, mains révélées (§17, §2.3) |

Cycle de vie : `waiting → in_progress → finished`, monotone (`isForwardTransition`, et garde
SQL dans `PostgresGameRepository.save`). Il n'y a pas de statut `starting`, car la
distribution est atomique. Il n'y a pas non plus de `cancelled`, `blocked` ni `suspended` : leurs
effets ne sont pas définis (R-23, R-25).

### Partie, tour, coup

```
Partie (Game) ─ une distribution, 5 tours
  └── Tour (trick, « tour » de la spec) ─ chaque joueur en jeu joue une carte
        └── Coup (TrickPlay) ─ { playerId, cardId }
```

Les documents ne définissent **aucune manche** au-dessus de la partie. Dans le code, le mot
« round » n'est utilisé pour rien. « Tour » désigne le pli de la spec (`trick`).

### Contrôle

- `Control = { playerId, cardId? }`. Au départ, le premier servi a le contrôle sans carte.
- Le contrôleur ouvre chaque tour et pose la carte de référence (déduction R-27).
- Un coup prend le contrôle si sa carte est **strictement supérieure** à la carte de référence
  **et** de même couleur selon `sameColor`. La carte de référence devient alors celle du
  nouveau contrôleur, et les joueurs suivants doivent la battre.
- À la fin d'un tour, le contrôleur garde le contrôle et ouvre le tour suivant. À la fin du
  5e tour, il gagne.

## 3. Moteur de règles

Le principe est simple : un état et une commande passent par la validation des règles, qui
produit un nouvel état et des événements.

- `domain/game/ter-engine.ts` : `startGame`, `playCard`, `declareWin`, `flee`. Ce sont des
  fonctions déterministes (hasard et horloge injectés) qui modifient une **copie de travail**
  fournie par `GameService` et renvoient des `GameEventDraft`.
- `domain/rules/rule-set.ts` : les constantes certaines (`HAND_SIZE`, `DEAL_PASSES`,
  `TRICKS_PER_GAME`, `MAX_FLEES_PER_GAME`) et l'interface `TerRuleSet`, une politique par
  règle ambiguë : `sameColor`, `cardPlayability`, `winDeclarationWindow`,
  `instantWinConditions` et `fleeEligibility`.
- `domain/rules/rule-candidates.ts` : des interprétations **candidates** pour chaque politique.
  Aucune n'est officielle ni utilisée par défaut.
- `domain/rules/win-conditions.ts` : chaque condition est un objet `{ id, isSatisfiedBy(hand) }`
  indépendant. La configuration choisit la liste.
- `domain/rules/stake.ts` : `stakeTransfers` (gagné simple uniquement), `PayoutKind` et
  `KoraDetector` (interface sans implémentation).
- `domain/rules/unresolved-rule.ts` : `UnresolvedRuleError(ruleRef)`.

**Il n'existe pas encore de jeu de règles de production.** Sans `rules`, `GameService` refuse
toute commande de jeu (`UnresolvedRuleError('RULESET')`). Les tests utilisent
`tests/fixtures/rules.ts`, explicitement étiqueté « hypothèses de test ».

Contrôles de `playCard`, dans l'ordre :

1. Le `gameId` est valide et la partie existe (service).
2. Le joueur est membre (service, dans la file, puis moteur).
3. La partie est `in_progress`.
4. Le joueur n'a pas fui.
5. C'est son tour.
6. La carte est valide (`parseCardId`).
7. La carte est dans sa main.
8. La carte est jouable selon `cardPlayability`.
9. Mise à jour de l'état.
10. Version incrémentée et écriture conditionnée (service).

Une commande refusée ne modifie rien : la copie de travail est jetée.

## 4. Événements

| Événement | Diffusion | Charge utile |
|---|---|---|
| `game:started` | `game:{gameId}` | `dealOrder`, `firstPlayerId`, `controllerId`, `trickNumber`, `nextPlayerId`, `dealSequence` (lots, aucune carte), `turnStartedAt`, `turnDeadlineAt` |
| `game:hand_dealt` | **privé**, au seul joueur concerné, dans cette partie | `cards`, `batches` (lot de 3, lot de 2) |
| `game:card_played` | `game:{gameId}` | `playerId`, `cardId`, `trickNumber`, `tookControl`, `controllerId` |
| `game:trick_completed` | `game:{gameId}` | `trickNumber`, `controllerId`, `plays` |
| `game:turn_changed` | `game:{gameId}` | `trickNumber`, `nextPlayerId`, `turnStartedAt`, `turnDeadlineAt` (10 s, D-034) |
| `game:control_changed` | `game:{gameId}` | `controllerId`, `cardId`, `trickNumber` (prise de contrôle) |
| `game:turn_timeout` | `game:{gameId}` | `playerId`, `trickNumber`, `turnDeadlineAt` — échéance constatée par le serveur |
| `game:auto_card_played` | `game:{gameId}` | `playerId`, `trickNumber` ; suivi du `game:card_played` du coup automatique |
| `game:player_fled` | `game:{gameId}` | `playerId` |
| `game:finished` | `game:{gameId}` | `result` (mains révélées seulement en cas de gain instantané) |

Les charges utiles sont copiées au moment de la diffusion : un abonné ne peut pas modifier
l'état d'une partie.

### Timer de tour et coup automatique (D-034, D-036)

- Chaque nouveau joueur attendu reçoit `turnStartedAt` et `turnDeadlineAt` = début + 10 s
  (`TURN_DURATION_MS`), fixés par le moteur et persistés avec la partie.
- Après l'échéance, son coup est refusé (`TurnExpiredError`, 409 `TURN_EXPIRED`) ;
  `GameService.handleTurnTimeout` enregistre `turnTimedOutAt` (TURN_TIMEOUT), une seule fois.
- Le coup automatique passe par `AutomaticCardSelectionStrategy` puis par `engine.playCard`,
  exactement comme un coup manuel. Stratégie officielle (D-036,
  `LowestCardAutomaticSelectionStrategy`) : l'ouvreur du tour joue la plus petite carte de
  sa main ; un joueur suivant qui possède la famille de la carte d'ouverture joue la plus
  petite de cette famille, sinon la plus petite de sa main. Déterministe. Égalité de valeur
  entre familles : départage technique PROVISOIRE, non validé par le métier
  (`PROVISIONAL_TIE_BREAK_ORDER`, ordre de `SUITS`, TODO R-06). Le 5e tour n'utilise
  pas de stratégie (carte unique jouée par le moteur). Le timeout ne fait ni fuir, ni
  éliminer, ni terminer.

## 5. Isolation multi-parties

- Le moteur ne lit et n'écrit que la partie reçue en argument. Il ne contient aucun état
  global ni singleton.
- Les cartes sont des identifiants (chaînes), et chaque partie a ses propres tableaux.
  Le dépôt et le service fournissent des copies profondes.
- Testé :
  - jouer dans A laisse B identique ;
  - des commandes simultanées dans A et B ;
  - des mises et des mains distinctes ;
  - un joueur de A refusé dans B (jouer, déclarer, fuir) ;
  - les mains privées ne sortent pas de leur partie ;
  - la fin de A annule son timer seulement ;
  - les mutations profondes (main, talon, cartes jouées, joueurs, charges utiles) ne se
    propagent pas.
