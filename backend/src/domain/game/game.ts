import type { CardId } from '../cards/card';
import type { WinConditionId } from '../rules/win-conditions';
import type { GameId, PlayerId } from './game-id';

/**
 * Cycle de vie d'une partie : waiting → in_progress → finished.
 *
 * Pas de statut « starting » : la distribution est instantanée et atomique.
 * Pas de statut « cancelled », « blocked » ou « suspended » : leur effet n'est pas
 * défini (docs/TODO.md R-23, R-25).
 */
export type GameStatus = 'waiting' | 'in_progress' | 'finished';

/** Nombre de joueurs autorisé par la spécification fonctionnelle (§1). */
export const MIN_PLAYERS = 2;
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
  /** Position à la table, attribuée dans l'ordre d'arrivée. */
  seat: number;
  joinedAt: Date;
  /** Présent si le joueur a fui la partie (spec §2.5). */
  fledAt?: Date;
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
  /** Cartes non distribuées. Usage non défini (R-26). */
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
}

export type GameEndMethod =
  /** Gain instantané déclaré et vérifié (spec §4). */
  | 'INSTANT_WIN'
  /** Contrôle conservé à l'issue du 5e tour (spec §1, séquence « déroulement »). */
  | 'CONTROL_AFTER_LAST_TRICK';

export interface GameResult {
  winnerId: PlayerId;
  method: GameEndMethod;
  /** Conditions satisfaites en cas de gain instantané (aucune priorité définie). */
  instantWinConditions?: WinConditionId[];
  /** Toutes les mains, révélées en cas de gain instantané (spec §2.3). */
  revealedHands?: Record<string, CardId[]>;
  /** Joueurs encore en jeu autres que le gagnant. */
  remainingOpponentIds: PlayerId[];
  /** Joueurs ayant fui ; leur traitement financier reste à définir (R-05). */
  fledPlayerIds: PlayerId[];
}

/**
 * Agrégat « partie » : l'unité d'isolation du système.
 * Tout l'état d'une partie vit dans cet objet et nulle part ailleurs.
 */
export interface Game {
  id: GameId;
  /** Incrémentée à chaque changement d'état validé (concurrence optimiste). */
  version: number;
  status: GameStatus;
  creatorId: PlayerId;
  maxPlayers: number;
  /** Mise de la partie (séquence « création de partie »). Unité à définir (R-13). */
  stakeAmount?: number;
  players: PlayerInGame[];
  /** Présent dès que la partie a démarré. */
  play?: TerPlay;
  /** Présent quand la partie s'est terminée par le jeu (absent si arrêtée par le système). */
  result?: GameResult;
  createdAt: Date;
  updatedAt: Date;
  startedAt?: Date;
  finishedAt?: Date;
  /** Échéance du tour en cours, persistée pour réarmer le timer après un redémarrage. */
  turnDeadlineAt?: Date;
  /** Derniers commandId traités, pour ignorer les doubles soumissions. */
  recentCommandIds: string[];
}

export function isActive(game: Game): boolean {
  return game.status !== 'finished';
}

export function activePlayerIds(game: Game): PlayerId[] {
  return game.players.filter((p) => !p.fledAt).map((p) => p.playerId);
}
