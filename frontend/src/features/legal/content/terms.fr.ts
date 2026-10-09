import type { LegalDocument, ResolvedLegalInfo } from '../types';

/**
 * Conditions d'utilisation — version française.
 *
 * ⚠ NOTE INTERNE : projet de texte rédigé à partir du fonctionnement réel de l'application.
 * Il n'a été relu ni validé par aucun professionnel du droit et doit l'être avant toute
 * publication officielle. Les repères entre crochets sont à compléter (constants/app-config).
 */
export function termsFr(info: ResolvedLegalInfo): LegalDocument {
  return {
    title: "Conditions d'utilisation",
    lastUpdated: info.lastUpdated,
    sections: [
      {
        heading: '1. Objet',
        paragraphs: [
          `Les présentes conditions d'utilisation (les « Conditions ») encadrent l'accès et l'utilisation de l'application mobile Le Ter (le « Service »), éditée par ${info.publisherName}, ${info.address} (l'« Éditeur »).`,
          "En créant un compte ou en utilisant le Service, vous acceptez les présentes Conditions. Si vous ne les acceptez pas, vous ne devez pas utiliser le Service.",
        ],
      },
      {
        heading: '2. Présentation du jeu',
        paragraphs: [
          'Le Ter est un jeu de cartes en ligne qui se joue de 2 à 4 joueurs autour d\'une table virtuelle. Les règles de jeu sont appliquées par les serveurs de l\'Éditeur, qui font foi pour le déroulement et le résultat de chaque partie.',
          'Le Service peut proposer des tables privées, des tournois et d\'autres modes de jeu. Certaines fonctionnalités peuvent être ajoutées, modifiées ou retirées au fil des mises à jour.',
        ],
      },
      {
        heading: "3. Conditions d'accès",
        paragraphs: [
          `Le Service est réservé aux personnes âgées d'au moins ${info.minimumAge} ans et disposant de la capacité juridique d'accepter les présentes Conditions, ou, le cas échéant, de l'autorisation de leur représentant légal lorsque la loi applicable le permet.`,
          "L'utilisation du Service nécessite un appareil compatible et une connexion Internet, dont les coûts restent à votre charge. Le jeu se pratique uniquement avec un compte : il n'existe pas de mode invité.",
          "Il vous appartient de vérifier que l'utilisation du Service, et en particulier des fonctions impliquant des jetons, est autorisée dans le pays où vous vous trouvez.",
        ],
      },
      {
        heading: '4. Création et utilisation du compte',
        paragraphs: [
          "La création d'un compte demande votre prénom, votre nom, une adresse email, un pseudo, un numéro de téléphone et un mot de passe. Vous vous engagez à fournir des informations exactes et à les tenir à jour.",
          'Votre pseudo est visible des autres joueurs. Il ne doit pas porter atteinte aux droits d\'autrui ni être injurieux, trompeur ou contraire aux présentes Conditions.',
          "Votre compte est personnel. Vous êtes responsable de la confidentialité de votre mot de passe et de toute activité réalisée depuis votre compte. Une seule session active est autorisée par compte : une nouvelle connexion met fin à la précédente.",
          "Si vous pensez que votre compte a été utilisé sans votre autorisation, contactez l'Éditeur sans délai.",
        ],
      },
      {
        heading: '5. Règles de comportement',
        paragraphs: [
          "Vous vous engagez à utiliser le Service de manière loyale et respectueuse. Sont notamment interdits, y compris dans le chat des parties :",
          '• les propos injurieux, diffamatoires, haineux, discriminatoires, violents ou à caractère sexuel ;',
          '• le harcèlement, les menaces ou l\'intimidation d\'autres joueurs ;',
          '• la publication de données personnelles d\'autrui ;',
          '• la publicité, le démarchage ou le spam ;',
          "• toute tentative d'accès non autorisé au Service, à ses serveurs ou aux comptes d'autres joueurs.",
        ],
      },
      {
        heading: '6. Utilisation équitable du jeu',
        paragraphs: [
          "Chaque joueur doit jouer pour son propre compte, avec ses seules cartes et ses propres décisions. Le Service peut appliquer des mécanismes automatiques nécessaires au bon déroulement des parties (par exemple un coup joué automatiquement lorsque le temps de jeu est écoulé).",
          "Lorsqu'une table est créée avec la détection anti-collusion activée, le Service peut, avec votre autorisation, utiliser la position de votre appareil pendant la partie afin de calculer les distances entre joueurs. Les détails figurent dans la Politique de confidentialité.",
        ],
      },
      {
        heading: '7. Triche et fraude',
        paragraphs: [
          'Sont interdits notamment : l\'entente entre joueurs (collusion), le partage d\'informations sur les cartes, l\'utilisation de plusieurs comptes, l\'utilisation de logiciels, robots ou scripts, l\'exploitation volontaire d\'un bogue et toute manœuvre visant à fausser le résultat d\'une partie ou à obtenir indûment des jetons.',
          "Le Service peut analyser le déroulement des parties pour repérer des situations inhabituelles. Une telle analyse constitue une indication et non une preuve : elle n'entraîne aucune sanction automatique et peut donner lieu à un examen.",
          "Tout bogue ou faille découvert doit être signalé à l'Éditeur et ne doit pas être exploité.",
        ],
      },
      {
        heading: '8. Tournois et compétitions',
        paragraphs: [
          "Lorsque des tournois ou compétitions sont proposés, leurs modalités propres (conditions de participation, déroulement, éventuels droits d'entrée et récompenses) sont présentées dans l'application avant l'inscription et complètent les présentes Conditions.",
          "L'Éditeur peut annuler, reporter ou modifier un tournoi en cas de problème technique, de fraude constatée ou de circonstance indépendante de sa volonté, en informant les participants dans la mesure du possible.",
        ],
      },
      {
        heading: '9. Jetons et éléments virtuels',
        paragraphs: [
          'Le Service utilise des jetons, conservés sur votre compte de jeu. Les jetons ne peuvent être utilisés que dans le Service, ne produisent pas d\'intérêts et ne peuvent être transférés à un autre compte que selon les fonctionnalités expressément proposées.',
          "Votre solde de jetons est celui enregistré par les serveurs de l'Éditeur, qui fait foi. Les conditions de conversion éventuelle entre jetons et monnaie sont indiquées dans l'application au moment de chaque opération.",
        ],
      },
      {
        heading: '10. Paiements éventuels',
        paragraphs: [
          "Le Service peut permettre d'acheter des jetons ou d'effectuer des retraits par l'intermédiaire d'un prestataire de paiement, notamment de Mobile Money. Ces fonctions ne sont disponibles que lorsqu'un prestataire est effectivement activé ; leur disponibilité est indiquée dans l'application.",
          "Les paiements sont traités par le prestataire concerné, selon ses propres conditions. L'Éditeur ne reçoit ni ne conserve vos identifiants ou codes de paiement. Une opération n'est créditée qu'après confirmation par le prestataire.",
          'Les éventuels frais facturés par le prestataire ou par votre opérateur restent à votre charge, sauf indication contraire.',
        ],
      },
      {
        heading: '11. Remboursements',
        paragraphs: [
          "Sauf disposition légale impérative contraire, les jetons utilisés en partie ne sont pas remboursables. Une opération de paiement ayant échoué n'est pas créditée ; un retrait qui échoue est recrédité sur votre compte de jeu.",
          "Pour toute réclamation concernant une opération, contactez l'Éditeur en indiquant la date et la référence de l'opération. Les modalités de remboursement complètes seront précisées lors de l'activation des paiements.",
        ],
      },
      {
        heading: "12. Suspension ou fermeture d'un compte",
        paragraphs: [
          "En cas de manquement aux présentes Conditions, notamment en cas de triche, de fraude ou de comportement abusif, l'Éditeur peut, de manière proportionnée, avertir le joueur, suspendre temporairement son compte ou le fermer, après examen de la situation.",
          "Vous pouvez demander la fermeture de votre compte à tout moment en contactant l'Éditeur. Le sort des jetons restant sur un compte fermé sera précisé conformément à la réglementation applicable.",
        ],
      },
      {
        heading: '13. Propriété intellectuelle',
        paragraphs: [
          "Le Service, son nom, ses graphismes, ses textes, ses logiciels et ses autres éléments sont protégés par les droits de propriété intellectuelle. Ils appartiennent à l'Éditeur ou à ses partenaires.",
          'Vous bénéficiez d\'un droit personnel, non exclusif et non transférable d\'utiliser le Service pour votre usage privé. Toute reproduction, modification, extraction ou exploitation non autorisée est interdite.',
        ],
      },
      {
        heading: '14. Disponibilité du service',
        paragraphs: [
          "L'Éditeur s'efforce de rendre le Service accessible en continu, sans pouvoir le garantir. Le Service peut être interrompu pour maintenance, mise à jour ou en cas de panne, y compris pendant une partie.",
          "L'Éditeur peut faire évoluer le Service, et notamment ajouter, modifier ou retirer des fonctionnalités.",
        ],
      },
      {
        heading: '15. Limitation de responsabilité',
        paragraphs: [
          "Dans les limites permises par la loi applicable, la responsabilité de l'Éditeur ne saurait être engagée pour les dommages résultant d'une interruption du Service, d'une défaillance de votre appareil ou de votre connexion, d'une mauvaise utilisation du Service ou du fait d'un tiers, dont les prestataires de paiement.",
          'Rien dans les présentes Conditions ne limite les droits dont vous bénéficiez en vertu de dispositions légales impératives.',
        ],
      },
      {
        heading: '16. Modification des conditions',
        paragraphs: [
          "L'Éditeur peut modifier les présentes Conditions, notamment pour tenir compte de l'évolution du Service ou de la réglementation. En cas de modification importante, vous en serez informé dans l'application avant son entrée en vigueur. Poursuivre l'utilisation du Service vaut acceptation des Conditions modifiées.",
        ],
      },
      {
        heading: '17. Droit applicable',
        paragraphs: [
          `Les présentes Conditions sont soumises au droit de ${info.jurisdiction}. En cas de litige, une solution amiable sera recherchée avant toute action. À défaut, le litige sera porté devant les juridictions compétentes, sous réserve des règles impératives protégeant les consommateurs.`,
        ],
      },
      {
        heading: '18. Contact',
        paragraphs: [
          `Pour toute question relative aux présentes Conditions : ${info.publisherName}, ${info.address}, ${info.email}.`,
        ],
      },
    ],
  };
}
