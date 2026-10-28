import type { LegalDocument, ResolvedLegalInfo } from '../types';

/**
 * Politique de confidentialité — version française.
 *
 * Rédigée d'après les données RÉELLEMENT traitées par le code (audit d'octobre 2026) :
 * table `users`, `refresh_tokens`, `wallets` / `wallet_transactions`, `game_chat_messages`,
 * `detection_positions` (24 h), tables de jeu ; aucune IP conservée ; aucun outil d'analyse
 * ni de publicité. Paiements : CinetPay prévu (table `payments`, migration 0017, D-050) mais
 * aucun appel au fournisseur n'est encore implémenté ni activé.
 * À mettre à jour à chaque nouvelle donnée collectée (paiements réels, SMS…).
 *
 * ⚠ NOTE INTERNE : projet non relu par un professionnel du droit ; validation obligatoire
 * avant publication officielle. Repères entre crochets : constants/app-config.
 */
export function privacyFr(info: ResolvedLegalInfo): LegalDocument {
  return {
    title: 'Politique de confidentialité',
    lastUpdated: info.lastUpdated,
    sections: [
      {
        heading: '1. Introduction',
        paragraphs: [
          `La présente politique explique quelles données personnelles l'application LeTer traite, pourquoi et comment, ainsi que vos droits. Le responsable du traitement est ${info.publisherName}, ${info.address} (l'« Éditeur »).`,
        ],
      },
      {
        heading: '2. Données collectées',
        paragraphs: [
          "L'Éditeur ne collecte que les données nécessaires au fonctionnement du jeu : les données de votre compte, les données de vos parties, certaines données techniques et, lorsque les paiements sont activés, les données des opérations sur vos jetons. Elles sont détaillées ci-dessous.",
          "L'application n'intègre aucun outil de mesure d'audience, de publicité ou de suivi publicitaire.",
        ],
      },
      {
        heading: '3. Données du compte',
        paragraphs: [
          "• prénom, nom, pseudo et numéro de téléphone, fournis lors de l'inscription, ainsi que votre adresse email si vous choisissez de la renseigner ;",
          '• mot de passe : il n\'est jamais conservé en clair, seule une empreinte chiffrée (hachage) est enregistrée ;',
          '• date de création, statut du compte et indication de vérification du numéro de téléphone.',
          "Votre pseudo est visible des autres joueurs. Vos nom, prénom, email et numéro de téléphone ne leur sont jamais montrés.",
        ],
      },
      {
        heading: '4. Données de jeu',
        paragraphs: [
          '• tables rejointes, place occupée, parties jouées, cartes jouées, décisions (continuer ou quitter), résultats et coups joués automatiquement à l\'expiration du temps ;',
          '• messages envoyés dans le chat d\'une partie, conservés avec l\'historique de cette partie ;',
          '• solde de jetons de votre compte de jeu.',
          "Sur une table où son créateur a activé la détection anti-collusion, et seulement si vous l'autorisez, la position de votre appareil est envoyée pendant la partie, au premier plan uniquement (jamais en arrière-plan). Elle est arrondie à environ 11 mètres, n'est jamais montrée aux autres joueurs (seules des distances calculées par le serveur s'affichent) et est supprimée au plus tard 24 heures après la fin de la partie. Le refus n'empêche pas de jouer.",
          'Ces données peuvent être analysées pour repérer de possibles ententes entre joueurs. Ces analyses produisent des indications internes, jamais une sanction automatique.',
        ],
      },
      {
        heading: '5. Données techniques',
        paragraphs: [
          "• données de session de connexion : dates de début et d'expiration ; le jeton de session est conservé sur votre appareil dans son stockage sécurisé, et seule son empreinte est enregistrée sur nos serveurs ;",
          "• journaux techniques des serveurs (erreurs, requêtes refusées), qui ne contiennent jamais votre mot de passe ni vos jetons de session ;",
          "• votre adresse IP est lue temporairement, en mémoire, pour limiter les abus (nombre de tentatives) ; elle n'est pas enregistrée ;",
          '• vos préférences (son, langue) restent sur votre appareil et ne sont pas envoyées à nos serveurs.',
        ],
      },
      {
        heading: '6. Données de paiement',
        paragraphs: [
          "Lorsque l'achat ou le retrait de jetons par Mobile Money sera activé, l'Éditeur enregistrera pour chaque opération : son type (achat ou retrait), le nombre de jetons, le montant et la devise (FCFA), son statut, ses dates, le moyen de paiement indiqué par le prestataire et les références de l'opération chez le prestataire.",
          "L'Éditeur ne reçoit ni ne conserve vos codes secrets ou identifiants de paiement, et ne recopie pas votre numéro de téléphone dans les données de paiement. L'application affiche uniquement une version masquée du numéro associé à votre compte.",
          "À la date de la présente politique, les paiements ne sont pas encore activés : ces données ne sont donc pas encore collectées. La présente politique sera mise à jour lors de l'activation.",
        ],
      },
      {
        heading: '7. Utilisation des données',
        paragraphs: [
          '• créer et gérer votre compte, vous authentifier et sécuriser l\'accès ;',
          '• organiser et arbitrer les parties, afficher votre pseudo aux autres joueurs, faire fonctionner le chat ;',
          '• tenir votre compte de jeu et traiter les opérations sur vos jetons ;',
          '• prévenir et détecter la triche, la fraude et les abus ;',
          '• assurer le fonctionnement, la maintenance et la sécurité du Service ;',
          '• répondre à vos demandes et respecter nos obligations légales.',
        ],
      },
      {
        heading: '8. Conservation des données',
        paragraphs: [
          "Les données du compte sont conservées tant que votre compte existe. Les positions liées à la détection anti-collusion sont supprimées au plus tard 24 heures après la fin de la partie. Les données de jeu et de paiement peuvent être conservées plus longtemps lorsque c'est nécessaire à la prévention de la fraude ou au respect d'obligations légales, notamment comptables.",
          'Les durées précises applicables à chaque catégorie de données seront précisées dans une prochaine version de la présente politique.',
        ],
      },
      {
        heading: '9. Sécurité',
        paragraphs: [
          "L'Éditeur met en œuvre des mesures techniques et organisationnelles adaptées : mots de passe et jetons de session enregistrés sous forme d'empreintes, jeton de session stocké dans l'espace sécurisé de votre appareil, accès limités, échanges chiffrés avec les serveurs. Aucun système n'étant infaillible, la sécurité absolue ne peut toutefois être garantie.",
        ],
      },
      {
        heading: '10. Partage avec des prestataires',
        paragraphs: [
          "Vos données ne sont ni vendues ni louées. Elles peuvent être confiées à des prestataires techniques agissant pour le compte de l'Éditeur (hébergement des serveurs et de la base de données, par exemple), dans la limite de ce qui est nécessaire à leur mission.",
          'Elles peuvent aussi être communiquées lorsque la loi l\'exige ou pour défendre les droits de l\'Éditeur.',
        ],
      },
      {
        heading: '11. Paiements et prestataires externes',
        paragraphs: [
          "Le prestataire de paiement prévu est CinetPay, qui permet de payer par Mobile Money. Lorsque les paiements seront activés, ils seront traités par CinetPay selon sa propre politique de confidentialité ; vous saisirez vos informations de paiement directement auprès de lui. Seules les données strictement nécessaires à l'opération (notamment son montant et sa référence) lui seront transmises.",
          "Cette section sera complétée lors de l'activation des paiements, avec la liste exacte des données échangées.",
        ],
      },
      {
        heading: '12. Droits des utilisateurs',
        paragraphs: [
          'Selon la loi applicable, vous pouvez demander l\'accès à vos données, leur rectification, leur suppression, la limitation de leur traitement, vous y opposer ou en demander la portabilité. Vous pouvez à tout moment retirer l\'autorisation d\'accès à la position dans les réglages de votre appareil.',
          `Pour exercer ces droits, écrivez à ${info.email}. Vous pouvez également saisir l'autorité de protection des données compétente.`,
        ],
      },
      {
        heading: '13. Suppression du compte',
        paragraphs: [
          `L'application ne propose pas encore de suppression du compte en libre-service. Vous pouvez la demander en écrivant à ${info.email}. Certaines données pourront être conservées pendant la durée nécessaire au respect d'obligations légales ou à la prévention de la fraude.`,
        ],
      },
      {
        heading: '14. Cookies et technologies similaires',
        paragraphs: [
          "L'application mobile n'utilise pas de cookies publicitaires ni de traceurs. Elle enregistre sur votre appareil uniquement ce qui est nécessaire à son fonctionnement : votre jeton de session (stockage sécurisé) et vos préférences de son et de langue.",
        ],
      },
      {
        heading: '15. Mineurs',
        paragraphs: [
          `Le Service n'est pas destiné aux personnes de moins de ${info.minimumAge} ans. Si vous pensez qu'un mineur nous a transmis des données, contactez-nous pour que nous puissions les supprimer.`,
        ],
      },
      {
        heading: '16. Modifications de la politique',
        paragraphs: [
          "La présente politique peut évoluer, notamment lors de l'activation des paiements ou de nouvelles fonctionnalités. En cas de modification importante, vous en serez informé dans l'application.",
        ],
      },
      {
        heading: '17. Contact',
        paragraphs: [
          `Pour toute question relative à vos données : ${info.publisherName}, ${info.address}, ${info.email}.`,
        ],
      },
      {
        heading: '18. Date de dernière mise à jour',
        paragraphs: [`La présente politique a été mise à jour le ${info.lastUpdated}.`],
      },
    ],
  };
}
