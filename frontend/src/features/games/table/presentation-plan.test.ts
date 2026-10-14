/// <reference types="jest" />
import type { PlayerPlayView } from '../../../types/game';
import {
  LAST_TRICK_GAP_MS,
  planPresentation,
  publicPlays,
  settledCardsOf,
  turnHeld,
  type PublicPlay,
} from './presentation-plan';

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

describe('cadre « mes cartes jouées »', () => {
  const view = (overrides: Partial<PlayerPlayView>): PlayerPlayView => ({
    trickNumber: 1,
    dealOrder: ['me', 'j2', 'j3', 'j4'],
    dealSequence: [],
    controllerId: 'me',
    trickOrder: ['me', 'j2', 'j3', 'j4'],
    currentTrick: [],
    completedTricks: [],
    myHand: [],
    handCounts: {},
    stockCount: 0,
    ...overrides,
  });
  const trick = (number: number, ...plays: [string, string][]) => ({
    number,
    controllerId: 'me',
    plays: plays.map(([playerId, cardId]) => ({ playerId, cardId })),
  });
  const all = (plays: PublicPlay[]) => new Set(plays.map((p) => p.cardId));

  it('ma carte confirmée par le serveur y apparaît, celles de J2, J3 et J4 jamais', () => {
    const plays = publicPlays(
      view({
        trickNumber: 2,
        completedTricks: [
          trick(1, ['me', 'COEUR-3'], ['j2', 'COEUR-5'], ['j3', 'COEUR-9'], ['j4', 'PIQUE-7']),
        ],
        currentTrick: [{ playerId: 'j2', cardId: 'ETOILE-4' }],
      }),
    );
    expect(settledCardsOf(plays, 'me', all(plays))).toEqual(['COEUR-3']);
    expect(settledCardsOf(plays, 'j2', all(plays))).toEqual(['COEUR-5', 'ETOILE-4']);
  });

  it('ordre chronologique des tours, sans doublon (5e tour présent dans les deux listes)', () => {
    const plays = publicPlays(
      view({
        trickNumber: 5,
        completedTricks: [
          trick(1, ['me', 'COEUR-3'], ['j2', 'COEUR-5']),
          trick(2, ['j2', 'PIQUE-8'], ['me', 'PIQUE-10']),
          trick(5, ['me', 'ETOILE-5'], ['j2', 'ETOILE-7']),
        ],
        currentTrick: [{ playerId: 'me', cardId: 'ETOILE-5' }],
      }),
    );
    expect(settledCardsOf(plays, 'me', all(plays))).toEqual(['COEUR-3', 'PIQUE-10', 'ETOILE-5']);
  });

  it('relectures successives de l’état : même contenu, jamais de carte dupliquée', () => {
    const state = view({
      trickNumber: 2,
      completedTricks: [trick(1, ['me', 'COEUR-3'], ['j2', 'COEUR-5'])],
      currentTrick: [{ playerId: 'me', cardId: 'PIQUE-8' }],
    });
    const first = publicPlays(state);
    const again = publicPlays(structuredClone(state));
    expect(settledCardsOf(again, 'me', all(first))).toEqual(
      settledCardsOf(first, 'me', all(first)),
    );
    expect(settledCardsOf(again, 'me', all(first))).toEqual(['COEUR-3', 'PIQUE-8']);
  });

  it('carte encore présentée au centre : pas encore dans le cadre', () => {
    const plays = publicPlays(view({ currentTrick: [{ playerId: 'me', cardId: 'COEUR-3' }] }));
    expect(settledCardsOf(plays, 'me', new Set())).toEqual([]);
  });

  it('nouvelle partie (aucune carte jouée) : cadre vide, rien de la partie précédente', () => {
    const fresh = publicPlays(view({ myHand: ['COEUR-3', 'PIQUE-8'] }));
    expect(settledCardsOf(fresh, 'me', new Set(['COEUR-3', 'PIQUE-10']))).toEqual([]);
  });
});

describe('barres de progression et roulette suspendues', () => {
  const base = {
    rejected: false,
    myHand: ['COEUR-3', 'PIQUE-8'],
    plays: [] as PublicPlay[],
    settled: new Set<string>(),
    completedTricks: new Set<number>(),
  };

  it('aucune carte en jeu, rien à ranger : barres et roulette actives', () => {
    expect(turnHeld(base)).toBe(false);
  });

  it('ma carte vient d’être lâchée : arrêt immédiat, avant même la réponse du serveur', () => {
    expect(turnHeld({ ...base, pendingCardId: 'COEUR-3' })).toBe(true);
    expect(turnHeld({ ...base, droppedCardId: 'COEUR-3' })).toBe(true);
  });

  it('coup refusé par le serveur : le tour reprend', () => {
    expect(turnHeld({ ...base, droppedCardId: 'COEUR-3', rejected: true })).toBe(false);
  });

  it('coup accepté (la carte a quitté ma main) : plus rien de suspendu de ce fait', () => {
    expect(turnHeld({ ...base, droppedCardId: 'COEUR-3', myHand: ['PIQUE-8'] })).toBe(false);
  });

  it('tour terminé, cartes pas encore rangées dans leurs zones : suspendu jusqu’au rangement', () => {
    const plays = [card('a', 'COEUR-3', 1), card('b', 'COEUR-5', 1)];
    const completedTricks = new Set([1]);
    expect(turnHeld({ ...base, plays, completedTricks })).toBe(true);
    expect(turnHeld({ ...base, plays, completedTricks, settled: new Set(['COEUR-3']) })).toBe(true);
    expect(
      turnHeld({ ...base, plays, completedTricks, settled: new Set(['COEUR-3', 'COEUR-5']) }),
    ).toBe(false);
  });

  it('tour EN COURS : ses cartes restent au centre sans bloquer le joueur suivant', () => {
    const plays = [card('a', 'COEUR-3', 2)];
    expect(turnHeld({ ...base, plays, completedTricks: new Set([1]) })).toBe(false);
  });
});