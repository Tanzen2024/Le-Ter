import type { PlayerPlayView, TrickPlay } from '../../../types/game';

/**
 * Ordonnancement de la présentation des cartes jouées (module pur, sans React Native) :
 * l'état métier vient du serveur, ce module décide seulement QUOI montrer et QUAND.
 */

/** Tour joué automatiquement par le serveur (D-035) : présenté carte par carte (D-041). */
export const LAST_TRICK_NUMBER = 5;
/** Pause entre l'apparition de deux cartes du 5e tour (D-041). */
export const LAST_TRICK_GAP_MS = 2000;

export type PublicPlay = TrickPlay & { trick: number };

/**
 * Toutes les cartes jouées, dans l'ordre du serveur : tours terminés, puis tour en cours.
 * `cardId` identifie une carte physique du paquet (31 cartes distinctes, identifiant du
 * moteur) : c'est la clé de la carte partout (main, centre, zone publique). Une carte n'a
 * donc qu'UNE place ici : le tour en cours n'est ajouté que s'il n'est pas déjà terminé, et
 * une carte déjà vue est ignorée (états de fin de partie enregistrés avant la correction
 * du moteur, où le 5e tour figurait dans les deux listes).
 */
export function publicPlays(play: PlayerPlayView | undefined): PublicPlay[] {
  if (!play) return [];
  const completed = new Set(play.completedTricks.map((t) => t.number));
  const all = [
    ...play.completedTricks.flatMap((t) => t.plays.map((p) => ({ ...p, trick: t.number }))),
    ...(completed.has(play.trickNumber)
      ? []
      : play.currentTrick.map((p) => ({ ...p, trick: play.trickNumber }))),
  ];
  const seen = new Set<string>();
  return all.filter((p) => !seen.has(p.cardId) && seen.add(p.cardId));
}

/**
 * Cartes déjà rangées chez un joueur (sa zone publique ; pour le joueur connecté, le cadre
 * « mes cartes jouées ») : SEULEMENT les siennes, dans l'ordre chronologique du serveur, chacune
 * une fois (`publicPlays` dédoublonne), et seulement une fois sa présentation au centre finie.
 */
export function settledCardsOf(
  plays: PublicPlay[],
  playerId: string,
  settled: ReadonlySet<string>,
): string[] {
  return plays.filter((p) => p.playerId === playerId && settled.has(p.cardId)).map((p) => p.cardId);
}

/** Une carte jouée présentée sur la table, et quand elle doit rejoindre son joueur. */
export interface Spotlight {
  play: PublicPlay;
  /** Attente avant son apparition (pause entre deux cartes du 5e tour). */
  delayMs: number;
  /**
   * Vrai quand son tour est complet : la carte quitte alors la table `TRICK_CLEAR_DELAY_MS`
   * plus tard, en même temps que les autres cartes du même tour.
   */
  release: boolean;
}

/**
 * Ce qui est présenté MAINTENANT (fonction pure, dérivée de l'état du serveur et de ce qui a
 * déjà été affiché, donc sans rejouer d'animation après une reconnexion) :
 * - cartes des tours 1 à 4 : chacune apparaît dès qu'elle est jouée et RESTE sur la table
 *   jusqu'à ce que le tour soit complet (`completedTricks`) ; elles partent alors ensemble ;
 * - cartes du 5e tour (D-041) : UNE à la fois, dans l'ordre du serveur (ordre du tour, fuyards
 *   absents), seulement quand plus aucune carte d'un tour précédent n'est sur la table, et
 *   `LAST_TRICK_GAP_MS` après l'apparition de la précédente ; elles restent toutes sur la table
 *   et partent ensemble quand la dernière est apparue ;
 * - `notYetShown(joueur)` : ses cartes du 5e tour pas encore apparues (dessinées de dos, ou
 *   dans ma main) ;
 * - `presenting` : tant qu'une carte jouée n'est pas rangée, le résultat attend.
 */
export function planPresentation(
  plays: PublicPlay[],
  settled: ReadonlySet<string>,
  revealed: ReadonlySet<string>,
  completedTricks: ReadonlySet<number> = new Set(),
) {
  const unsettled = plays.filter((p) => !settled.has(p.cardId));
  const regular = unsettled.filter((p) => p.trick !== LAST_TRICK_NUMBER);
  const finals = plays.filter((p) => p.trick === LAST_TRICK_NUMBER);
  const finalQueue = unsettled.filter((p) => p.trick === LAST_TRICK_NUMBER);
  const isShown = (p: PublicPlay) => revealed.has(p.cardId) || settled.has(p.cardId);

  const spotlights: Spotlight[] = regular.map((play) => ({
    play,
    delayMs: 0,
    release: completedTricks.has(play.trick),
  }));
  let activeFinal: PublicPlay | undefined;
  if (regular.length === 0 && finalQueue.length > 0) {
    // Cartes du 5e tour déjà apparues, puis la suivante (une seule à la fois).
    const shown = finalQueue.filter(isShown);
    activeFinal = finalQueue.find((p) => !isShown(p));
    const allShown = activeFinal === undefined;
    for (const play of shown) spotlights.push({ play, delayMs: 0, release: allShown });
    if (activeFinal) {
      spotlights.push({
        play: activeFinal,
        delayMs: finals.some(isShown) ? LAST_TRICK_GAP_MS : 0,
        release: finals.every((p) => p === activeFinal || isShown(p)),
      });
    }
  }
  return {
    spotlights,
    activeFinal,
    notYetShown: (playerId: string) =>
      finalQueue.filter((p) => p.playerId === playerId && !revealed.has(p.cardId)),
    presenting: unsettled.length > 0,
  };
}

/**
 * Barres de progression et roulette SUSPENDUES (l'échéance reste celle du serveur) :
 * - dès que le joueur connecté a lâché sa carte (`droppedCardId`), tant que le serveur ne l'a
 *   ni acceptée (elle quitte alors sa main) ni refusée (`rejected` : le tour reprend) ;
 * - tant qu'une carte d'un tour TERMINÉ n'est pas encore rangée dans la zone de son joueur.
 * Pendant un tour en cours, les cartes restent au centre jusqu'à la dernière : elles ne
 * suspendent rien (le joueur suivant doit pouvoir jouer).
 */
export function turnHeld({
  pendingCardId,
  droppedCardId,
  rejected,
  myHand,
  plays,
  settled,
  completedTricks,
}: {
  pendingCardId?: string;
  droppedCardId?: string;
  rejected: boolean;
  myHand: readonly string[];
  plays: PublicPlay[];
  settled: ReadonlySet<string>;
  completedTricks: ReadonlySet<number>;
}): boolean {
  const myCardPlayed =
    pendingCardId !== undefined ||
    (droppedCardId !== undefined && !rejected && myHand.includes(droppedCardId));
  const trickSettling = plays.some((p) => completedTricks.has(p.trick) && !settled.has(p.cardId));
  return myCardPlayed || trickSettling;
}