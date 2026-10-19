# Sécurité — Administration Le Ter

## 1. Identité et rôle

- Seul rôle d'administration : `admin` (`users.role`), présenté comme `SUPER_ADMIN`
  (D-061). Aucune inscription d'administrateur : le rôle s'attribue uniquement sur le
  serveur par `npm run user:role -- <email> admin` (`user:role:prod` après build).
- Création du premier compte : inscription normale d'un compte **dédié** (pas un compte de
  jeu), puis l'outil ci-dessus. Aucun identifiant par défaut, aucun mot de passe codé.
- Le rôle est relu en base à chaque requête (`AuthService.authenticate`).
- R-32 : une connexion révoque la session précédente du même compte ; se connecter au
  mobile avec le compte admin ferme la session d'administration (et inversement).

## 2. Session d'administration (8 h / 30 min)

| Mécanisme | Où | Effet |
|---|---|---|
| Rôle vérifié avant la session | `AdminSessionService.login` | un compte joueur n'obtient jamais de session et sa session mobile n'est pas révoquée |
| `admin_sessions` | migration 0023 | une ligne par session d'administration : début, dernière activité, borne absolue, fin, motif |
| Contrôle à chaque requête `/api/admin/*` | `requireAdminSession` | durée absolue (8 h) et inactivité (30 min) vérifiées par le serveur ; activité enregistrée (au plus toutes les 15 s) |
| Expiration | `AdminSessionRepository.end` | session terminée, **refresh tokens révoqués**, audit `ADMIN_SESSION_EXPIRED`, 401 |
| Borne du refresh token | `refresh_tokens.session_expires_at` | aucune rotation (même par `/api/auth/refresh`) ne prolonge un jeton admin au-delà de 8 h ; sessions des joueurs : `NULL`, inchangées |
| Pas de rafraîchissement automatique qui prolonge la session | `app/providers.tsx`, `X-Admin-Passive` (D-116) | seules les relectures **passives** des points d'attention et le flux `/api/admin/events` tournent en fond ; contrôlées comme les autres, elles n'enregistrent jamais d'activité : la session expire toujours après 30 min sans action |
| Jeton mobile d'un compte admin | `requireAdminSession` | 401 `ADMIN_SESSION_REQUIRED` |

**Incompatibilité assumée** : les écrans `frontend/app/admin/**` du mobile utilisent une
session mobile ; ils reçoivent désormais 401 `ADMIN_SESSION_REQUIRED`. Leur retrait ou leur
migration est un lot séparé (le mobile n'a pas été modifié).

## 3. Navigateur et passerelle

- Le navigateur ne voit **aucun jeton** : `leter_admin_at` et `leter_admin_rt` sont des
  cookies `httpOnly`, `SameSite=Strict`, `Secure` en production (`ADMIN_COOKIE_SECURE`),
  `Path=/`, 8 h au plus. Les réponses de connexion ne contiennent pas les jetons.
- CSRF : `SameSite=Strict` + contrôle d'`Origin` sur toute requête de modification (y
  compris la connexion) + jeton de double soumission `leter_admin_csrf` (en-tête
  `x-csrf-token`, comparaison en temps constant).
- Relais limité à `/api/admin/*` (segments validés, `..` refusé) ; `auth/login` et
  `auth/logout` passent par des routes dédiées.
- Redirection après connexion : chemins internes uniquement (pas de redirection ouverte).
- En-têtes : `X-Frame-Options: DENY`, `nosniff`, `Referrer-Policy: same-origin`,
  `Permissions-Policy`, COOP ; réponses de la passerelle `Cache-Control: no-store`.
- Aucune variable `NEXT_PUBLIC_*` ; aucune donnée sensible dans le code client.
- `proxy.ts` ne fait que des redirections de confort : **l'autorisation est au backend**.

## 4. Limitation de débit

| Limite | Fenêtre | Maximum | Clé |
|---|---|---|---|
| Connexion admin par compte | 15 min | 5 | empreinte (IP + email) |
| Connexion admin par email | 15 min | 20 | empreinte (email) |
| Connexion admin par IP | 15 min | 30 | empreinte (IP) |

Compteurs partagés dans Redis (`INCR` + `PEXPIRE NX`) si `REDIS_URL` est défini ; en cas de
panne Redis, **repli contrôlé** sur un compteur local (la limite reste appliquée, l'incident
est journalisé). Les emails ne sont jamais stockés en clair dans Redis.

`TRUST_PROXY` est **désactivé par défaut** : `req.ip` est le pair TCP et `X-Forwarded-For`
est ignoré. La passerelle Next.js ne transmet pas d'adresse client. Conséquence : la limite
par IP s'applique à l'adresse de la passerelle ; les limites par compte et par email restent
pleinement efficaces. Une fois l'infrastructure connue, configurer `TRUST_PROXY` avec les
seules adresses des proxys réels (`true` est refusé).

## 5. Journal d'audit

- Écrit par le serveur, dans la même transaction que l'action quand elle en a une.
- Événements : connexions réussies et échouées (motif : compte inconnu, mot de passe, compte
  désactivé, non admin), déconnexions, expirations, consultation du détail d'un joueur ou
  d'un paiement, revérification de paiement (résultat), export de rapport, actions sur les
  tournois, paramètres, alertes (existants).
- Jamais : mot de passe, jeton, adresse IP, email, numéro de téléphone, donnée de paiement
  sensible. Les listes consultées ne sont pas journalisées.
- Acteur absent autorisé **seulement** pour `ADMIN_LOGIN_FAILED` (contrainte CHECK).
- **Immuabilité** : déclencheur refusant `UPDATE` et `DELETE` ligne à ligne ; aucune route
  de modification. **Limite** : un rôle propriétaire de la table peut désactiver le
  déclencheur ou exécuter `TRUNCATE` (utilisé par les tests). Protection complète :
  exécuter l'application avec un rôle SQL sans droit DDL, sans `UPDATE`/`DELETE`/`TRUNCATE`
  sur `admin_audit_log` (à mettre en place côté infrastructure).

## 6. Données exposées

- Parties : aucune donnée de jeu privée (pas de lecture de `games.state`) — testé.
- Joueurs : téléphone masqué dans les listes, complet dans la fiche (consultation auditée).
- Paiements : ni `notify_token_hash`, ni `payment_url`.
- Système : CinetPay « configuré / non configuré » et mode, jamais une valeur.
- Exports CSV : colonnes en liste blanche, formules de tableur neutralisées, audités.

## 7. Finances

- Aucun crédit, débit, remboursement, retrait ni écriture au compte de la plateforme depuis
  l'administration ; aucune modification de solde par SQL.
- Un paiement n'est jamais marqué réussi par l'administration : seule la confirmation de
  CinetPay, relue par le serveur, règle un paiement (règlement idempotent existant).

## 8. Risques résiduels et suites

| Risque | Statut |
|---|---|
| Rôle SQL dédié pour protéger réellement le journal | infrastructure, à faire |
| HTTPS de bout en bout (cookies `Secure`) | à configurer au déploiement |
| `TRUST_PROXY` à régler selon le proxy réel | à faire au déploiement |
| Écrans admin du mobile incompatibles (401) | lot séparé |
| Pas d'authentification à deux facteurs | recommandation |
| Pas de CSP stricte sur l'administration (Next.js et scripts inline) | recommandation (CSP avec nonce) |
| Instabilité des tests sous charge (délais PGlite) | préexistant |
