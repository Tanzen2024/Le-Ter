/// <reference types="jest" />
import { LAST_TRICK_GAP_MS, planPresentation, type PublicPlay } from './presentation-plan';

/** Cartes d'un tour : restent sur la table jusqu'à la dernière, puis partent ensemble. */

const card = (playerId: string, cardId: string, trick: number): PublicPlay => ({
  playerId,
  cardId,
  trick,
});
const none = new Set<string>();

describe('cartes d’un tour sur la table', () => {
  it('tour en cours : toutes les cartes déjà jouées restent sur la table (aucune ne part)', () => {
    const plays = [card('a', 'COEUR-3', 2), card('b', 'COEUR-5', 2)];
    const plan = planPresentation(plays, none, none, new Set([1]));
    expect(plan.spotlights.map((s) => s.play.cardId)).toEqual(['COEUR-3', 'COEUR-5']);
    expect(plan.spotlights.every((s) => !s.release && s.delayMs === 0)).toBe(true);
    expect(plan.presenting).toBe(true);
  });

  it('dernière carte jouée (tour complet) : toutes les cartes du tour partent ensemble', () => {
    const plays = [card('a', 'COEUR-3', 2), card('b', 'COEUR-5', 2), card('c', 'COEUR-9', 2)];
    const plan = planPresentation(plays, none, none, new Set([1, 2]));
    expect(plan.spotlights.map((s) => s.release)).toEqual([true, true, true]);
  });

  it('cartes déjà rangées : plus présentées', () => {
    const plays = [card('a', 'COEUR-3', 1), card('b', 'COEUR-5', 1)];
    const plan = planPresentation(plays, new Set(['COEUR-3', 'COEUR-5']), none, new Set([1]));
    expect(plan.spotlights).toEqual([]);
    expect(plan.presenting).toBe(false);
  });
});

describe('5e tour (automatique) : une carte à la fois, toutes rangées ensemble à la fin', () => {
  const finals = [card('a', 'PIQUE-3', 5), card('b', 'PIQUE-4', 5), card('c', 'PIQUE-5', 5)];
  const done = new Set([1, 2, 3, 4, 5]);

  it('attend que le 4e tour soit rangé, puis montre la 1re carte sans attente', () => {
    const waiting = planPresentation([card('a', 'COEUR-3', 4), ...finals], none, none, done);
    expect(waiting.spotlights.map((s) => s.play.cardId)).toEqual(['COEUR-3']);
    const plan = planPresentation(finals, none, none, done);
    expect(plan.spotlights).toEqual([{ play: finals[0], delayMs: 0, release: false }]);
  });

  it('les cartes apparues restent ; la suivante vient après la pause', () => {
    const plan = planPresentation(finals, none, new Set(['PIQUE-3']), done);
    expect(plan.spotlights).toEqual([
      { play: finals[0], delayMs: 0, release: false },
      { play: finals[1], delayMs: LAST_TRICK_GAP_MS, release: false },
    ]);
  });

  it('dernière carte : toutes partent ensemble, 2 s après elle', () => {
    const before = planPresentation(finals, none, new Set(['PIQUE-3', 'PIQUE-4']), done);
    expect(before.spotlights.map((s) => s.release)).toEqual([false, false, true]);
    const all = planPresentation(finals, none, new Set(['PIQUE-3', 'PIQUE-4', 'PIQUE-5']), done);
    expect(all.spotlights.map((s) => s.release)).toEqual([true, true, true]);
  });
});
