/**
 * Textes français (langue par défaut). Ce fichier définit la forme de toutes les langues :
 * `en.ts` doit fournir exactement les mêmes clés (vérifié par TypeScript).
 */
export const fr = {
  common: {
    close: 'Fermer',
  },
  settings: {
    title: 'Réglages',
    sound: 'Son',
    on: 'ON',
    off: 'OFF',
    soundOnA11y: 'Activer les sons',
    soundOffA11y: 'Désactiver les sons',
    languages: 'Langues',
    french: 'Français',
    english: 'English',
    selectFrenchA11y: 'Sélectionner le français',
    selectEnglishA11y: "Sélectionner l'anglais",
    support: 'Assistance',
    supportA11y: "Ouvrir l'assistance",
    terms: "Conditions d'utilisations",
    termsA11y: "Ouvrir les conditions d'utilisation",
    privacy: 'Confidentialité',
    privacyA11y: 'Ouvrir la politique de confidentialité',
    closeA11y: 'Fermer les paramètres',
  },
  support: {
    title: 'Assistance',
    unavailable: "Le service d'assistance sera bientôt disponible.",
    openFailed: "Impossible d'ouvrir l'assistance pour le moment. Réessayez plus tard.",
  },
  legal: {
    back: 'Retour',
    backA11y: "Revenir à l'écran précédent",
    lastUpdated: 'Dernière mise à jour',
    notFound: 'Document introuvable.',
  },
  lobby: {
    profile: 'Profil',
    settings: 'Réglages',
    backHome: "Retour à l'accueil",
    addCoins: 'Ajouter des jetons',
    balance: (tokens: number) => `Solde : ${tokens} jetons`,
    /** Solde disponible et fonds réservés par des inscriptions à des tournois (D-054). */
    balanceWithReserved: (available: number, reserved: number) =>
      `Solde disponible : ${available} jetons, ${reserved} réservés pour des tournois`,
    balanceUnavailable: 'Solde indisponible',
    counterUnavailable: 'Compteur indisponible',
  },
  home: {
    chooseMode: 'Choisis ton mode !',
    private: 'Parties',
    tournaments: 'Tournois',
    join: 'Rejoindre',
    joinA11y: (mode: string) => `Rejoindre : ${mode}`,
    proposeTournament: 'Proposer un tournoi',
    /** Prochain tournoi inscrit (D-059) : date, heure de début, heure de fin. */
    nextTournament: 'PROCHAIN TOURNOI',
    nextTournamentDate: 'Date',
    nextTournamentStart: 'Début',
    nextTournamentEnd: 'Fin',
    nextTournamentA11y: (date: string, start: string, end: string) =>
      `Ton prochain tournoi : ${date}, de ${start} à ${end}`,
  },
  /** Sélecteurs de date (calendrier) et d'heure (heures, minutes, AM/PM). */
  pickers: {
    chooseDate: 'Choisir une date',
    chooseTime: 'Choisir une heure',
    previousMonth: 'Mois précédent',
    nextMonth: 'Mois suivant',
    previousYear: 'Année précédente',
    nextYear: 'Année suivante',
    hours: 'Heures',
    minutes: 'Minutes',
    period: 'Période',
    cancel: 'Annuler',
    confirm: 'Valider',
    unavailableDay: (date: string) => `${date}, indisponible`,
  },
};

export type Messages = typeof fr;
