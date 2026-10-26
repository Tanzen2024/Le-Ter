# Le Ter — Exploitation du VPS (environnements TEST et PROD)

- **Date** : 2026-10-26 · **Commit déployé** : `f428637768b9896bfd8491f02c4245c6bf87dca3`
  (TEST et PROD) · **Décision** : D-171.
- **Serveur** : VPS Contabo `vmi3697591`, Ubuntu 24.04.5 LTS, IPv4 `158.220.96.159`,
  IPv6 `2a02:c207:2369:7591::1`, 6 vCPU, 11 Go de RAM, 193 Go de disque.
- **Accès** : SSH par clé uniquement, compte `lamat` (sudo avec mot de passe). Connexion root
  et authentification par mot de passe désactivées.
- Ce document ne contient **aucun secret** ni identifiant de compte personnel. Il indique
  seulement où se trouvent les secrets.
- **Mises à jour** : 2026-10-26, création ; 2026-10-26, ajout du §10 (services et outils
  externes) ; 2026-10-26, D-169 (verrou du parrainage) et D-170 (`HOST`) versionnés dans le
  dépôt, **pas encore déployés** sur le VPS (§11) ; 2026-10-26, distribution de l'APK de test
  depuis le VPS (§7.1) et espace de distribution PROD (§7.2). Tenir ce document à jour à chaque changement
  sur le serveur ou chez un prestataire.

## 1. Architecture

```text
                          VPS 158.220.96.159
                                  │
                    Nginx :80 → 301 · :443 (TLS 1.2/1.3, HTTP/2)
               ┌──────────────────┴──────────────────┐
          LE TER TEST                           LE TER PROD
   https://api-beta.leter.cm               https://api.leter.cm
   le-ter-backend-test → 127.0.0.1:3001    le-ter-backend-prod → 127.0.0.1:3000
   utilisateur leter-test                  utilisateur leter-prod
   PostgreSQL le_ter_test                  PostgreSQL le_ter_prod
   Redis 127.0.0.1:6380                    Redis 127.0.0.1:6379
   CinetPay SANDBOX (sk_test_)             CinetPay vide : finances verrouillées
```

L'isolation ne vient pas du code, qui est le même commit pour les deux environnements. Elle
vient de la configuration :

- **Bases** : une base et un rôle par environnement. `CONNECT` est retiré à `PUBLIC`, donc
  chaque rôle ne peut se connecter qu'à sa propre base.
- **Redis** : deux instances distinctes, chacune avec son mot de passe. Les canaux Pub/Sub
  sont globaux à une instance (`le-ter:admin:events`, `le-ter:game:{id}:*`,
  `le-ter:session:{id}:events`, `le-ter:user:{id}:events`) : séparer par numéro de base
  (DB 0/1) **ne suffirait pas**.
- **Utilisateurs système** : un par environnement. Le code de chaque environnement est
  illisible pour l'autre.
- **systemd** : `InaccessiblePaths=` masque à chaque service l'arborescence de l'autre
  environnement, `/opt/le-ter/app`, `/opt/le-ter/secrets` et `/opt/le-ter/backups`.
- **Secrets** : distincts (PostgreSQL, Redis, JWT). Vérifiés différents à leur génération.

## 2. Arborescence

| Chemin | Propriétaire / mode | Contenu |
|---|---|---|
| `/opt/le-ter/leter-test/app` | `lamat:leter-test` 2750 | clone Git figé sur le commit, `backend/dist`, `node_modules` (groupe en lecture seule) |
| `/opt/le-ter/leter-test/env/backend.env` | `root:root` 600 | configuration TEST (lue par systemd en root) |
| `/opt/le-ter/leter-test/backups/` | `root:root` 700 | dumps `le_ter_test_<date UTC>.dump` + `.sha256`, copies de configuration |
| `/opt/le-ter/leter-test/logs/` | `leter-test` 750 | réservé, inutilisé (journaux dans journald) |
| `/opt/le-ter/leter-prod/…` | idem avec `leter-prod` | même structure pour la PROD |
| `/opt/le-ter/secrets/` | `root:root` 700 | `pg_le_ter_test.password`, `pg_le_ter_prod.password`, `redis_test_password`, `redis_prod_password`, `redis_password` (ancien, obsolète) |
| `/opt/le-ter/backups/` | `root:root` 700 | dumps de l'ancienne base `le_ter`, **dump de référence** `le_ter_pre_split_20261026_110247.dump` (SHA-256 `04cff9cf530cec8cf65905ce7587722233f2ea14484ac6282939fac7711164b2`, à ne jamais supprimer), copies `*.bak-*` |
| `/opt/le-ter/app` | `lamat` | **ancien** déploiement (désactivé, conservé pour retour arrière) |

Aucun `backend/.env` ne doit exister dans les clones TEST et PROD : au démarrage, le backend
charge le `.env` du dossier courant s'il en trouve un.

## 3. Services systemd

| Unité | Rôle | Utilisateur | Dépend de |
|---|---|---|---|
| `le-ter-backend-test.service` | API TEST, port 3001 | `leter-test` | `postgresql`, `redis-server@test` |
| `le-ter-backend-prod.service` | API PROD, port 3000 | `leter-prod` | `postgresql`, `redis-server` |
| `redis-server.service` | Redis PROD 6379 (`/etc/redis/redis.conf`) | `redis` | — |
| `redis-server@test.service` | Redis TEST 6380 (`/etc/redis/redis-test.conf`, données `/var/lib/redis/test`, sans persistance, 256 Mo) | `redis` | — |
| `le-ter-backup-prod.timer` | sauvegarde `le_ter_prod` à 02:15 UTC | root | — |
| `le-ter-db-backup.timer` | **ancien** : sauvegarde `le_ter` à 02:30 UTC | root | à désactiver avec le retrait de l'ancien service |
| `le-ter-backup-test.timer` | sauvegarde `le_ter_test` à 02:45 UTC | root | — |
| `certbot.timer` | renouvellement des certificats | root | — |
| `le-ter-backend.service` | **ancien** backend, `disabled`/`inactive` | `lamat` | — |

Particularités des deux backends :

- `NODE_OPTIONS="--dns-result-order=ipv4first --no-network-family-autoselection"` : connexions
  sortantes en IPv4. CinetPay n'autorise que `158.220.96.159` : en IPv6, l'authentification
  est refusée (code 2011 `NOT_ALLOWED`). TEST : drop-in
  `/etc/systemd/system/le-ter-backend-test.service.d/ipv4.conf`. PROD : intégré à l'unité.
- Durcissement : `ProtectSystem=strict`, `NoNewPrivileges`, `CapabilityBoundingSet=` vide,
  `PrivateTmp`, `PrivateDevices`, `MemoryMax` (1 Go TEST, 2 Go PROD).
- Le code déployé écoute sur toutes les interfaces (`*:3000`, `*:3001`) : seul UFW empêche
  l'accès direct. Correction : variable `HOST=127.0.0.1` (D-170), présente dans le dépôt, pas
  encore déployée (§11).

## 4. Réseau, DNS et TLS

- **UFW** : entrées refusées par défaut ; ouverts : 22, 80, 443 (IPv4 et IPv6). PostgreSQL
  (5432) et Redis (6379, 6380) n'écoutent que sur la boucle locale.
- **Docker** est installé : un conteneur qui publie un port **contourne UFW**. Toujours publier
  sur `127.0.0.1:` (aucun conteneur aujourd'hui).
- **DNS** : registrar CleanDev Agency (`leter.cm`, expire le 26/10/2027, renouvellement
  automatique **désactivé**). Zone hébergée chez **Cloudflare** (`ned.ns.cloudflare.com`,
  `stella.ns.cloudflare.com`), offre gratuite. Enregistrements : `api` et `api-beta` → A
  `158.220.96.159`, **DNS only** (nuage gris : le backend doit voir les vraies IP), TTL Auto.
  Pas d'AAAA, pas de DNSSEC, rien sur la racine ni sur `www`.
- **Nginx** :
  - `sites-enabled/le-ter` (`api.leter.cm` → 3000) et `le-ter-beta` (`api-beta.leter.cm` →
    3001) : 80 → 301 HTTPS ; 443 avec HTTP/2, HSTS un an, en-têtes `Host`, `X-Forwarded-*`,
    WebSocket (`map` dans `conf.d/le-ter-upgrade.conf`), délais 120 s (pings WS 30 s,
    battements SSE 25 s). Journaux `/var/log/nginx/le-ter-{prod,beta}.{access,error}.log`.
  - `le-ter-catchall` : tout nom inconnu ou l'IP brute est refusé (80 : `444` ; 443 :
    `ssl_reject_handshake`). Le site `default` est désactivé.
  - `nginx.conf` : `ssl_protocols TLSv1.2 TLSv1.3`, `server_tokens off`.
- **Certificats** : Let's Encrypt, mode `certonly` (Certbot ne modifie jamais les sites),
  un certificat par nom, expiration actuelle 24/01/2027. Le hook
  `/etc/letsencrypt/renewal-hooks/deploy/reload-nginx.sh` recharge Nginx après chaque
  renouvellement. Test : `sudo certbot renew --dry-run`.
- Les backends tournent avec `TRUST_PROXY=loopback` : seule l'adresse ajoutée par Nginx dans
  `X-Forwarded-For` est retenue.

## 5. Configuration (`env/backend.env`)

Mêmes clés pour les deux environnements, valeurs différentes :

| Clé | TEST | PROD |
|---|---|---|
| `NODE_ENV` | `production` | `production` |
| `PORT` | `3001` | `3000` |
| `DATABASE_URL` | `le_ter_test@127.0.0.1:5432/le_ter_test` | `le_ter_prod@127.0.0.1:5432/le_ter_prod` |
| `REDIS_URL` | `127.0.0.1:6380` | `127.0.0.1:6379` |
| `JWT_SECRET` | propre au TEST | propre à la PROD |
| `TRUST_PROXY` | `loopback` | `loopback` |
| `CINETPAY_API_KEY` / `_PASSWORD` | sandbox (`sk_test_`) | **vides** |
| `CINETPAY_NOTIFY_URL` / `_RETURN_URL` | `https://api-beta.leter.cm/api/payments/cinetpay/{notify,return}` | vides |
| `CINETPAY_TRANSFERS_ENABLED`, `CINETPAY_TRANSFERS_LIVE_CONFIRMED`, `PLATFORM_PAYOUTS_ENABLED` | `false` | `false` |
| `REFERRAL_REWARDS_ENABLED` | `false` (**ignorée** par `f428637`) | `false` (**ignorée** par `f428637`) |

- Modifier une valeur : éditer le fichier en root (garder une copie `backend.env.bak-<date>`),
  puis `sudo systemctl restart le-ter-backend-<env>`. Ne jamais afficher le fichier.
- Les identifiants CinetPay se saisissent directement sur le VPS, sans écho (`read -rs`), avec
  refus d'une clé `sk_live_` côté TEST.
- `NODE_ENV=production` côté TEST bloque les **retraits** sandbox (`SANDBOX_IN_PRODUCTION`).
  Passage du TEST en `development` accepté par le porteur du projet, à faire quand CinetPay
  aura activé le transfert sur le compte sandbox.

## 6. Sauvegardes et restauration

- Scripts `/usr/local/sbin/le-ter-backup-{prod,test}.sh` (root 700) : `pg_dump -Fc` par le
  socket local (`postgres`, sans mot de passe), écriture en `.partial`, contrôle
  `pg_restore --list`, renommage, empreinte `.sha256`, conservation 14 jours (motif
  `le_ter_<env>_[0-9]*`, profondeur 1).
- Lancer une sauvegarde à la main : `sudo systemctl start le-ter-backup-prod.service`.
- Vérifier une sauvegarde :
  `sudo sh -c 'cd /opt/le-ter/leter-prod/backups && sha256sum -c le_ter_prod_<date>.dump.sha256'`.
- **Restaurer pour contrôle** (testé le 26/10/2026 pour les deux environnements) : créer une
  base jetable appartenant à `postgres`, `REVOKE CONNECT … FROM PUBLIC`, puis
  `pg_restore --dbname=<base jetable> --no-owner --no-acl --single-transaction --exit-on-error`
  en lisant le dump par l'entrée standard ; comparer les empreintes de structure et le nombre
  de lignes par table ; `DROP DATABASE <base jetable>`.
- **Restaurer en remplacement** (incident) : arrêter le backend de l'environnement, restaurer
  dans une nouvelle base, vérifier, puis seulement basculer `DATABASE_URL`. Ne jamais restaurer
  un dump PROD dans le TEST ni l'inverse : le nom de fichier et `pg_restore --list`
  (`dbname:`) indiquent l'environnement.
- Les sauvegardes restent sur le VPS : **aucune copie hors serveur** n'est encore en place.

## 7. Déployer un nouveau commit

Toujours le TEST d'abord, la PROD ensuite, avec le même commit.

1. Sur le poste : commit, tests, push sur `main`.
2. Sur le VPS (`lamat`), pour l'environnement visé :
   `cd /opt/le-ter/leter-<env>/app && git fetch && git checkout --detach <commit>`, puis
   `cd backend && (umask 027 && npm ci && npm run build)`.
3. Sauvegarde : `sudo systemctl start le-ter-backup-<env>.service`.
4. Migrations, avec le rôle de l'environnement et depuis `/` (aucun `.env` chargé) :
   `runuser -u leter-<env> -w DATABASE_URL,NODE_ENV -- node …/dist/database/migrate.js`
   (`DATABASE_URL` construit en root à partir de `/opt/le-ter/secrets/pg_le_ter_<env>.password`,
   `NODE_ENV=development` pour cette seule exécution).
5. `sudo systemctl restart le-ter-backend-<env>` puis
   `curl -s https://api[-beta].leter.cm/api/health` et lecture du journal.

### 7.1 Distribution de l'APK de test depuis le VPS

- Lien public, sans authentification ni limite de débit :
  **`https://api-beta.leter.cm/downloads/le-ter-test.apk`** (toujours la dernière version).
  Servi par Nginx (`location /downloads/` du site `le-ter-beta`), sans passer par le backend.
  Liste du dossier refusée (`403`). N'existe pas sur `api.leter.cm`.
- Fichiers : `/var/www/le-ter-downloads/test/` (root, 755/644) : `le-ter-test-v<version>-vc<versionCode>.apk`,
  son `.sha256`, et le lien `le-ter-test.apk` vers la version courante.
- Version en ligne au 26/10/2026 : `le-ter-test-v1.0.0-vc4.apk` (commit `f428637`, 118 Mo,
  SHA-256 `07b841a1df5116372ec2f6e258ab86fdebc64e96fbacb18f776b999968439a7f`).
- Publier un nouvel APK : sur le VPS, `sudo curl -fsSL -o le-ter-test-v<v>-vc<n>.apk "<lien EAS>"`
  dans ce dossier, `chmod 644`, vérifier l'archive (`python3` + `zipfile.testzip()`), écrire le
  `.sha256`, puis `sudo ln -sfn le-ter-test-v<v>-vc<n>.apk le-ter-test.apk`. Aucun rechargement de
  Nginx n'est nécessaire. Garder la version précédente pour pouvoir revenir en arrière.
- Le lien est public : l'APK ne contient aucun secret (seulement `https://api-beta.leter.cm`),
  mais il donne accès au TEST et aux paiements sandbox. À ne partager qu'avec les testeurs.
- Utile quand un téléphone ne joint pas `expo.dev` (VPN, DNS privé, réseau filtrant).

### 7.2 Distribution de l'APK de production (espace prêt, vide)

- Lien prévu : **`https://api.leter.cm/downloads/le-ter.apk`**, servi par le bloc
  `location /downloads/` du site `le-ter`, depuis `/var/www/le-ter-downloads/prod/` (root, 755).
  Répond `404` tant qu'aucun APK n'y est déposé ; liste du dossier refusée (`403`).
- Cloisonnement vérifié : l'APK de test n'est pas accessible par `api.leter.cm` (`404`), et
  chaque domaine ne sert que son propre dossier.
- **Ne jamais y déposer un APK de test** : il pointerait vers `api-beta.leter.cm` (serveur TEST,
  paiements sandbox) tout en étant présenté comme la production.
- Avant le premier dépôt : environnement EAS `production` → `https://api.leter.cm`, et un build
  au format **APK** (le profil `production` de `frontend/eas.json` produit un AAB, réservé au
  Play Store et non installable directement). Nommage :
  `le-ter-v<version>-vc<versionCode>.apk` + `.sha256`, lien `le-ter.apk` vers la version
  courante (même procédure qu'au §7.1).
- Retour arrière : `/opt/le-ter/leter-prod/backups/nginx-le-ter.bak-avant-downloads-20261026`.

Application mobile : `EXPO_PUBLIC_API_URL` est figée au build. Environnement EAS `preview` →
`https://api-beta.leter.cm` (fait) ; environnement `production` → `https://api.leter.cm` (à
définir avant le premier build de production). Construire depuis une copie propre du commit
déployé (`git worktree add --detach`). Définir la variable avec `eas env:set` (`env:create` est
déprécié ; voir `docs/android-apk-test.md`).

## 8. Journaux et supervision

| Besoin | Commande |
|---|---|
| Journal d'un backend | `sudo journalctl -u le-ter-backend-prod -f -o cat` (`-test` pour le TEST) |
| Paiements en direct | `… \| grep --line-buffered -iE "payment\|cinetpay\|wallet\|notify"` |
| Sauvegardes | `sudo journalctl -t le-ter-backup-prod -n 5` |
| Santé | `curl -s https://api.leter.cm/api/health` → `{"status":"ok","database":"connected","redis":"connected"}` |
| Timers | `systemctl list-timers 'le-ter-*' certbot.timer` |
| Certificats | `sudo certbot certificates` |
| Disque / mémoire | `df -h /` · `free -h` |

Aucune supervision automatique (alerte en cas de panne, d'échec de sauvegarde ou d'expiration
de certificat) n'est encore en place.

## 9. Retours arrière préparés

- **Bascule PROD (26/10/2026 17:52 UTC)** : l'ancien service, son dossier `/opt/le-ter/app`,
  son `.env` et la base `le_ter` sont intacts. Retour :
  `systemctl disable --now le-ter-backend-prod`, remettre l'ancien mot de passe Redis (en
  direct par `CONFIG SET requirepass`, et `/opt/le-ter/backups/redis.conf.bak-pre-bascule-20261026`
  → `/etc/redis/redis.conf`), puis `systemctl enable --now le-ter-backend`. Dump `le_ter` juste
  avant la bascule : `/opt/le-ter/backups/le_ter_20261026_175124.dump`.
- **Distribution de l'APK** : retirer le bloc `location /downloads/` avec
  `/opt/le-ter/leter-test/backups/nginx-le-ter-beta.bak-avant-downloads-20261026`, puis `nginx -t`
  et `reload`.
- **Nginx** : `/opt/le-ter/backups/nginx.conf.bak-20261026`,
  `/opt/le-ter/backups/nginx-le-ter.http.bak-20261026`,
  `/opt/le-ter/leter-test/backups/nginx-le-ter-beta.http.bak-20261026` ; réactiver `default` en
  recréant son lien et en retirant `le-ter-catchall`. Toujours `nginx -t` avant `reload`.
- **Script de sauvegarde historique** : `/opt/le-ter/backups/le-ter-db-backup.sh.bak-20261026`
  (sa rétention supprimait aussi le dump de référence, corrigée le 26/10/2026).
- **Système** : `vm.overcommit_memory=1` dans `/etc/sysctl.d/90-le-ter-redis.conf`.

## 10. Services et outils externes

### 10.1 Services en production

| Service | Rôle dans Le Ter | Compte, offre, état | Si le service tombe ou expire |
|---|---|---|---|
| **CleanDev Agency** (Yaoundé, cleandev.cm) | **Registrar** : enregistrement de `leter.cm` et déclaration de ses serveurs DNS (aujourd'hui Cloudflare) | Acheté le 26/10/2026, expire le **26/10/2027**, **renouvellement automatique désactivé**. L'espace client permet de changer les serveurs DNS et d'obtenir un code de transfert. | Domaine expiré : `api.leter.cm` et `api-beta.leter.cm` disparaissent, application et API injoignables |
| **ANTIC** (registre `.cm`) | Autorité du domaine `.cm`, publie la délégation de `leter.cm` | Aucun compte direct : tout passe par CleanDev | — |
| **Cloudflare** (dash.cloudflare.com) | **Hébergeur DNS** : `api` et `api-beta` → `158.220.96.159` | Offre gratuite, compte du porteur du projet. Serveurs `ned.ns.cloudflare.com` et `stella.ns.cloudflare.com`. Enregistrements **DNS only** : le trafic ne passe pas par Cloudflare (voir §4). | Plus de résolution DNS, donc plus d'accès. Le compte contrôle tout le domaine. |
| **Contabo** | **Hébergeur du VPS** : backends, bases, Redis, Nginx et sauvegardes | VPS `vmi3697591` (§ en-tête) | Arrêt complet de TEST et de PROD. Les sauvegardes sont **sur le même serveur** (§6). |
| **Let's Encrypt** | **Certificats HTTPS** des deux domaines | Gratuit, sans e-mail. Renouvellement par `certbot.timer`, expiration actuelle le 24/01/2027 (§4) | Renouvellement en échec : connexions refusées à l'expiration |
| **CinetPay** | **Paiements Mobile Money** : achats de jetons (page de paiement) ; plus tard retraits des joueurs et payouts de la plateforme (API de transfert) | **Sandbox** configuré sur le TEST et validé (§5). **Live** non configuré en PROD. Seule IP autorisée : `158.220.96.159` (IPv4, §3). **Transfert non activé.** Frais publiés : MTN 2 %, Orange 2,2 %, sans part fixe. | Plus d'achats ni de retraits ; le jeu continue de fonctionner |
| **MTN Mobile Money**, **Orange Money** (Cameroun) | Opérateurs utilisés **à travers CinetPay**, sans contrat direct. Payouts de la plateforme : **MTN uniquement**. | — | Dépend de CinetPay |

### 10.2 Développement, build et distribution

| Service | Rôle | État |
|---|---|---|
| **GitHub** (`Tanzen2024/Le-Ter`) | Dépôt du code. Le VPS vérifie que le commit déployé correspond à `main`. | `main` = `f428637`, identique sur le serveur |
| **Expo / EAS** (compte `lamat1986`, projet `le-ter`) | Compilation de l'application Android dans le cloud. Détient la **clé de signature**, indispensable pour toute mise à jour de l'application. | Environnement `preview` → `https://api-beta.leter.cm` ; `production` à régler sur `https://api.leter.cm`. Offre gratuite (file d'attente : environ 50 min le 26/10/2026). |
| **npm** (npmjs.com) | Dépendances JavaScript (`npm ci`) | Versions figées par `package-lock.json` |
| **ngrok** | Tunnel du poste de développement pour les tests (D-170) | Développement uniquement |
| **Tailscale** | Téléphone ↔ poste de développement avec Expo Go (`docs/tailscale-expo-go.md`) | Développement uniquement |
| **Cloudflare Quick Tunnel** (`trycloudflare.com`) | Ancienne exposition temporaire du backend pour les premiers APK | **Remplacé** par `api-beta.leter.cm` |

### 10.3 Logiciels installés sur le VPS (dépôts externes)

| Logiciel | Rôle | Source |
|---|---|---|
| Ubuntu 24.04 LTS | Système | Dépôts Ubuntu (mises à jour de sécurité automatiques) |
| Node.js 22 | Exécution des backends | Dépôt **NodeSource** |
| PostgreSQL 16 | **Source de vérité** (`le_ter_prod`, `le_ter_test`) | Dépôts Ubuntu |
| Redis 7 | Pub/Sub temps réel, limitation de débit (deux instances) | Dépôts Ubuntu |
| Nginx | HTTPS, aiguillage par domaine, WebSocket | Dépôts Ubuntu |
| Certbot | Certificats Let's Encrypt | Dépôts Ubuntu |
| UFW, Fail2Ban | Pare-feu, blocage des attaques SSH | Dépôts Ubuntu |
| Docker | Installé, **non utilisé** (contournerait UFW, §4) | Dépôt **Docker** |

### 10.4 Prévu dans le code, pas en service

| Outil | Rôle prévu | État |
|---|---|---|
| **Ollama** | Assistant des réclamations : modèle d'IA hébergé sur nos machines (D-114) | Non configuré : mode dégradé sans IA |

### 10.5 Comptes à protéger en priorité

Perdus ou piratés, ces comptes coupent ou compromettent tout le service :

1. **Cloudflare** : contrôle tout le DNS. Authentification à deux facteurs obligatoire.
2. **CleanDev** : contrôle le domaine. Mot de passe fort ; renouvellement automatique, ou
   rappel bien avant le 26/10/2027.
3. **Expo / EAS** : détient la clé de signature Android. Sans elle, aucune mise à jour de
   l'application n'est possible.
4. **CinetPay** : accès à l'argent. Authentification à deux facteurs ; les clés `sk_live_` ne
   sont jamais partagées et ne vont jamais dans le TEST.
5. **Contabo** et **GitHub** : accès au serveur et au code.

## 11. Points ouverts

| Point | Bloque |
|---|---|
| Retraits et payouts : transfert à activer par CinetPay sur le compte sandbox ; barème annoncé (site CinetPay) MTN 2 %, Orange 2,2 %, sans part fixe → `PLATFORM_PAYOUT_FEE_BPS=200`, `PLATFORM_PAYOUT_FEE_FIXED=0`, à confirmer par écrit | tests de retrait |
| Le commit déployé `f428637` ignore `REFERRAL_REWARDS_ENABLED` et la campagne de parrainage est `ACTIVE` dès la migration 0056. Le verrou (D-169) est dans le dépôt : à déployer sur le TEST puis la PROD (§7) | paiements PROD |
| Écoute des backends sur `127.0.0.1` seulement : variable `HOST` (D-170) dans le dépôt, à déployer puis à ajouter aux deux `backend.env` | défense en profondeur (UFW protège déjà) |
| En sandbox, la relecture CinetPay ne renvoie ni montant ni devise (`amountReturned:false`) : à vérifier sur l'API live | paiements PROD |
| Même identifiant Android (`com.anonymous.leter`) pour tous les profils | coexistence des APK |
| Sauvegardes hors serveur, supervision et alertes | exploitation |
| Retrait de l'ancien service, de `/opt/le-ter/app`, de la base `le_ter` et de l'ancien timer | décision du porteur |
| Renouvellement automatique du domaine (CleanDev) désactivé | continuité |
| Authentification à deux facteurs à vérifier sur Cloudflare, CleanDev, Expo, CinetPay, Contabo et GitHub (§10.5) | sécurité des comptes |
| Environnement EAS `production` à régler sur `https://api.leter.cm` avant le premier build de production | application de production |
