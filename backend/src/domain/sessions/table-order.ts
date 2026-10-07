/**
 * ORDRE DE LA TABLE — implémentation UNIQUE (D-033, D-034).
 *
 * Le sens officiel du jeu est le sens ANTIHORAIRE. Il est représenté par l'ordre des
 * sièges FIXES croissants : siège 0 → 1 → 2 → 3 → 0. Les sièges ne tournent jamais ; J1
 * (premier joueur d'une partie) n'est que le point de départ du parcours. Toute notion de « joueur suivant »
 * (distribution, ordre de jeu d'un tour, choix de J1 quand le gagnant est parti) passe
 * par ces fonctions ; il n'en existe pas d'autre implémentation.
 */

/**
 * L'ordre circulaire à partir de `start` : rotateFrom([A, B, C, D], C) → [C, D, A, B].
 * `start` doit figurer dans `order`.
 */
export function rotateFrom<T>(order: readonly T[], start: T): T[] {
  const index = order.indexOf(start);
  if (index < 0) {
    throw new Error('rotateFrom : le point de départ ne figure pas dans l’ordre');
  }
  return [...order.slice(index), ...order.slice(0, index)];
}

/**
 * Joueur suivant, dans le sens antihoraire, à partir de `current` (exclu), en passant de
 * J4 à J1. Ne renvoie que des joueurs `eligible` ; undefined si aucun ne l'est.
 */
export function getNextPlayer<T>(
  order: readonly T[],
  current: T,
  eligible: (candidate: T) => boolean = () => true,
): T | undefined {
  const index = order.indexOf(current);
  if (index < 0) {
    throw new Error('getNextPlayer : le joueur courant ne figure pas dans l’ordre');
  }
  for (let step = 1; step <= order.length; step++) {
    const candidate = order[(index + step) % order.length] as T;
    if (candidate !== current && eligible(candidate)) {
      return candidate;
    }
  }
  return undefined;
}

/**
 * Premier siège OCCUPÉ en partant du siège qui suit `fromSeat`, dans le sens antihoraire,
 * en faisant le tour complet de la table : `fromSeat` lui-même est examiné en dernier.
 * Les sièges ne bougent pas ; seul le point de départ de la recherche change.
 */
export function nextOccupiedSeat<T>(
  seatCount: number,
  fromSeat: number,
  occupantOf: (seat: number) => T | undefined,
): T | undefined {
  const seats = Array.from({ length: seatCount }, (_, i) => i);
  const order = rotateFrom(seats, ((fromSeat % seatCount) + seatCount) % seatCount);
  for (const seat of [...order.slice(1), order[0] as number]) {
    const occupant = occupantOf(seat);
    if (occupant !== undefined) {
      return occupant;
    }
  }
  return undefined;
}

/** Contexte de la session pour choisir J1 d'une nouvelle partie. */
export interface FirstPlayerContext<T> {
  creatorId: T;
  /** Nombre de sièges de la table (maxPlayers de la session). */
  seatCount: number;
  /** Joueur PRÉSENT assis à ce siège, undefined si le siège est vacant. */
  occupantOf: (seat: number) => T | undefined;
  isActive: (playerId: T) => boolean;
  /**
   * Dernière partie TERMINÉE de la session avant celle-ci, ou null s'il n'y en a aucune.
   * `winnerId` est absent si elle a été arrêtée sans gagnant ; `winnerSeat` est le siège
   * qu'occupait le gagnant dans cette partie.
   */
  previousGame: { winnerId?: T; winnerSeat?: number; tieFirstPlayerId?: T } | null;
}

export type FirstPlayerDecision<T> =
  | { kind: 'first'; playerId: T }
  /** La dernière partie terminée n'a pas de gagnant : aucune règle ne fixe J1. */
  | { kind: 'undetermined' }
  /** Plus aucun joueur actif : la session doit être fermée. */
  | { kind: 'none' };

/**
 * J1 d'une nouvelle partie (D-033, D-034) :
 * - première partie de la session : le créateur de la session ;
 * - partie suivante : le gagnant de la dernière partie terminée s'il est encore présent ;
 * - sinon : à partir du SIÈGE du gagnant, le premier siège occupé dans le sens antihoraire
 *   (tour complet de la table ; jamais un retour automatique au créateur, jamais un choix
 *   arbitraire). Les sièges ne sont jamais modifiés ;
 * - partie précédente annulée pour égalité de priorité : le MÊME J1 (décision 23) ;
 * - aucun joueur actif : `none`.
 */
export function determineFirstPlayer<T>(ctx: FirstPlayerContext<T>): FirstPlayerDecision<T> {
  if (!ctx.previousGame) {
    return ctx.isActive(ctx.creatorId)
      ? { kind: 'first', playerId: ctx.creatorId }
      : { kind: 'none' };
  }
  const { winnerId, winnerSeat, tieFirstPlayerId } = ctx.previousGame;
  if (tieFirstPlayerId !== undefined) {
    // Reprise après égalité de priorité (décision 23) : le même J1, s'il est présent.
    return ctx.isActive(tieFirstPlayerId)
      ? { kind: 'first', playerId: tieFirstPlayerId }
      : { kind: 'undetermined' };
  }
  if (winnerId === undefined) {
    return { kind: 'undetermined' };
  }
  if (ctx.isActive(winnerId)) {
    return { kind: 'first', playerId: winnerId };
  }
  if (winnerSeat === undefined) {
    return { kind: 'undetermined' };
  }
  const next = nextOccupiedSeat(ctx.seatCount, winnerSeat, ctx.occupantOf);
  return next === undefined ? { kind: 'none' } : { kind: 'first', playerId: next };
}
