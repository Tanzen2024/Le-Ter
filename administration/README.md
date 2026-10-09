# Administration Le Ter

Plateforme Web d'administration de Le Ter (super administrateur). Application Next.js
autonome : elle ne parle qu'au backend Le Ter, de serveur à serveur.

Documentation : [`docs/admin/`](../docs/admin/) — architecture, API, sécurité, décisions,
avancement.

## Prérequis

- Node.js ≥ 22 (testé avec 22.23.0), npm ≥ 11.
- Le backend Le Ter (`backend/`) démarré, avec PostgreSQL, `JWT_SECRET` et la migration
  `0023_admin_platform.sql` appliquée (`npm run db:migrate` dans `backend/`).
- Un compte administrateur dédié :
  1. créer un compte par l'inscription normale ;
  2. dans `backend/` : `npm run user:role -- <email> admin`.
  Aucun compte par défaut n'existe ; aucun administrateur ne se crée depuis l'interface.

## Installation

```bash
cd administration
npm install
cp .env.example .env.local   # puis adapter
```

## Variables d'environnement (`.env.local`, jamais commité)

| Variable | Rôle | Défaut |
|---|---|---|
| `ADMIN_API_URL` | URL du backend, appelée par le serveur Next.js uniquement | `http://localhost:3000` |
| `ADMIN_PUBLIC_ORIGIN` | origine publique de l'administration (contrôle CSRF) ; vide : déduite de l'en-tête `Host` | vide |
| `ADMIN_COOKIE_SECURE` | cookies `Secure` (HTTPS) | `true` en production, `false` sinon |

Aucune variable n'est exposée au navigateur. Ne jamais y placer de secret CinetPay.

## Développement

```bash
npm run dev        # http://localhost:3100
```

## Vérifications

```bash
npm run typecheck     # TypeScript strict
npm run lint          # ESLint (configuration Next.js)
npm run format:check  # Prettier
npm test              # Vitest + Testing Library
npm run build         # build de production
npm start             # serveur de production (port 3100)
```

## Points d'attention

- Session de 8 heures au maximum, fermée après 30 minutes sans activité (contrôlé par le
  backend). Se connecter au mobile avec le compte administrateur ferme la session Web.
- En production : HTTPS obligatoire (cookies `Secure`), `ADMIN_PUBLIC_ORIGIN` renseignée.
- Toute donnée affichée vient du backend ; une fonction non prise en charge est affichée
  comme indisponible, jamais simulée.
