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
    /** Numéro d'ordre du joueur sur la plateforme (D-133) : rang d'inscription. */
    playerNumber: (n: number) => `N° ${n}`,
    playerNumberA11y: (n: number) => `Joueur numéro ${n} sur la plateforme`,
  },
  home: {
    chooseMode: 'À toi de jouer !',
    private: 'Fap-Fap',
    tournaments: 'Tournois',
    /** GARAM TIA, deuxième jeu de la plateforme (D-119). */
    garam: 'Garam Tia',
    join: 'Rejoindre',
    joinA11y: (mode: string) => `Rejoindre : ${mode}`,
    /** Parties à rejoindre d'un jeu (liste « Rechercher une partie »), sur son panneau. */
    openGames: (count: number) => `${count} ${count > 1 ? 'parties' : 'partie'} en cours`,
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
    youWon: 'Vous avez gagné !',
    stopped: 'Partie arrêtée.',
    youWin: 'Vous gagnez',
    youLose: 'Vous perdez',
    youFled: 'Vous avez fui la partie',
    bySpecialHand: (combination?: string) =>
      combination ? `Victoire par main spéciale : ${combination}` : 'Victoire par main spéciale',
    /** Ma victoire par Full (THREE_AND_TWO) : surtitre, libellé puis nom de la main. */
    specialHandKicker: 'Main spéciale',
    specialHandLabel: 'Main spéciale :',
    fullHouse: 'Full',
    /** Ma victoire par SUM_AT_MOST_21 : nom de la main, dans le même bloc que le Full. */
    sumAtMost21: 'Somme inférieur ou égale à 21',
    /** Main spéciale « deux 7, un 4, un 3 » (D-118). */
    compositionOfSeven: 'Composition de 7',
    opponentFled: (name: string) => `${name} s’est couché.`,
    combinations: {
      THREE_SEVENS: 'Trois 7',
      SUM_AT_MOST_21: 'Somme ≤ 21',
      FIVE_SAME_SUIT: 'Cinq cartes de la même famille',
      FOUR_OF_A_VALUE: 'Quatre cartes de même valeur',
      THREE_AND_TWO: 'Trois + deux',
      COMPOSITION_OF_SEVEN: 'Composition de 7',
      THREE_THREES: 'Trois 3',
    } as Record<string, string>,
    noChange: 'Aucun gain ni perte',
    /** GARAM TIA (D-119) : raison de la victoire, manche nulle. */
    garamConditions: {
      THREE_SEVENS: 'Trois 7',
      THREE_OF_A_KIND: 'Trois cartes identiques',
      SUM_TEN: 'Somme des trois cartes = 10',
      SAME_SUIT: 'Trois cartes de même famille',
      SUM_TWENTY_ONE: 'Somme des trois cartes = 21',
      TWO_ACES: 'Deux As',
      LOW_SUM: 'Somme des trois cartes ≤ 10',
      SAME_SUIT_TERRE: 'Terre du même signe',
    } as Record<string, string>,
    garamAutomatic: (condition: string) => `Main spéciale : ${condition}`,
    garamBestScore: (score: number) => `Meilleur total : ${score}`,
    /** Victoire à 22 points : deux As (11 + 11), seul total gagnant au-dessus de 21 (D-130). */
    garamTwoAces: 'Victoire avec deux As',
    /** Même victoire, bandeau de la table sous « 🏆 pseudo ». */
    garamTwoAcesBanner: 'Gagne avec deux As',
    garamBelowThreshold: (threshold?: number) =>
      `Koraté (${threshold ? `moins de ${threshold}` : 'sous le seuil'}) : une mise de plus pour le gagnant`,
    garamTieTitle: 'Manche nulle',
    garamTieSpecial: 'Plusieurs joueurs remplissent la même condition : la manche est rejouée.',
    garamTieScore: (score: number) =>
      `Égalité à ${score} : nouvelle manche, avec proposition de doubler la mise.`,
    amountA11y: (signed: string) => `${signed} jetons`,
    /** Partie de tournoi (D-111) : le montant vient du compte FICTIF, jamais du solde réel. */
    tournamentAmountA11y: (signed: string) => `${signed} jetons du tournoi (solde fictif)`,
    tournamentAmountNote: 'Jetons du tournoi — solde fictif, votre solde réel est inchangé',
    quit: 'Quitter',
    replay: 'Rejouer',
    cannotContinue: 'Solde insuffisant pour poursuivre : il faut au moins le double de la mise.',
    continueUnchecked: 'Vérification du solde impossible pour le moment : vous pouvez quitter la partie.',
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
