import type { LegalDocument, ResolvedLegalInfo } from '../types';

/**
 * Terms of Use — English version.
 *
 * ⚠ INTERNAL NOTE: draft written from the application's actual behaviour. It has not been
 * reviewed or approved by any legal professional and must be before any official
 * publication. Bracketed markers are to be completed (constants/app-config).
 */
export function termsEn(info: ResolvedLegalInfo): LegalDocument {
  return {
    title: 'Terms of Use',
    lastUpdated: info.lastUpdated,
    sections: [
      {
        heading: '1. Purpose',
        paragraphs: [
          `These terms of use (the "Terms") govern access to and use of the LeTer mobile application (the "Service"), published by ${info.publisherName}, ${info.address} (the "Publisher").`,
          'By creating an account or using the Service, you accept these Terms. If you do not accept them, you must not use the Service.',
        ],
      },
      {
        heading: '2. About the game',
        paragraphs: [
          "LeTer is an online card game for 2 to 4 players around a virtual table. The game rules are applied by the Publisher's servers, which are authoritative for the course and outcome of every game.",
          'The Service may offer private tables, tournaments and other game modes. Some features may be added, changed or removed through updates.',
        ],
      },
      {
        heading: '3. Access conditions',
        paragraphs: [
          `The Service is reserved for people aged at least ${info.minimumAge} who have the legal capacity to accept these Terms or, where the applicable law allows it, the consent of their legal guardian.`,
          'Using the Service requires a compatible device and an Internet connection, at your own cost. The game can only be played with an account: there is no guest mode.',
          'It is your responsibility to check that using the Service, and in particular the features involving tokens, is permitted in the country where you are.',
        ],
      },
      {
        heading: '4. Creating and using an account',
        paragraphs: [
          'Creating an account requires your first name, last name, a username, a phone number and a password; an email address is optional. You agree to provide accurate information and to keep it up to date.',
          "Your username is visible to other players. It must not infringe anyone's rights or be offensive, misleading or contrary to these Terms.",
          'Your account is personal. You are responsible for keeping your password confidential and for all activity carried out from your account. Only one active session is allowed per account: a new sign-in ends the previous one.',
          'If you believe your account has been used without your permission, contact the Publisher without delay.',
        ],
      },
      {
        heading: '5. Code of conduct',
        paragraphs: [
          'You agree to use the Service fairly and respectfully. The following are prohibited, including in game chat:',
          '• offensive, defamatory, hateful, discriminatory, violent or sexual content;',
          '• harassing, threatening or intimidating other players;',
          "• publishing other people's personal data;",
          '• advertising, solicitation or spam;',
          "• any attempt to gain unauthorised access to the Service, its servers or other players' accounts.",
        ],
      },
      {
        heading: '6. Fair play',
        paragraphs: [
          'Each player must play on their own behalf, with their own cards and their own decisions. The Service may apply automatic mechanisms needed for games to run properly (for example, a card played automatically when the turn time runs out).',
          'When a table is created with anti-collusion detection enabled, the Service may, with your permission, use your device location during the game to calculate distances between players. Details are given in the Privacy Policy.',
        ],
      },
      {
        heading: '7. Cheating and fraud',
        paragraphs: [
          'The following are prohibited in particular: collusion between players, sharing information about cards, using several accounts, using software, bots or scripts, deliberately exploiting a bug, and any scheme intended to distort the outcome of a game or to obtain tokens improperly.',
          'The Service may analyse how games are played to spot unusual situations. Such an analysis is an indication, not proof: it never triggers an automatic sanction and may lead to a review.',
          'Any bug or vulnerability you discover must be reported to the Publisher and must not be exploited.',
        ],
      },
      {
        heading: '8. Tournaments and competitions',
        paragraphs: [
          'When tournaments or competitions are offered, their specific terms (eligibility, format, any entry fees and rewards) are shown in the application before registration and supplement these Terms.',
          'The Publisher may cancel, postpone or change a tournament in the event of a technical problem, established fraud or circumstances beyond its control, informing participants where possible.',
        ],
      },
      {
        heading: '9. Tokens and virtual items',
        paragraphs: [
          'The Service uses tokens, held in your game account. Tokens can only be used within the Service, do not earn interest and cannot be transferred to another account except through features expressly offered.',
          "Your token balance is the one recorded by the Publisher's servers, which is authoritative. The terms of any conversion between tokens and money are shown in the application at the time of each operation.",
        ],
      },
      {
        heading: '10. Payments',
        paragraphs: [
          'The Service may let you buy tokens or make withdrawals through a payment provider, in particular Mobile Money. These features are only available once a provider is actually enabled; their availability is shown in the application.',
          "Payments are processed by the relevant provider under its own terms. The Publisher does not receive or store your payment credentials or codes. An operation is only credited after the provider's confirmation.",
          'Any fees charged by the provider or your mobile operator are your responsibility unless stated otherwise.',
        ],
      },
      {
        heading: '11. Refunds',
        paragraphs: [
          'Unless mandatory legal provisions state otherwise, tokens used in games are not refundable. A failed payment is not credited; a failed withdrawal is credited back to your game account.',
          'For any claim about an operation, contact the Publisher with the date and reference of the operation. Full refund terms will be specified when payments are enabled.',
        ],
      },
      {
        heading: '12. Account suspension or closure',
        paragraphs: [
          "If these Terms are breached, in particular in cases of cheating, fraud or abusive behaviour, the Publisher may, proportionately and after reviewing the situation, warn the player, temporarily suspend the account or close it.",
          'You may ask for your account to be closed at any time by contacting the Publisher. What happens to tokens remaining on a closed account will be specified in accordance with the applicable regulations.',
        ],
      },
      {
        heading: '13. Intellectual property',
        paragraphs: [
          'The Service, its name, graphics, texts, software and other elements are protected by intellectual property rights. They belong to the Publisher or its partners.',
          'You are granted a personal, non-exclusive and non-transferable right to use the Service for your private use. Any unauthorised reproduction, modification, extraction or exploitation is prohibited.',
        ],
      },
      {
        heading: '14. Service availability',
        paragraphs: [
          'The Publisher strives to keep the Service available at all times but cannot guarantee it. The Service may be interrupted for maintenance, updates or in the event of a failure, including during a game.',
          'The Publisher may change the Service, in particular by adding, modifying or removing features.',
        ],
      },
      {
        heading: '15. Limitation of liability',
        paragraphs: [
          'To the extent permitted by the applicable law, the Publisher is not liable for damage resulting from an interruption of the Service, a failure of your device or connection, misuse of the Service, or the acts of third parties, including payment providers.',
          'Nothing in these Terms limits the rights you have under mandatory legal provisions.',
        ],
      },
      {
        heading: '16. Changes to these terms',
        paragraphs: [
          'The Publisher may change these Terms, in particular to reflect changes to the Service or to regulations. You will be informed of any significant change in the application before it takes effect. Continuing to use the Service means you accept the amended Terms.',
        ],
      },
      {
        heading: '17. Governing law',
        paragraphs: [
          `These Terms are governed by the law of ${info.jurisdiction}. In the event of a dispute, an amicable solution will be sought before any action. Failing that, the dispute will be brought before the competent courts, subject to mandatory consumer protection rules.`,
        ],
      },
      {
        heading: '18. Contact',
        paragraphs: [
          `For any question about these Terms: ${info.publisherName}, ${info.address}, ${info.email}.`,
        ],
      },
    ],
  };
}
