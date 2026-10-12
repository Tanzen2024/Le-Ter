# Gestion des joueurs et modération (D-079)

Administration → Joueurs : gestion des comptes, sécurité et modération. Décision :
[D-079](../decisions.md). Routes : [API.md §3.1](API.md).

## États d'un compte

| Mesure | Stockage | Effet | Fin |
|---|---|---|---|
| Désactivation | `users.status = 'disabled'` (D-029) | sessions révoquées ; connexion, renouvellement et chaque requête refusés (`403 ACCOUNT_DISABLED`) | réactivation par un admin |
| Suspension | `user_sanctions` `SUSPENSION` | même effet sur l'accès (`403 ACCOUNT_SUSPENDED`) | échéance (heure du serveur) ou levée ; ne touche jamais `users.status` |
| Restriction du chat | `user_sanctions` `CHAT_RESTRICTION` | envoi de messages refusé dans toutes ses parties (`403 CHAT_RESTRICTED`) ; le reste fonctionne | échéance ou levée |
| Avertissement | `user_sanctions` `WARNING` (+ `notifications`) | aucun effet sur l'accès ; message visible facultatif | — |

Une mesure est **en cours** si elle n'est pas levée et que `ends_at` est NULL ou futur. Le
contrôle est fait à chaque connexion, renouvellement, requête authentifiée, commande
WebSocket et message de chat, avec l'heure du serveur : aucune tâche planifiée, aucune
écriture à l'expiration.

## Où le backend applique les règles

- `AuthService.verifyCredentials` (connexion joueur et admin) : compte désactivé ou suspendu.
- `PostgresAuthSessionRepository.rotate` (renouvellement) : sous verrou de la ligne `users`.
- `PostgresAuthSessionRepository.findActiveSession` (chaque requête via `requireAuth`, chaque
  commande WebSocket via `stillAuthenticated`) : une seule requête SQL lit session, statut et
  suspension.
- `ChatService.sendMessage` (HTTP et WebSocket) puis `PostgresChatRepository.insert` (la même
  condition dans l'INSERT) : restriction du chat.

## Révocation des sessions

Une session = une suite de jetons de renouvellement (`refresh_tokens.session_id`, R-32 : une
seule active par compte). Révoquer = marquer le jeton actif révoqué, dans la transaction de
l'action, sous verrou de la ligne `users`. Les access tokens (JWT) de cette session sont refusés
dès la requête suivante, parce que chaque requête relit la session en base. L'administrateur
qui agit n'est jamais touché ; les autres joueurs non plus. La reconnexion normale reste
possible dès que le compte est accessible.

Limite connue : une connexion WebSocket déjà abonnée au chat d'une partie continue de recevoir
les messages diffusés jusqu'à l'expiration de son access token (15 min) ; toute commande
(envoi, abonnement) est refusée et ferme la connexion.

## Protections

- Désactivation, suspension, révocation : jamais sur son propre compte (403, audité en échec).
- Le dernier super administrateur accessible (actif, non suspendu) ne peut pas perdre l'accès
  (409, audité en échec). Les comptes admin sont verrouillés dans un ordre fixe : deux admins
  qui se désactivent mutuellement en même temps → l'un réussit, l'autre est refusé.
- Toute action exige `requireAuth` → `requireRole('admin')` → session d'administration.
- L'auteur d'une action ou d'une note est l'administrateur authentifié ; un `actorId` ou
  `authorId` envoyé dans le corps est refusé (400).
- Avertissements et notes : `Idempotency-Key` obligatoire (un double clic ne crée qu'une ligne).
- Suspension / restriction déjà en cours : 409 (pas de doublon).

## Partie en cours

Un joueur suspendu, désactivé ou déconnecté pendant une partie est traité comme une
déconnexion (décision du porteur, D-079) : le minuteur de 20 s joue ses cartes (D-036), la
partie se termine et se règle normalement, puis la manche Poursuivre/Quitter le retire. Ni
fuite, ni défaite, ni mouvement financier n'est ajouté. Rien n'est modifié dans les tournois,
achats ou retraits en cours.

## Journal et données

- Journal de modération = `admin_audit_log` filtré sur la cible `USER` (source unique).
  Actions : `USER_DISABLED`, `USER_ENABLED`, `USER_SUSPENDED`, `USER_SUSPENSION_LIFTED`,
  `USER_SESSIONS_REVOKED`, `USER_WARNED`, `USER_CHAT_RESTRICTED`,
  `USER_CHAT_RESTRICTION_LIFTED`, `USER_NOTE_ADDED`, `USER_NOTE_DELETED`. `details` contient
  motif, échéance, identifiant de la mesure ; jamais de jeton, ni le texte d'une note.
- `user_sanctions` : aucune suppression ; seule la levée d'une mesure ouverte est modifiable
  (trigger). `user_admin_notes` : aucune modification ; suppression logique avec motif.
- Les notes internes ne sont exposées par aucune API joueur. Le seul texte transmis au joueur
  est le `playerMessage` d'un avertissement, affiché à l'accueil de l'application mobile
  (`ModerationNotice`) et marqué lu par « J'ai compris ».

## Interface

- Liste : badges Actif/Désactivé, Suspendu, Chat restreint ; filtre « Suspendus » ; menu
  d'actions par ligne (ouvrir la fiche, activer/désactiver avec confirmation et motif).
- Fiche : onglets Profil (téléphone masqué par défaut), Sécurité, Activité (parties et
  transactions existantes, paginées côté serveur, en lecture seule), Modération (mesures,
  notes, journal) ; carte « Actions sur le compte ».
