import type { PlayerId } from '../game/game-id';
import type { GaramCardId, GaramSuit } from './garam-cards';

/**
 * Règles de GARAM TIA (docs/garam, cahier des charges maître consolidé, D-119). Seules les
 * règles de jeu sont reprises ici ; ce que les documents ne définissent pas est tranché par
 * une décision explicite de docs/decisions.md (D-119), jamais deviné.
 */

/**
 * Calendrier VISUEL de la distribution (D-123) : il ne fixe que la durée de la phase de
 * distribution du serveur (`dealEndsAt`), jamais le temps d'un tour (GARAM_TURN_DURATION_MS,
 * D-127). Identique à celui des téléphones (`garam-deal.ts`, frontend),
 * intervalles mesurés d'un départ au suivant :
 * - passage 1 : 2 cartes ENSEMBLE à chaque joueur, dans l'ordre de la table, 600 ms entre
 *   deux joueurs ;
 * - passage 2 : la 3e carte, une par joueur, même ordre, 600 ms (avant le passage aussi) ;
 * - terre : 700 ms après la dernière carte des mains, puis une carte toutes les 700 ms.
 */
export const GARAM_DEAL_PASSES: readonly number[] = [2, 1];
export const GARAM_DEAL_PLAYER_STEP_MS = 600;
export const GARAM_DEAL_PASS_PAUSE_MS = 600;
export const GARAM_DEAL_TERRE_PAUSE_MS = 700;
export const GARAM_DEAL_TERRE_STEP_MS = 700;

/** 3 cartes par joueur (§3.4). */
export const GARAM_HAND_SIZE = 3;

/** Cartes posées au terre selon le nombre de joueurs (§3.4) : 2 → 3, 3 → 4, 4 → 5. */
export const GARAM_TERRE_SIZE: Readonly<Record<number, number>> = { 2: 3, 3: 4, 4: 5 };

/** Meilleur score possible ; le tirage ne le dépasse jamais (§3.8, §4.2). */
export const GARAM_SCORE_LIMIT = 21;

/** Main spéciale n° 3 : somme des 3 cartes reçues = 10 (D-130). */
export const GARAM_SUM_TEN = 10;
/** Main spéciale n° 5 : somme des 3 cartes reçues = 21 (D-130). */
export const GARAM_SUM_TWENTY_ONE = 21;
/** Main spéciale n° 1 : trois cartes de cette valeur. */
export const GARAM_SEVEN = 7;

/**
 * Variantes de GARAM TIA (D-127) : GARAM 15, 16, 17 ou 18, choisie EXPLICITEMENT à la création
 * de la partie (table) ou du tournoi, sans aucune valeur par défaut (ni client, ni serveur, ni
 * base). Elle fixe UNIQUEMENT le seuil de la pénalité financière « moins de X » : un perdant
 * dont le total est STRICTEMENT inférieur à X paie une mise de plus, versée au gagnant sans
 * commission. Elle ne change ni le gagnant (plus grand total ≤ 21, conditions spéciales) ni la
 * limite absolue du tirage, 21, commune aux quatre variantes.
 */
export const GARAM_VARIANTS = [15, 16, 17, 18] as const;
export type GaramVariant = (typeof GARAM_VARIANTS)[number];

export function isGaramVariant(value: unknown): value is GaramVariant {
  return typeof value === 'number' && (GARAM_VARIANTS as readonly number[]).includes(value);
}

/** Message unique du refus d'une variante absente ou invalide (API, tournois, CLI). */
export const GARAM_VARIANT_REQUIRED = 'Veuillez choisir la variante : GARAM 15, 16, 17 ou 18.';

/** Un total est-il sous le seuil « moins de X » de la variante ? STRICTEMENT inférieur. */
export function isBelowGaramThreshold(total: number, variant: GaramVariant): boolean {
  return total < variant;
}

/**
 * Temps de décision d'un joueur de GARAM TIA pour jouer sa première carte (D-127, D-143) :
 * 25 s AFFICHÉES par joueur (compte à rebours 25 → 0
 * sur le téléphone du joueur attendu), plus la marge réseau invisible commune de 3 s (D-098 :
 * l'écran atteint 0 trois secondes avant l'échéance du serveur, qui reste seul juge). Propre
 * à GARAM : le temps de tour de Fap-Fap (TURN_DURATION_MS) est inchangé.
 */
export const GARAM_DISPLAYED_TURN_MS = 25_000;
export const GARAM_TURN_DURATION_MS = GARAM_DISPLAYED_TURN_MS + 3_000;

/**
 * Tirage automatique (D-136) : le tirage est obligatoire tant que la tête ne fait pas dépasser
 * 21 (§3.8), le joueur n'a donc aucun choix ; le serveur tire pour lui. Pendant la phase de
 * tirage, l'échéance du tour devient ce court délai : avant la 1re carte d'un joueur
 * (`FIRST`), puis entre deux cartes (`STEP`). Même cycle que le vol d'une carte sur le
 * téléphone (`GARAM_DRAW_BREATH_MS` + `GARAM_DRAW_FLIGHT_MS`, `garam-presentation.ts`).
 */
export const GARAM_AUTO_DRAW_FIRST_MS = 800;
export const GARAM_AUTO_DRAW_STEP_MS = 800;

/**
 * Délai avant la toute PREMIÈRE carte tirée de la manche, à la fin du premier tour : les écrans
 * laissent d'abord le tour visible (2 s), le rangent chez chaque joueur (450 ms), puis
 * marquent une pause lisible (`GARAM_DRAW_START_PAUSE_MS` côté téléphone, 1 s) avant que la
 * 1re carte du terre ne parte. Sans ce délai, le serveur tirait pendant que les cartes du tour
 * étaient encore au centre de la table.
 */
export const GARAM_AUTO_DRAW_AFTER_FIRST_ROUND_MS = 3_500;

/**
 * « Je passe » du contrôleur (D-140) : s'il ne peut prendre aucune carte du terre, son tour
 * reste ouvert ce délai DE PLUS que `GARAM_AUTO_DRAW_AFTER_FIRST_ROUND_MS` (7 s en tout depuis
 * la fin du premier tour). Les écrans rangent le tour (2,45 s), annoncent le contrôle (1,8 s),
 * puis affichent « Je passe » jusqu'à l'échéance (≈ 2,75 s) ; le serveur clôt alors son tirage
 * et passe la main au joueur suivant.
 */
export const GARAM_PASS_NOTICE_MS = 3_500;

/**
 * Main spéciale déclarée automatiquement (D-137) : une main spéciale unique n'est plus un choix
 * du joueur ; le serveur la déclare lui-même, ce court délai après la fin de la distribution
 * (cartes posées sur toutes les tables), pour que chacun voie l'annonce. Échéance de tour
 * persistée, comme le tirage automatique (D-136) : un seul déclenchement, repris au redémarrage.
 */
export const GARAM_AUTO_DECLARE_MS = 800;

/**
 * Présentation VISUELLE de la fin d'une manche gagnée (D-128) : les écrans laissent d'abord le
 * dernier tour se ranger ou la dernière carte tirée arriver (`GARAM_REVEAL_LEAD_MS` : 2 s de
 * tour visible + 450 ms de rangement + marge de réception), révèlent ensuite les mains cachées
 * joueur par joueur (`GARAM_REVEAL_STEP_MS` chacun), affichent les totaux du serveur
 * (`GARAM_SCORE_HOLD_MS`), puis le gagnant (`GARAM_WINNER_HOLD_MS`). Mêmes valeurs côté
 * téléphone (`garam-presentation.ts`). Le serveur n'attend rien pour le résultat : seule la
 * ronde Continuer/Sortir commence après cette présentation, comme après le 5e tour du Ter
 * (D-041), sinon son délai s'écoulerait pendant la révélation.
 */
export const GARAM_REVEAL_LEAD_MS = 2_600;
export const GARAM_REVEAL_STEP_MS = 900;
export const GARAM_SCORE_HOLD_MS = 900;
export const GARAM_WINNER_HOLD_MS = 2_000;

/** Durée de la présentation de fin d'une manche gagnée à `players` joueurs. */
export function garamRevealPresentationMs(players: number): number {
  if (players <= 0) return 0;
  return (
    GARAM_REVEAL_LEAD_MS +
    players * GARAM_REVEAL_STEP_MS +
    GARAM_SCORE_HOLD_MS +
    GARAM_WINNER_HOLD_MS
  );
}

/**
 * Proposition de doubler la mise (§3.15) : même délai de réponse que Continuer/Sortir
 * (13 s côté serveur dont 10 s affichées, D-098).
 */
export const GARAM_STAKE_VOTE_MS = 13_000;

/**
 * Les 5 mains spéciales de GARAM TIA (D-130), toutes sur les 3 cartes reçues, par priorité
 * décroissante (1 = la plus forte), avec la convention de valeur du jeu (3 à 10, As = 11 ;
 * aucune carte 2 ni figure) :
 * 1. THREE_SEVENS : trois 7 ;
 * 2. THREE_OF_A_KIND : trois cartes de même valeur autre que 7 (familles indifférentes) ;
 * 3. SUM_TEN : somme = 10 (seule possibilité : 3 + 3 + 4) ;
 * 4. SAME_SUIT : les 3 cartes de la même famille ;
 * 5. SUM_TWENTY_ONE : somme = 21.
 * Deux As ne sont PAS une main spéciale (propriétaire, D-130) : gardés jusqu'à la fin normale,
 * ils battent tout autre total. `LOW_SUM`, `SAME_SUIT_TERRE` (D-119) et `TWO_ACES` (D-129)
 * restent lisibles dans les résultats des manches déjà jouées (`GaramLegacyCondition`).
 */
export type GaramSpecialCondition =
  | 'THREE_SEVENS'
  | 'THREE_OF_A_KIND'
  | 'SUM_TEN'
  | 'SAME_SUIT'
  | 'SUM_TWENTY_ONE';

/** Conditions des manches jouées avant D-130 (affichage de l'historique seulement). */
export type GaramLegacyCondition = 'LOW_SUM' | 'SAME_SUIT_TERRE' | 'TWO_ACES';

/** Priorité de chaque main spéciale (1 = la plus forte). Ordre définitif (D-130). */
export const GARAM_SPECIAL_PRIORITY: Readonly<Record<GaramSpecialCondition, number>> = {
  THREE_SEVENS: 1,
  THREE_OF_A_KIND: 2,
  SUM_TEN: 3,
  SAME_SUIT: 4,
  SUM_TWENTY_ONE: 5,
};

/** Phases d'une manche en cours (§11.11 : DÉGAGEMENT/PREMIER_TOUR, puis TIRAGE). */
export type GaramPhase = 'FIRST_ROUND' | 'DRAW';

export interface GaramPlayedCard {
  playerId: PlayerId;
  cardId: GaramCardId;
}

/**
 * État de jeu d'une MANCHE de GARAM TIA (une partie GARAM = une session, D-119). Il
 * appartient à cette seule manche (D-011) et vit dans `games.state`.
 */
export interface GaramPlay {
  phase: GaramPhase;
  /** Le joueur qui dégage (J1 de la manche). */
  dealerId: PlayerId;
  /** Ordre de la manche, sens trigonométrique (antihoraire) depuis le dégageur. */
  order: PlayerId[];
  /** Cartes en main (clé = playerId). SECRÈTES : jamais envoyées aux autres joueurs. */
  hands: Record<string, GaramCardId[]>;
  /** Les 3 cartes reçues, pour la révélation finale. SECRÈTES jusqu'à la fin. */
  initialHands: Record<string, GaramCardId[]>;
  /** Terre public, en rang : `terre[0]` est la tête (§3.4, §3.8). */
  terre: GaramCardId[];
  /** Cartes non distribuées : jamais utilisées ni montrées. */
  stock: GaramCardId[];
  /** Premières cartes jouées, dans l'ordre : publiques, exclues du score (§7.9). */
  firstCards: GaramPlayedCard[];
  /** Signe dégagé par la première carte (§3.6). */
  leadSuit?: GaramSuit;
  /** Plus grande carte du signe dégagé à la fin du premier tour (§3.7). */
  controllerId?: PlayerId;
  /** Ordre du tirage : le contrôleur, puis sens antihoraire (D-119). */
  drawOrder: PlayerId[];
  /** Cartes tirées du terre par chaque joueur : publiques (elles étaient au terre). */
  drawn: Record<string, GaramCardId[]>;
  /** Joueurs dont le tirage est terminé (« Impossible » ou terre vide). */
  drawDone: PlayerId[];
  /**
   * Dernier tirage refusé : « Impossible » (`cardId` = la carte qui ferait dépasser 21, restée
   * au terre) ou terre vide (`cardId` absent).
   */
  lastRefusal?: { playerId: PlayerId; cardId?: GaramCardId; passed?: true };
  /**
   * Contrôleur qui ne peut prendre aucune carte (D-140) : son tour reste ouvert le temps
   * d'annoncer « Je passe » à la table, puis son tirage est clos à l'échéance.
   */
  passing?: { playerId: PlayerId; cardId?: GaramCardId };
  /** Joueur attendu ; absent quand aucune action n'est attendue. */
  nextPlayerId?: PlayerId;
  /**
   * Main spéciale à DÉCLARER (D-129, D-130) par son SEUL détenteur (plusieurs mains : arbitrage
   * automatique). SECRÈTE : seul son détenteur la voit. Déclarable jusqu'à sa première carte
   * jouée (par lui ou par le Katika), sinon le droit est perdu.
   */
  special?: { playerId: PlayerId; condition: GaramSpecialCondition };
}

/**
 * Manche nulle (§3.12 pluralité, §3.15 égalité) : aucun gagnant, nouvelle manche dans la
 * même partie, même dégageur (D-119). `kind = 'SCORE'` : égalité au plus grand total, la
 * proposition de doubler la mise s'applique (§3.15).
 */
export interface GaramTie {
  kind: 'SPECIAL' | 'SCORE';
  condition?: GaramSpecialCondition | GaramLegacyCondition;
  playerIds: PlayerId[];
  scores?: Record<string, number>;
  /**
   * Cartes révélées : égalité au plus grand total, cartes en main avec les totaux (§3.14) ;
   * égalité de mains spéciales, les 3 cartes reçues de chacun (D-130).
   */
  hands?: Record<string, GaramCardId[]>;
}

/**
 * Proposition de doubler la mise (§3.15), portée par la manche EN ATTENTE qui rejoue une
 * égalité au plus grand total. Doublée seulement si TOUS répondent oui ; une absence de
 * réponse à l'échéance n'est pas un oui (D-119).
 */
export interface GaramStakeVote {
  /** Mise de la manche nulle. */
  previousStake: number;
  /** Mise si tous acceptent : le double. */
  proposedStake: number;
  /**
   * Mise de création de la table (D-138) : celle de la manche si un joueur refuse ou ne
   * répond pas à temps. Absente d'une proposition enregistrée avant D-138 : `previousStake`.
   */
  baseStake?: number;
  deadlineAt: Date;
  /** Réponses reçues (clé = playerId). */
  votes: Record<string, boolean>;
}

export function terreSizeFor(playerCount: number): number {
  const size = GARAM_TERRE_SIZE[playerCount];
  if (size === undefined) {
    throw new RangeError(`Nombre de joueurs invalide pour le terre : ${playerCount}`);
  }
  return size;
}
