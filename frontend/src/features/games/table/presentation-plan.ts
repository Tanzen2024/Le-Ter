import type { PlayerPlayView, TrickPlay } from '../../../types/game';

/**
 * Ordonnancement de la présentation des cartes jouées (module pur, sans React Native) :
 * l'état métier vient du serveur, ce module décide seulement QUOI montrer et QUAND.
 */

/** Tour joué automatiquement par le serveur (D-035) : présenté carte par carte (D-041). */
export const LAST_TRICK_NUMBER = 5;
/** Pause entre deux cartes du 5e tour, après que la précédente a été rangée (D-041). */
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
 * Ce qui est présenté MAINTENANT (fonction pure, dérivée de l'état du serveur et de ce qui a
 * déjà été affiché, donc sans rejouer d'animation après une reconnexion) :
 * - cartes des tours 1 à 4 : chacune dès qu'elle arrive (comportement inchangé) ;
 * - cartes du 5e tour (D-041) : UNE à la fois, dans l'ordre du serveur (ordre du tour, fuyards
 *   absents), seulement quand plus aucune carte d'un tour précédent n'est présentée, et
 *   `LAST_TRICK_GAP_MS` après que la précédente a été rangée ;
 * - `notYetShown(joueur)` : ses cartes du 5e tour pas encore apparues (dessinées de dos, ou
 *   dans ma main) ;
 * - `presenting` : tant qu'une carte jouée n'est pas rangée, le résultat attend.
 */
export function planPresentation(
  plays: PublicPlay[],
  settled: ReadonlySet<string>,
  revealed: ReadonlySet<string>,
) {
  const unsettled = plays.filter((p) => !settled.has(p.cardId));
  const regular = unsettled.filter((p) => p.trick !== LAST_TRICK_NUMBER);
  const finalQueue = unsettled.filter((p) => p.trick === LAST_TRICK_NUMBER);
  const activeFinal = regular.length === 0 ? finalQueue[0] : undefined;
  const finalAlreadyShown = plays.some(
    (p) => p.trick === LAST_TRICK_NUMBER && settled.has(p.cardId),
  );
  return {
    spotlights: activeFinal ? [...regular, activeFinal] : regular,
    activeFinal,
    finalGap: finalAlreadyShown ? LAST_TRICK_GAP_MS : 0,
    notYetShown: (playerId: string) =>
      finalQueue.filter((p) => p.playerId === playerId && !revealed.has(p.cardId)),
    presenting: unsettled.length > 0,
  };
}
