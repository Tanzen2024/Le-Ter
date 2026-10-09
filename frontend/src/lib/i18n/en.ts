import type { Messages } from './fr';

/** English texts: same keys as `fr.ts`. */
export const en: Messages = {
  common: {
    close: 'Close',
  },
  settings: {
    title: 'Settings',
    sound: 'Sound',
    on: 'ON',
    off: 'OFF',
    soundOnA11y: 'Turn sound on',
    soundOffA11y: 'Turn sound off',
    languages: 'Language',
    french: 'French',
    english: 'English',
    selectFrenchA11y: 'Select French',
    selectEnglishA11y: 'Select English',
    support: 'Support',
    supportA11y: 'Open support',
    terms: 'Terms of Use',
    termsA11y: 'Open the terms of use',
    privacy: 'Privacy Policy',
    privacyA11y: 'Open the privacy policy',
    closeA11y: 'Close settings',
  },
  support: {
    title: 'Support',
    unavailable: 'Support will be available soon.',
    openFailed: 'Support cannot be opened right now. Please try again later.',
  },
  legal: {
    back: 'Back',
    backA11y: 'Go back to the previous screen',
    lastUpdated: 'Last updated',
    notFound: 'Document not found.',
  },
  lobby: {
    profile: 'Profile',
    settings: 'Settings',
    backHome: 'Back to home',
    addCoins: 'Add tokens',
    balance: (tokens: number) => `Balance: ${tokens} tokens`,
    balanceWithReserved: (available: number, reserved: number) =>
      `Available balance: ${available} tokens, ${reserved} reserved for tournaments`,
    balanceUnavailable: 'Balance unavailable',
    counterUnavailable: 'Counter unavailable',
  },
  home: {
    chooseMode: 'Choose your mode!',
    private: 'Private',
    tournaments: 'Tournaments',
    join: 'Join',
    joinA11y: (mode: string) => `Join: ${mode}`,
    proposeTournament: 'Propose a tournament',
    nextTournament: 'NEXT TOURNAMENT',
    nextTournamentDate: 'Date',
    nextTournamentStart: 'Start',
    nextTournamentEnd: 'End',
    nextTournamentA11y: (date: string, start: string, end: string) =>
      `Your next tournament: ${date}, ${start} to ${end}`,
  },
};
