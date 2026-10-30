import { escapeHtml, pageContext, renderDocument } from './layout.mjs';

/**
 * Accueil (une page par langue). Aucun texte visible n'est écrit ici : tout vient du
 * dictionnaire `t` (src/i18n). Les identifiants de section (#decouvrir, #parrainage…) sont
 * communs aux deux langues pour que le sélecteur de langue garde la section affichée.
 */

const FEATURES = [
  { key: 'multiplayer', icon: 'i-users', badge: 'live' },
  { key: 'tables', icon: 'i-table', badge: 'live' },
  { key: 'cards', icon: 'i-cards', badge: 'live' },
  { key: 'tournaments', icon: 'i-trophy', badge: 'schedule' },
  { key: 'profile', icon: 'i-user', badge: 'live' },
  { key: 'shop', icon: 'i-wallet', badge: 'live' },
  { key: 'support', icon: 'i-help', badge: 'live' },
  { key: 'referral', icon: 'i-gift', badge: 'link' },
];

const BADGES = {
  live: (t) => `<span class="badge badge-live">${t.features.badgeLive}</span>`,
  schedule: (t) => `<span class="badge badge-live">${t.features.badgeSchedule}</span>`,
  soon: (t) => `<span class="badge badge-soon">${t.features.badgeSoon}</span>`,
  link: (t) => `<a class="feature-link" href="#parrainage">${t.features.referralLink}</a>`,
};

const FAQ = ['whatIs', 'download', 'account', 'cost', 'withdraw', 'multiplayer', 'referral', 'password', 'help'];

function faqItem(t, key) {
  const item = t.faq[key];
  const id = key === 'referral' ? ' id="faq-parrainage"' : '';
  let answer;
  if (key === 'download') {
    answer = `            <p data-before-launch>${item.beforeLaunch}</p>
            <p data-after-launch hidden>${item.afterLaunch}</p>
            <p data-download-platform="android" hidden>${t.download.androidInstall}</p>`;
  } else if (key === 'help') {
    answer = `            <p>${item.a}</p>
            <p data-support-missing>${item.supportMissing}</p>
            <ul class="support-links" data-support-links data-support-label="${escapeHtml(item.supportCenter)}" hidden></ul>`;
  } else {
    answer = `            <p>${item.a}</p>`;
  }
  return `          <details${id}>
            <summary>${item.q}</summary>
${answer}
          </details>`;
}

function renderBody(t) {
  const d = t.download;
  return `  <main id="contenu">
    <!-- Affiché seulement si l'adresse contient un code de parrainage valide (?ref=CODE). -->
    <section class="invitation" id="invitation" hidden aria-labelledby="invitation-titre">
      <div class="container invitation-inner">
        <div>
          <h2 id="invitation-titre">${t.invitation.title}</h2>
          <p>${t.invitation.codeLabel} <strong class="code" data-referral-code></strong>. ${t.invitation.instructions}</p>
        </div>
        <div class="invitation-actions">
          <button class="btn btn-ghost-light" type="button" data-copy-code>${t.invitation.copy}</button>
          <a class="btn btn-ghost-light" data-open-app href="#parrainage">${t.invitation.openApp}</a>
          <p class="copy-status" data-copy-status data-copied="${escapeHtml(t.invitation.copied)}" data-copy-failed="${escapeHtml(t.invitation.copyFailed)}" role="status"></p>
        </div>
      </div>
    </section>

    <section class="hero section-dark" id="accueil" aria-labelledby="hero-titre">
      <div class="container hero-grid">
        <div class="hero-copy">
          <p class="status-pill" data-before-launch>${t.hero.statusBeforeLaunch}</p>
          <p class="status-pill" data-after-launch hidden>${t.hero.statusAfterLaunch}</p>
          <h1 id="hero-titre">${t.hero.title}</h1>
          <p class="lead">${t.hero.lead}</p>
          <div class="actions">
            <a class="btn btn-primary" href="#decouvrir">${t.hero.discoverCta}</a>
            <!-- Affichés seulement quand le lien officiel de la plateforme est configuré. -->
            <a class="btn btn-outline" data-download="android" data-download-platform="android" hidden>
              <svg class="icon" aria-hidden="true"><use href="#i-android"/></svg>
              ${d.android}
            </a>
            <a class="btn btn-outline" data-download="ios" data-download-platform="ios" hidden>
              <svg class="icon" aria-hidden="true"><use href="#i-apple"/></svg>
              ${d.ios}
            </a>
          </div>
        </div>
        <div class="hero-visual">
          <div class="card-fan" role="img" aria-label="${escapeHtml(t.hero.visualLabel)}">
            <span class="tcard" aria-hidden="true"><span class="tcard-medal">L</span></span>
            <span class="tcard" aria-hidden="true"><span class="tcard-medal">E</span></span>
            <span class="tcard" aria-hidden="true"><span class="tcard-medal">T</span></span>
            <span class="tcard" aria-hidden="true"><span class="tcard-medal">E</span></span>
            <span class="tcard" aria-hidden="true"><span class="tcard-medal">R</span></span>
          </div>
          <p class="visual-note">${t.hero.visualNote}</p>
        </div>
      </div>
    </section>

    <section class="section section-ivory" id="decouvrir" aria-labelledby="decouvrir-titre">
      <div class="container">
        <p class="eyebrow">${t.discover.eyebrow}</p>
        <h2 id="decouvrir-titre">${t.discover.title}</h2>
        <p class="section-intro">${t.discover.intro}</p>
        <div class="games">
          <article class="game">
            <h3>Fap-Fap</h3>
            <p>${t.discover.fapFap}</p>
          </article>
          <article class="game">
            <h3>GARAM TIA</h3>
            <p>${t.discover.garam}</p>
          </article>
        </div>
        <p class="note">${t.discover.note}</p>
      </div>
    </section>

    <section class="section section-ivory-alt" id="fonctionnalites" aria-labelledby="fonctionnalites-titre">
      <div class="container">
        <p class="eyebrow">${t.features.eyebrow}</p>
        <h2 id="fonctionnalites-titre">${t.features.title}</h2>
        <ul class="features">
${FEATURES.map(
  ({ key, icon, badge }) => `          <li class="feature">
            <svg class="icon icon-feature" aria-hidden="true"><use href="#${icon}"/></svg>
            <h3>${t.features.items[key].title}</h3>
            <p>${t.features.items[key].text}</p>
            ${BADGES[badge](t)}
          </li>`,
).join('\n')}
        </ul>
      </div>
    </section>

    <section class="section section-ivory" id="jetons" aria-labelledby="jetons-titre">
      <div class="container">
        <p class="eyebrow">${t.tokens.eyebrow}</p>
        <h2 id="jetons-titre">${t.tokens.title}</h2>
        <p class="section-intro">${t.tokens.intro}</p>
        <dl class="token-facts">
${t.tokens.facts
  .map(
    (fact) => `          <div>
            <dt>${fact.term}</dt>
            <dd>${fact.text}</dd>
          </div>`,
  )
  .join('\n')}
        </dl>
        <p class="notice-light">${t.tokens.responsible}</p>
      </div>
    </section>

    <section class="section section-dark" id="comment-jouer" aria-labelledby="jouer-titre">
      <div class="container">
        <p class="eyebrow">${t.howToPlay.eyebrow}</p>
        <h2 id="jouer-titre">${t.howToPlay.title}</h2>
        <ol class="steps">
${t.howToPlay.steps
  .map(
    (step) => `          <li class="step">
            <h3>${step.title}</h3>
            <p>${step.text}</p>
          </li>`,
  )
  .join('\n')}
        </ol>

        <div class="download" id="telecharger">
          <div>
            <h3>${d.title}</h3>
            <p data-before-launch>${d.beforeLaunch}</p>
            <p data-after-launch hidden>${d.afterLaunch}</p>
            <!-- Installation hors Google Play : affiché seulement quand le lien Android est configuré. -->
            <p class="install-note" data-download-platform="android" hidden>${d.androidInstall}</p>
          </div>
          <div class="actions platform-actions">
            <a class="btn btn-primary is-disabled" data-download="android" data-label="${escapeHtml(d.android)}" aria-disabled="true">
              <svg class="icon" aria-hidden="true"><use href="#i-android"/></svg>
              <span data-download-text>${d.androidSoon}</span>
            </a>
            <a class="btn btn-primary is-disabled" data-download="ios" data-label="${escapeHtml(d.ios)}" aria-disabled="true">
              <svg class="icon" aria-hidden="true"><use href="#i-apple"/></svg>
              <span data-download-text>${d.iosSoon}</span>
            </a>
          </div>
        </div>
      </div>
    </section>

    <section class="section section-ivory" id="parrainage" aria-labelledby="parrainage-titre">
      <div class="container">
        <p class="eyebrow">${t.referral.eyebrow}</p>
        <h2 id="parrainage-titre">${t.referral.title}</h2>
        <p class="section-intro">${t.referral.intro}</p>

        <ol class="referral-steps">
${t.referral.steps
  .map(
    (step, index) => `          <li>
            <span class="step-number" aria-hidden="true">${index + 1}</span>
            <h3>${step.title}</h3>
            <p>${step.text}</p>
          </li>`,
  )
  .join('\n')}
        </ol>

        <div class="rules">
          <h3>${t.referral.rulesTitle}</h3>
          <dl class="rules-list">
${t.referral.rules
  .map(
    (rule) => `            <div>
              <dt>${rule.term}</dt>
              <dd>${rule.text}</dd>
            </div>`,
  )
  .join('\n')}
          </dl>
          <!-- Affiché par site.js seulement si config.js désactive le crédit (referral.rewardsActive). -->
          <p class="notice" data-rewards-pending hidden>${t.referral.rewardsPending}</p>
          <p class="fine-print">${t.referral.finePrint}</p>
        </div>

        <div class="actions">
          <a class="btn btn-primary" href="#telecharger">${t.common.downloadCta}</a>
          <a class="btn btn-outline-dark" href="#faq-parrainage">${t.referral.faqCta}</a>
        </div>
      </div>
    </section>

    <section class="section section-ivory-alt" id="tournois" aria-labelledby="tournois-titre">
      <div class="container split">
        <div>
          <p class="eyebrow">${t.tournaments.eyebrow}</p>
          <h2 id="tournois-titre">${t.tournaments.title}</h2>
${t.tournaments.paragraphs.map((p) => `          <p>${p}</p>`).join('\n')}
          <p class="fine-print">${t.tournaments.finePrint}</p>
        </div>
        <ul class="facts" aria-label="${escapeHtml(t.tournaments.factsLabel)}">
${t.tournaments.facts.map((f) => `          <li><strong>${f.term}</strong><span>${f.text}</span></li>`).join('\n')}
        </ul>
      </div>
    </section>

    <section class="section section-ivory" id="assistance" aria-labelledby="assistance-titre">
      <div class="container narrow">
        <p class="eyebrow">${t.faq.eyebrow}</p>
        <h2 id="assistance-titre">${t.faq.title}</h2>
        <div class="faq">
${FAQ.map((key) => faqItem(t, key)).join('\n')}
        </div>
      </div>
    </section>
  </main>`;
}

export function renderHome(t, lang) {
  const ctx = pageContext('home', lang);
  return renderDocument(ctx, t, {
    comment: 'Généré par marketing/scripts/generate.mjs (src/pages/home.mjs + src/i18n) : ne pas modifier à la main.',
    head: {
      title: t.meta.home.title,
      description: t.meta.home.description,
      ogTitle: t.meta.home.ogTitle,
      ogDescription: t.meta.home.ogDescription,
      // Page racine (choix de la langue) : relativeHref la désigne par son dossier (« ../ »).
      xDefault: ctx.asset('index.html'),
    },
    body: renderBody(t),
  });
}
