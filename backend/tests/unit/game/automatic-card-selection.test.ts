import { createDeck } from '../../../src/domain/cards/deck';
import { cardFromId, type CardId } from '../../../src/domain/cards/card';
import {
  LowestCardAutomaticSelectionStrategy,
  type AutomaticCardSelectionContext,
} from '../../../src/domain/game/automatic-card-selection';
import { toPlayerId, type GameId } from '../../../src/domain/game/game-id';
import {
  mustFollowLeadColorWhenPossible,
  sameSuit,
} from '../../../src/domain/rules/official-rules';

/**
 * Coup automatique après TURN_TIMEOUT (D-036) : plus petite carte de la famille du
 * contrôle si le joueur en possède, sinon plus petite carte de toute la main.
 */
const strategy = new LowestCardAutomaticSelectionStrategy();
const leader = toPlayerId('leader');
const player = toPlayerId('player');

function select(hand: CardId[], leadCardId?: CardId, controlCardId?: CardId): CardId {
  const context: AutomaticCardSelectionContext = {
    gameId: 'game-1' as GameId,
    playerId: player,
    hand,
    trickNumber: 2,
    currentTrick: leadCardId ? [{ playerId: leader, cardId: leadCardId }] : [],
    controllerId: leader,
    ...(leadCardId && { leadCardId }),
    ...((controlCardId ?? leadCardId) && { controlCardId: controlCardId ?? leadCardId }),
  };
  return strategy.selectCard(context);
}

describe('LowestCardAutomaticSelectionStrategy', () => {
  it('1. contrôle 5♠, main 7♠ 9♠ 4♥ 6♣ → 7♠ (famille obligatoire)', () => {
    expect(select(['PIQUE-7', 'PIQUE-9', 'COEUR-4', 'TREFLE-6'], 'PIQUE-5')).toBe('PIQUE-7');
  });

  it('2. contrôle 5♠, main 9♠ 7♠ 8♠ → 7♠ (pas la première carte rencontrée)', () => {
    expect(select(['PIQUE-9', 'PIQUE-7', 'PIQUE-8'], 'PIQUE-5')).toBe('PIQUE-7');
  });

  it('3. contrôle 5♠, aucune ♠ : main 8♥ 3♣ 6⭐ 9♥ 7♣ → 3♣', () => {
    expect(select(['COEUR-8', 'TREFLE-3', 'ETOILE-6', 'COEUR-9', 'TREFLE-7'], 'PIQUE-5')).toBe(
      'TREFLE-3',
    );
  });

  it('4. contrôle 5♠, main 3♥ 7♠ 4♠ → 4♠ (le 3♥, plus petit, est interdit)', () => {
    // La spec cite un 2♥ ; le paquet du Ter commence à 3 (spec §2.1) : 3♥ joue ce rôle.
    expect(select(['COEUR-3', 'PIQUE-7', 'PIQUE-4'], 'PIQUE-5')).toBe('PIQUE-4');
  });

  it('5. contrôle 5♠, main 7♠ → 7♠', () => {
    expect(select(['PIQUE-7'], 'PIQUE-5')).toBe('PIQUE-7');
  });

  it('6. aucune carte de la famille du contrôle → minimum numérique global', () => {
    expect(select(['ETOILE-10', 'COEUR-9', 'ETOILE-4', 'TREFLE-5'], 'PIQUE-8')).toBe('ETOILE-4');
    expect(select(['PIQUE-6', 'ETOILE-8', 'COEUR-5'], 'TREFLE-3')).toBe('COEUR-5');
  });

  it('7. déterministe : même résultat à chaque exécution et quel que soit l’ordre de la main', () => {
    const hand: CardId[] = ['COEUR-8', 'TREFLE-3', 'ETOILE-6', 'COEUR-9', 'TREFLE-7'];
    const results = new Set<CardId>();
    for (let i = 0; i < 50; i++) {
      results.add(select(hand, 'PIQUE-5'));
      results.add(select([...hand].reverse(), 'PIQUE-5'));
      results.add(select([...hand.slice(i % 5), ...hand.slice(0, i % 5)], 'PIQUE-5'));
    }
    expect([...results]).toEqual(['TREFLE-3']);
  });

  it('la famille vient du contrôle du DÉBUT du tour, pas d’une prise de contrôle en cours', () => {
    // Meneur : 5♠ ; un joueur a pris le contrôle avec 8♠. La famille reste ♠ (inchangé ici),
    // mais la référence est bien la carte du meneur, jamais recalculée.
    expect(select(['PIQUE-9', 'PIQUE-6', 'COEUR-3'], 'PIQUE-5', 'PIQUE-8')).toBe('PIQUE-6');
  });

  it('le joueur qui ouvre le tour (aucune famille imposée) joue sa plus petite carte', () => {
    expect(select(['PIQUE-9', 'ETOILE-4', 'COEUR-7'])).toBe('ETOILE-4');
  });

  it('égalité de valeur entre familles : départage TECHNIQUE PROVISOIRE (ordre de SUITS), non validé — R-06', () => {
    // Aucune règle métier ne départage 3♣ / 3⭐ : ce test fige seulement le comportement
    // provisoire actuel (déterministe, indépendant de l'ordre de la main), à confirmer.
    expect(select(['ETOILE-3', 'TREFLE-3', 'PIQUE-3'], 'COEUR-9')).toBe('PIQUE-3');
    expect(select(['PIQUE-3', 'TREFLE-3', 'ETOILE-3'], 'COEUR-9')).toBe('PIQUE-3');
    expect(select(['ETOILE-3', 'TREFLE-3'])).toBe('TREFLE-3');
  });

  it('la carte choisie est TOUJOURS jouable selon les règles officielles (500 mains)', () => {
    const deck = createDeck().map(cardFromId);
    let seed = 42;
    const next = () => {
      seed = (seed * 1103515245 + 12345) % 2 ** 31;
      return seed;
    };
    for (let run = 0; run < 500; run++) {
      const pool = [...deck];
      const draw = () => pool.splice(next() % pool.length, 1)[0]!;
      const lead = draw();
      const hand = Array.from({ length: 1 + (next() % 5) }, draw);
      const ids = hand.map((c) => c.id);

      const chosen = cardFromId(select(ids, lead.id));
      expect(ids).toContain(chosen.id);
      expect(
        mustFollowLeadColorWhenPossible({
          card: chosen,
          hand,
          leadCard: lead,
          sameColor: sameSuit,
        }),
      ).toBe(true);
      const candidates = hand.some((c) => c.suit === lead.suit)
        ? hand.filter((c) => c.suit === lead.suit)
        : hand;
      expect(chosen.value).toBe(Math.min(...candidates.map((c) => c.value)));
    }
  });
});

describe('D-036 — scénarios de référence du propriétaire (timeout uniquement)', () => {
  it('TEST 1 — ouvreur du tour : main 8♥ 3♣ 7♠ 5⭐ 9♥ → 3♣ (plus petite carte de la main)', () => {
    expect(select(['COEUR-8', 'TREFLE-3', 'PIQUE-7', 'ETOILE-5', 'COEUR-9'])).toBe('TREFLE-3');
  });

  it('TEST 1 bis — l’ouvreur est le premier joueur de CHAQUE tour 1 à 4, pas seulement J1', () => {
    for (const trickNumber of [1, 2, 3, 4]) {
      const context: AutomaticCardSelectionContext = {
        gameId: 'game-1' as GameId,
        playerId: player,
        hand: ['COEUR-8', 'TREFLE-3', 'PIQUE-7', 'ETOILE-5', 'COEUR-9'],
        trickNumber,
        currentTrick: [],
        controllerId: player,
      };
      expect(strategy.selectCard(context)).toBe('TREFLE-3');
    }
  });

  it('TEST 2 — ouverture 5♥, main 9♥ 7♠ 4♣ 3⭐ → 9♥ (famille obligatoire, même si plus grande)', () => {
    expect(select(['COEUR-9', 'PIQUE-7', 'TREFLE-4', 'ETOILE-3'], 'COEUR-5')).toBe('COEUR-9');
  });

  it('TEST 3 — ouverture 5♠, main 9♠ 7♠ 4♥ 3♣ → 7♠ (plus petite de la famille)', () => {
    expect(select(['PIQUE-9', 'PIQUE-7', 'COEUR-4', 'TREFLE-3'], 'PIQUE-5')).toBe('PIQUE-7');
  });

  it('TEST 4 — ouverture 5♥, main 8♣ 3♣ 7♠ 9⭐ (aucune ♥) → 3♣ (plus petite de la main)', () => {
    expect(select(['TREFLE-8', 'TREFLE-3', 'PIQUE-7', 'ETOILE-9'], 'COEUR-5')).toBe('TREFLE-3');
  });

  it('égalité 3♣ / 3⭐ sans ♥ : la carte est bien de valeur minimale (le choix entre elles est provisoire)', () => {
    const chosen = cardFromId(select(['TREFLE-3', 'ETOILE-3', 'PIQUE-7', 'TREFLE-8'], 'COEUR-5'));
    expect(chosen.value).toBe(3);
    expect(['TREFLE-3', 'ETOILE-3']).toContain(chosen.id);
  });
});
