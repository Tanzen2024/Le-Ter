import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

import { SITE_CONFIG } from '../public/assets/js/config.js';
import {
  appRegisterLink,
  emailAddress,
  ga4MeasurementId,
  httpsUrl,
  normalizeReferralCode,
  referralCodeFromSearch,
} from '../public/assets/js/lib.js';
import { checkSite } from '../scripts/check.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const read = (path) => readFileSync(join(ROOT, 'public', path), 'utf8');
const HOMES = { fr: read('fr/index.html'), en: read('en/index.html') };

describe('code de parrainage', () => {
  it('accepte la forme du serveur (8 caractères sans 0/O/1/I) et la normalise', () => {
    assert.equal(normalizeReferralCode('ab3k-7mpq'), 'AB3K7MPQ');
    assert.equal(normalizeReferralCode(' AB3K 7MPQ '), 'AB3K7MPQ');
  });

  it('refuse toute autre forme', () => {
    for (const raw of ['', 'AB3K7MP', 'AB3K7MPQX', 'AB0K7MPQ', 'ABOK7MPQ', 'AB1K7MPQ', 'ABIK7MPQ', '<script>', null]) {
      assert.equal(normalizeReferralCode(raw), null, String(raw));
    }
  });

  it("lit ?ref= dans l'adresse", () => {
    assert.equal(referralCodeFromSearch('?ref=ab3k7mpq'), 'AB3K7MPQ');
    assert.equal(referralCodeFromSearch('?utm=x&ref=AB3K7MPQ'), 'AB3K7MPQ');
    assert.equal(referralCodeFromSearch('?ref=%3Cb%3E'), null);
    assert.equal(referralCodeFromSearch(''), null);
  });

  it("ouvre l'inscription de l'application avec le code (schéma leter, D-161)", () => {
    assert.equal(appRegisterLink('AB3K7MPQ'), 'leter://register?ref=AB3K7MPQ');
  });
});

describe('liens configurables', () => {
  it('httpsUrl : https seulement, vide = indisponible', () => {
    assert.equal(httpsUrl(''), null);
    assert.equal(httpsUrl('http://le-ter.test'), null);
    assert.equal(httpsUrl('javascript:alert(1)'), null);
    assert.equal(httpsUrl('https://play.google.com/store'), 'https://play.google.com/store');
  });

  it('emailAddress', () => {
    assert.equal(emailAddress(''), null);
    assert.equal(emailAddress('pas une adresse'), null);
    assert.equal(emailAddress('aide@le-ter.cm'), 'aide@le-ter.cm');
  });
});

describe('configuration livrée', () => {
  it("ne contient aucune URL inventée : tout ce qui n'est pas confirmé reste vide", () => {
    // APK Android officiel, hébergé par LeTer sur son propre domaine (leter.cm).
    assert.equal(httpsUrl(SITE_CONFIG.downloads.android), SITE_CONFIG.downloads.android);
    assert.match(SITE_CONFIG.downloads.android, /^https:\/\/([a-z0-9-]+\.)*leter\.cm\/[^?#]+\.apk$/);
    // Aucune fiche App Store, aucune page d'assistance : vides tant qu'elles n'existent pas.
    assert.equal(SITE_CONFIG.downloads.ios, '');
    assert.equal(SITE_CONFIG.supportUrl, '');
    assert.equal(SITE_CONFIG.supportEmail, 'hugueslamat16@gmail.com');
  });

  it('crédit des récompenses annoncé actif (décision du propriétaire, à aligner sur REFERRAL_REWARDS_ENABLED, D-169)', () => {
    assert.equal(SITE_CONFIG.referral.rewardsActive, true);
  });

  it('GA4 : identifiant vide (mesure désactivée) ou de la forme G-XXXXXXXXXX', () => {
    const id = SITE_CONFIG.analytics.ga4MeasurementId;
    assert.ok(id === '' || ga4MeasurementId(id) === id, id);
    assert.equal(ga4MeasurementId('g-ab12cd34ef'), 'G-AB12CD34EF');
    for (const raw of ['', 'UA-12345-1', 'G-', 'G-<script>', 'AW-123456', null]) {
      assert.equal(ga4MeasurementId(raw), null, String(raw));
    }
  });
});

describe('en-têtes de sécurité', () => {
  it("même CSP dans .htaccess, serve.mjs et l'exemple Nginx du README ; HSTS et 404 en production", () => {
    const htaccess = readFileSync(join(ROOT, 'public/.htaccess'), 'utf8');
    const csp = htaccess.match(/Content-Security-Policy "([^"]+)"/)[1];
    assert.ok(readFileSync(join(ROOT, 'scripts/serve.mjs'), 'utf8').includes(`"${csp}"`), 'serve.mjs');
    assert.ok(readFileSync(join(ROOT, 'README.md'), 'utf8').includes(`"${csp}"`), 'README.md');
    assert.match(csp, /script-src 'self' https:\/\/www\.googletagmanager\.com;/);
    assert.match(csp, /object-src 'none'/);
    assert.match(htaccess, /Strict-Transport-Security/);
    assert.match(htaccess, /ErrorDocument 404 \/404\.html/);
  });
});

describe('accueil (FR et EN)', () => {
  it('passe le contrôle statique (liens, fichiers, CSP, accessibilité, hreflang)', async () => {
    assert.deepEqual(await checkSite(join(ROOT, 'public')), []);
  });

  for (const [lang, html] of Object.entries(HOMES)) {
    it(`${lang} : contient toutes les sections de la navigation`, () => {
      for (const id of ['accueil', 'decouvrir', 'fonctionnalites', 'comment-jouer', 'telecharger', 'parrainage', 'tournois', 'assistance', 'faq-parrainage']) {
        assert.match(html, new RegExp(`id="${id}"`), id);
      }
    });

    it(`${lang} : sans configuration, les boutons de téléchargement ne pointent nulle part`, () => {
      for (const [tag] of html.matchAll(/<a\b[^>]*data-download="[^"]*"[^>]*>/g)) {
        assert.doesNotMatch(tag, /\shref=/, tag);
        assert.match(tag, /aria-disabled="true"|\shidden[\s>]/, tag);
      }
    });

    it(`${lang} : boutons Android et iOS dans la section Télécharger, accueil masqué tant que non configuré`, () => {
      const section = html.slice(html.indexOf('id="telecharger"'), html.indexOf('id="parrainage"'));
      assert.match(section, /data-download="android"[^>]*data-label="[^"]+"/);
      assert.match(section, /data-download="ios"[^>]*data-label="[^"]+"/);
      assert.match(section, /#i-android/);
      assert.match(section, /#i-apple/);
      const hero = html.slice(html.indexOf('id="accueil"'), html.indexOf('id="decouvrir"'));
      for (const platform of ['android', 'ios']) assert.match(hero, new RegExp(`data-download-platform="${platform}" hidden`));
    });

    it(`${lang} : avertissement « crédit pas encore activé » masqué par défaut, réactivable par la configuration`, () => {
      assert.match(html, /<p class="notice" data-rewards-pending hidden>/);
    });

    it(`${lang} : aucun barème de commission, aucun taux, aucune annonce périmée, marque LeTer`, () => {
      const main = html.slice(html.indexOf('<main'), html.indexOf('</main>'));
      assert.doesNotMatch(main, /\d\s?%/, 'pourcentage affiché');
      assert.doesNotMatch(main, /Aucun tournoi public|No public tournament/);
      assert.doesNotMatch(html, /Le-Ter|Le Ter\b/);
    });

    it(`${lang} : section Jetons et mises, Mobile Money, âge minimum`, () => {
      assert.match(html, /id="jetons"/);
      assert.match(html, /href="#jetons"/);
      assert.match(html, /MTN Mobile Money/);
      assert.match(html, /Orange Money/);
      assert.match(html, /18/);
    });
  }

  it('FR : Fap-Fap à 31 cartes, règles de parrainage de D-161', () => {
    const fapFap = HOMES.fr.slice(HOMES.fr.indexOf('<h3>Fap-Fap</h3>'), HOMES.fr.indexOf('<h3>GARAM TIA</h3>'));
    assert.match(fapFap, /31 cartes/);
    assert.match(fapFap, /5 cartes/);
    assert.match(fapFap, /5 plis/);
    assert.doesNotMatch(fapFap, /21/, "21 est l'objectif de GARAM TIA, pas du Fap-Fap");
    const start = HOMES.fr.indexOf('<h3>GARAM TIA</h3>');
    const garam = HOMES.fr.slice(start, HOMES.fr.indexOf('</article>', start));
    assert.match(garam, /35 cartes/);
    assert.match(garam, /3 cartes/);
    assert.match(garam, /sans dépasser 21/);
    // Cartes au centre : n + 1 (GARAM_TERRE_SIZE, confirmé par le propriétaire le 27/10/2026).
    assert.match(garam, /une de plus que le nombre de joueurs \(3 cartes à 2 joueurs, 4 à 3, 5 à 4\)/);
    assert.match(HOMES.fr, /commission sur les mises des perdants/);
    assert.match(HOMES.fr, /1 jeton = 1 FCFA/);
    assert.match(HOMES.fr, /au moins deux fois la mise/);
    assert.match(HOMES.fr, /un seul gagnant/);
    assert.match(HOMES.fr, /À partir de 1 000 jetons/);
    assert.match(HOMES.fr, /Prénom, nom, pseudo, numéro de téléphone et mot de passe ; l'e-mail est facultatif/);
    assert.match(HOMES.fr, /1 000 jetons/);
    assert.match(HOMES.fr, /10 filleuls qualifiés/);
    assert.match(HOMES.fr, /5 000 jetons par palier complet/);
    assert.match(HOMES.fr, /Bientôt disponible sur Android/);
    assert.match(HOMES.fr, /Bientôt disponible sur iOS/);
  });

  it('EN : 31-card deck, D-161 referral rules', () => {
    const fapFap = HOMES.en.slice(HOMES.en.indexOf('<h3>Fap-Fap</h3>'), HOMES.en.indexOf('<h3>GARAM TIA</h3>'));
    assert.match(fapFap, /31-card deck/);
    assert.match(HOMES.en, /35-card deck/);
    assert.match(HOMES.en, /1 token = 1 FCFA/);
    assert.match(HOMES.en, /at least twice the stake/);
    assert.match(HOMES.en, /single winner/);
    assert.match(HOMES.en, /From 1,000 tokens/);
    assert.match(HOMES.en, /First name, last name, username, phone number and password; email is optional/);
    assert.match(HOMES.en, /1,000 tokens/);
    assert.match(HOMES.en, /10 qualified referrals/);
    assert.match(HOMES.en, /5,000 tokens per completed tier/);
    assert.match(HOMES.en, /Coming soon on Android/);
    assert.match(HOMES.en, /Coming soon on iOS/);
  });
});
