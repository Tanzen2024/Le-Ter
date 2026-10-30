/**
 * English copy for the marketing site.
 *
 * Same structure and keys as fr.mjs (checked by tests/i18n.test.mjs). Values are inserted as is
 * into the HTML: only simple inline markup is allowed (<em>, <strong>, <a href="#…"> or mailto:).
 *
 * Some in-app screens are only shown in French (“Inscription”, “Aide et réclamations”,
 * “Parrainage”, “Code de parrainage”, “Mot de passe oublié ?”): they are quoted exactly as
 * players see them, followed by an English gloss. Update both if the app gets translated.
 *
 * Product facts: owner's brief (26/10/2026), checked against the backend
 * (docs/mise-a-niveau/AUDIT_INITIAL.md). Never publish a commission schedule, an exchange rate
 * or unconfirmed countries here.
 */
export default {
  meta: {
    home: {
      title: 'LeTer — Multiplayer card games on mobile: Fap-Fap and GARAM TIA',
      description:
        'LeTer brings together Fap-Fap and GARAM TIA, two card games for 2 to 4 players on your phone, in real time, with token stakes: tables with friends, tournaments and referrals.',
      ogTitle: 'LeTer — the card game that brings players together',
      ogDescription: 'Fap-Fap and GARAM TIA, 2 to 4 players, in real time, on mobile.',
    },
    terms: { description: 'Terms of Use of the LeTer app.' },
    privacy: { description: 'Privacy Policy of the LeTer app and of the www.leter.cm website.' },
    notice: { title: 'Legal Notice', description: 'LeTer legal notice: publisher and contact.' },
    titleSuffix: ' — LeTer',
    shareImageAlt: 'LeTer: the L, E, T, E, R cards on a night-green and brass background.',
  },

  common: {
    skipLink: 'Skip to content',
    mainNavLabel: 'Main navigation',
    menu: 'Menu',
    languageSwitchLabel: 'Choose language',
    downloadCta: 'Download LeTer',
    backHome: '‹ Back to home',
  },

  nav: {
    discover: 'The game',
    features: 'Features',
    tokens: 'Tokens',
    referral: 'Referrals',
    tournaments: 'Tournaments',
    support: 'Support',
    download: 'Download',
  },

  invitation: {
    title: "You've been invited",
    codeLabel: 'Referral code:',
    instructions:
      'Enter it in the “Code de parrainage” (referral code) field when you create your account: it is not carried over automatically after installation.',
    copy: 'Copy code',
    copied: 'Code copied.',
    copyFailed: 'Could not copy: please write the code down.',
    openApp: 'I already have the app',
  },

  hero: {
    statusBeforeLaunch: 'Public launch in preparation',
    statusAfterLaunch: 'Available on Android · iOS coming soon',
    title: 'LeTer: the card game that brings players together.',
    lead: 'Fap-Fap and GARAM TIA, two card games for 2 to 4 players on your phone, in real time. Meet your friends around a table, take on other players, stake your tokens and enter tournaments.',
    discoverCta: 'Discover LeTer',
    visualLabel: 'The L, E, T, E, R cards in the colours of the game',
    visualNote: 'Illustration, based on the app’s decor.',
  },

  download: {
    android: 'Download for Android',
    ios: 'Download for iPhone / iOS',
    androidSoon: 'Coming soon on Android',
    iosSoon: 'Coming soon on iOS',
    title: 'Download LeTer',
    beforeLaunch:
      'The public launch is in preparation. The official download links will be published here. Do not install LeTer from any other source.',
    afterLaunch: 'Install LeTer from the official link below. Do not install the app from any other source.',
    androidInstall:
      '<strong>On Android:</strong> LeTer is installed outside Google Play for now. Open the downloaded file: Android asks you to allow installs from this source (your browser or file manager). Allow it, then tap “Install”. Only accept this request for the file downloaded from this site.',
  },

  discover: {
    eyebrow: 'The game',
    title: 'A card table in your pocket',
    intro:
      'LeTer is a mobile app for multiplayer card games. Two to four players sit down at a table and play together, each on their own phone. The rules are enforced by the server, so everyone sees the same game at the same moment. Every game is played with a token stake; creating an account is free.',
    fapFap:
      'The game of Ter: a 31-card deck, 2 to 4 players. Each player is dealt 5 cards and the game is played over 5 tricks. One player leads the trick; the others must follow the suit led if they can. The highest card of that suit wins the trick and takes control of the next one. Think ahead, adapt your strategy and stay in control.',
    garam:
      'A 35-card deck, 2 to 4 players. Each player is dealt 3 cards, and cards are laid face up in the middle of the table: one more than the number of players (3 cards with 2 players, 4 with 3, 5 with 4). You follow the suit led if you can; the highest card of that suit takes control. Hands are then completed with the cards from the middle: the highest total without going over 21 wins.',
    note: "Every turn is timed. If a player doesn't play in time, the server plays a card for them, following a fixed rule, so the game can go on.",
  },

  features: {
    eyebrow: 'Features',
    title: 'LeTer at a glance',
    badgeLive: 'In the app',
    badgeSchedule: 'As scheduled',
    badgeSoon: 'In preparation',
    referralLink: 'See the program',
    items: {
      multiplayer: {
        title: 'Multiplayer games',
        text: 'Two to four players per table, in real time. The table creator starts the game as soon as two players are seated.',
      },
      tables: {
        title: 'Tables and players',
        text: 'Create your own table (name, number of seats, stake, optional password) or join an open one. Chat with the players at the table.',
      },
      cards: {
        title: 'Cards and table',
        text: 'Drag your card onto the table. A timer shows whose turn it is, and a glow shows who takes control.',
      },
      tournaments: {
        title: 'Tournaments and rankings',
        text: 'Sign up for scheduled tournaments, play at tables of 4 and see the official ranking published at closing.',
      },
      profile: {
        title: 'Profile and preferences',
        text: 'Your details, your password, your recovery code and the app settings.',
      },
      shop: {
        title: 'Tokens and game account',
        text: 'Top up your tokens with MTN Mobile Money or Orange Money, follow your balance and withdraw your winnings.',
      },
      support: {
        title: 'Help and complaints',
        text: 'Report a problem and follow how your complaint is handled, right from the app.',
      },
      referral: {
        title: 'Referrals',
        text: 'A personal code to invite your friends, and an overview of the friends you referred, in the app.',
      },
    },
  },

  tokens: {
    eyebrow: 'Tokens and stakes',
    title: 'Playing with tokens',
    intro:
      'Every LeTer game is played with a token stake: there are no free games. The game account itself is free.',
    facts: [
      { term: 'Value', text: '1 token = 1 FCFA.' },
      {
        term: 'Top up',
        text: 'With MTN Mobile Money or Orange Money, from the app. Tokens are credited as soon as the payment is confirmed; a failed or cancelled payment credits nothing, and you can try again.',
      },
      {
        term: 'Stake',
        text: 'Every player at the table stakes the same amount. To join a game, your balance must be at least twice the stake: in some cases (for example a Kora win in Fap-Fap), a losing player loses twice the stake. Otherwise you cannot join and need to top up.',
      },
      {
        term: 'Win',
        text: 'A game has a single winner. LeTer takes a commission on the losing players’ stakes, at a rate that depends on the stake amount; the winner gets their own stake back and receives everything else. Winnings are credited to your token balance immediately.',
      },
      {
        term: 'Withdraw',
        text: 'From 1,000 tokens (1,000 tokens = 1,000 FCFA), to the MTN Mobile Money or Orange Money number registered on your LeTer account, and that number only. The withdrawal is processed automatically by the payment provider.',
      },
    ],
    responsible:
      '<strong>For people aged 18 and over only.</strong> Staking involves a risk of loss: only stake amounts you can afford to lose. Top-ups and withdrawals go through MTN Mobile Money and Orange Money: they are open today to Cameroonian numbers, and other countries where these services exist are planned.',
  },

  howToPlay: {
    eyebrow: 'How to play',
    title: 'Four steps to take a seat at the table',
    steps: [
      { title: 'Install LeTer', text: 'Download the app from the official link published on this site.' },
      {
        title: 'Create your account',
        text: 'First name, last name, username, phone number and password; email is optional. The account is free and for people aged 18 and over. Write down your recovery code: it is shown only once.',
      },
      {
        title: 'Top up your tokens',
        text: 'With MTN Mobile Money or Orange Money. Keep at least twice the stake of the table you want to join.',
      },
      {
        title: 'Play',
        text: 'Fap-Fap or GARAM TIA: join a table, create your own or enter a tournament. The game starts with two players.',
      },
    ],
  },

  referral: {
    eyebrow: 'Referrals',
    title: 'Invite your friends and enjoy the LeTer program.',
    intro:
      'Every player has a personal referral code in the app. Share it: a friend who enters it when creating their account becomes your referral.',
    steps: [
      {
        title: 'Share your invitation',
        text: 'Find your personal code under <em>Aide et réclamations</em> (Help and complaints), in the <em>Parrainage</em> (Referral) tab. Copy it or share your invitation link.',
      },
      {
        title: 'Your friend joins LeTer',
        text: 'They create a new account and enter your code in the “Code de parrainage” (referral code) field. An existing account cannot become a referral.',
      },
      {
        title: 'Qualification is checked',
        text: "The server checks each referral's qualifying conditions, works out the tiers reached and credits the rewards, under the program rules.",
      },
    ],
    rulesTitle: 'Program rules',
    rules: [
      {
        term: 'Qualified referral',
        text: "Their own confirmed token purchases reach 1,000 tokens in total. Purchases made by different referrals don't add up.",
      },
      { term: 'One tier', text: '10 qualified referrals.' },
      {
        term: 'Reward per tier',
        text: '5,000 tokens per completed tier: 10 qualified referrals → 5,000 tokens, 20 → 10,000 in total, 30 → 15,000 in total.',
      },
      {
        term: 'Conditions',
        text: 'One referrer per referral; no self-referral; only referrals whose account is active and in good standing are counted. The program may be suspended, or its rules adjusted for future tiers; a tier already reached is kept.',
      },
    ],
    rewardsPending:
      'Reward crediting is not active yet. Tiers reached are recorded and will be credited once the program is finally approved. No reward is due unless the conditions above are met.',
    finePrint: 'Rewards are credited as tokens to your LeTer game account. The rules in force are those shown in the app.',
    faqCta: 'Referral questions',
  },

  tournaments: {
    eyebrow: 'Tournaments and competition',
    title: 'Measure yourself against other players',
    paragraphs: [
      'Tournaments have a start and an end date. Sign up before the tournament starts, then join a table of 4 players during the playing period.',
      'At closing, once every game has ended, the server calculates the official ranking and publishes it in the app; it does not change after that.',
      'You can also propose a tournament from the app: it is published once the LeTer team has approved it.',
    ],
    finePrint:
      'The schedule and conditions of each tournament (eligibility, format, rewards) are shown in the app before you sign up.',
    factsLabel: 'Tournaments at a glance',
    facts: [
      { term: 'Sign-up', text: 'before the start' },
      { term: 'Tables', text: '4 players' },
      { term: 'Ranking', text: 'official at closing' },
    ],
  },

  faq: {
    eyebrow: 'Support',
    title: 'Frequently asked questions',
    whatIs: {
      q: 'What is LeTer?',
      a: 'A mobile app for multiplayer card games: Fap-Fap and GARAM TIA, two to four players per table, in real time, with token stakes, tournaments and a referral program.',
    },
    download: {
      q: 'How do I download the game?',
      beforeLaunch:
        'The public launch is in preparation. The official links will be published in the <a href="#telecharger">Download</a> section of this site. Do not install LeTer from any other source.',
      afterLaunch:
        'Use the official link in the <a href="#telecharger">Download</a> section. Do not install LeTer from any other source. The iOS version is coming soon.',
    },
    account: {
      q: 'How do I create an account?',
      a: 'In the app, choose “Inscription” (Sign up): first name, last name, username, phone number (Cameroon +237 preselected, can be changed) and password. Email is optional. The account is free and for people aged 18 and over. Keep the recovery code shown at the end in a safe place: you will need it if you forget your password.',
    },
    cost: {
      q: 'How much does a game cost?',
      a: 'The stake is set when the table is created and every player stakes the same amount, in tokens (1 token = 1 FCFA). Your balance must be at least twice the stake to join the game. See the <a href="#jetons">Tokens and stakes</a> section.',
    },
    withdraw: {
      q: 'How do I withdraw my winnings?',
      a: 'From the app, from 1,000 tokens: the amount is sent to the MTN Mobile Money or Orange Money number registered on your LeTer account. Withdrawing to another number is not possible.',
    },
    multiplayer: {
      q: 'How does multiplayer work?',
      a: 'Each table seats 2, 3 or 4 players, set when it is created. Seats are fixed and play goes counter-clockwise. The server applies the rules and sends the game to every player in real time.',
    },
    referral: {
      q: 'How does the referral program work?',
      a: 'Your personal code is under <em>Aide et réclamations</em> (Help and complaints), in the <em>Parrainage</em> (Referral) tab. Your friend enters it when creating their account. If you received an invitation link, write down the code it shows: after installing the app, enter it when you sign up. The detailed rules are in the <a href="#parrainage">Referrals section</a>.',
    },
    password: {
      q: 'I forgot my password.',
      a: 'On the sign-in screen, choose “Mot de passe oublié ?” (Forgot password?), then enter your phone number or email and your recovery code. If you have lost this code, contact support.',
    },
    help: {
      q: 'Where can I get help if something goes wrong?',
      a: 'In the app: <em>Profile</em>, then <em>Aide et réclamations</em> (Help and complaints). You can file a complaint there and follow the reply.',
      supportMissing:
        'To email support, use the address given in the <a href="legal/legal-notice.html">legal notice</a>.',
      supportCenter: 'LeTer help center',
    },
  },

  footer: {
    tagline: 'The multiplayer card game that brings players together, on mobile.',
    ageNotice: 'For people aged 18 and over. Staking involves a risk of loss.',
    siteTitle: 'Site',
    siteNavLabel: 'Site map',
    legalTitle: 'Information',
    legalNavLabel: 'Legal information',
    terms: 'Terms of Use',
    privacy: 'Privacy Policy',
    notice: 'Legal Notice',
    support: 'Support',
  },

  consent: {
    label: 'Audience measurement',
    text: 'With your consent, LeTer measures visits to this site with Google Analytics (measurement cookies). Nothing is loaded if you refuse.',
    details: 'Learn more',
    accept: 'Accept',
    refuse: 'Refuse',
    manage: 'Audience measurement',
  },

  notFound: {
    title: 'Page not found',
    text: 'The page you asked for does not exist or has moved.',
    cta: 'Back to home',
  },

  legal: {
    /** App screen label (frontend/src/lib/i18n/en.ts, legal.lastUpdated). */
    lastUpdated: 'Last updated:',
    website: {
      heading: 'Addendum: the www.leter.cm website',
      paragraphs: [
        'This section supplements the policy above for the www.leter.cm website, published by LAMAT. The website does not ask you to create an account and has no forms.',
        'The website stores in your browser (local storage) only your language choice and, where applicable, your choice about audience measurement. This information is not sent to LeTer.',
        'Audience measurement: the website may use Google Analytics 4, a Google service. It is only loaded after you consent in the banner provided for this purpose; it then sets measurement cookies and sends browsing data to Google (pages viewed, device, browser, approximate location), which may be processed outside Cameroon. You can withdraw your consent at any time with the “Audience measurement” button at the bottom of the page.',
        'The server hosting the website keeps technical logs (IP address, date, page requested, browser), needed for it to run and stay secure.',
        'For any question or to exercise your rights: <a href="mailto:hugueslamat16@gmail.com">hugueslamat16@gmail.com</a>.',
      ],
    },
    notice: {
      items: [
        { term: 'Publisher', text: 'LAMAT' },
        { term: 'Address', text: 'Douala, Cameroon' },
        { term: 'Contact', text: '<a href="mailto:hugueslamat16@gmail.com">hugueslamat16@gmail.com</a>' },
        { term: 'Service', text: 'LeTer, a mobile app for multiplayer card games, and the www.leter.cm website' },
        { term: 'Governing law', text: 'Law of the Republic of Cameroon' },
        { term: 'Audience', text: 'For people aged 18 and over only' },
      ],
      pending:
        '<strong>Information still to be added:</strong> legal form and registration number of the publisher, publication director and website host.',
    },
  },
};
