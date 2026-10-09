# Architecture — Administration Le Ter

> Décisions : [DECISIONS.md](DECISIONS.md) · Sécurité : [SECURITY.md](SECURITY.md) ·
> Contrats : [API.md](API.md) · Avancement : [IMPLEMENTATION.md](IMPLEMENTATION.md)

## 1. Vue d'ensemble

```
Navigateur ──HTTPS──▶ administration/ (Next.js 16, port 3100)
                        ├─ pages App Router  app/(dashboard)/*, app/(auth)/connexion
                        ├─ passerelle serveur app/api/admin/[...path], app/api/session/{login,logout}
                        │    cookies httpOnly (jetons), contrôle Origin + jeton CSRF
                        └─ proxy.ts : redirection vers /connexion sans cookie (confort)
                                   │ HTTP serveur à serveur, Authorization: Bearer
                                   ▼
                      backend/ (Express) /api/admin/**
                        requireAuth → requireRole('admin') → requireAdminSession
                        AdminSessionService · AdminQueryService · PaymentService
                        TournamentService · DetectionAdminService · DetectionSettingsService
                                   ▼
                      PostgreSQL (source de vérité) · Redis (limitation du login admin)
```

- Le navigateur ne parle **qu'au serveur Next.js**. Le backend n'ouvre aucun CORS.
- Toute autorisation est décidée **par le backend**, à chaque requête. La passerelle et
  `proxy.ts` n'ajoutent aucune règle métier ni décision d'accès.
- Aucune modification du moteur de jeu, de `GameService`, de `SessionService`, du flux
  CinetPay des joueurs ni des routes du mobile.

## 2. Backend : ajouts

| Couche | Fichiers | Rôle |
|---|---|---|
| Migration | `migrations/0023_admin_platform.sql` | `admin_sessions`, borne absolue `refresh_tokens.session_expires_at`, audit (`outcome`, acteur nullable pour échec de connexion, actions, cibles, déclencheur d'immuabilité), index |
| Domaine | `domain/admin/admin.ts` | politique de session (8 h / 30 min), limites de connexion, actions d'audit, erreurs, seuils d'affichage |
| Ports | `repositories/admin-{session,audit,query}.repository.ts` | contrats |
| PostgreSQL | `repositories/postgres-admin-{session,audit,query}.repository.ts` | SQL paramétré, colonnes en liste blanche, **jamais `games.state`** |
| Services | `services/admin/admin-session.service.ts` | connexion, contrôle de session, déconnexion, audit |
| | `services/admin/admin-query.service.ts` | DTO, audit des consultations de détail, revérification, compte plateforme, rapports, CSV |
| | `services/admin/admin-reconciliation.ts` | contrôles de rapprochement (réutilise `computePool`, `computePrizes`, `isAllowedDepositAmount`) |
| | `services/admin/create-admin-services.ts` | assemblage |
| HTTP | `routes/admin.routes.ts`, `controllers/admin.controller.ts`, `validators/admin.validators.ts`, `middleware/{require-admin-session,admin-errors,shared-rate-limit}.ts` | routes, validation, garde, erreurs, limitation Redis/mémoire |

**Fichiers existants modifiés** (ajouts seulement) : `auth.service.ts` (`login` découpé en
`verifyCredentials` + `openSession`, comportement mobile identique),
`auth-session.repository.ts` et `postgres-auth-session.repository.ts` (borne absolue
optionnelle), `payment.service.ts` (`verifyForAdmin`, `providerConfigured`),
`require-auth.ts` (pas de double authentification dans une même requête), `api-errors.ts`
(branchement des erreurs admin), `routes/index.ts`, `app.ts`, `server.ts`, `config/env.ts`
(`TRUST_PROXY`), `.env.example`. Commentaires « Katika » : `user.ts`, `set-user-role.ts`,
`stake.ts` (D-060).

**Garde unique** : `createAdminRouter` est monté sur `/api/admin` AVANT les routeurs
existants (détection, paramètres, tournois) ; son `router.use(requireAuth, requireRole,
requireAdminSession)` s'applique donc à TOUTES les routes `/api/admin/*`. Seule
`POST /api/admin/auth/login` est déclarée avant la garde.

## 3. Administration : structure

```
administration/
├── app/
│   ├── (auth)/connexion/            page de connexion
│   ├── (dashboard)/                 coquille (sidebar, barre supérieure) + rubriques
│   │   ├── tableau-de-bord/  joueurs/[id]  parties/[id]  tournois/{nouveau,[id]}
│   │   ├── anti-collusion/[id]  finances/  paiements/[id]  rapprochement/
│   │   ├── compte-plateforme/  rapports/  audit/  parametres/  profil/
│   │   └── error.tsx
│   ├── api/admin/[...path]/route.ts relais vers le backend
│   ├── api/session/{login,logout}/  connexion / déconnexion
│   ├── layout.tsx  providers.tsx  globals.css  not-found.tsx  page.tsx
├── components/
│   ├── ui/        bouton, carte, badge, champs, dialogue, menu, squelette (radix-ui + cva)
│   ├── layout/    sidebar, barre supérieure, navigation, logo, en-tête de page
│   ├── data/      tableau paginé, filtres, indicateurs, badges de statut
│   ├── charts/    série temporelle (Recharts)
│   └── feedback/  états vide / erreur / indisponible / chargement, confirmation
├── features/      un dossier par rubrique : api.ts (requêtes TanStack Query) + vues
├── hooks/         session, état de liste dans l'URL, saisie différée
├── lib/
│   ├── api/       client navigateur (CSRF, fin de session), erreurs
│   ├── server/    passerelle (gateway.ts), cookies, CSRF, configuration, adaptateur Next
│   ├── validation/ schémas Zod (connexion, tournoi)
│   ├── format.ts  labels.ts  utils.ts
├── types/admin.ts contrats des API (miroir du backend ; pas de code partagé, AGENTS.md)
├── tests/         Vitest + Testing Library
└── proxy.ts       redirections de confort (Next 16 : ex-middleware)
```

## 4. Choix techniques

| Sujet | Choix | Raison |
|---|---|---|
| Versions | Next 16.3.6, React 19.3.0, Tailwind 4.3.3, TanStack Query 5.103.2, RHF 7.88.0, Zod 4.6.5, Recharts 3.10.1, Vitest 4.1.11, TypeScript 6.0.3, ESLint 9 | dernières versions publiées depuis au moins deux semaines, compatibles ; TypeScript aligné sur le backend |
| shadcn/ui | composants écrits à la main dans le style shadcn sur `radix-ui` + `class-variance-authority` | pas de dépendance au registre distant ; même API |
| Données | TanStack Query, pagination serveur, état des filtres dans l'URL | partageable, retour arrière conservé |
| Rafraîchissement | aucun `refetchInterval`, pas de rechargement au retour sur l'onglet | une requête admin compte comme activité : seules les actions de l'administrateur prolongent la session |
| Dates | instants ISO UTC vers l'API ; affichage et regroupement par jour en `Africa/Douala` | cohérent avec les tournois |
| Graphiques | une série par graphique, pas de second axe ; teintes validées (luminance, chroma, daltonisme, contraste) ; vue tableau | lisibilité et accessibilité |
| Design | fond gris bleuté, cartes blanches, bleu ardoise, turquoise discret, Inter, bordures fines, ombres légères | demande du propriétaire |
| Mode sombre | non livré | la V1 privilégie les fonctions ; jetons de couleur prêts à être redéfinis |

## 5. Règles métier respectées

- Joueur actif : présent dans `game_players` d'au moins une partie **créée** dans `[from, to)` et
  **démarrée** (`in_progress` ou `finished`). Compté une fois. Parties `waiting` exclues.
- Tournois : limites appliquées par le serveur uniquement ; l'annulation n'est pas proposée
  pendant `STARTING` ; résultats affichés seulement à partir de `RESULTS_VALIDATED`.
- Finances : achats, soldes des joueurs et recettes de la plateforme jamais additionnés ;
  devise unique XAF ; aucune écriture, aucun crédit, aucun remboursement.
- Compte financier de la plateforme (D-060) : `platform_ledger`, solde comptable calculé,
  trésorerie « non intégrée ».
- Suspension des joueurs : désactivée (règles à définir).
