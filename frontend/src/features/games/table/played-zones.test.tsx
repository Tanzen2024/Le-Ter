/// <reference types="jest" />
import { cleanup, render, screen } from '@testing-library/react-native';

import type { GameView, PlayerPlayView } from '../../../types/game';
import { computeLobbyMetrics } from '../../lobby/lobby-metrics';
import { publicPlays } from './presentation-plan';
import {
  playedRowIn,
  playedZoneRect,
  playedZones,
  PlayedCardsZone,
  publicRowBox,
  seatZones,
} from './TableCards';
import { computeGameTableLayout, MAX_HAND_CARDS, type SeatSide } from './table-layout';

/**
 * Zones des cartes jouées (référence annotée, zones 1 à 4) : une par siège OCCUPÉ, avec les
 * seules cartes de son occupant, publiques pour tous les joueurs de la partie.
 */

afterEach(cleanup);

const m = computeLobbyMetrics({
  width: 897,
  height: 393,
  safe: { top: 0, bottom: 0, left: 36, right: 0 },
});

const player = (playerId: string, seat: number) => ({
  playerId,
  seat,
  tablePosition: seat,
  joinedAt: '2026-10-14T10:00:00.000Z',
  username: playerId.toUpperCase(),
});

const trick = (number: number, ...plays: [string, string][]) => ({
  number,
  controllerId: plays[0]![0],
  plays: plays.map(([playerId, cardId]) => ({ playerId, cardId })),
});

function view(
  viewerId: string,
  seated: string[],
  play: Partial<PlayerPlayView> = {},
  overrides: Partial<GameView> = {},
): GameView {
  return {
    gameId: 'g-1',
    firstPlayerId: seated[0]!,
    version: 7,
    status: 'in_progress',
    creatorId: seated[0]!,
    maxPlayers: 4,
    players: seated.map((id, seat) => player(id, seat)),
    play: {
      trickNumber: 1,
      dealOrder: seated,
      dealSequence: [],
      controllerId: seated[0]!,
      trickOrder: seated,
      currentTrick: [],
      completedTricks: [],
      // Ma main seulement : celle des autres ne quitte jamais le serveur.
      myHand: [],
      handCounts: Object.fromEntries(seated.map((id) => [id, 5])),
      stockCount: 0,
      ...play,
    },
    myActions: {
      canPlayCard: false,
      playableCardIds: [],
      canFlee: false,
      canDeclareInstantWin: false,
    },
    viewerId,
    createdAt: '2026-10-14T10:00:00.000Z',
    ...overrides,
  };
}

/** Zones telles que les voit `game.viewerId`, toutes les cartes publiques déjà rangées. */
function zonesOf(game: GameView) {
  const L = computeGameTableLayout(m, { topSeat: game.maxPlayers !== 3 });
  const plays = publicPlays(game.play);
  return playedZones(game, plays, new Set(plays.map((p) => p.cardId)), L, m);
}
const bySide = (zones: ReturnType<typeof zonesOf>) =>
  Object.fromEntries(zones.map((z) => [z.side, z])) as Record<SeatSide, (typeof zones)[number]>;

const FOUR = ['j1', 'j2', 'j3', 'j4'];
const played: Partial<PlayerPlayView> = {
  trickNumber: 3,
  completedTricks: [
    trick(1, ['j1', 'COEUR-3'], ['j2', 'COEUR-5'], ['j3', 'COEUR-9'], ['j4', 'PIQUE-7']),
    trick(2, ['j3', 'TREFLE-8'], ['j4', 'TREFLE-10'], ['j1', 'TREFLE-4'], ['j2', 'ETOILE-6']),
  ],
  currentTrick: [{ playerId: 'j2', cardId: 'PIQUE-9' }],
};

describe('zones des cartes jouées', () => {
  it('4 joueurs : 4 zones, chacune avec les seules cartes de son occupant, dans l’ordre', () => {
    const zones = bySide(zonesOf(view('j1', FOUR, played)));
    // Sens antihoraire (D-033) : moi en bas, puis droite, haut, gauche.
    expect(zones.bottom.playerId).toBe('j1');
    expect(zones.right.playerId).toBe('j2');
    expect(zones.top.playerId).toBe('j3');
    expect(zones.left.playerId).toBe('j4');
    expect(zones.bottom.cardIds).toEqual(['COEUR-3', 'TREFLE-4']);
    expect(zones.right.cardIds).toEqual(['COEUR-5', 'ETOILE-6', 'PIQUE-9']);
    expect(zones.top.cardIds).toEqual(['COEUR-9', 'TREFLE-8']);
    expect(zones.left.cardIds).toEqual(['PIQUE-7', 'TREFLE-10']);
  });

  it('chaque joueur voit les mêmes cartes jouées par chacun, depuis son propre siège', () => {
    const fromJ1 = zonesOf(view('j1', FOUR, played));
    const fromJ3 = zonesOf(view('j3', FOUR, played));
    const cardsOf = (zones: typeof fromJ1) =>
      Object.fromEntries(zones.map((z) => [z.playerId, z.cardIds]));
    expect(cardsOf(fromJ3)).toEqual(cardsOf(fromJ1));
    // Perspective : chacun se voit en bas.
    expect(bySide(fromJ3).bottom.playerId).toBe('j3');
    expect(bySide(fromJ3).top.playerId).toBe('j1');
  });

  it('siège occupé sans carte jouée : la zone reste là, vide', () => {
    const zones = zonesOf(view('j1', FOUR));
    expect(zones).toHaveLength(4);
    expect(zones.every((z) => z.cardIds.length === 0)).toBe(true);
  });

  it('sièges vides : aucune zone (2 joueurs sur 4 places, 3 sur 3)', () => {
    const two = zonesOf(view('j1', ['j1', 'j2'], {}, { status: 'waiting', play: undefined }));
    expect(two.map((z) => z.side).sort()).toEqual(['bottom', 'right']);
    const three = zonesOf(view('j1', ['j1', 'j2', 'j3'], {}, { maxPlayers: 3 }));
    expect(three.map((z) => z.side).sort()).toEqual(['bottom', 'left', 'right']);
  });

  it('départ d’un joueur : sa zone disparaît ; nouveau siège : sa zone le suit', () => {
    const before = view('j1', FOUR, {}, { status: 'waiting', play: undefined });
    const left = { ...before, players: before.players.filter((p) => p.playerId !== 'j3') };
    expect(zonesOf(left).map((z) => z.playerId).sort()).toEqual(['j1', 'j2', 'j4']);
    const moved = {
      ...left,
      players: left.players.map((p) => (p.playerId === 'j4' ? { ...p, tablePosition: 2 } : p)),
    };
    expect(bySide(zonesOf(moved)).top.playerId).toBe('j4');
    expect(bySide(zonesOf(moved)).left).toBeUndefined();
  });

  it('fuyard : il garde son siège, sa zone et ses cartes jouées restent publiques', () => {
    const game = view('j1', FOUR, played);
    const fled = {
      ...game,
      players: game.players.map((p) => (p.playerId === 'j4' ? { ...p, fledAt: game.createdAt } : p)),
    };
    expect(bySide(zonesOf(fled)).left.cardIds).toEqual(['PIQUE-7', 'TREFLE-10']);
  });

  it('relectures et événements répétés : jamais de carte dupliquée', () => {
    // Le 5e tour peut figurer dans les deux listes (états anciens) : une seule fois.
    const state = view('j1', ['j1', 'j2'], {
      trickNumber: 5,
      completedTricks: [trick(5, ['j1', 'ETOILE-5'], ['j2', 'ETOILE-7'])],
      currentTrick: [{ playerId: 'j1', cardId: 'ETOILE-5' }],
    });
    const once = zonesOf(state);
    const again = zonesOf(structuredClone(state));
    expect(again).toEqual(once);
    expect(bySide(once).bottom.cardIds).toEqual(['ETOILE-5']);
  });

  it('nouvelle partie (nouveau gameId) : zones vides, rien de la précédente', () => {
    const next = view('j1', FOUR, {}, { gameId: 'g-2' });
    expect(zonesOf(next).flatMap((z) => z.cardIds)).toEqual([]);
  });

  it('cartes encore en main : jamais dans une zone (seules les cartes jouées y figurent)', () => {
    const game = view('j1', FOUR, { ...played, myHand: ['PIQUE-10', 'ETOILE-3'] });
    expect(zonesOf(game).flatMap((z) => z.cardIds)).not.toEqual(
      expect.arrayContaining(['PIQUE-10']),
    );
    expect(zonesOf(game).flatMap((z) => z.cardIds)).not.toContain('ETOILE-3');
  });

  it('cadre ajusté aux 5 cartes dessinées (même marge partout), un peu moins large que la place réservée', () => {
    const L = computeGameTableLayout(m, { topSeat: true });
    for (const side of ['bottom', 'right', 'top', 'left'] as const) {
      const reserved = seatZones(side, L, m).publicRow;
      const frame = playedZoneRect(reserved);
      const inner = publicRowBox(playedRowIn(reserved), MAX_HAND_CARDS);
      const place = publicRowBox(reserved, MAX_HAND_CARDS);
      // Légèrement moins large, même hauteur, dans la place réservée (aucun débordement).
      expect(frame.width).toBeLessThan(place.width);
      expect(frame.width).toBeGreaterThan(place.width * 0.85);
      expect(frame.height).toBeCloseTo(place.height);
      expect(frame.top).toBe(place.top);
      expect(frame.left).toBeGreaterThanOrEqual(place.left - 1e-9);
      expect(frame.left + frame.width).toBeLessThanOrEqual(place.left + place.width + 1e-9);
      // Collé au bord côté table : à gauche, ou à droite pour une rangée inversée.
      if (reserved.reverse) {
        expect(frame.left + frame.width).toBeCloseTo(place.left + place.width);
      } else {
        expect(frame.left).toBeCloseTo(place.left);
      }
      // Même marge à gauche, à droite, en haut et en bas des cartes dessinées.
      const pad = inner.top - frame.top;
      expect(inner.left - frame.left).toBeCloseTo(pad);
      expect(frame.left + frame.width - (inner.left + inner.width)).toBeCloseTo(pad);
      expect(frame.top + frame.height - (inner.top + inner.height)).toBeCloseTo(pad);
      expect(inner.left).toBeGreaterThan(frame.left);
      expect(inner.top).toBeGreaterThan(frame.top);
      expect(inner.left + inner.width).toBeLessThan(frame.left + frame.width);
      expect(inner.top + inner.height).toBeLessThan(frame.top + frame.height);
      // Plus petites que les cartes de la main, plus grandes qu'un dos d'adversaire.
      expect(playedRowIn(reserved).cardWidth).toBeLessThan(L.cardWidth);
      expect(playedRowIn(reserved).cardWidth).toBeGreaterThan(L.smallCard);
    }
  });
});

describe('affichage d’une zone', () => {
  const zone = () => bySide(zonesOf(view('j1', FOUR, played))).right;

  it('cadre et vraies cartes (valeur, famille), dans l’ordre, sans numéro de zone', async () => {
    await render(<PlayedCardsZone zone={zone()} label="J2" />);
    expect(screen.getByTestId('played-zone')).toBeTruthy();
    expect(screen.getByLabelText('Cartes jouées par J2 : 3')).toBeTruthy();
    expect(screen.getAllByTestId('card-face', { includeHiddenElements: true })).toHaveLength(3);
    // Vraies valeurs des cartes de J2 (COEUR-5, ETOILE-6, PIQUE-9).
    for (const value of ['5', '6', '9']) {
      expect(screen.queryAllByText(value, { includeHiddenElements: true }).length).toBeGreaterThan(0);
    }
    // Le cadre lui-même n'écrit rien : aucune annotation de la capture (1 à 5).
    expect(screen.getByTestId('played-zone').children).toHaveLength(0);
  });

  it('zone vide : le cadre seul, aucune carte', async () => {
    await render(<PlayedCardsZone zone={{ ...zone(), cardIds: [] }} label="J2" />);
    expect(screen.getByTestId('played-zone')).toBeTruthy();
    expect(screen.queryAllByTestId('card-face', { includeHiddenElements: true })).toHaveLength(0);
  });

  it('empilement : cartes décalées régulièrement, chacune identifiable', async () => {
    await render(<PlayedCardsZone zone={zone()} label="J2" />);
    const faces = screen.getAllByTestId('card-face', { includeHiddenElements: true });
    const lefts = faces.map((f) => Object.assign({}, ...[f.props.style].flat(3)).left as number);
    const steps = lefts.slice(1).map((l, i) => l - lefts[i]!);
    // Décalage visible (au moins 62 % de la largeur), chevauchement partiel (moins d'une carte).
    const width = zone().row.cardWidth;
    for (const step of steps) {
      expect(Math.abs(step)).toBeGreaterThanOrEqual(width * 0.62 - 0.01);
      expect(Math.abs(step)).toBeLessThan(width);
    }
  });
});
