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
    /**
     * Solde disponible et fonds réservés (D-054, D-074) : mises des parties en cours et
     * inscriptions à des tournois. Réservé ≠ débité : rien n'est perdu avant le règlement.
     */
    balanceWithReserved: (available: number, reserved: number) =>
      `Solde disponible : ${available} jetons, ${reserved} réservés (tournois), non débités`,
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
  /** Panneau de fin de partie, posé sur la table (gagnant, bilan, Quitter / Rejouer). */
  gameOver: {
    wonBy: (name: string) => `${name} a gagné la partie.`,
    youWon: 'Vous avez gagné la partie.',
    stopped: 'Partie arrêtée.',
    youWin: 'Vous gagnez',
    youLose: 'Vous perdez',
    youFled: 'Vous avez fui la partie',
    noChange: 'Aucun gain ni perte',
    amountA11y: (signed: string) => `${signed} jetons`,
    quit: 'Quitter',
    replay: 'Rejouer',
    leavingIn: (seconds: number) =>
      `La partie sera quittée dans ${seconds} seconde${seconds > 1 ? 's' : ''}`,
    leaving: 'Sortie de la partie…',
    waitingOthers: (count: number) =>
      `Vous rejouez. En attente de ${count} joueur${count > 1 ? 's' : ''}…`,
    newGame: 'Nouvelle partie…',
    nextGameLater: 'Une partie est en cours : vous jouerez la suivante.',
    home: 'Accueil',
    tieTitle: 'Égalité de priorité',
    tieDetail: 'Aucun gagnant : la partie est rejouée immédiatement, avec le même premier joueur.',
    newDeal: 'Nouvelle donne',
  },
};

export type Messages = typeof fr;
