import type { LegalDocument, ResolvedLegalInfo } from '../types';

/**
 * Privacy Policy — English version. Same data inventory as `privacy.fr.ts` (keep both in
 * sync).
 *
 * ⚠ INTERNAL NOTE: draft not reviewed by a legal professional; approval required before
 * official publication. Bracketed markers: constants/app-config.
 */
export function privacyEn(info: ResolvedLegalInfo): LegalDocument {
  return {
    title: 'Privacy Policy',
    lastUpdated: info.lastUpdated,
    sections: [
      {
        heading: '1. Introduction',
        paragraphs: [
          `This policy explains which personal data the LeTer application processes, why and how, and what your rights are. The data controller is ${info.publisherName}, ${info.address} (the "Publisher").`,
        ],
      },
      {
        heading: '2. Data we collect',
        paragraphs: [
          'The Publisher only collects the data needed for the game to work: your account data, your game data, some technical data and, once payments are enabled, data about operations on your tokens. They are detailed below.',
          'The application does not include any audience measurement, advertising or ad-tracking tool.',
        ],
      },
      {
        heading: '3. Account data',
        paragraphs: [
          '• first name, last name, username and phone number, provided when you register, and your email address if you choose to provide it;',
          '• password: never stored in plain text, only a secure hash is recorded;',
          '• creation date, account status and whether your phone number has been verified.',
          'Your username is visible to other players. Your name, email and phone number are never shown to them.',
        ],
      },
      {
        heading: '4. Game data',
        paragraphs: [
          '• tables joined, seat taken, games played, cards played, decisions (continue or leave), results and cards played automatically when the turn time runs out;',
          '• messages sent in a game chat, kept with the history of that game;',
          '• the token balance of your game account.',
          "At a table where its creator has enabled anti-collusion detection, and only if you allow it, your device location is sent during the game, in the foreground only (never in the background). It is rounded to about 11 metres, never shown to other players (only distances calculated by the server are displayed) and deleted no later than 24 hours after the game ends. Refusing does not prevent you from playing.",
          'This data may be analysed to spot possible collusion between players. These analyses produce internal indications, never an automatic sanction.',
        ],
      },
      {
        heading: '5. Technical data',
        paragraphs: [
          '• sign-in session data: start and expiry dates; the session token is kept on your device in its secure storage, and only its hash is recorded on our servers;',
          '• server technical logs (errors, rejected requests), which never contain your password or session tokens;',
          '• your IP address is read temporarily, in memory, to limit abuse (number of attempts); it is not recorded;',
          '• your preferences (sound, language) stay on your device and are not sent to our servers.',
        ],
      },
      {
        heading: '6. Payment data',
        paragraphs: [
          "Once buying or withdrawing tokens through Mobile Money is enabled, the Publisher will record for each operation: its type (purchase or withdrawal), the number of tokens, the amount and currency (FCFA), its status, its dates, the payment method reported by the provider and the operation's references at the provider.",
          'The Publisher does not receive or store your PINs or payment credentials, and does not copy your phone number into payment data. The application only displays a masked version of the number linked to your account.',
          'As of the date of this policy, payments are not enabled yet, so this data is not collected yet. This policy will be updated when payments are enabled.',
        ],
      },
      {
        heading: '7. How we use data',
        paragraphs: [
          '• creating and managing your account, authenticating you and securing access;',
          '• organising and refereeing games, showing your username to other players, running the chat;',
          '• keeping your game account and processing operations on your tokens;',
          '• preventing and detecting cheating, fraud and abuse;',
          '• operating, maintaining and securing the Service;',
          '• answering your requests and meeting our legal obligations.',
        ],
      },
      {
        heading: '8. Data retention',
        paragraphs: [
          'Account data is kept for as long as your account exists. Locations used for anti-collusion detection are deleted no later than 24 hours after the game ends. Game and payment data may be kept longer where needed to prevent fraud or to meet legal obligations, in particular accounting obligations.',
          'The exact retention periods for each category of data will be specified in a future version of this policy.',
        ],
      },
      {
        heading: '9. Security',
        paragraphs: [
          "The Publisher applies appropriate technical and organisational measures: passwords and session tokens stored as hashes, session token kept in your device's secure storage, restricted access, encrypted exchanges with the servers. As no system is infallible, absolute security cannot be guaranteed.",
        ],
      },
      {
        heading: '10. Sharing with service providers',
        paragraphs: [
          'Your data is never sold or rented. It may be entrusted to technical providers acting on behalf of the Publisher (for example, hosting of the servers and database), only to the extent needed for their task.',
          "It may also be disclosed where required by law or to defend the Publisher's rights.",
        ],
      },
      {
        heading: '11. Payments and external providers',
        paragraphs: [
          'The planned payment provider is CinetPay, which supports Mobile Money payments. Once payments are enabled, they will be processed by CinetPay under its own privacy policy; you will enter your payment details directly with it. Only the data strictly needed for the operation (in particular its amount and reference) will be sent to it.',
          'This section will be completed when payments are enabled, with the exact list of data exchanged.',
        ],
      },
      {
        heading: '12. Your rights',
        paragraphs: [
          "Depending on the applicable law, you may request access to your data, its correction or deletion, restrict or object to its processing, or ask for its portability. You can withdraw location access at any time in your device's settings.",
          `To exercise these rights, write to ${info.email}. You may also contact the competent data protection authority.`,
        ],
      },
      {
        heading: '13. Deleting your account',
        paragraphs: [
          `The application does not yet offer self-service account deletion. You can request it by writing to ${info.email}. Some data may be kept for as long as needed to meet legal obligations or to prevent fraud.`,
        ],
      },
      {
        heading: '14. Cookies and similar technologies',
        paragraphs: [
          'The mobile application does not use advertising cookies or trackers. It only stores on your device what it needs to work: your session token (secure storage) and your sound and language preferences.',
        ],
      },
      {
        heading: '15. Minors',
        paragraphs: [
          `The Service is not intended for people under ${info.minimumAge}. If you believe a minor has sent us data, contact us so that we can delete it.`,
        ],
      },
      {
        heading: '16. Changes to this policy',
        paragraphs: [
          'This policy may change, in particular when payments or new features are enabled. You will be informed of any significant change in the application.',
        ],
      },
      {
        heading: '17. Contact',
        paragraphs: [
          `For any question about your data: ${info.publisherName}, ${info.address}, ${info.email}.`,
        ],
      },
      {
        heading: '18. Last updated',
        paragraphs: [`This policy was last updated on ${info.lastUpdated}.`],
      },
    ],
  };
}
