import { SUITS, cardFromId, type Card, type CardId } from '../cards/card';
import type { TrickPlay } from './game';
import type { GameId, PlayerId } from './game-id';

/**
 * Ce que la stratégie de coup automatique peut voir : uniquement ce que le joueur
 * concerné voit lui-même (sa main et l'état public). Jamais les mains des autres.
 */
export interface AutomaticCardSelectionContext {
  gameId: GameId;
  playerId: PlayerId;
  /** Main du joueur dont le tour a expiré. */
  hand: readonly CardId[];
  trickNumber: number;
  /** Cartes déjà jouées dans le tour en cours (publiques). */
  currentTrick: readonly TrickPlay[];
  controllerId: PlayerId;
  /**
   * Carte d'OUVERTURE du tour en cours : la première carte posée, lue dans l'état serveur
   * (`play.currentTrick[0]`). C'est sa famille qui s'impose (décision 46). Absente si le
   * joueur expiré ouvre lui-même le tour.
   */
  leadCardId?: CardId;
  /** Carte qui détient le contrôle à cet instant du tour (peut différer de `leadCardId`). */
  controlCardId?: CardId;
}

/**
 * Choix de la carte jouée à la place d'un joueur après TURN_TIMEOUT (D-034, D-036).
 *
 * Contrat : renvoyer l'identifiant d'une carte de `context.hand`. La carte choisie est
 * ensuite jouée par GameService exactement comme un coup manuel (mêmes règles, même
 * transaction, mêmes événements) ; une carte refusée par les règles n'est pas jouée.
 */
export interface AutomaticCardSelectionStrategy {
  selectCard(context: AutomaticCardSelectionContext): CardId;
}

/**
 * Règle OFFICIELLE (D-036) : appliquée UNIQUEMENT après TURN_TIMEOUT (tours 1 à 4). En jeu
 * normal le joueur choisit lui-même sa carte (glisser-déposer) ; au 5e tour la carte unique
 * est jouée par le moteur, sans stratégie.
 *
 * - Joueur qui OUVRE le tour (premier à jouer, à chaque tour 1 à 4) : aucune famille
 *   imposée → plus petite carte de sa main.
 * - Joueur suivant qui possède la famille de la carte d'ouverture (`leadCardId`) : plus
 *   petite carte de cette famille. Famille = celle de la carte d'ouverture, jamais
 *   recalculée d'après une prise de contrôle en cours de tour.
 * - Joueur suivant sans cette famille : plus petite valeur numérique de toute la main.
 *
 * Déterministe : aucun hasard, indépendant de l'ordre de la main.
 */
export class LowestCardAutomaticSelectionStrategy implements AutomaticCardSelectionStrategy {
  selectCard(context: AutomaticCardSelectionContext): CardId {
    const hand = context.hand.map(cardFromId);
    const lead = context.leadCardId && cardFromId(context.leadCardId);
    const sameFamily = lead ? hand.filter((card) => card.suit === lead.suit) : [];
    const selected = lowest(sameFamily.length > 0 ? sameFamily : hand);
    if (!selected) {
      throw new Error(`Coup automatique impossible : main vide (partie ${context.gameId})`);
    }
    return selected.id;
  }
}

/**
 * ⚠ DÉPARTAGE TECHNIQUE PROVISOIRE — NON VALIDÉ PAR LE MÉTIER (docs/TODO.md R-06).
 *
 * Une égalité de valeur n'existe qu'entre familles différentes (une famille n'a qu'une
 * carte par valeur), donc seulement pour l'ouvreur ou pour un joueur sans la famille
 * d'ouverture (ex. 3♣ et 3⭐). Aucune règle validée ne la départage. Le serveur devant
 * rester déterministe, on retient en attendant l'ordre de déclaration des familles dans
 * `SUITS` (♥, ♠, ♣, ⭐). Ce n'est PAS une hiérarchie des familles du Ter.
 */
const PROVISIONAL_TIE_BREAK_ORDER = SUITS;

function lowest(cards: readonly Card[]): Card | undefined {
  return [...cards].sort(
    (a, b) =>
      a.value - b.value ||
      PROVISIONAL_TIE_BREAK_ORDER.indexOf(a.suit) - PROVISIONAL_TIE_BREAK_ORDER.indexOf(b.suit),
  )[0];
}
