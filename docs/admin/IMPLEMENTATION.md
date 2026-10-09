# Avancement — Administration Le Ter

État au 2026-10-09. Décisions : [DECISIONS.md](DECISIONS.md).

## 1. Phases

| Phase | Contenu | État |
|---|---|---|
| 0 — Audit | [AUDIT.md](AUDIT.md), référence des tests | Terminée |
| A — Katika (D-060) | 3 commentaires backend, 5 documents actifs, R-09 tranché, R-37 ouvert, D-060 et D-061 | Terminée |
| B — Initialisation | Next.js 16, TypeScript strict, Tailwind 4, ESLint, Prettier, Vitest | Terminée |
| C — Design system | jetons, composants, sidebar, barre supérieure, responsive | Terminée (mode clair) |
| D — Authentification | migration 0023, session admin 8 h / 30 min, passerelle, cookies, CSRF, limitation Redis, `TRUST_PROXY` | Terminée |
| E — Consultation | tableau de bord, joueurs, parties, tournois, anti-collusion | Terminée |
| F — Finances | vue générale, transactions, paiements, revérification, rapprochement, compte plateforme | Terminée |
| G — Rapports, audit, paramètres, profil | rapports + CSV, journal, paramètres, état des services, profil | Terminée |
| H — Validation | tests, lint, Prettier, TypeScript, builds, test de bout en bout | Terminée (voir §3) |

## 2. Rubriques

| Rubrique | État | Remarques |
|---|---|---|
| Tableau de bord | Opérationnelle | KPI et graphiques réels, alertes, activité administrative |
| Joueurs | Opérationnelle (lecture) | suspension **désactivée** (règles non définies) |
| Parties | Opérationnelle (lecture) | aucune donnée de jeu privée ; aucune action sur une partie |
| Tournois | Opérationnelle | création, approbation, refus, annulation (pas pendant `STARTING`), résultats, export ; **modification d'un tournoi : non proposée dans l'interface** (l'API existe) ; filtre de période appliqué sur les 100 tournois renvoyés par l'API |
| Anti-collusion | Opérationnelle | suivi des alertes, signaux, interrupteur global |
| Finances | Opérationnelle | opérations exceptionnelles affichées « indisponibles » |
| Paiements CinetPay | Opérationnelle | revérification auditée (nécessite CinetPay configuré) |
| Rapprochement | Opérationnel (lecture) | relevé marchand CinetPay non intégré |
| Compte financier de la plateforme | Opérationnel (lecture) | solde comptable calculé ; trésorerie réelle non intégrée |
| Rapports | Opérationnels | 7 rapports, export CSV audité |
| Journal d'audit | Opérationnel (lecture) | |
| Paramètres | Opérationnels | tournois et détection ; pas de paramètre de jeu, pas de maintenance |
| Profil et session | Opérationnel | |

## 3. Tests exécutés

### Backend (`backend/`)

| Commande | Référence (avant) | Après |
|---|---|---|
| `npm run typecheck` | OK | OK |
| `npm run lint` | OK | OK |
| `npm run build` | — | OK |
| `npm test` (suite complète) | 1 169 tests : 1 099 OK, 20 échecs (délais), 50 ignorés | 1 290 tests : 1 176 OK, **62 échecs (délais)**, 52 ignorés |
| suites en échec relancées seules (`--runInBand`) | 25/25 | `session-api` + `tournament-table-closing` : **62/62 OK** |
| `npm test -- tests/integration/admin tests/unit/admin` | — | **50/50 OK** (deux exécutions) |
| suites admin existantes adaptées (détection, interrupteur, tournois) | — | **84/84 OK** |
| `tests/integration/database/migrator.test.ts` | — | OK (migration 0023 appliquée sur PGlite) |

Les 62 échecs de la suite complète sont tous `Exceeded timeout of 30000 ms for a hook`
(PGlite dans des workers parallèles) ; ils passent seuls. Même nature que la référence ;
les suites touchées varient d'une exécution à l'autre. Les nouveaux tests couvrent :
401 sans jeton, 403 pour un joueur, 401 pour une session mobile d'un compte admin, échec de
connexion audité (compte inconnu, non admin) sans révoquer la session mobile, 429,
expiration après 30 min d'inactivité et après 8 h (jetons révoqués), borne du refresh
token, déconnexion effective, immuabilité du journal, absence de mains dans les réponses,
consultation sans effet sur la partie, audit des détails, revérification idempotente
(crédit unique, clé rejouée, montant divergent, CinetPay injoignable ou non configuré),
anomalies de paiement, six contrôles du compte plateforme, KPI (joueur actif compté une
fois), rapports, CSV, `TRUST_PROXY`, repli Redis, CSV sans injection.

### Mobile (`frontend/`, non modifié)

| Commande | Référence | Après |
|---|---|---|
| `npx tsc --noEmit` | OK | OK |
| `npx expo lint` | OK | OK |
| `npm test -- --ci` | 240/240 | **244/244** (tests ajoutés par le lot tournois en parallèle) |

### Administration (`administration/`)

| Commande | Résultat |
|---|---|
| `npm run typecheck` | OK |
| `npm run lint` | OK, aucun avertissement |
| `npm run format:check` | OK |
| `npm test` | **29/29 OK** (passerelle : CSRF, chemins, renouvellement, effacement des cookies, jetons jamais renvoyés ; validations ; composants) |
| `npm run build` | OK (25 routes + proxy) |

### Test de bout en bout (HTTP)

Backend réel sur PGlite en mémoire (migration 0023, aucune base partagée, port 3999) +
administration buildée (port 3199), parcours scripté : redirection sans session, page de
connexion, API sans session (401), connexion d'une autre origine (403), mauvais mot de passe
(401), connexion (cookies httpOnly, jetons absents de la réponse), tableau de bord, 14 pages
(200), téléphones masqués, rapprochement (paiement ancien détecté), revérification sans
jeton CSRF (403), CinetPay non configuré (503 explicite), détail de paiement audité, compte
plateforme, tournois, export CSV, journal (4 événements attendus), déconnexion (204 puis 401
et redirection). Le backend local de l'utilisateur (port 3000) n'a pas été touché.

## 4. Migrations

| Migration | État |
|---|---|
| `0023_admin_platform.sql` | **préparée et testée sur PGlite** ; **non appliquée** à une base partagée ou de production (autorisation requise) |

Les migrations `0024` et `0025` (tournois sans nom, classement pondéré) appartiennent au lot
tournois mené en parallèle ; elles sont numérotées après `0023`, sans collision.

## 5. Fichiers

**Créés — backend** : `migrations/0023_admin_platform.sql` ; `src/domain/admin/admin.ts` ;
`src/repositories/{admin-audit,admin-session,admin-query}.repository.ts` et leurs versions
`postgres-*` ; `src/services/admin/{admin-session.service,admin-query.service,admin-reconciliation,create-admin-services}.ts` ;
`src/routes/admin.routes.ts` ; `src/controllers/admin.controller.ts` ;
`src/validators/admin.validators.ts` ;
`src/middleware/{require-admin-session,admin-errors,shared-rate-limit}.ts` ;
`tests/fixtures/admin.ts` ; `tests/integration/admin/{admin-auth,admin-api}.test.ts` ;
`tests/unit/admin/admin-unit.test.ts`.

**Modifiés — backend** (ajouts, sans retrait du travail existant) : `src/app.ts`,
`src/server.ts`, `src/routes/index.ts`, `src/config/env.ts`, `.env.example`,
`src/middleware/{api-errors,require-auth}.ts`, `src/services/auth/auth.service.ts`,
`src/repositories/{auth-session,postgres-auth-session}.repository.ts`,
`src/services/payments/payment.service.ts`, `src/repositories/postgres-admin-query.repository.ts`
(libellé des tournois sans nom, aligné sur 0024), commentaires de `src/domain/users/user.ts`,
`src/cli/set-user-role.ts`, `src/domain/rules/stake.ts` ; tests `tests/fixtures/{game-api,tournaments}.ts`,
`tests/integration/database/migrator.test.ts`, `tests/integration/detection/{detection-admin,detection-global-switch}.test.ts`,
`tests/integration/tournaments/tournament-api.test.ts`.

**Créés — administration** : tout `administration/` (hors `node_modules`, `.next`).

**Documentation** : créés `docs/admin/{AUDIT,DECISIONS,ARCHITECTURE,API,SECURITY,IMPLEMENTATION}.md` ;
modifiés `docs/decisions.md` (D-060, D-061 ajoutées), `docs/TODO.md` (R-09 tranché, R-37),
`docs/architecture.md`, `docs/authentication.md`, `docs/detection.md`, `docs/game-domain.md`.

Aucun commit, push, changement de branche ni déploiement n'a été effectué.

## 6. Prochaines étapes

1. Appliquer `0023` sur la base de développement puis de production (autorisation requise).
2. Créer le compte administrateur dédié (`npm run user:role`).
3. Lot séparé : retirer ou migrer les écrans `frontend/app/admin/**` du mobile.
4. Régler l'en-tête `D-060` utilisé par le lot tournois (voir DECISIONS.md).
5. Infrastructure : HTTPS, `ADMIN_PUBLIC_ORIGIN`, `TRUST_PROXY`, rôle SQL sans droit de
   modification sur `admin_audit_log`.
6. Décisions métier ouvertes : suspension des joueurs, commission des parties ordinaires
   (R-37), sorties du compte plateforme, remboursements et retraits.
