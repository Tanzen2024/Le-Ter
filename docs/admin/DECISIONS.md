# Décisions — Administration Le Ter

Le journal officiel des décisions du projet reste [`docs/decisions.md`](../decisions.md).
Ce fichier résume celles qui gouvernent l'administration et ajoute les choix techniques
propres à `administration/`.

> **Numérotation** : le rôle `SUPER_ADMIN` a été demandé sous le numéro D-059, déjà
> attribué (tournois, D-059). Conformément à l'usage du dépôt (voir D-057, D-058), il est
> enregistré sous le prochain numéro libre : **D-061**. D-060 garde son numéro.

> **Collision à arbitrer** : le lot tournois mené en parallèle cite « D-060 » pour la
> suppression du nom et de la description des tournois (migration `0024`, commentaires de
> `domain/tournaments/tournament.ts`, `validators/tournament.validators.ts`,
> `tournament-export.ts`, `cli/tournament-create.ts`, mobile) et « D-062 » pour le classement
> pondéré (migration `0025`). Dans `docs/decisions.md`, D-060 est la suppression de
> l'appellation Katika. Ces fichiers n'ont pas été modifiés par l'administration : le
> propriétaire du projet doit attribuer un numéro libre à la décision « tournois sans nom »
> (ex. D-063). Les commentaires de migration appliquées ne doivent pas être réécrits.

## Décisions métier

| N° | Décision | Effet |
|---|---|---|
| D-060 | L'appellation « Katika » est supprimée. Le compte central des commissions s'appelle **compte financier de la plateforme Le-Ter** ; il est réalisé par `platform_ledger`. | Pas de second compte ; solde comptable calculé ; trésorerie réelle « non intégrée » ; aucune commission sur les parties ordinaires (R-37 ouvert). |
| D-061 | `admin` est le seul rôle d'administration, présenté comme `SUPER_ADMIN`. | Attribution par `npm run user:role` uniquement ; session admin dédiée sur toutes les routes `/api/admin/*`. |
| — | Joueur actif sur `[from, to)` : présent dans `game_players` d'au moins une partie **créée** dans la période et **démarrée** (`in_progress` ou `finished`). Compté une fois. | Les parties `waiting` jamais démarrées sont exclues. Il n'existe ni partie annulée ni partie de test dans le modèle. |
| — | Session admin : 8 h absolues, 30 min d'inactivité, contrôlées par le backend. | Table `admin_sessions` (migration 0023). |
| ~~—~~ | ~~Suspension des joueurs désactivée en V1.~~ **Remplacée par D-079** (gestion des joueurs). | Désactivation, suspension, révocation des sessions, avertissements, restriction du chat et notes : [MODERATION.md](MODERATION.md). |
| — | Audit des consultations : détail joueur et détail paiement ; jamais les listes. | `USER_VIEWED`, `PAYMENT_VIEWED`. |
| — | Opérations indisponibles : remboursement, retrait, crédit manuel, écriture manuelle au compte plateforme, maintenance. | Affichées « indisponibles », sans endpoint. |

## Références historiques conservées (D-060)

| Emplacement | Raison |
|---|---|
| `backend/migrations/0002_create_users_and_refresh_tokens.sql:20`, `backend/migrations/0017_admin_role_and_audit.sql:6` (commentaires) | Migrations appliquées : leur empreinte SHA-256 est vérifiée par le migrateur ; les modifier bloquerait `db:migrate` (D-026). |
| `docs/decisions.md`, entrées antérieures à D-060 | Journal historique : on n'en réécrit pas le contenu. D-060 les remplace sur ce point. |
| `docs/SPECIFICATION FONCTIONNELLE DE LE TER.docx`, `docs/Voici des critères…docx`, `docs/Diagramme_de_classe_de_LE_TER.jpg` | Documents sources protégés par `AGENTS.md`. Remplacés par D-060 sur ce point. |
| `docs/admin/AUDIT.md` | Rapport d'audit décrivant l'état initial. |

## Choix techniques de l'administration

Voir [ARCHITECTURE.md](ARCHITECTURE.md) et [SECURITY.md](SECURITY.md).
