import { SITE_CONFIG } from './config.js';
import { ga4MeasurementId } from './lib.js';

/**
 * Mesure d'audience Google Analytics 4, avec consentement préalable.
 *
 * - Identifiant vide (config.js, analytics.ga4MeasurementId) : rien n'est chargé, aucun bandeau.
 * - Sinon : bandeau [data-consent] tant que le visiteur n'a pas choisi ; gtag.js n'est chargé
 *   qu'après « Accepter ». Le choix est mémorisé dans le navigateur (localStorage) et peut être
 *   changé à tout moment par le bouton [data-consent-open] du pied de page.
 * - Aucun script en ligne : la configuration de gtag est faite ici (CSP « script-src 'self'
 *   https://www.googletagmanager.com »).
 */

const STORAGE_KEY = 'leter-analytics-consent';
const id = ga4MeasurementId(SITE_CONFIG.analytics?.ga4MeasurementId);
let loaded = false;

function readChoice() {
  try {
    return window.localStorage.getItem(STORAGE_KEY);
  } catch {
    return null; // Stockage indisponible : le bandeau s'affiche à chaque visite.
  }
}

function saveChoice(choice) {
  try {
    window.localStorage.setItem(STORAGE_KEY, choice);
  } catch {
    // Le choix vaut pour cette page seulement.
  }
}

function gtag() {
  // gtag.js attend l'objet `arguments` lui-même, pas un tableau.
  // eslint-disable-next-line prefer-rest-params
  window.dataLayer.push(arguments);
}

function load() {
  if (loaded || !id) return;
  loaded = true;
  window[`ga-disable-${id}`] = false;
  window.dataLayer = window.dataLayer || [];
  gtag('js', new Date());
  gtag('config', id);
  const script = document.createElement('script');
  script.async = true;
  script.src = `https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(id)}`;
  document.head.append(script);
}

/** Retrait de l'accord : plus aucun envoi, cookies _ga effacés (domaine courant et parent). */
function stop() {
  if (!id) return;
  window[`ga-disable-${id}`] = true;
  const host = window.location.hostname;
  const domains = ['', host, `.${host.split('.').slice(-2).join('.')}`];
  for (const name of document.cookie.split(';').map((c) => c.split('=')[0].trim())) {
    if (name !== '_ga' && !name.startsWith('_ga_')) continue;
    for (const domain of domains) {
      document.cookie = `${name}=; Max-Age=0; path=/${domain ? `; domain=${domain}` : ''}`;
    }
  }
}

/** Événement de conversion (clic de téléchargement…) ; ignoré sans accord. */
export function trackEvent(name, params = {}) {
  if (loaded && readChoice() === 'granted') gtag('event', name, params);
}

export function initAnalytics() {
  if (!id) return;
  const banner = document.querySelector('[data-consent]');
  const choice = readChoice();

  if (choice === 'granted') load();
  else if (choice !== 'denied' && banner) banner.hidden = false;

  for (const button of document.querySelectorAll('[data-consent-choice]')) {
    button.addEventListener('click', () => {
      const granted = button.dataset.consentChoice === 'granted';
      saveChoice(granted ? 'granted' : 'denied');
      if (granted) load();
      else stop();
      if (banner) banner.hidden = true;
    });
  }

  for (const button of document.querySelectorAll('[data-consent-open]')) {
    button.hidden = false;
    button.addEventListener('click', () => {
      if (!banner) return;
      banner.hidden = false;
      banner.querySelector('button')?.focus();
    });
  }
}
