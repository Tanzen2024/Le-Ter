/// <reference types="jest" />
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen } from '@testing-library/react-native';

import type { GameView } from '../../../types/game';
import { computeLobbyMetrics } from '../../lobby/lobby-metrics';
import { cardLabel } from '../format';
import { CardFace } from '../table/Cards';
import { computeGameTableLayout } from '../table/table-layout';
import { dialVisibleFor, seatTurnFor, turnPhaseOf } from '../table/turn-phase';
import { GaramPlayArea, garamTurnMessage } from './GaramPlayArea';

/**
 * GARAM TIA (D-119) : le modèle de carte du Ter affiche les cartes du paquet de 35 (♦, As = 11
 * affiché « A ») ; la consigne du tour suit la phase décidée par le serveur.
 */
afterEach(cleanup);

const base = (garam: Partial<NonNullable<GameView['garam']>>, active = 'me'): GameView => ({
  gameId: 'g',
  gameType: 'GARAM',
  firstPlayerId: 'me',
  version: 1,
  status: 'in_progress',
  creatorId: 'me',
  maxPlayers: 2,
  players: [
    { playerId: 'me', seat: 0, joinedAt: '', username: 'Moi' },
    { playerId: 'b', seat: 1, joinedAt: '', username: 'Bob' },
  ],
  createdAt: '',
  activePlayerId: active,
  myActions: { canPlayCard: true, playableCardIds: [], canFlee: false, canDeclareInstantWin: false },
  viewerId: 'me',
  garam: {
    phase: 'FIRST_ROUND',
    dealerId: 'me',
    order: ['me', 'b'],
    dealSequence: [],
    terre: [],
    firstCards: [],
    drawOrder: [],
    drawn: {},
    drawDone: [],
    myHand: [],
    handCounts: {},
    canDraw: false,
    ...garam,
  },
});

describe('cartes GARAM TIA sur le modèle existant', () => {
  it('As de carreau : « A » et ♦ rouge ; libellé accessible « A ♦ »', async () => {
    await render(<CardFace cardId="CARREAU-11" width={60} />);
    expect(screen.getAllByText('A', { includeHiddenElements: true }).length).toBeGreaterThan(0);
    expect(screen.getAllByText('♦', { includeHiddenElements: true }).length).toBeGreaterThan(0);
    expect(cardLabel('CARREAU-11')).toBe('A ♦');
    expect(cardLabel('COEUR-7')).toBe('7 ♥');
  });
});

describe('consigne du tour (état du serveur)', () => {
  it('dégagement, premier tour, tirage automatique (D-136)', () => {
    expect(garamTurnMessage(base({}))).toBe('Dégagez : déposez une carte au centre');
    expect(
      garamTurnMessage(base({ firstCards: [{ playerId: 'b', cardId: 'COEUR-3' }] })),
    ).toBe('Déposez une carte (même signe si vous en avez)');
    expect(garamTurnMessage(base({ phase: 'DRAW' }, 'b'))).toBe('Bob tire au terre');
    // Tirage : le serveur tire pour moi, aucune consigne d'action (ni « Tirez », ni « Temps écoulé »).
    expect(garamTurnMessage(base({ phase: 'DRAW' }))).toBe('Tirage automatique…');
    expect(
      garamTurnMessage({ ...base({ phase: 'DRAW' }), turnTimedOutAt: '2026-10-20T10:00:01.000Z' }),
    ).toBe('Tirage automatique…');
  });
});

describe('chrono (D-143) : 25 s affichées pour GARAM, Le Ter inchangé', () => {
  const timed = (gameType: 'GARAM' | undefined, durationMs: number): GameView => ({
    ...base({}),
    ...(gameType ? { gameType } : { gameType: undefined, garam: undefined, play: {} as never }),
    turnStartedAt: '2026-10-20T10:00:00.000Z',
    turnDeadlineAt: new Date(Date.parse('2026-10-20T10:00:00.000Z') + durationMs).toISOString(),
  });

  it('GARAM : 25 s affichées sur les 28 s du serveur ; Le Ter : 10 s sur 13 s (D-098)', () => {
    const garam = turnPhaseOf(timed('GARAM', 28_000), { dealing: false, offsetMs: 0 });
    expect(garam?.totalMs).toBe(25_000);
    expect(garam?.localDeadline).toBe(Date.parse('2026-10-20T10:00:25.000Z'));
    const ter = turnPhaseOf(timed(undefined, 13_000), { dealing: false, offsetMs: 0 });
    expect(ter?.totalMs).toBe(10_000);
  });

  it('chiffres pour le joueur attendu seulement ; barre dans la plaque des adversaires', () => {
    const mine = turnPhaseOf(timed('GARAM', 18_000), { dealing: false, offsetMs: 0 });
    expect(dialVisibleFor(mine, 'me')).toBe(true);
    expect(seatTurnFor(mine, 'me', 'me')).toBeNull(); // jamais de barre sur ma propre plaque
    const theirs = turnPhaseOf(
      { ...timed('GARAM', 18_000), activePlayerId: 'b' },
      { dealing: false, offsetMs: 0 },
    );
    expect(dialVisibleFor(theirs, 'me')).toBe(false); // je ne vois pas ses secondes
    expect(seatTurnFor(theirs, 'b', 'me')).toBe(theirs); // je vois sa barre
  });

  it('aucun chrono pendant la distribution (mains ou terre) ni avant la confirmation du serveur', () => {
    const game = timed('GARAM', 18_000);
    expect(turnPhaseOf(game, { dealing: true, offsetMs: 0 })).toBeNull();
    expect(
      turnPhaseOf({ ...game, dealEndsAt: '2026-10-20T10:00:00.000Z' }, { dealing: false, offsetMs: 0 }),
    ).toBeNull();
  });
});

describe('table GARAM rendue : chrono numérique et barre (D-127)', () => {
  // Horloge figée : le compte à rebours ne dépend pas de la vitesse de la machine de test.
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());
  const layout = computeGameTableLayout(
    computeLobbyMetrics({ width: 800, height: 360, safe: { top: 6, bottom: 6, left: 12, right: 12 } }),
  );
  const running = (active: string): GameView => {
    const now = Date.now();
    return {
      ...base({ myHand: ['COEUR-3', 'TREFLE-4', 'PIQUE-5'], handCounts: { me: 3, b: 3 } }, active),
      garamVariant: 17,
      turnStartedAt: new Date(now).toISOString(),
      turnDeadlineAt: new Date(now + 18_000).toISOString(),
      serverNow: new Date(now).toISOString(),
    };
  };
  const show = (game: GameView) =>
    render(
      <QueryClientProvider client={new QueryClient()}>
        <GaramPlayArea
          game={game}
          receivedAt={Date.now()}
          layout={layout}
          dealing={false}
          onDealDone={() => undefined}
          onResultShown={() => undefined}
          center={() => null}
        />
      </QueryClientProvider>,
    );
  const seconds = () =>
    // Le compte à rebours est un nombre ; les rangs des cartes sont des textes (« 3 », « A »).
    screen
      .queryAllByText(/^\d{1,2}$/, { includeHiddenElements: true })
      .map((n) => n.props.children as unknown)
      .filter((c) => typeof c === 'number');

  it('mon tour : je vois le compte à rebours (15 → 0), aucune barre sur ma plaque', async () => {
    await show(running('me'));
    expect(seconds()).toEqual([15]);
    expect(screen.queryByTestId('turn-progress-fill', { includeHiddenElements: true })).toBeNull();
  });

  it('tour d’un adversaire : sa barre dans sa plaque, jamais ses secondes', async () => {
    await show(running('b'));
    expect(seconds()).toEqual([]);
    expect(screen.queryByLabelText(/secondes/)).toBeNull();
    expect(screen.getByTestId('turn-progress-fill', { includeHiddenElements: true })).toBeTruthy();
  });
});
