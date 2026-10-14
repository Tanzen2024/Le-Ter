// Démarre Metro pour Expo Go à travers Tailscale (téléphone sur un autre réseau, aucun tunnel
// public). Voir docs/tailscale-expo-go.md.
//
//   npm run start:tailscale              (arguments supplémentaires transmis : -- --clear)
//
// - Lit l'adresse IPv4 Tailscale ACTUELLE du PC (`tailscale ip -4`, ou TAILSCALE_IP) : rien
//   n'est codé en dur ;
// - REACT_NATIVE_PACKAGER_HOSTNAME = cette adresse : le QR code et l'URL exp:// annoncés par
//   `expo start --lan` la désignent au lieu de l'IP du Wi-Fi ;
// - EXPO_PUBLIC_API_URL = auto (prioritaire sur frontend/.env) : l'application dérive l'API
//   (http://<IP>:3000) et le WebSocket (ws://<IP>:3000/ws) de l'hôte Metro (src/lib/api-client.ts).
//   Une valeur déjà définie dans l'environnement du shell est conservée.
import { execFileSync, spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const API_PORT = 3000;
const TAILSCALE_CANDIDATES = ['tailscale', 'C:\\Program Files\\Tailscale\\tailscale.exe'];
const IPV4_TAILSCALE = /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.\d{1,3}\.\d{1,3}$/;

function tailscaleIp() {
  const fromEnv = process.env.TAILSCALE_IP?.trim();
  if (fromEnv) return fromEnv;
  for (const bin of TAILSCALE_CANDIDATES) {
    try {
      const out = execFileSync(bin, ['ip', '-4'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
      const ip = out.split(/\s+/).find((line) => IPV4_TAILSCALE.test(line));
      if (ip) return ip;
    } catch {
      // binaire absent ou Tailscale arrêté : candidat suivant
    }
  }
  return undefined;
}

async function checkBackend(ip) {
  const url = `http://${ip}:${API_PORT}/api/health`;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
    const body = await res.json();
    console.log(`[tailscale] Backend ${url} → ${JSON.stringify(body)}`);
  } catch (error) {
    console.warn(`[tailscale] Backend injoignable sur ${url} (${error.message}). Lancez-le : cd backend; npm run dev`);
  }
}

const ip = tailscaleIp();
if (!ip) {
  console.error('[tailscale] Adresse Tailscale introuvable : Tailscale est-il connecté ? (ou définir TAILSCALE_IP)');
  process.exit(1);
}

await checkBackend(ip);
console.log(`[tailscale] Expo Go : exp://${ip}:8081 · API : http://${ip}:${API_PORT} · WebSocket : ws://${ip}:${API_PORT}/ws`);

const cli = join(dirname(fileURLToPath(import.meta.url)), '..', 'node_modules', 'expo', 'bin', 'cli');
if (!existsSync(cli)) {
  console.error('[tailscale] Expo CLI introuvable : lancer npm install dans frontend/.');
  process.exit(1);
}

const child = spawn(process.execPath, [cli, 'start', '--lan', ...process.argv.slice(2)], {
  stdio: 'inherit',
  env: {
    ...process.env,
    REACT_NATIVE_PACKAGER_HOSTNAME: ip,
    EXPO_PUBLIC_API_URL: process.env.EXPO_PUBLIC_API_URL || 'auto',
  },
});
child.on('exit', (code) => process.exit(code ?? 0));
