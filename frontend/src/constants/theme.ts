/** Palette Le Ter : tapis de jeu vert profond, accent or, surfaces claires. */
export const colors = {
  felt: '#0E3B2E',
  feltLight: '#16523F',
  gold: '#E3B341',
  goldPressed: '#C99A2E',
  surface: '#FFFFFF',
  background: '#F4F6F3',
  text: '#13201B',
  textMuted: '#5B6B63',
  textOnFelt: '#F4F1E6',
  border: '#D5DDD8',
  borderFocus: '#16523F',
  danger: '#B3261E',
  dangerBg: '#FCEDEC',
  success: '#1E7A4C',
  successBg: '#E7F5EC',
} as const;

export const spacing = { xs: 4, sm: 8, md: 16, lg: 24, xl: 32 } as const;
export const radius = { sm: 8, md: 12, lg: 20 } as const;

/**
 * Direction artistique de l'aire de jeu, « Ébène & Laiton » : un salon de jeu nocturne. La
 * pièce est sombre (vert nuit), la table seule est éclairée ; son plateau est un feutre
 * émeraude cerclé de noyer, incrusté de laiton. Les surfaces d'information (plaques, HUD,
 * panneaux) sont des laques sombres à filet de laiton : elles restent en retrait des cartes,
 * seules à porter des couleurs vives (ivoire, rouge, anthracite). L'or vif est réservé à ce
 * qui demande l'attention : joueur attendu, carte jouable, gagnant.
 *
 * Valeurs de présentation uniquement : aucune n'a d'effet sur le jeu.
 */
export const gameTheme = {
  room: {
    base: '#06110D',
    /** Lumière zénithale posée sur la table, pièce plongée dans la pénombre autour. */
    light:
      'radial-gradient(ellipse at 50% 44%, #1C4838 0%, #11302A 30%, #0A1D17 58%, #040B08 100%)',
    ornament: 'rgba(214, 178, 94, 0.16)',
  },
  felt: {
    base: '#0F4A35',
    surface:
      'radial-gradient(circle at 50% 38%, #2A8A62 0%, #1C6E4D 34%, #11553A 66%, #0A3D29 100%)',
    weave: '#04261A',
    shade: 'rgba(0, 0, 0, 0.55)',
  },
  rim: {
    base: '#3A1E0E',
    wood: 'linear-gradient(155deg, #6A3C1E 0%, #44230F 34%, #2A140A 62%, #52301A 86%, #2E170B 100%)',
    edge: '#170A04',
  },
  /**
   * Rail rembourré de la table de jeu : cuir sang-de-bœuf patiné, surpiqûre et clous de
   * laiton. Le noyer (`rim`) n'en est plus que la bande fine qui borde le feutre.
   */
  leather: {
    base: '#3A1114',
    surface:
      'linear-gradient(160deg, #6B2328 0%, #4A1519 26%, #2C0B0D 55%, #561A1E 82%, #2E0C0E 100%)',
    stitch: 'rgba(226, 190, 112, 0.55)',
    edge: '#120405',
  },
  /** Lampe suspendue au-dessus de la table : flaque de lumière chaude autour et sur le feutre. */
  lamp: {
    pool: 'radial-gradient(circle at 50% 50%, rgba(255, 214, 150, 0.16) 0%, rgba(255, 200, 120, 0.07) 42%, rgba(255, 190, 110, 0) 70%)',
    beam: 'rgba(255, 222, 160, 0.05)',
  },
  /**
   * Cœurs des jetons-avatars (clair, moyen, profond) : une pierre par joueur, choisie d'après
   * son pseudo réel (`avatarToneOf`), pour reconnaître chacun d'un coup d'œil. Repère visuel
   * seulement : le pseudo reste écrit dans la plaque. Dernière teinte : joueur sans pseudo.
   */
  avatarTones: [
    ['#45B98F', '#14654D', '#07322A'],
    ['#5C8BDB', '#1F4A94', '#0B1E46'],
    ['#A57AD8', '#5B3290', '#25113F'],
    ['#DA6175', '#8E1F35', '#3E0914'],
    ['#E3AE52', '#9C6418', '#432806'],
    ['#47BCC7', '#14707C', '#05303A'],
    ['#7E8A86', '#3D4744', '#151B19'],
  ],
  /** Impressions du feutre (filets, rayons, losanges) : laiton délavé, jamais plus vif que les cartes. */
  print: {
    line: 'rgba(226, 196, 120, 0.3)',
    faint: 'rgba(226, 196, 120, 0.16)',
    groove: 'rgba(3, 26, 17, 0.62)',
  },
  brass: {
    main: '#D6B25E',
    bright: '#F2D27A',
    deep: '#8C6A2A',
    line: 'rgba(214, 178, 94, 0.55)',
    hairline: 'rgba(214, 178, 94, 0.28)',
    faint: 'rgba(214, 178, 94, 0.14)',
  },
  /** Or « attention » : joueur attendu, carte jouable, gagnant. */
  focus: '#F5C842',
  focusGlow: 'rgba(245, 200, 66, 0.55)',
  /** Joueur connecté : repère jade, jamais confondu avec l'or du joueur attendu. */
  self: '#43C49E',
  ember: '#E2574C',
  emberGlow: 'rgba(226, 87, 76, 0.55)',
  ivory: '#F6EFDF',
  text: '#FFFFFF',
  textSoft: 'rgba(246, 239, 223, 0.82)',
  textFaint: 'rgba(246, 239, 223, 0.6)',
  lacquer: {
    fill: 'rgba(10, 17, 15, 0.9)',
    surface: 'linear-gradient(180deg, rgba(30, 40, 36, 0.95) 0%, rgba(9, 15, 13, 0.95) 100%)',
    solid: '#0B1411',
    border: 'rgba(214, 178, 94, 0.3)',
  },
  oxblood: {
    main: '#8E1F2F',
    surface: 'linear-gradient(180deg, #A42A3A 0%, #6E1423 100%)',
  },
  emerald: {
    main: '#14654D',
    surface: 'linear-gradient(180deg, rgba(36, 128, 98, 0.95) 0%, rgba(14, 84, 63, 0.95) 100%)',
  },
  shadow: {
    /** Objet posé sur la table (carte, jeton). */
    rest: '0 1px 1px rgba(0, 0, 0, 0.35), 0 3px 7px rgba(0, 0, 0, 0.3)',
    /** Objet tenu au-dessus de la table (carte soulevée). */
    lifted: '0 16px 26px rgba(0, 0, 0, 0.55), 0 0 14px rgba(245, 200, 66, 0.3)',
    /** Plaque ou panneau flottant. */
    panel: '0 10px 28px rgba(0, 0, 0, 0.55), 0 0 0 1px rgba(0, 0, 0, 0.5)',
    plate: '0 3px 8px rgba(0, 0, 0, 0.45)',
  },
} as const;

/**
 * « Salon » : la déclinaison d'Ébène & Laiton pour les écrans autour du jeu (connexion,
 * accueil, tournois, boutique, profil, assistance). Même pièce nocturne, mêmes laques à filet
 * de laiton que la table ; le laiton plein est réservé à l'action principale d'un écran et
 * aux montants, l'émeraude aux actions secondaires, le sang-de-bœuf aux départs et refus.
 *
 * Valeurs de présentation uniquement : aucune n'a d'effet sur le jeu ni sur les données.
 */
export const salon = {
  backdrop: gameTheme.room.base,
  /** Pièce éclairée d'en haut : halo vert nuit, pénombre sur les bords. */
  backdropLight:
    'radial-gradient(ellipse at 50% 16%, #1B4436 0%, #112F28 24%, #0A1E19 50%, #050E0B 76%, #020605 100%)',
  surface: {
    fill: 'rgba(12, 22, 19, 0.95)',
    gradient: 'linear-gradient(180deg, rgba(27, 41, 36, 0.97) 0%, rgba(10, 18, 16, 0.97) 100%)',
    border: gameTheme.brass.hairline,
    /** Zone en creux d'une surface : liste, groupe de choix, champ. */
    well: 'rgba(0, 0, 0, 0.3)',
    wellBorder: 'rgba(246, 239, 223, 0.09)',
    shadow: gameTheme.shadow.panel,
  },
  /** Surface mise en avant (carte choisie, élément à traiter). */
  highlight: gameTheme.brass.line,
  text: gameTheme.ivory,
  textSoft: gameTheme.textSoft,
  textFaint: gameTheme.textFaint,
  /** Texte posé sur le laiton. */
  ink: '#1C1407',
  brass: {
    fill: gameTheme.brass.main,
    gradient: 'linear-gradient(180deg, #F6DC8E 0%, #DDBA66 46%, #A9843A 100%)',
    border: 'rgba(92, 66, 22, 0.9)',
    text: gameTheme.brass.bright,
  },
  emerald: {
    fill: gameTheme.emerald.main,
    gradient: gameTheme.emerald.surface,
    border: 'rgba(67, 196, 158, 0.32)',
  },
  oxblood: {
    fill: gameTheme.oxblood.main,
    gradient: gameTheme.oxblood.surface,
    border: 'rgba(255, 170, 170, 0.22)',
  },
  /** États (badges, messages) : toujours accompagnés d'un libellé, jamais la couleur seule. */
  status: {
    positive: { text: '#86E3C2', fill: 'rgba(67, 196, 158, 0.13)', border: 'rgba(67, 196, 158, 0.45)' },
    attention: { text: gameTheme.focus, fill: 'rgba(245, 200, 66, 0.12)', border: 'rgba(245, 200, 66, 0.5)' },
    critical: { text: '#FFB3A6', fill: 'rgba(226, 87, 76, 0.14)', border: 'rgba(226, 87, 76, 0.5)' },
    info: { text: '#A6CFEA', fill: 'rgba(110, 170, 215, 0.12)', border: 'rgba(110, 170, 215, 0.42)' },
    neutral: { text: gameTheme.textSoft, fill: 'rgba(246, 239, 223, 0.06)', border: 'rgba(246, 239, 223, 0.2)' },
  },
  radius: { control: 12, card: 14, panel: 18 },
} as const;

export type SalonTone = keyof typeof salon.status;

/**
 * Durées des animations de présentation (ms). Elles ne retardent jamais une commande ni un
 * état : la vue du serveur reste la seule source de vérité.
 */
export const motion = {
  tap: 100,
  select: 160,
  drop: 120,
  cardMove: 280,
  turn: 260,
  resolve: 200,
  roundEnd: 320,
  result: 420,
  panel: 210,
  /** Avec « réduire les animations » : changement presque immédiat. */
  reduced: 1,
} as const;
