import type { CardId } from '../cards/card';
import type { GaramCardId } from '../garam/garam-cards';
import type {
  GaramLegacyCondition,
  GaramPlay,
  GaramSpecialCondition,
  GaramStakeVote,
  GaramTie,
  GaramVariant,
} from '../garam/garam-rules';
import type { SessionId } from '../sessions/session';
import type { InstantWinRank, WinConditionId } from '../rules/win-conditions';
import type { GameId, PlayerId } from './game-id';

/**
 * Cycle de vie d'une partie : waiting → in_progress → finished.
 *
 * Pas de statut « starting » : la distribution est instantanée et atomique.
 * Pas de statut « cancelled », « blocked » ou « suspended » : leur effet n'est pas
 * défini (docs/TODO.md R-23, R-25).
 */
export type GameStatus = 'waiting' | 'in_progress' | 'finished';

/**
 * Jeu d'une partie (D-119) : `TER` (Le Ter, jeu historique) ou `GARAM` (GARAM TIA). Fixé par
 * la session à la création, immuable (colonne `game_type`). Absent ou `TER` : Le Ter.
 */
export const GAME_TYPES = ['TER', 'GARAM'] as const;
export type GameType = (typeof GAME_TYPES)[number];

export function isGameType(value: unknown): value is GameType {
  return typeof value === 'string' && (GAME_TYPES as readonly string[]).includes(value);
}

/** Nombre de joueurs autorisé par la spécification fonctionnelle (§1). */
export const MIN_PLAYERS = 2;

/**
 * Capacités autorisées à la création (R-23) : 2, 3 ou 4 joueurs, rien d'autre.
 * La capacité est un MAXIMUM ; le démarrage exige seulement MIN_PLAYERS_TO_START.
 */
export const ALLOWED_MAX_PLAYERS = [2, 3, 4] as const;
export const MIN_PLAYERS_TO_START = 2;
export const MAX_PLAYERS = 4;

/** Nombre d'identifiants de commande conservés pour l'idempotence. */
export const RECENT_COMMANDS_LIMIT = 50;

/**
 * Participation d'un utilisateur (compte) à UNE partie. Le même utilisateur aura
 * un `PlayerInGame` distinct dans chaque partie qu'il rejoint ; savoir s'il peut
 * en avoir plusieurs à la fois reste à décider (R-18).
 */
export interface PlayerInGame {
  /** Identifiant du compte utilisateur. */
  playerId: PlayerId;
  /** Rang d'arrivée dans CETTE partie (0, 1, 2…). */
  seat: number;
  /**
   * Place du joueur à la table de la session au moment où il a rejoint la partie
   * (D-033). Fixe l'ordre antihoraire de la partie ; absente hors session (tests).
   */
  tablePosition?: number;
  joinedAt: Date;
  /** Présent si le joueur a fui la partie (spec §2.5). */
  fledAt?: Date;
  /**
   * Pseudo du compte, pour l'affichage seulement (D-064) : lu dans `users` au chargement de
   * la partie, jamais persisté avec elle ni utilisé par les règles. Absent si inconnu.
   */
  username?: string;
}

export interface TrickPlay {
  playerId: PlayerId;
  cardId: CardId;
}

export interface CompletedTrick {
  /** Numéro du tour (1 à 5). */
  number: number;
  plays: TrickPlay[];
  /** Joueur qui détenait le contrôle à la fin du tour. */
  controllerId: PlayerId;
}

/**
 * Contrôle de la partie (spec §2.2, §2.4). Le premier servi l'a au départ, avant
 * d'avoir joué. `cardId` est la carte qui détient le contrôle dans le tour en cours ;
 * elle est absente tant que le contrôleur n'a pas joué dans ce tour.
 */
export interface Control {
  playerId: PlayerId;
  cardId?: CardId;
}

/**
 * État de jeu d'une partie démarrée. Il appartient à cette seule partie : aucune
 * de ces structures n'est partagée avec une autre.
 *
 * Terminologie (docs/game-domain.md) : une partie = une distribution + 5 « tours »
 * (spec §2.4). Un tour = chaque joueur encore en jeu joue une carte. Les documents
 * ne définissent aucune « manche » au-dessus de la partie.
 */
export interface TerPlay {
  /** Ordre de distribution ; `dealOrder[0]` est le premier servi. */
  dealOrder: PlayerId[];
  /** Main de chaque joueur (clé = playerId). Secrète : jamais envoyée aux autres joueurs. */
  hands: Record<string, CardId[]>;
  /** Cartes non distribuées : ni pioche, ni accessibles, jamais utilisées (D-032, R-26). */
  stock: CardId[];
  /** Tour en cours, de 1 à 5. */
  trickNumber: number;
  /** Ordre de jeu du tour en cours. */
  trickOrder: PlayerId[];
  /** Cartes jouées dans le tour en cours, visibles par tous (spec §2.3). */
  currentTrick: TrickPlay[];
  completedTricks: CompletedTrick[];
  control: Control;
  /** Joueur attendu ; absent quand la partie est terminée. */
  nextPlayerId?: PlayerId;
  /**
   * Analyse SERVEUR des 5 cartes initiales (D-035), faite à la distribution : meilleure
   * combinaison de chaque joueur dont la main est gagnante. SECRÈTE (elle renseigne sur
   * une main) : seul le joueur concerné en voit sa propre ligne. Retirée si le joueur fuit.
   */
  instantWins?: Record<string, { rank: InstantWinRank; combination: WinConditionId }>;
}

export type GameEndMethod =
  /** Victoire instantanée, déclarée ou automatique (D-035). Toujours SIMPLE. */
  | 'INSTANT_WIN'
  /** Contrôle détenu à l'issue du 5e tour : victoire automatique (décisions 35, 52). */
  | 'CONTROL_AFTER_LAST_TRICK'
  /**
   * Partie à 2 : l'adversaire s'est couché (avant sa deuxième carte) ; le joueur restant gagne
   * aussitôt, victoire SIMPLE, et le fuyard paie sa mise comme un perdant (D-086).
   */
  | 'OPPONENT_FLED'
  /** GARAM TIA : condition spéciale de victoire automatique (§3.12, §3.13). */
  | 'GARAM_AUTOMATIC_WIN'
  /** GARAM TIA : fin normale, plus grand total ≤ 21 (§3.14). */
  | 'GARAM_BEST_SCORE';

/**
 * Raison de la fin d'une partie (colonne `games.end_reason`) :
 * - les deux méthodes de victoire ;
 * - INSTANT_WIN_TIE : plusieurs mains gagnantes au même meilleur rang, aucun gagnant, la
 *   partie est immédiatement rejouée dans une NOUVELLE partie de la session ;
 * - ADMIN_STOP : arrêt administratif, sans résultat de jeu.
 */
export type GameEndReason = GameEndMethod | 'INSTANT_WIN_TIE' | 'GARAM_TIE' | 'ADMIN_STOP';

/**
 * Fins SANS gagnant rejouées aussitôt dans une nouvelle partie de la même session, sans
 * Poursuivre/Quitter et avec le même J1 : égalité de priorité du Ter (D-035) et manche nulle
 * de GARAM TIA (D-119).
 */
export function isReplayEndReason(reason: GameEndReason | undefined): boolean {
  return reason === 'INSTANT_WIN_TIE' || reason === 'GARAM_TIE';
}

/** Type de victoire. Une victoire instantanée est toujours SIMPLE (jamais Kora). */
export type VictoryType = 'SIMPLE';

export interface GameResult {
  winnerId: PlayerId;
  method: GameEndMethod;
  /** Victoire instantanée : rang et combinaison retenus (meilleur rang de la main). */
  instantWinRank?: InstantWinRank;
  instantWinCombination?: WinConditionId;
  /** Victoire instantanée attribuée automatiquement par le serveur (rangs différents). */
  automatic?: boolean;
  /**
   * SIMPLE pour une victoire instantanée. Absent pour une victoire en fin de 5e tour : les
   * types Kora / Double Kora ne sont pas définis (R-02), rien n'est inventé.
   */
  victoryType?: VictoryType;
  /** Toutes les mains, révélées en cas de gain instantané (spec §2.3). */
  revealedHands?: Record<string, CardId[]>;
  /** Joueurs encore en jeu autres que le gagnant. */
  remainingOpponentIds: PlayerId[];
  /**
   * Joueurs ayant fui. Hors des participants réglés (coût de la fuite non défini, R-05), sauf
   * la fuite d'une partie à 2 (`OPPONENT_FLED`) : le fuyard y est le perdant (D-086).
   */
  fledPlayerIds: PlayerId[];
  /**
   * GARAM TIA : main spéciale gagnante (déclarée, ou arbitrée automatiquement si
   * `automatic`, D-130). Les manches jouées avant D-130 peuvent porter une ancienne condition.
   */
  garamCondition?: GaramSpecialCondition | GaramLegacyCondition;
  /** GARAM TIA : total final de chaque joueur (fin normale, §3.14). */
  scores?: Record<string, number>;
  /**
   * GARAM TIA : perdants dont le total est STRICTEMENT inférieur au seuil de la variante
   * (fin normale seulement, D-119, D-127), qui paient une mise de plus au gagnant. Les
   * résultats enregistrés avant D-127 (`belowFifteenIds`, GARAM 15) sont relus sous ce nom.
   */
  belowThresholdIds?: PlayerId[];
  /** GARAM TIA : seuil « moins de X » appliqué (la variante de la partie, D-127). */
  penaltyThreshold?: GaramVariant;
  /** GARAM TIA : cartes en main révélées à la fin (§2.5). */
  garamHands?: Record<string, GaramCardId[]>;
}

/**
 * Agrégat « partie » : l'unité d'isolation du système.
 * Tout l'état d'une partie vit dans cet objet et nulle part ailleurs.
 */
export interface Game {
  id: GameId;
  /** Jeu de la partie (D-119). Absent : Le Ter. */
  gameType?: GameType;
  /**
   * GARAM TIA : variante de la partie (15, 16, 17 ou 18, D-127), recopiée de la session à la
   * création, immuable. Toujours présente pour GARAM, jamais pour Le Ter.
   */
  garamVariant?: GaramVariant;
  /**
   * Session à laquelle appartient la partie (D-033). Toujours présente en base
   * (`games.session_id NOT NULL`) ; absente seulement pour des parties de test isolées.
   */
  sessionId?: SessionId;
  /**
   * J1, fixé à la création par la session (D-033) : premier servi, premier à jouer,
   * contrôle initial. Première partie d'une session : son créateur.
   */
  firstPlayerId: PlayerId;
  /** Incrémentée à chaque changement d'état validé (concurrence optimiste). */
  version: number;
  status: GameStatus;
  creatorId: PlayerId;
  maxPlayers: number;
  /** Mise de la partie (séquence « création de partie »). Unité à définir (R-13). */
  stakeAmount?: number;
  /**
   * GARAM TIA : mise définie à la création de la table (D-138), reportée de manche en manche.
   * Une proposition de doubler refusée ou sans réponse de tous ramène la manche à cette mise.
   */
  garamBaseStake?: number;
  players: PlayerInGame[];
  /** Présent dès que la partie a démarré (Le Ter). */
  play?: TerPlay;
  /** GARAM TIA : état de la manche, présent dès qu'elle a démarré (D-119). */
  garam?: GaramPlay;
  /** GARAM TIA : manche nulle (endReason = GARAM_TIE). */
  garamTie?: GaramTie;
  /** GARAM TIA : proposition de doubler la mise, sur la manche en attente qui rejoue (§3.15). */
  garamStakeVote?: GaramStakeVote;
  /** Présent quand la partie s'est terminée par une victoire. */
  result?: GameResult;
  /** Raison de la fin, présente dès que la partie est terminée. */
  endReason?: GameEndReason;
  /** Égalité de priorité des mains instantanées (endReason = INSTANT_WIN_TIE). */
  instantWinTie?: { rank: InstantWinRank; playerIds: PlayerId[] };
  /** Partie rejouée après une égalité : la partie annulée qu'elle remplace (décision 17). */
  replayOfGameId?: GameId;
  createdAt: Date;
  updatedAt: Date;
  startedAt?: Date;
  finishedAt?: Date;
  /**
   * Timer de tour (D-034, SERVER-AUTHORITATIVE) : début et échéance du tour du joueur
   * attendu (`play.nextPlayerId`), persistés pour reconstruire le timer après un
   * redémarrage. Remis à zéro à chaque changement de joueur attendu.
   */
  turnStartedAt?: Date;
  turnDeadlineAt?: Date;
  /**
   * Phase de distribution (D-102) : présent tant que la partie est en cours mais que la
   * distribution n'a pas été CONFIRMÉE par le serveur (transition COMPLETE_DEAL). Pendant
   * cette phase il n'existe aucune échéance de tour (`turnDeadlineAt` absent), aucun timer
   * de décision et aucune action de joueur n'est acceptée.
   */
  dealEndsAt?: Date;
  /**
   * Échéance constatée par le serveur (TURN_TIMEOUT) : le joueur attendu ne peut plus
   * jouer lui-même ; le coup automatique (AutomaticCardSelectionStrategy, non définie)
   * reste à jouer. Absent tant que le tour n'a pas expiré.
   */
  turnTimedOutAt?: Date;
  /**
   * Délai de démarrage (D-065), fixé à la création : présent seulement pour les tables de
   * tournoi. Absent : seul le créateur démarre, sans échéance (parties privées inchangées).
   */
  autoStartDelayMs?: number;
  /**
   * Tournoi de la partie (D-106) : écrit À LA CRÉATION pour toute partie d'une table de
   * tournoi (première et suivantes), puis immuable (garde-fou en base). Absent : partie
   * ordinaire, qui ne touche jamais aux jetons d'un tournoi.
   */
  tournamentId?: string;
  /**
   * Échéance PERSISTÉE du démarrage automatique (D-065) : posée quand la partie en attente
   * atteint 2 joueurs, jamais repoussée par les arrivées suivantes, retirée sous 2 joueurs et
   * au démarrage. Voir `syncStartDeadline`.
   */
  startDeadlineAt?: Date;
  /** Derniers commandId traités, pour ignorer les doubles soumissions. */
  recentCommandIds: string[];
  /**
   * Clé d'idempotence de la création (en-tête Idempotency-Key), unique par créateur.
   * Rejouer la même clé renvoie cette partie au lieu d'en créer une seconde.
   */
  creationKey?: string;
}

const STATUS_ORDER: readonly GameStatus[] = ['waiting', 'in_progress', 'finished'];

/** Le cycle de vie est monotone : waiting → in_progress → finished, jamais de retour. */
export function isForwardTransition(from: GameStatus, to: GameStatus): boolean {
  return STATUS_ORDER.indexOf(to) >= STATUS_ORDER.indexOf(from);
}

export function isActive(game: Game): boolean {
  return game.status !== 'finished';
}

export function isGaram(game: Pick<Game, 'gameType'>): boolean {
  return game.gameType === 'GARAM';
}

/** Joueur attendu par le serveur dans une partie en cours, quel que soit le jeu. */
export function expectedPlayerOf(game: Pick<Game, 'play' | 'garam'>): PlayerId | undefined {
  return game.play?.nextPlayerId ?? game.garam?.nextPlayerId;
}

export function activePlayerIds(game: Game): PlayerId[] {
  return game.players.filter((p) => !p.fledAt).map((p) => p.playerId);
}

/**
 * Échéance de démarrage automatique d'une partie EN ATTENTE (D-065), recalculée après chaque
 * changement de joueurs. Sans délai de démarrage (parties privées), ne fait rien.
 *
 * - 2 joueurs ou plus, sans échéance : l'échéance part MAINTENANT (arrivée du 2e joueur) ;
 * - échéance déjà posée : inchangée (les 3e et 4e arrivées ne la repoussent pas) ;
 * - moins de 2 joueurs : l'échéance est retirée (un joueur seul attend, sans compte à rebours).
 *
 * Renvoie true si l'échéance a changé.
 */
export function syncStartDeadline(game: Game, now: Date): boolean {
  if (game.status !== 'waiting' || game.autoStartDelayMs === undefined) {
    return false;
  }
  if (game.players.length < MIN_PLAYERS_TO_START) {
    if (game.startDeadlineAt === undefined) return false;
    game.startDeadlineAt = undefined;
    return true;
  }
  if (game.startDeadlineAt !== undefined) return false;
  game.startDeadlineAt = new Date(now.getTime() + game.autoStartDelayMs);
  return true;
}
