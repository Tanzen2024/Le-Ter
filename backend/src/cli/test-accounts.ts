/**
 * `npm run test:accounts -- <URL de l'API de TEST> [nombre]` : crée des comptes FICTIFS par
 * l'inscription publique (POST /api/auth/register), donc avec toutes les validations du serveur
 * et sans accès direct à la base (D-170). À utiliser à la place de vraies données personnelles.
 *
 * - Prénoms et noms synthétiques ; e-mails `testeur.<lot>.<n>@example.com` (domaine réservé à la
 *   documentation, RFC 2606 : aucune boîte réelle) ; pseudos `test_<lot>_<n>`.
 * - Téléphone : obligatoire à l'inscription (R-15) et jamais vérifié (R-34). Tout numéro
 *   camerounais valide PEUT appartenir à quelqu'un : ces comptes ne servent qu'en SANDBOX (aucun
 *   transfert réel n'est possible hors production, D-077, D-170) et ne doivent jamais être
 *   recréés sur un environnement réel.
 * - Mot de passe : `TEST_ACCOUNT_PASSWORD` (8 caractères minimum, lettres et chiffres), jamais
 *   affiché ni écrit. Les codes de récupération renvoyés par le serveur ne sont pas affichés.
 */
const [apiUrl, countArg] = process.argv.slice(2);
const password = process.env.TEST_ACCOUNT_PASSWORD ?? '';
const count = Number(countArg ?? 4);

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

if (!apiUrl) fail('Usage : TEST_ACCOUNT_PASSWORD=… npm run test:accounts -- <URL de l’API de test> [nombre]');
if (!Number.isInteger(count) || count < 1 || count > 20) fail('Nombre de comptes : entier entre 1 et 20');
if (password.length < 8 || !/[A-Za-z]/.test(password) || !/\d/.test(password)) {
  fail('TEST_ACCOUNT_PASSWORD requis : 8 caractères minimum, lettres et chiffres');
}

const FIRST = ['Amina', 'Boris', 'Clarisse', 'Dieudonné', 'Estelle', 'Fabrice', 'Grâce', 'Hervé'];
const LAST = ['Testeur', 'Essai', 'Fictif', 'Démo'];
// Lot horodaté : jamais deux fois les mêmes e-mails, pseudos ou numéros.
const batch = Date.now().toString(36).slice(-5);
const digits = String(Date.now()).slice(-5);

async function main(): Promise<void> {
  const base = new URL(apiUrl!).origin;
  const health = await fetch(`${base}/api/health`, {
    headers: { 'ngrok-skip-browser-warning': '1' },
  }).catch(() => undefined);
  if (!health?.ok) fail(`API injoignable : ${base}/api/health`);

  let created = 0;
  for (let n = 1; n <= count; n += 1) {
    const body = {
      firstName: FIRST[(n - 1) % FIRST.length],
      lastName: LAST[(n - 1) % LAST.length],
      email: `testeur.${batch}.${n}@example.com`,
      username: `test_${batch}_${n}`,
      country: 'CM',
      // 69 + 7 chiffres : forme d'un mobile camerounais, propre au lot.
      phone: `69${digits}${String(n).padStart(2, '0')}`,
      password,
      confirmPassword: password,
    };
    const res = await fetch(`${base}/api/auth/register`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'ngrok-skip-browser-warning': '1' },
      body: JSON.stringify(body),
    });
    if (res.status === 201) {
      created += 1;
      console.log(`créé  ${body.email}  (pseudo ${body.username})`);
    } else {
      const reason = (await res.json().catch(() => ({}))) as { code?: string };
      console.log(`refus ${body.email} : HTTP ${res.status} ${reason.code ?? ''}`);
    }
  }
  console.log(`${created}/${count} comptes fictifs créés (lot ${batch}).`);
  process.exit(created === count ? 0 : 2);
}

void main();
