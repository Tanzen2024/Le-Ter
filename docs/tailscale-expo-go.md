# Tests mobiles distants : Tailscale + Expo Go

Tester l'application dans **Expo Go** sur un téléphone connecté à un autre Wi-Fi ou aux données
mobiles, en passant par le réseau privé **Tailscale** jusqu'au PC de développement. Aucun APK, aucun
tunnel public (ngrok, Cloudflare, `expo start --tunnel`), aucun hébergement externe.

## Principe

| Flux | Adresse vue par le téléphone | Port |
| --- | --- | --- |
| Bundle JavaScript (Metro) | `exp://<IP Tailscale du PC>:8081` | 8081 |
| API HTTP | `http://<IP Tailscale du PC>:3000` | 3000 |
| Temps réel | `ws://<IP Tailscale du PC>:3000/ws` | 3000 |
| PostgreSQL / Redis | **non exposés** (`127.0.0.1:5433`, `127.0.0.1:6379`) | — |

- Le backend écoute sur toutes les interfaces (`listen(PORT)`, double pile IPv4/IPv6) : aucun
  réglage n'est nécessaire côté API.
- Sans réglage, `expo start --lan` annonce l'adresse de la **passerelle par défaut** (le Wi-Fi du
  PC), injoignable depuis un autre réseau. `npm run start:tailscale`
  (`frontend/scripts/start-tailscale.mjs`) lit l'adresse Tailscale actuelle (`tailscale ip -4`) et la
  passe à Expo par `REACT_NATIVE_PACKAGER_HOSTNAME`.
- Le script force `EXPO_PUBLIC_API_URL=auto` (prioritaire sur `frontend/.env`) : l'application
  dérive l'API et le WebSocket de l'hôte Metro (`src/lib/api-client.ts`, `realtimeUrl`). Aucune
  adresse n'est codée en dur.
- Pare-feu Windows : Tailscale installe la règle `Tailscale-In` (tout trafic entrant vers l'adresse
  Tailscale du PC, profils Domaine/Privé ; l'interface Tailscale est en profil Privé). Elle couvre
  3000 et 8081.

## Démarrage (PowerShell)

```powershell
# 1. Bases de données (localhost uniquement)
cd C:\xampp\htdocs\le-ter\backend
docker compose up -d
docker compose ps

# 2. Backend (fenêtre dédiée)
npm run dev

# 3. Expo (autre fenêtre)
cd C:\xampp\htdocs\le-ter\frontend
npm run start:tailscale            # ajouter -- --clear après un changement de .env
```

Le script affiche le résultat de `/api/health` sur l'adresse Tailscale et l'URL `exp://` à ouvrir.

## Téléphone

1. Ouvrir l'application Tailscale, se connecter au même compte que le PC, activer le VPN
   (clé VPN visible dans la barre d'état). Vérifier que le PC apparaît comme connecté.
2. Dans Tailscale → Paramètres, s'assurer qu'aucune exclusion d'application (*split tunneling*) ne
   concerne le navigateur ni Expo Go, et désactiver tout autre VPN.
3. Navigateur : ouvrir `http://<IP Tailscale du PC>:3000/api/health` → `"status":"ok"`, et
   `http://<IP Tailscale du PC>:8081/status` → `packager-status:running`. Ne pas ouvrir la racine
   `:8081/` dans un navigateur : elle demande le bundle web, que ce projet mobile n'installe pas
   (`react-native-web` absent), et l'erreur de bundling peut arrêter Metro.
4. Expo Go : scanner le QR code affiché par `npm run start:tailscale` ou saisir
   `exp://<IP Tailscale du PC>:8081` (« Enter URL manually »).

## Diagnostic

- Côté PC, sans droits administrateur : `tailscale debug capture -o capture.pcap` enregistre les
  paquets à l'intérieur de Tailscale, avant le pare-feu Windows. Faire une seule tentative depuis le
  téléphone, puis arrêter la capture (Ctrl+C) :
  - aucun SYN venant du téléphone : le téléphone n'envoie pas la requête dans Tailscale (VPN
    inactif, exclusion d'application, autre VPN) ;
  - SYN reçu sans SYN-ACK en retour : Windows (ou un logiciel de sécurité du poste) bloque ;
  - SYN puis SYN-ACK : le réseau fonctionne ; chercher côté application.
- `tailscale ping --tsmp <IP téléphone>` vérifie le tunnel WireGuard ; `tailscale ping` seul
  (disco) ne vérifie que la découverte.

## Retour arrière

- Ne plus utiliser `npm run start:tailscale` : `npx expo start` reprend le comportement antérieur
  (valeur de `frontend/.env`).
- Les règles de pare-feu propres à Le Ter, si elles ont été créées, se suppriment en PowerShell
  administrateur : `Remove-NetFirewallRule -DisplayName "<nom>"`.
