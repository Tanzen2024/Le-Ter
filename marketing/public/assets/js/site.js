import { initAnalytics, trackEvent } from './analytics.js';
import { SITE_CONFIG } from './config.js';
import {
  appRegisterLink,
  emailAddress,
  httpsUrl,
  languageSwitchHref,
  referralCodeFromSearch,
} from './lib.js';

/**
 * Le HTML est écrit dans son état « non configuré » (aucun lien, « Bientôt disponible ») : sans
 * JavaScript ou sans valeur dans config.js, aucun bouton ne pointe vers une adresse inventée.
 * Ce script n'active que ce que la configuration fournit réellement.
 */

const downloads = {
  android: httpsUrl(SITE_CONFIG.downloads?.android),
  ios: httpsUrl(SITE_CONFIG.downloads?.ios),
};
const anyDownload = downloads.android ?? downloads.ios;

// --- Menu mobile -------------------------------------------------------------------------------

const toggle = document.querySelector('.nav-toggle');
const menu = document.getElementById('nav-menu');

function setMenu(open) {
  toggle.setAttribute('aria-expanded', String(open));
  menu.classList.toggle('is-open', open);
}

if (toggle && menu) {
  toggle.addEventListener('click', () => setMenu(toggle.getAttribute('aria-expanded') !== 'true'));
  menu.addEventListener('click', (event) => {
    if (event.target.closest('a')) setMenu(false);
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && toggle.getAttribute('aria-expanded') === 'true') {
      setMenu(false);
      toggle.focus();
    }
  });
}

// --- Téléchargement ----------------------------------------------------------------------------

for (const link of document.querySelectorAll('[data-download]')) {
  const url = downloads[link.dataset.download];
  if (!url) continue;
  link.href = url;
  link.removeAttribute('aria-disabled');
  link.classList.remove('is-disabled');
  link.addEventListener('click', () => trackEvent('app_download', { platform: link.dataset.download }));
  // Seul le libellé change : l'icône de la plateforme reste.
  const text = link.querySelector('[data-download-text]');
  if (text && link.dataset.label) text.textContent = link.dataset.label;
}

// Boutons de l'accueil : n'apparaissent que pour une plateforme réellement disponible.
for (const element of document.querySelectorAll('[data-download-platform]')) {
  element.hidden = !downloads[element.dataset.downloadPlatform];
}

if (anyDownload) {
  for (const element of document.querySelectorAll('[data-before-launch]')) element.hidden = true;
  for (const element of document.querySelectorAll('[data-after-launch]')) element.hidden = false;
}

// --- Assistance --------------------------------------------------------------------------------

const supportUrl = httpsUrl(SITE_CONFIG.supportUrl);
const supportEmail = emailAddress(SITE_CONFIG.supportEmail);
const supportList = document.querySelector('[data-support-links]');

if (supportList && (supportUrl || supportEmail)) {
  // Libellé dans la langue de la page (src/i18n, faq.help.supportCenter).
  if (supportUrl) supportList.append(listLink(supportUrl, supportList.dataset.supportLabel ?? supportUrl));
  if (supportEmail) supportList.append(listLink(`mailto:${supportEmail}`, supportEmail));
  supportList.hidden = false;
  for (const element of document.querySelectorAll('[data-support-missing]')) element.hidden = true;
}

for (const link of document.querySelectorAll('[data-support-link]')) {
  const target = supportUrl ?? (supportEmail ? `mailto:${supportEmail}` : null);
  if (target) {
    link.href = target;
    link.hidden = false;
  }
}

function listLink(href, text) {
  const item = document.createElement('li');
  const link = document.createElement('a');
  link.href = href;
  link.textContent = text;
  item.append(link);
  return item;
}

// --- Parrainage --------------------------------------------------------------------------------

// Avertissement masqué dans le HTML (crédit actif) ; réaffiché seulement si la configuration le
// désactive (referral.rewardsActive: false, à aligner sur REFERRAL_REWARDS_ENABLED, D-169).
if (SITE_CONFIG.referral?.rewardsActive !== true) {
  for (const element of document.querySelectorAll('[data-rewards-pending]')) element.hidden = false;
}

/**
 * Lien de parrainage reçu (`?ref=CODE`, D-161) : le code est affiché pour être saisi à
 * l'inscription, car l'application ne le récupère pas après l'installation. Seule sa forme est
 * vérifiée ici ; le serveur décide s'il est valable.
 */
const code = referralCodeFromSearch(window.location.search);
const invitation = document.getElementById('invitation');

if (code && invitation) {
  for (const slot of invitation.querySelectorAll('[data-referral-code]')) slot.textContent = code;
  const openApp = invitation.querySelector('[data-open-app]');
  if (openApp) openApp.href = appRegisterLink(code);
  const copy = invitation.querySelector('[data-copy-code]');
  const status = invitation.querySelector('[data-copy-status]');
  // Messages dans la langue de la page (data-copied / data-copy-failed, src/i18n).
  copy?.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(code);
      if (status) status.textContent = status.dataset.copied ?? '';
    } catch {
      if (status) status.textContent = status.dataset.copyFailed ?? '';
    }
  });
  invitation.hidden = false;
}

// --- Langue ------------------------------------------------------------------------------------

/**
 * Sélecteur FR | EN : le lien mène à la même page dans l'autre langue ; on y ajoute ?ref= et
 * #section pour ne perdre ni l'invitation ni la position, et on mémorise le choix pour la page
 * racine (lang-redirect.js). Sans JavaScript, le lien fonctionne tel quel.
 */
for (const link of document.querySelectorAll('[data-lang-switch] a[data-lang]')) {
  link.addEventListener('click', () => {
    try {
      window.localStorage.setItem('leter-language', link.dataset.lang);
    } catch {
      // Stockage indisponible (navigation privée) : le choix vaut pour cette visite.
    }
    link.href = languageSwitchHref(link.href, window.location.search, window.location.hash);
  });
}

// --- Mesure d'audience (GA4, après consentement) -----------------------------------------------

initAnalytics();

// --- Divers ------------------------------------------------------------------------------------

for (const element of document.querySelectorAll('[data-year]')) {
  element.textContent = String(new Date().getFullYear());
}
