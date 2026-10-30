/**
 * Textes français du site vitrine (langue par défaut).
 *
 * Même structure, mêmes clés que en.mjs (vérifié par tests/i18n.test.mjs). Les valeurs sont
 * insérées telles quelles dans le HTML : seul un balisage en ligne simple est permis (<em>,
 * <strong>, <a href="#…"> ou mailto:) ; écrire « & » sous la forme &amp;.
 *
 * Les libellés de l'application cités entre « » ou en italique (Inscription, Aide et
 * réclamations, Parrainage…) doivent rester ceux affichés à l'écran.
 *
 * Informations produit : brief du propriétaire (26/10/2026), vérifiées dans le backend
 * (docs/mise-a-niveau/AUDIT_INITIAL.md). Ne jamais publier ici de barème de commission, de
 * taux de change ou de pays non confirmés.
 */
export default {
  meta: {
    home: {
      title: 'LeTer — Jeux de cartes multijoueur sur mobile : Fap-Fap et GARAM TIA',
      description:
        'LeTer réunit Fap-Fap et GARAM TIA, deux jeux de cartes à jouer de 2 à 4 sur mobile, en temps réel, avec des mises en jetons : tables entre amis, tournois et parrainage.',
      ogTitle: 'LeTer — le jeu de cartes qui rassemble les joueurs',
      ogDescription: 'Fap-Fap et GARAM TIA, de 2 à 4 joueurs, en temps réel, sur mobile.',
    },
    terms: { description: "Conditions d'utilisation de l'application LeTer." },
    privacy: { description: "Politique de confidentialité de l'application LeTer et du site www.leter.cm." },
    notice: { title: 'Mentions légales', description: 'Mentions légales de LeTer : éditeur et contact.' },
    titleSuffix: ' — LeTer',
    shareImageAlt: 'LeTer : les cartes L, E, T, E, R sur fond vert nuit et laiton.',
  },

  common: {
    skipLink: 'Aller au contenu',
    mainNavLabel: 'Navigation principale',
    menu: 'Menu',
    languageSwitchLabel: 'Choisir la langue',
    downloadCta: 'Télécharger LeTer',
    backHome: "‹ Retour à l'accueil",
  },

  nav: {
    discover: 'Découvrir le jeu',
    features: 'Fonctionnalités',
    tokens: 'Jetons',
    referral: 'Parrainage',
    tournaments: 'Tournois',
    support: 'Assistance',
    download: 'Télécharger',
  },

  invitation: {
    title: 'Vous avez reçu une invitation',
    codeLabel: 'Code de parrainage :',
    instructions:
      "Saisissez-le dans le champ « Code de parrainage » au moment de créer votre compte : il n'est pas repris automatiquement après l'installation.",
    copy: 'Copier le code',
    copied: 'Code copié.',
    copyFailed: 'Copie impossible : recopiez le code à la main.',
    openApp: "J'ai déjà l'application",
  },

  hero: {
    statusBeforeLaunch: 'Lancement public en préparation',
    statusAfterLaunch: 'Disponible sur Android · iOS bientôt',
    title: 'LeTer : le jeu de cartes qui rassemble les joueurs.',
    lead: "Fap-Fap et GARAM TIA, deux jeux de cartes à jouer de 2 à 4 sur mobile, en temps réel. Retrouvez vos amis autour d'une table, affrontez d'autres joueurs, misez vos jetons et participez aux tournois.",
    discoverCta: 'Découvrir LeTer',
    visualLabel: 'Les cartes L, E, T, E, R aux couleurs du jeu',
    visualNote: "Illustration, d'après le décor de l'application.",
  },

  download: {
    android: 'Télécharger sur Android',
    ios: 'Télécharger sur iPhone / iOS',
    androidSoon: 'Bientôt disponible sur Android',
    iosSoon: 'Bientôt disponible sur iOS',
    title: 'Télécharger LeTer',
    beforeLaunch:
      "Le lancement public est en préparation. Les liens officiels de téléchargement seront publiés ici. N'installez pas LeTer depuis une autre source.",
    afterLaunch: "Installez LeTer depuis le lien officiel ci-dessous. N'installez pas l'application depuis une autre source.",
    androidInstall:
      "<strong>Sur Android :</strong> LeTer s'installe pour l'instant hors de Google Play. Ouvrez le fichier téléchargé : Android vous demande d'autoriser l'installation depuis cette source (votre navigateur ou votre gestionnaire de fichiers). Autorisez-la, puis touchez « Installer ». N'acceptez cette demande que pour le fichier téléchargé depuis ce site.",
  },

  discover: {
    eyebrow: 'Découvrir le jeu',
    title: 'Une table de jeu dans votre poche',
    intro:
      "LeTer est une application mobile de jeux de cartes multijoueur. De 2 à 4 joueurs s'installent à une table et jouent ensemble, chacun sur son téléphone. Les règles sont appliquées par le serveur : tout le monde voit la même partie, au même moment. Chaque partie se joue avec une mise en jetons ; la création du compte est gratuite.",
    fapFap:
      "Le jeu du Ter : 31 cartes, de 2 à 4 joueurs. Chaque joueur reçoit 5 cartes et la partie se joue en 5 plis. Un joueur mène le pli ; les autres doivent fournir la couleur demandée quand ils l'ont. La plus forte carte de cette couleur remporte le pli et prend le contrôle du suivant. Anticipez, adaptez votre stratégie et gardez le contrôle.",
    garam:
      "35 cartes, de 2 à 4 joueurs. Chaque joueur reçoit 3 cartes, et des cartes sont posées face visible au centre de la table : une de plus que le nombre de joueurs (3 cartes à 2 joueurs, 4 à 3, 5 à 4). On fournit la couleur demandée quand on l'a ; la plus forte carte de cette couleur prend le contrôle. Les mains sont ensuite complétées avec les cartes du centre : le plus grand total sans dépasser 21 l'emporte.",
    note: 'Chaque tour est chronométré. Si un joueur ne joue pas à temps, le serveur joue une carte à sa place, selon une règle fixe, pour que la partie continue.',
  },

  features: {
    eyebrow: 'Fonctionnalités',
    title: "L'essentiel de LeTer",
    badgeLive: "Dans l'application",
    badgeSchedule: 'Selon le calendrier',
    badgeSoon: 'En préparation',
    referralLink: 'Voir le programme',
    items: {
      multiplayer: {
        title: 'Parties multijoueurs',
        text: 'De 2 à 4 joueurs par table, en temps réel. Le créateur lance la partie dès que deux joueurs sont assis.',
      },
      tables: {
        title: 'Tables et joueurs',
        text: 'Créez votre table (nom, nombre de places, mise, mot de passe facultatif) ou rejoignez une table ouverte. Discutez avec les joueurs assis.',
      },
      cards: {
        title: 'Cartes et table',
        text: "Faites glisser votre carte sur la table. Un chrono indique à qui c'est le tour, un halo signale qui prend le contrôle.",
      },
      tournaments: {
        title: 'Tournois et classements',
        text: 'Inscription aux tournois programmés, tables de 4 joueurs et classement officiel publié à la clôture.',
      },
      profile: {
        title: 'Profil et préférences',
        text: "Vos informations, votre mot de passe, votre code de récupération et les réglages de l'application.",
      },
      shop: {
        title: 'Jetons et compte de jeu',
        text: 'Rechargez vos jetons par MTN Mobile Money ou Orange Money, suivez votre solde et retirez vos gains.',
      },
      support: {
        title: 'Aide et réclamations',
        text: "Signalez un problème et suivez le traitement de votre réclamation depuis l'application.",
      },
      referral: {
        title: 'Parrainage',
        text: "Un code personnel pour inviter vos amis, et le suivi de vos filleuls dans l'application.",
      },
    },
  },

  tokens: {
    eyebrow: 'Jetons et mises',
    title: 'Jouer avec des jetons',
    intro:
      "Toutes les parties de LeTer se jouent avec une mise en jetons : il n'existe pas de partie gratuite. Le compte de jeu, lui, est gratuit.",
    facts: [
      { term: 'Valeur', text: '1 jeton = 1 FCFA.' },
      {
        term: 'Recharger',
        text: "Par MTN Mobile Money ou Orange Money, depuis l'application. Les jetons sont crédités dès la confirmation du paiement ; un paiement échoué ou annulé ne crédite rien, et vous pouvez réessayer.",
      },
      {
        term: 'Miser',
        text: "Chaque joueur de la table mise le même montant. Pour rejoindre une partie, votre solde doit atteindre au moins deux fois la mise : dans certains cas (par exemple une victoire par Kora au Fap-Fap), un perdant perd deux fois la mise. Sinon, la participation est refusée et il faut recharger.",
      },
      {
        term: 'Gagner',
        text: 'Une partie a un seul gagnant. LeTer prélève une commission sur les mises des perdants, à un taux qui dépend du montant de la mise ; le gagnant récupère sa propre mise et reçoit tout le reste. Les gains sont crédités immédiatement sur votre solde de jetons.',
      },
      {
        term: 'Retirer',
        text: "À partir de 1 000 jetons (1 000 jetons = 1 000 FCFA), vers le numéro MTN Mobile Money ou Orange Money enregistré sur votre compte LeTer, et seulement celui-ci. Le retrait est traité automatiquement par le prestataire de paiement.",
      },
    ],
    responsible:
      "<strong>Réservé aux personnes de 18 ans et plus.</strong> Miser comporte un risque de perte : ne misez que des montants que vous pouvez vous permettre de perdre. Achats et retraits passent par MTN Mobile Money et Orange Money : ils sont ouverts aujourd'hui aux numéros du Cameroun, et d'autres pays où ces services existent sont prévus.",
  },

  howToPlay: {
    eyebrow: 'Comment jouer ?',
    title: "Quatre étapes pour s'asseoir à la table",
    steps: [
      { title: 'Installez LeTer', text: "Téléchargez l'application depuis le lien officiel publié sur ce site." },
      {
        title: 'Créez votre compte',
        text: "Prénom, nom, pseudo, numéro de téléphone et mot de passe ; l'e-mail est facultatif. Le compte est gratuit et réservé aux 18 ans et plus. Notez votre code de récupération : il n'est affiché qu'une fois.",
      },
      {
        title: 'Rechargez vos jetons',
        text: 'Par MTN Mobile Money ou Orange Money. Gardez au moins deux fois la mise de la table que vous voulez rejoindre.',
      },
      {
        title: 'Jouez',
        text: 'Fap-Fap ou GARAM TIA : rejoignez une table, créez la vôtre ou entrez dans un tournoi. La partie démarre dès deux joueurs.',
      },
    ],
  },

  referral: {
    eyebrow: 'Parrainage',
    title: 'Parrainez vos amis et profitez du programme LeTer.',
    intro:
      "Chaque joueur dispose d'un code de parrainage personnel, dans l'application. Partagez-le : un ami qui le saisit au moment de créer son compte devient votre filleul.",
    steps: [
      {
        title: 'Partagez votre invitation',
        text: "Retrouvez votre code personnel dans <em>Aide et réclamations</em>, onglet <em>Parrainage</em>. Copiez-le ou partagez votre lien d'invitation.",
      },
      {
        title: 'Votre ami rejoint LeTer',
        text: 'Il crée un nouveau compte et saisit votre code dans le champ « Code de parrainage ». Un compte déjà existant ne peut pas devenir filleul.',
      },
      {
        title: 'La qualification est vérifiée',
        text: 'Le serveur vérifie les conditions de qualification de chaque filleul, calcule les paliers atteints et crédite les récompenses, selon les règles du programme.',
      },
    ],
    rulesTitle: 'Les règles du programme',
    rules: [
      {
        term: 'Filleul qualifié',
        text: "Ses propres achats de jetons confirmés atteignent 1 000 jetons au total. Les achats de plusieurs filleuls ne s'additionnent pas.",
      },
      { term: 'Un palier', text: '10 filleuls qualifiés.' },
      {
        term: 'Récompense par palier',
        text: '5 000 jetons par palier complet : 10 filleuls qualifiés → 5 000 jetons, 20 → 10 000 au total, 30 → 15 000 au total.',
      },
      {
        term: 'Conditions',
        text: "Un seul parrain par filleul ; pas d'auto-parrainage ; seuls les filleuls dont le compte est actif et en règle sont comptés. Le programme peut être suspendu ou ses règles ajustées pour les paliers à venir ; un palier déjà obtenu reste acquis.",
      },
    ],
    rewardsPending:
      "Le crédit des récompenses n'est pas encore activé. Les paliers atteints sont enregistrés et seront crédités après la validation définitive du programme. Aucune récompense n'est due si les conditions ci-dessus ne sont pas remplies.",
    finePrint:
      "Les récompenses sont créditées en jetons sur le compte de jeu LeTer. Les règles en vigueur sont celles affichées dans l'application.",
    faqCta: 'Questions sur le parrainage',
  },

  tournaments: {
    eyebrow: 'Tournois et compétition',
    title: 'Mesurez-vous aux autres joueurs',
    paragraphs: [
      "Les tournois ont une date de début et une date de fin. Inscrivez-vous tant que le tournoi n'a pas commencé, puis rejoignez une table de 4 joueurs pendant la période de jeu.",
      "À la clôture, une fois toutes les parties terminées, le classement officiel est calculé par le serveur puis publié dans l'application ; il ne change plus ensuite.",
      "Vous pouvez aussi proposer un tournoi depuis l'application : il est publié après approbation par l'équipe LeTer.",
    ],
    finePrint:
      "Le calendrier et les conditions de chaque tournoi (participation, déroulement, récompenses) sont affichés dans l'application avant l'inscription.",
    factsLabel: 'Le tournoi en bref',
    facts: [
      { term: 'Inscription', text: 'avant le début' },
      { term: 'Tables', text: '4 joueurs' },
      { term: 'Classement', text: 'officiel à la clôture' },
    ],
  },

  faq: {
    eyebrow: 'Assistance',
    title: 'Questions fréquentes',
    whatIs: {
      q: "Qu'est-ce que LeTer ?",
      a: 'Une application mobile de jeux de cartes multijoueur : Fap-Fap et GARAM TIA, de 2 à 4 joueurs par table, en temps réel, avec des mises en jetons, des tournois et un programme de parrainage.',
    },
    download: {
      q: 'Comment télécharger le jeu ?',
      beforeLaunch:
        "Le lancement public est en préparation. Les liens officiels seront publiés dans la section <a href=\"#telecharger\">Télécharger</a> de ce site. N'installez pas LeTer depuis une autre source.",
      afterLaunch:
        "Utilisez le lien officiel de la section <a href=\"#telecharger\">Télécharger</a>. N'installez pas LeTer depuis une autre source. La version iOS arrive bientôt.",
    },
    account: {
      q: 'Comment créer un compte ?',
      a: "Dans l'application, choisissez « Inscription » : prénom, nom, pseudo, numéro de téléphone (Cameroun +237 présélectionné, modifiable) et mot de passe. L'e-mail est facultatif. Le compte est gratuit et réservé aux personnes de 18 ans et plus. Gardez précieusement le code de récupération affiché à la fin : il sert en cas de mot de passe oublié.",
    },
    cost: {
      q: 'Combien coûte une partie ?',
      a: 'La mise est fixée à la création de la table et chaque joueur mise le même montant, en jetons (1 jeton = 1 FCFA). Votre solde doit atteindre au moins deux fois la mise pour rejoindre la partie. Voir la section <a href="#jetons">Jetons et mises</a>.',
    },
    withdraw: {
      q: 'Comment retirer mes gains ?',
      a: "Depuis l'application, à partir de 1 000 jetons : le montant est envoyé au numéro MTN Mobile Money ou Orange Money enregistré sur votre compte LeTer. Un retrait vers un autre numéro n'est pas possible.",
    },
    multiplayer: {
      q: 'Comment fonctionne le multijoueur ?',
      a: "Chaque table accueille 2, 3 ou 4 joueurs, fixé à sa création. Les places sont fixes et le jeu tourne dans le sens inverse des aiguilles d'une montre. Le serveur applique les règles et envoie la partie à tous les joueurs en temps réel.",
    },
    referral: {
      q: 'Comment fonctionne le parrainage ?',
      a: "Votre code personnel se trouve dans <em>Aide et réclamations</em>, onglet <em>Parrainage</em>. Votre ami le saisit en créant son compte. Si vous avez reçu un lien d'invitation, notez le code affiché : après l'installation, saisissez-le à l'inscription. Les règles détaillées sont dans la <a href=\"#parrainage\">section Parrainage</a>.",
    },
    password: {
      q: "J'ai oublié mon mot de passe.",
      a: "Sur l'écran de connexion, choisissez « Mot de passe oublié ? », puis indiquez votre téléphone ou votre e-mail et votre code de récupération. Si vous avez perdu ce code, contactez l'assistance.",
    },
    help: {
      q: "Où trouver de l'aide en cas de problème ?",
      a: "Dans l'application : <em>Profil</em>, puis <em>Aide et réclamations</em>. Vous pouvez y déposer une réclamation et suivre sa réponse.",
      supportMissing:
        "Pour écrire à l'assistance, utilisez l'adresse indiquée dans les <a href=\"legal/mentions-legales.html\">mentions légales</a>.",
      supportCenter: "Centre d'assistance LeTer",
    },
  },

  footer: {
    tagline: 'Le jeu de cartes multijoueur qui rassemble les joueurs, sur mobile.',
    ageNotice: 'Réservé aux 18 ans et plus. Miser comporte un risque de perte.',
    siteTitle: 'Le site',
    siteNavLabel: 'Plan du site',
    legalTitle: 'Informations',
    legalNavLabel: 'Informations juridiques',
    terms: "Conditions d'utilisation",
    privacy: 'Politique de confidentialité',
    notice: 'Mentions légales',
    support: 'Assistance',
  },

  consent: {
    label: "Mesure d'audience",
    text: "Avec votre accord, LeTer mesure la fréquentation de ce site avec Google Analytics (cookies de mesure). Rien n'est chargé si vous refusez.",
    details: 'En savoir plus',
    accept: 'Accepter',
    refuse: 'Refuser',
    manage: "Mesure d'audience",
  },

  notFound: {
    title: 'Page introuvable',
    text: "La page demandée n'existe pas ou a été déplacée.",
    cta: "Retour à l'accueil",
  },

  legal: {
    /** Libellé de l'écran de l'application (frontend/src/lib/i18n/fr.ts, legal.lastUpdated). */
    lastUpdated: 'Dernière mise à jour :',
    website: {
      heading: 'Complément : le site www.leter.cm',
      paragraphs: [
        "Cette section complète la politique ci-dessus pour le site internet www.leter.cm, édité par LAMAT. Le site ne demande aucune création de compte et ne contient aucun formulaire.",
        "Le site enregistre dans votre navigateur (stockage local) uniquement votre choix de langue et, le cas échéant, votre choix concernant la mesure d'audience. Ces informations ne sont pas transmises à LeTer.",
        "Mesure d'audience : le site peut utiliser Google Analytics 4, service de Google. Il n'est chargé qu'après votre accord, donné dans le bandeau prévu à cet effet ; il dépose alors des cookies de mesure et transmet à Google des données de navigation (pages consultées, appareil, navigateur, localisation approximative), qui peuvent être traitées hors du Cameroun. Vous pouvez retirer votre accord à tout moment avec le bouton « Mesure d'audience » en bas de page.",
        "Le serveur qui héberge le site enregistre des journaux techniques (adresse IP, date, page demandée, navigateur), nécessaires à son fonctionnement et à sa sécurité.",
        'Pour toute question ou pour exercer vos droits : <a href="mailto:hugueslamat16@gmail.com">hugueslamat16@gmail.com</a>.',
      ],
    },
    notice: {
      items: [
        { term: 'Éditeur', text: 'LAMAT' },
        { term: 'Adresse', text: 'Douala, Cameroun' },
        { term: 'Contact', text: '<a href="mailto:hugueslamat16@gmail.com">hugueslamat16@gmail.com</a>' },
        { term: 'Service', text: "LeTer, application mobile de jeux de cartes multijoueur, et le site www.leter.cm" },
        { term: 'Droit applicable', text: 'Droit de la République du Cameroun' },
        { term: 'Public', text: 'Réservé aux personnes de 18 ans et plus' },
      ],
      pending:
        "<strong>Informations en cours de complément :</strong> forme juridique et numéro d'immatriculation de l'éditeur, directeur de la publication et hébergeur du site.",
    },
  },
};
