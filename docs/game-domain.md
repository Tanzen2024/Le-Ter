# Domaine du jeu — moteur du Ter

> Statut : moteur implémenté dans `backend/src/domain/` (octobre 2026).
> Règle absolue : **aucune règle métier n'est inventée**. Les règles certaines sont codées ;
> les règles ambiguës sont des **politiques injectées sans valeur par défaut** ; les situations
> que les documents ne couvrent pas lèvent `UnresolvedRuleError` au lieu d'être devinées.

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
| Démarrage | Séquence « création de partie » | Quand la table est complète (« en attente de (max−1) joueurs ») | CONFIRMÉ | `startGame` exige `players = maxPlayers` |
| Qui déclenche le démarrage | — | Automatique ou créateur ? | NON DÉFINI (R-23) | Commande système `startGame` |
| Distribution | Spec §2.2 | 5 cartes par joueur | CONFIRMÉ | `HAND_SIZE`, `dealCards` |
| Mode de distribution | — | Une à une ou par paquets | Choix technique | Une à une (équivalent sur un paquet mélangé) |
| Cartes restantes (talon) | — | 21, 16 ou 11 cartes : usage ? | NON DÉFINI (R-26) | Conservées dans `stock`, inutilisées, jamais exposées |
| Premier joueur | Spec §2.2 | Le premier servi commence et a le contrôle | CONFIRMÉ | `control = dealOrder[0]` |
| Choix du premier servi / donneur | Spec §2.2 | Non dit (rotation ?) | NON DÉFINI (R-17) | `DealOrderPolicy` |
| Nombre de tours | Spec §2.4, séquence | 5 tours | CONFIRMÉ | `TRICKS_PER_GAME` |
| Contenu d'un tour | 5 cartes, 5 tours, séquence (une carte par itération) | Chaque joueur en jeu joue une carte | DÉDUIT (R-29) | `advance` |
| Manches | — | Aucune notion de manche au-dessus de la partie | Constat | Pas de modèle « Round » |
| Meneur des tours 2 à 5 | §2.4 : référence = carte du contrôleur | Le contrôleur ouvre le tour | DÉDUIT (R-27) | `openTrick` |
| Ordre de jeu dans un tour | — | Sens ? | NON DÉFINI (R-28) | `PlayOrderPolicy` |
| Prise de contrôle | Spec §2.4 | Carte **supérieure** et **de même couleur** que celle du contrôleur | CONFIRMÉ | `applyControl` |
| Sens de « couleur » | Spec §2.1, §2.4, §4 | Famille ou rouge/noir ? (couleur des étoiles inconnue) | AMBIGU (R-08) | `ColorEquivalence` |
| Obligation de suivre | — | Non dite | NON DÉFINI (R-03) | `CardPlayabilityPolicy` |
| « Carte non jouable » | Scénario §5 | Le serveur vérifie et refuse | CONFIRMÉ | `CardNotPlayableError` |
| Fin normale | Spec §1 + séquence | Celui qui a le contrôle à l'issue du 5e tour gagne | CONFIRMÉ | `CONTROL_AFTER_LAST_TRICK` |
| Visibilité | Spec §2.3 | Sa main seulement ; cartes jouées publiques | CONFIRMÉ | `toPlayerView`, `game:hand_dealt` privé |
| Révélation en cas de gain instantané | Spec §2.3 | Toutes les mains sont révélées | CONFIRMÉ | `result.revealedHands` |
| Déclaration de victoire | Séquence + scénario §6 | Le joueur la demande, le serveur vérifie | CONFIRMÉ | `declareWin` |
| Main non gagnante | Séquence | Message, la partie continue | CONFIRMÉ | `NotAWinningHandError`, état inchangé |
| Moment de la déclaration | — | Avant de jouer ? À tout moment ? | NON DÉFINI (R-07) | `WinDeclarationWindow` |
| Trois 3 | Spec §4 | 3 cartes de valeur 3 | CONFIRMÉ | `threeThrees` |
| Quatre de même valeur | Spec §4 | 4 cartes de même valeur (impossible pour 10) | CONFIRMÉ | `fourOfAValue` |
| Cinq de même couleur | Spec §4 | 5 cartes de même couleur | CONFIRMÉ, « couleur » AMBIGU | `fiveSameColor(sameColor)` |
| Somme | Spec §4 : ≤ 21 ; note `checkWinCondition` : ≥ 30 | Seuil et sens | CONTRADICTOIRE (R-01) | `sumThreshold({operator, threshold})`, sans valeur par défaut |
| 7 + 7 + 4 + 3 | Spec §4 | Ne décrit que 4 cartes sur 5 | AMBIGU (R-04) | `twoSevensFourThree()` lève `UnresolvedRuleError` |
| Trois + deux | Spec §4 | 3 d'une valeur + 2 d'une autre | CONFIRMÉ | `threeAndTwo` |
| Trois 7 | Spec §4 | 3 cartes de valeur 7 | CONFIRMÉ | `threeSevens` |
| Plusieurs conditions remplies | — | Laquelle afficher ? | NON DÉFINI (R-31) | Toutes listées dans `instantWinConditions` |
| Fuite autorisée | Spec §2.5 : « pas joué plus d'une carte » ; séquence : « avant le 2e tour » | Deux formulations | CONTRADICTOIRE (R-05) | `FleeEligibility` |
| Fuites par partie | Spec §2.5 | Une au maximum | CONFIRMÉ | `MAX_FLEES_PER_GAME` |
| Après une fuite | Séquence | La partie continue sans ce joueur | CONFIRMÉ | Le joueur est sauté |
| Fuite du contrôleur, ou partie réduite à 1 joueur | — | Non dit | NON DÉFINI (R-30) | `UnresolvedRuleError` |
| Gagné simple | Spec §5.1 | Chaque perdant verse la mise | CONFIRMÉ | `stakeTransfers('SIMPLE', …)` |
| Kora / Double Kora | Spec §5.2-5.3 | Déclencheur inconnu ; 200 / 300 pour une mise de 100 | AMBIGU (R-02) | `PayoutKind`, `KoraDetector` sans implémentation |
| Le fuyard paie-t-il ? | — | Non dit | NON DÉFINI (R-05) | `fledPlayerIds` séparé dans le résultat |
| Prélèvement du Katika | Spec §9 | « Pourcentage minimal » non chiffré | AMBIGU (R-09) | Non modélisé |
| Unité de la mise | Spec §5 (FCFA) ; maquette (jetons) | FCFA ou jetons | AMBIGU (R-13) | `stakeAmount` entier, sans unité |
| Minuteur | Scénario §5 ; séquence | Durée et effet | AMBIGU (R-06) | Registre par partie, effet non codé |
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
- `dealCards(deck, dealOrder, handSize)` : distribue une carte à la fois, renvoie
  `{ hands, stock }`. Si les cartes ne suffisent pas, `NotEnoughCardsError`.
- Hasard : interface `RandomSource`. En production, `cryptoRandomSource` (`crypto.randomInt`,
  sans biais), puisque de l'argent réel est en jeu. Dans les tests, des sources déterministes
  (`tests/fixtures/random.ts`), sans dépendance externe.

### User et PlayerInGame

- **User** : le compte. Il n'est pas modélisé dans le moteur, seulement référencé par `PlayerId`.
- **PlayerInGame** (`players[]` d'une partie) : `{ playerId, seat, joinedAt, fledAt? }`. C'est la
  participation à **une** partie. Un même utilisateur a un `PlayerInGame` distinct par partie.
  Le modèle autorise plusieurs participations ; la politique qui le permet ou non est R-18.

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

Cycle de vie : `waiting → in_progress → finished`. Il n'y a pas de statut `starting`, car la
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
- `domain/rules/rule-set.ts` : les constantes certaines (`HAND_SIZE`, `TRICKS_PER_GAME`,
  `MAX_FLEES_PER_GAME`) et l'interface `TerRuleSet`, une politique par règle ambiguë :
  `sameColor`, `dealOrder`, `playOrder`, `cardPlayability`, `winDeclarationWindow`,
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
| `game:started` | `game:{gameId}` | `dealOrder`, `controllerId`, `trickNumber`, `nextPlayerId` (aucune carte) |
| `game:hand_dealt` | **privé**, au seul joueur concerné, dans cette partie | `cards` |
| `game:card_played` | `game:{gameId}` | `playerId`, `cardId`, `trickNumber`, `tookControl`, `controllerId` |
| `game:trick_completed` | `game:{gameId}` | `trickNumber`, `controllerId`, `plays` |
| `game:turn_changed` | `game:{gameId}` | `trickNumber`, `nextPlayerId` |
| `game:player_fled` | `game:{gameId}` | `playerId` |
| `game:finished` | `game:{gameId}` | `result` (mains révélées seulement en cas de gain instantané) |

Les charges utiles sont copiées au moment de la diffusion : un abonné ne peut pas modifier
l'état d'une partie.

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
