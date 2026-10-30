/**
 * Serveur local de prévisualisation (« npm run serve » / « npm run preview ») : sert UN dossier
 * (public/ ou dist/) sur http://127.0.0.1:4173, avec les mêmes en-têtes que .htaccess.
 * Pour le développement seulement : en production, le dossier dist/ est servi par Nginx/Apache.
 */
import { createReadStream, existsSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { dirname, extname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DIR = resolve(ROOT, process.argv[2] ?? 'public');
const PORT = Number(process.env.PORT ?? 4173);

/**
 * CSP du site, identique à public/.htaccess et à l'exemple Nginx du README (vérifié par
 * tests/site.test.mjs) : tout en local, sauf Google Analytics 4 (chargé après consentement).
 */
export const CONTENT_SECURITY_POLICY =
  "default-src 'self'; script-src 'self' https://www.googletagmanager.com; style-src 'self'; img-src 'self' data: https://*.google-analytics.com https://*.googletagmanager.com; font-src 'self'; connect-src 'self' https://*.google-analytics.com https://*.analytics.google.com https://*.googletagmanager.com; base-uri 'self'; form-action 'none'; frame-ancestors 'none'; object-src 'none'";

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.ttf': 'font/ttf',
  '.txt': 'text/plain; charset=utf-8',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
};

const HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'X-Frame-Options': 'DENY',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
  'Content-Security-Policy': CONTENT_SECURITY_POLICY,
};

if (!existsSync(join(DIR, 'index.html'))) {
  console.error(`✗ ${DIR} ne contient pas index.html (lancez d'abord « npm run build » pour dist/).`);
  process.exit(1);
}

createServer((request, response) => {
  let pathname;
  try {
    pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
  } catch {
    response.writeHead(400, HEADERS).end('Requête invalide');
    return;
  }
  if (pathname.endsWith('/')) pathname += 'index.html';
  const file = resolve(DIR, `.${pathname}`);
  const hidden = pathname.split('/').some((part) => part.startsWith('.'));

  if (!file.startsWith(DIR + sep) || hidden || !existsSync(file) || !statSync(file).isFile()) {
    // Même page 404 que le serveur de production (ErrorDocument / error_page).
    const notFound = join(DIR, '404.html');
    if (existsSync(notFound)) {
      response.writeHead(404, { ...HEADERS, 'Content-Type': TYPES['.html'] });
      createReadStream(notFound).pipe(response);
    } else {
      response.writeHead(404, { ...HEADERS, 'Content-Type': 'text/plain; charset=utf-8' }).end('Introuvable');
    }
    return;
  }
  response.writeHead(200, { ...HEADERS, 'Content-Type': TYPES[extname(file)] ?? 'application/octet-stream' });
  createReadStream(file).pipe(response);
}).listen(PORT, '127.0.0.1', () => {
  console.log(`Site vitrine (${DIR}) : http://127.0.0.1:${PORT}/`);
});
