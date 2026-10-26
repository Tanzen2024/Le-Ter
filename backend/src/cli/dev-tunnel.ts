import { spawn } from 'node:child_process';
import { resolve } from 'node:path';

import { tunnelEnvironment } from '../config/tunnel-env';

/**
 * `npm run dev:tunnel -- https://<domaine du tunnel>` : backend de TEST joignable à distance par
 * un tunnel LOCAL déjà lancé vers 127.0.0.1:<PORT> (ngrok, tunnel Cloudflare nommé ; D-170).
 * `backend/.env` n'est pas modifié : HOST, TRUST_PROXY et les URL CinetPay sont imposés pour
 * cette session seulement. Démarre `tsx watch src/server.ts`, puis vérifie /api/health en local
 * et par l'URL publique. Aucun paiement, aucune écriture hors du fonctionnement normal.
 */
const publicUrl = process.argv[2] ?? process.env.TUNNEL_PUBLIC_URL ?? '';
if (!publicUrl) {
  console.error('Usage : npm run dev:tunnel -- https://<domaine du tunnel>');
  process.exit(1);
}

let overrides: Record<string, string>;
try {
  overrides = tunnelEnvironment(publicUrl);
} catch (err) {
  console.error((err as Error).message);
  process.exit(1);
}
const origin = new URL(publicUrl).origin;
const port = process.env.PORT ?? '3000';
console.log(`Tunnel : ${origin} → http://127.0.0.1:${port} (HOST=127.0.0.1, TRUST_PROXY=loopback)`);
console.log(`Application (EAS preview) : EXPO_PUBLIC_API_URL=${origin}`);

const tsx = resolve(__dirname, '../../node_modules/tsx/dist/cli.mjs');
const child = spawn(process.execPath, [tsx, 'watch', 'src/server.ts'], {
  cwd: resolve(__dirname, '../..'),
  env: { ...process.env, ...overrides },
  stdio: 'inherit',
});
child.on('exit', (code) => process.exit(code ?? 0));
for (const signal of ['SIGINT', 'SIGTERM'] as const) process.on(signal, () => child.kill(signal));

async function health(url: string): Promise<string> {
  try {
    const res = await fetch(`${url}/api/health`, {
      // Évite la page d'avertissement des tunnels gratuits pour ce contrôle programmatique.
      headers: { 'ngrok-skip-browser-warning': '1', 'user-agent': 'le-ter-dev-tunnel' },
      signal: AbortSignal.timeout(8000),
    });
    return `${res.status} ${JSON.stringify(await res.json().catch(() => null))}`;
  } catch (err) {
    return `injoignable (${(err as Error).message})`;
  }
}

setTimeout(async () => {
  console.log(`[dev:tunnel] santé locale  : ${await health(`http://127.0.0.1:${port}`)}`);
  console.log(`[dev:tunnel] santé publique : ${await health(origin)}`);
}, 8000).unref();
