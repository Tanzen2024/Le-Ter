/// <reference types="jest" />
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, render, screen } from '@testing-library/react-native';
import { StyleSheet, Text } from 'react-native';

import type { GameView, GaramView } from '../../../types/game';
import { computeLobbyMetrics } from '../../lobby/lobby-metrics';
import { FACE_CORNER } from '../table/Cards';
import { TRICK_CLEAR_DELAY_MS } from '../table/TableCards';
import { computeGameTableLayout } from '../table/table-layout';
import { GaramPlayArea } from './GaramPlayArea';
import {
  GARAM_DRAW_BREATH_MS,
  GARAM_DRAW_START_PAUSE_MS,
  GARAM_DRAW_FLIGHT_MS,
  GARAM_REVEAL_PAUSE_MS,
  GARAM_REVEAL_STEP_MS,
  GARAM_TERRE_STEP,
  GARAM_SCORE_HOLD_MS,
  GARAM_TIE_HOLD_MS,
  GARAM_WINNER_HOLD_MS,
} from './garam-presentation';

/**
 * Une manche de GARAM TIA vue par le dégageur (2 joueurs), d'une vue du serveur à la suivante
 * (D-128) : chaque étape est montrée dans SA zone, au rythme prévu, sans rien décider.
 */
beforeEach(() => jest.useFakeTimers());
afterEach(() => {
  jest.useRealTimers();
  cleanup();
});

const layout = computeGameTableLayout(
  computeLobbyMetrics({ width: 800, height: 360, safe: { top: 6, bottom: 6, left: 12, right: 12 } }),
  { topSeat: true },
);

const garamOf = (garam: Partial<GaramView>): GaramView => ({
  phase: 'FIRST_ROUND',
  dealerId: 'me',
  order: ['me', 'b'],
  dealSequence: [],
  terre: ['TREFLE-4', 'PIQUE-5', 'CARREAU-3'],
  firstCards: [],
  drawOrder: [],
  drawn: { me: [], b: [] },
  drawDone: [],
  myHand: ['COEUR-9', 'TREFLE-7', 'PIQUE-10'],
  handCounts: { me: 3, b: 3 },
  canDraw: false,
  ...garam,
});

const view = (garam: Partial<GaramView>, extra: Partial<GameView> = {}): GameView => ({
  gameId: 'g',
  gameType: 'GARAM',
  garamVariant: 15,
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
  activePlayerId: 'me',
  myActions: { canPlayCard: true, playableCardIds: [], canFlee: false, canDeclareInstantWin: false },
  viewerId: 'me',
  garam: garamOf(garam),
  ...extra,
});

/** Étapes successives de la manche, telles que le serveur les envoie. */
const DEALT = view({});
const I_PLAYED = view(
  {
    firstCards: [{ playerId: 'me', cardId: 'COEUR-9' }],
    leadSuit: 'COEUR',
    myHand: ['TREFLE-7', 'PIQUE-10'],
    handCounts: { me: 2, b: 3 },
    nextPlayerId: 'b',
  },
  { activePlayerId: 'b' },
);
const ROUND_DONE = view({
  phase: 'DRAW',
  firstCards: [
    { playerId: 'me', cardId: 'COEUR-9' },
    { playerId: 'b', cardId: 'COEUR-5' },
  ],
  leadSuit: 'COEUR',
  controllerId: 'me',
  drawOrder: ['me', 'b'],
  myHand: ['TREFLE-7', 'PIQUE-10'],
  handCounts: { me: 2, b: 2 },
  nextPlayerId: 'me',
  myTotal: 17,
  canDraw: true,
});
const I_DREW = view({
  ...ROUND_DONE.garam,
  terre: ['PIQUE-5', 'CARREAU-3'],
  drawn: { me: ['TREFLE-4'], b: [] },
  myTotal: 21,
  canDraw: false,
});
const FINISHED = view(
  {
    ...I_DREW.garam,
    drawDone: ['me', 'b'],
    nextPlayerId: undefined,
  },
  {
    status: 'finished',
    activePlayerId: undefined,
    endReason: 'GARAM_BEST_SCORE',
    result: {
      winnerId: 'me',
      method: 'GARAM_BEST_SCORE',
      scores: { me: 21, b: 18 },
      belowThresholdIds: [],
      penaltyThreshold: 15,
      garamHands: { me: ['TREFLE-7', 'PIQUE-10'], b: ['CARREAU-8', 'TREFLE-10'] },
      remainingOpponentIds: ['b'],
      fledPlayerIds: [],
    },
  },
);

const center = jest.fn((_presenting: boolean, _slot?: unknown): React.ReactNode => null);
const client = new QueryClient();
const table = (game: GameView) => (
  <QueryClientProvider client={client}>
    <GaramPlayArea
      game={game}
      receivedAt={Date.now()}
      layout={layout}
      dealing={false}
      onDealDone={() => undefined}
      onResultShown={() => undefined}
      center={center}
    />
  </QueryClientProvider>
);
const wait = (ms: number) => act(() => jest.advanceTimersByTime(ms));
const label = (text: string | RegExp) => screen.queryByLabelText(text, { includeHiddenElements: true });

describe('« Je passe » du contrôleur (D-145)', () => {
  it('annoncé après le contrôle, tenu jusqu’à la main passée, jamais répété en « Impossible »', async () => {
    // Je contrôle avec 20 : la tête (♠3) ferait 23, je ne peux rien tirer.
    const PASSING = view({
      ...ROUND_DONE.garam,
      terre: ['PIQUE-3', 'CARREAU-5'],
      myTotal: 20,
      canDraw: false,
      passingPlayerId: 'me',
    });
    const ui = await render(table(DEALT));
    await ui.rerender(table(I_PLAYED));
    await wait(10_000);
    await ui.rerender(table(PASSING));
    const pass = () => screen.queryByTestId('garam-pass-notice', { includeHiddenElements: true });
    // Le tour reste visible puis se range : ni contrôle ni « Je passe » avant.
    await wait(50);
    await wait(TRICK_CLEAR_DELAY_MS - 150);
    expect(pass()).toBeNull();
    await wait(1_000);
    // Le contrôle est annoncé d'abord…
    expect(screen.getByTestId('garam-control-notice', { includeHiddenElements: true })).toBeTruthy();
    expect(pass()).toBeNull();
    // … puis « Je passe », perceptible par toute la table, tant que le serveur garde ce tour.
    await wait(2_000);
    expect(screen.queryByTestId('garam-control-notice', { includeHiddenElements: true })).toBeNull();
    expect(pass()).toHaveTextContent('Vous : « Je passe »');
    expect(screen.queryByText('Tirage automatique…', { includeHiddenElements: true })).toBeNull();
    await wait(5_000);
    expect(pass()).toBeTruthy();

    // Le serveur passe la main à Bob : l'annonce s'efface, sans « Impossible » en plus.
    await ui.rerender(
      table(
        view(
          {
            ...PASSING.garam,
            passingPlayerId: undefined,
            drawDone: ['me'],
            lastRefusal: { playerId: 'me', cardId: 'PIQUE-3', passed: true },
            nextPlayerId: 'b',
          },
          { activePlayerId: 'b' },
        ),
      ),
    );
    expect(pass()).toBeNull();
    expect(screen.queryByText(/Impossible/, { includeHiddenElements: true })).toBeNull();
    expect(screen.getByText('Bob tire au terre', { includeHiddenElements: true })).toBeTruthy();
  });

  it('joueur suivant sans carte prenable : « Je passe » quand la main lui arrive, après la carte posée', async () => {
    const ui = await render(table(DEALT));
    await ui.rerender(table(I_PLAYED));
    await wait(10_000);
    await ui.rerender(table(ROUND_DONE));
    await wait(50);
    await wait(TRICK_CLEAR_DELAY_MS - 150);
    await wait(1_000);
    await wait(2_000); // contrôle annoncé puis effacé
    const pass = () => screen.queryByTestId('garam-pass-notice', { includeHiddenElements: true });
    // Je tire ♣4 (21) puis « Impossible » ; la main arrive à Bob, qui ne peut rien prendre.
    await ui.rerender(
      table(
        view(
          {
            ...I_DREW.garam,
            drawDone: ['me'],
            lastRefusal: { playerId: 'me', cardId: 'PIQUE-5' },
            nextPlayerId: 'b',
            passingPlayerId: 'b',
          },
          { activePlayerId: 'b' },
        ),
      ),
    );
    // Ma carte vole d'abord : pas d'annonce de Bob avant qu'elle soit posée.
    expect(pass()).toBeNull();
    await wait(GARAM_DRAW_START_PAUSE_MS + GARAM_DRAW_BREATH_MS);
    expect(screen.getByTestId('garam-draw-flight', { includeHiddenElements: true })).toBeTruthy();
    expect(pass()).toBeNull();
    await wait(GARAM_DRAW_FLIGHT_MS + 50);
    expect(pass()).toHaveTextContent('Bob : « Je passe »');
    // Tenue jusqu'à ce que le serveur passe la main (aucun délai côté téléphone).
    await wait(4_500);
    expect(pass()).toBeTruthy();
  });

  it('vu par un autre joueur : « Bob : « Je passe » »', async () => {
    const theirs = view(
      { ...ROUND_DONE.garam, controllerId: 'b', drawOrder: ['b', 'me'], nextPlayerId: 'b', canDraw: false, passingPlayerId: 'b' },
      { activePlayerId: 'b' },
    );
    const ui = await render(table(DEALT));
    await ui.rerender(table(I_PLAYED));
    await wait(10_000);
    await ui.rerender(table(theirs));
    await wait(50);
    await wait(TRICK_CLEAR_DELAY_MS - 150);
    await wait(1_000);
    await wait(2_000);
    expect(screen.getByTestId('garam-pass-notice', { includeHiddenElements: true })).toHaveTextContent(
      'Bob : « Je passe »',
    );
  });
});

describe('manche complète, sans victoire immédiate', () => {
  it('distribution → tour → contrôle → classement → tirage → révélation → gagnant', async () => {
    // Étape 1 — après la distribution : 3 cartes en main chacun, terre en haut de la table.
    const ui = await render(table(DEALT));
    expect(label('Bob : 3 cartes cachées, 0 tirée du terre')).toBeTruthy();
    expect(label('Mes cartes : 3 en main, 0 tirée du terre')).toBeTruthy();
    expect(label('Terre : 3 cartes, tête à gauche')).toBeTruthy();
    expect(screen.getByTestId('garam-trick-zone', { includeHiddenElements: true })).toBeTruthy();

    // Étapes 2-3 — je dégage : ma carte quitte ma main (2 cartes) et reste dans la zone du tour.
    await ui.rerender(table(I_PLAYED));
    await wait(10_000);
    expect(label('Ma carte du 1er tour : aucune')).toBeTruthy(); // pas encore classée
    expect(screen.queryByTestId('garam-control-notice', { includeHiddenElements: true })).toBeNull();

    // Étapes 4-5 — Bob joue : le tour est complet ; le contrôle n'est annoncé qu'après.
    await ui.rerender(table(ROUND_DONE));
    await wait(50); // la carte de Bob apparaît sur la table
    await wait(TRICK_CLEAR_DELAY_MS - 150);
    expect(screen.queryByTestId('garam-control-notice', { includeHiddenElements: true })).toBeNull();
    expect(label('Ma carte du 1er tour : aucune')).toBeTruthy();
    // Étape 6 — rangement : chaque carte rejoint le cadre « 1er tour » de son joueur.
    await wait(1_000);
    expect(label('Ma carte du 1er tour : classée')).toBeTruthy();
    expect(label('Carte de Bob du 1er tour : classée')).toBeTruthy();
    expect(label('Bob : 2 cartes cachées, 0 tirée du terre')).toBeTruthy();
    expect(label('Mes cartes : 2 en main, 0 tirée du terre')).toBeTruthy(); // 3 → 2 cartes
    expect(screen.getByTestId('garam-control-notice', { includeHiddenElements: true })).toHaveTextContent(
      'Vous prenez le contrôle',
    );
    // Étape 7 — je contrôle : aucune action à faire (D-136), ni bouton « Tirer », ni tête à
    // glisser, ni chrono : le serveur tire pour moi.
    expect(screen.queryByText('Tirer', { includeHiddenElements: true })).toBeNull();
    expect(screen.queryByTestId('garam-terre-head', { includeHiddenElements: true })).toBeNull();
    expect(screen.queryByTestId('timer-dial', { includeHiddenElements: true })).toBeNull();

    // Étape 8 — tirage : après une courte pause (tour rangé), la carte part de la tête du
    // terre, puis arrive, visible, chez moi.
    await ui.rerender(table(I_DREW));
    expect(screen.queryByTestId('garam-draw-flight', { includeHiddenElements: true })).toBeNull();
    await wait(GARAM_DRAW_BREATH_MS);
    expect(screen.queryByTestId('garam-draw-flight', { includeHiddenElements: true })).toBeNull();
    await wait(GARAM_DRAW_START_PAUSE_MS);
    await wait(GARAM_DRAW_BREATH_MS);
    expect(screen.getByTestId('garam-draw-flight', { includeHiddenElements: true })).toBeTruthy();
    expect(label('Mes cartes : 2 en main, 0 tirée du terre')).toBeTruthy();
    await wait(GARAM_DRAW_FLIGHT_MS + 50);
    expect(screen.queryByTestId('garam-draw-flight', { includeHiddenElements: true })).toBeNull();
    // Posée dans ma zone de départ, à côté de mes 2 cartes cachées.
    expect(label('Mes cartes : 2 en main, 1 tirée du terre')).toBeTruthy();

    // Étapes 9-11 — fin : AUCUNE révélation tant que la présentation n'a pas commencé ; puis la
    // zone de départ de chaque joueur est dévoilée, joueur après joueur, avec son total.
    await ui.rerender(table(FINISHED));
    expect(center).toHaveBeenLastCalledWith(true);
    expect(label('Bob : 2 cartes cachées, 0 tirée du terre')).toBeTruthy();
    expect(screen.queryByTestId('garam-total-me', { includeHiddenElements: true })).toBeNull();
    // Courte pause, tous les tirages posés : aucune main encore dévoilée (D-148).
    await wait(GARAM_REVEAL_PAUSE_MS - 50);
    expect(screen.queryByTestId('garam-total-me', { includeHiddenElements: true })).toBeNull();
    await wait(100); // moi d'abord (ordre de la manche)
    expect(screen.getByTestId('garam-total-me', { includeHiddenElements: true })).toHaveTextContent('Total 21');
    expect(label('Bob : 2 cartes cachées, 0 tirée du terre')).toBeTruthy(); // Bob attend son tour
    expect(screen.queryByTestId('garam-total-b', { includeHiddenElements: true })).toBeNull();
    await wait(GARAM_REVEAL_STEP_MS);
    expect(label('Bob : cartes dévoilées, 0 tirée du terre')).toBeTruthy();
    expect(screen.getByTestId('garam-total-b', { includeHiddenElements: true })).toHaveTextContent('Total 18');
    expect(screen.queryByTestId('garam-banner', { includeHiddenElements: true })).toBeNull();
    await wait(GARAM_REVEAL_STEP_MS - 50);
    expect(screen.queryByTestId('garam-banner', { includeHiddenElements: true })).toBeNull();

    // Étape 12 — gagnant mis en évidence, cartes et totaux toujours visibles.
    await wait(GARAM_SCORE_HOLD_MS);
    expect(screen.getByTestId('garam-banner', { includeHiddenElements: true })).toHaveTextContent('🏆 Moi');
    expect(screen.getByText('21 points', { includeHiddenElements: true })).toBeTruthy();
    expect(center).toHaveBeenLastCalledWith(true);

    // Étape 13 — panneau de fin (Continuer / Sortir), la table reste lisible derrière.
    await wait(GARAM_WINNER_HOLD_MS);
    expect(center).toHaveBeenLastCalledWith(false, expect.objectContaining({ width: expect.any(Number) }));
    expect(screen.getByTestId('garam-total-b', { includeHiddenElements: true })).toBeTruthy();
  });

  it('reconnexion sur une manche terminée : état final d’emblée, aucune animation rejouée', async () => {
    await render(table(FINISHED));
    expect(center).toHaveBeenLastCalledWith(false, expect.objectContaining({ width: expect.any(Number) }));
    expect(label('Bob : cartes dévoilées, 0 tirée du terre')).toBeTruthy();
    expect(label('Mes cartes : 2 en main, 1 tirée du terre')).toBeTruthy();
    expect(screen.queryByTestId('garam-draw-flight', { includeHiddenElements: true })).toBeNull();
  });

  it('victoire à 22 points (deux As) : le bandeau annonce « Gagne avec deux As », jamais « 22 points »', async () => {
    const twoAces = view(FINISHED.garam!, {
      status: 'finished',
      activePlayerId: undefined,
      endReason: 'GARAM_BEST_SCORE',
      result: { ...FINISHED.result!, scores: { me: 22, b: 18 } },
    });
    // Fin reçue pendant la manche : révélation joueur après joueur, puis le gagnant.
    const ui = await render(table(I_DREW));
    await ui.rerender(table(twoAces));
    await wait(50 + GARAM_REVEAL_PAUSE_MS + 2 * GARAM_REVEAL_STEP_MS + GARAM_SCORE_HOLD_MS);
    expect(screen.getByTestId('garam-banner', { includeHiddenElements: true })).toHaveTextContent('🏆 Moi');
    expect(screen.getByText('Gagne avec deux As', { includeHiddenElements: true })).toBeTruthy();
    expect(screen.queryByText('22 points', { includeHiddenElements: true })).toBeNull();
  });

  it('panneau de fin lisible : posé au-dessus des cartes et des totaux, table assombrie', async () => {
    center.mockImplementation((presenting) =>
      presenting ? null : <Text testID="result-panel">Vous avez gagné !</Text>,
    );
    try {
      await render(table(FINISHED));
      const layer = screen.getByTestId('garam-result-layer', { includeHiddenElements: true });
      expect(layer).toContainElement(screen.getByTestId('result-panel', { includeHiddenElements: true }));
      const zIndexOf = (testID: string) =>
        StyleSheet.flatten(screen.getByTestId(testID, { includeHiddenElements: true }).props.style)
          .zIndex ?? 0;
      // Au-dessus des totaux (les plus hauts des éléments posés de la table) et du terre.
      expect(zIndexOf('garam-result-layer')).toBeGreaterThan(zIndexOf('garam-total-b'));
      expect(zIndexOf('garam-result-layer')).toBeGreaterThan(zIndexOf('garam-terre-card-0'));
      // Le panneau n'est rendu qu'une fois, dans cette couche.
      expect(screen.getAllByTestId('result-panel', { includeHiddenElements: true })).toHaveLength(1);
    } finally {
      center.mockImplementation(() => null);
    }
  });
});

describe('visibilité et droits d’action', () => {
  it('adversaire : la carte que j’ai tirée lui est visible, ma main reste cachée', async () => {
    const theirs = view(
      { ...I_DREW.garam, myHand: ['CARREAU-8', 'TREFLE-10'], nextPlayerId: 'b', canDraw: true },
      { viewerId: 'b', activePlayerId: 'b' },
    );
    await render(table(theirs));
    // Ma zone de départ vue par Bob : mes 2 cartes en dos, ma carte tirée face visible.
    expect(label('Moi : 2 cartes cachées, 1 tirée du terre')).toBeTruthy();
    // La vue de Bob ne contient jamais mes cartes cachées : rien à masquer côté écran.
    expect(JSON.stringify(theirs)).not.toContain('TREFLE-7');
  });

  const noManualDraw = () => {
    expect(screen.queryByTestId('garam-terre-head', { includeHiddenElements: true })).toBeNull();
    expect(screen.queryByTestId('garam-draw-target', { includeHiddenElements: true })).toBeNull();
    expect(screen.queryByText('Tirer', { includeHiddenElements: true })).toBeNull();
  };

  it('tirage automatique (D-136) : le joueur qui tire n’a ni bouton « Tirer » ni terre à saisir', async () => {
    await render(table(ROUND_DONE)); // c'est à moi de tirer (canDraw)
    await wait(5_000);
    noManualDraw();
  });

  it('tirage automatique (D-136) : un adversaire non plus', async () => {
    await render(
      table(view({ ...ROUND_DONE.garam, nextPlayerId: 'b', canDraw: false }, { activePlayerId: 'b' })),
    );
    await wait(5_000);
    noManualDraw();
  });

  it('aucun vol avant que le premier tour soit rangé ; puis un seul, même vue reçue deux fois', async () => {
    const ui = await render(table(I_PLAYED));
    await wait(10_000);
    // Le tour se termine ET le serveur a déjà tiré pour moi, dans la même vue.
    await ui.rerender(table(I_DREW));
    await wait(GARAM_DRAW_BREATH_MS + 50);
    expect(screen.queryByTestId('garam-draw-flight', { includeHiddenElements: true })).toBeNull();
    expect(label('Mes cartes : 2 en main, 0 tirée du terre')).toBeTruthy();
    // Tour rangé : toujours rien pendant la pause qui suit le rangement.
    await wait(TRICK_CLEAR_DELAY_MS + 500);
    expect(label('Ma carte du 1er tour : classée')).toBeTruthy();
    expect(screen.queryByTestId('garam-draw-flight', { includeHiddenElements: true })).toBeNull();
    // Puis la carte vole depuis le terre et se pose chez moi.
    await wait(GARAM_DRAW_START_PAUSE_MS);
    await wait(GARAM_DRAW_BREATH_MS);
    expect(screen.getByTestId('garam-draw-flight', { includeHiddenElements: true })).toBeTruthy();
    await wait(GARAM_DRAW_FLIGHT_MS + 50);
    expect(label('Mes cartes : 2 en main, 1 tirée du terre')).toBeTruthy();
    // La même vue reçue de nouveau (rendu, reconnexion du flux) : aucun vol rejoué.
    await ui.rerender(table({ ...I_DREW }));
    await wait(GARAM_DRAW_BREATH_MS + GARAM_DRAW_FLIGHT_MS + 50);
    expect(screen.queryByTestId('garam-draw-flight', { includeHiddenElements: true })).toBeNull();
    expect(label('Mes cartes : 2 en main, 1 tirée du terre')).toBeTruthy();
  });

  it('cartes successives : chacune vole à son tour, aucune ne part avant que la précédente soit posée', async () => {
    const ui = await render(table(ROUND_DONE));
    await wait(5_000);
    // Deux tirages arrivés ensemble (serveur plus rapide que l'animation).
    await ui.rerender(
      table(
        view({
          ...ROUND_DONE.garam,
          terre: ['CARREAU-3'],
          drawn: { me: ['TREFLE-4', 'PIQUE-5'], b: [] },
        }),
      ),
    );
    await wait(GARAM_DRAW_BREATH_MS);
    expect(screen.getAllByTestId('garam-draw-flight', { includeHiddenElements: true })).toHaveLength(1);
    await wait(GARAM_DRAW_FLIGHT_MS + 50);
    expect(label('Mes cartes : 2 en main, 1 tirée du terre')).toBeTruthy();
    await wait(GARAM_DRAW_BREATH_MS);
    expect(screen.getAllByTestId('garam-draw-flight', { includeHiddenElements: true })).toHaveLength(1);
    await wait(GARAM_DRAW_FLIGHT_MS + 50);
    expect(label('Mes cartes : 2 en main, 2 tirées du terre')).toBeTruthy();
  });

  it('tirage d’un autre joueur (ou du Katika) : présenté comme un tirage humain', async () => {
    const before = view({ ...I_DREW.garam, nextPlayerId: 'b' }, { activePlayerId: 'b' });
    const ui = await render(table(before));
    await ui.rerender(
      table(
        view(
          {
            ...I_DREW.garam,
            terre: ['CARREAU-3'],
            drawn: { me: ['TREFLE-4'], b: ['PIQUE-5'] },
            nextPlayerId: 'b',
          },
          { activePlayerId: 'b' },
        ),
      ),
    );
    await wait(GARAM_DRAW_BREATH_MS);
    expect(screen.getByTestId('garam-draw-flight', { includeHiddenElements: true })).toBeTruthy();
    await wait(GARAM_DRAW_FLIGHT_MS + 50);
    expect(label('Bob : 2 cartes cachées, 1 tirée du terre')).toBeTruthy();
  });
});

describe('égalité et tour suivant', () => {
  it('égalité : mains et totaux montrés ensemble, « Égalité · Nouvelle manche », puis la suite', async () => {
    const tie = view(
      { ...I_DREW.garam, drawDone: ['me', 'b'], nextPlayerId: undefined },
      {
        status: 'finished',
        activePlayerId: undefined,
        endReason: 'GARAM_TIE',
        garamTie: {
          kind: 'SCORE',
          playerIds: ['me', 'b'],
          scores: { me: 21, b: 21 },
          hands: { me: ['TREFLE-7', 'PIQUE-10'], b: ['CARREAU-8', 'TREFLE-9'] },
        },
      },
    );
    const ui = await render(table(I_DREW));
    await wait(5_000);
    await ui.rerender(table(tie));
    await wait(50);
    expect(screen.getByTestId('garam-banner', { includeHiddenElements: true })).toHaveTextContent('Égalité');
    expect(screen.getByText('Nouvelle manche', { includeHiddenElements: true })).toBeTruthy();
    expect(screen.getByTestId('garam-total-b', { includeHiddenElements: true })).toHaveTextContent('Total 21');
    expect(center).toHaveBeenLastCalledWith(true);
    await wait(GARAM_TIE_HOLD_MS);
    expect(center).toHaveBeenLastCalledWith(false, expect.objectContaining({ width: expect.any(Number) }));
  });

  it('manche suivante : la table repart de zéro (aucune carte de la manche précédente)', async () => {
    const ui = await render(table(FINISHED));
    await ui.rerender(table({ ...DEALT, gameId: 'g2' }));
    expect(label('Mes cartes : 3 en main, 0 tirée du terre')).toBeTruthy();
    expect(label('Ma carte du 1er tour : aucune')).toBeTruthy();
    expect(label('Bob : 3 cartes cachées, 0 tirée du terre')).toBeTruthy();
    expect(screen.queryByTestId('garam-total-me', { includeHiddenElements: true })).toBeNull();
  });
});

describe('terre lisible', () => {
  const zOf = (testID: string) =>
    StyleSheet.flatten(screen.getByTestId(testID, { includeHiddenElements: true }).props.style)
      .zIndex as number;
  const leftOf = (testID: string) =>
    StyleSheet.flatten(screen.getByTestId(testID, { includeHiddenElements: true }).props.style)
      .left as number;

  it('de gauche à droite, la tête (1re carte posée) au-dessus des suivantes', async () => {
    await render(table(I_PLAYED)); // personne ne tire : terre de 3 cartes, toutes posées
    expect(leftOf('garam-terre-card-0')).toBeLessThan(leftOf('garam-terre-card-1'));
    expect(leftOf('garam-terre-card-1')).toBeLessThan(leftOf('garam-terre-card-2'));
    expect(zOf('garam-terre-card-0')).toBeGreaterThan(zOf('garam-terre-card-1'));
    expect(zOf('garam-terre-card-1')).toBeGreaterThan(zOf('garam-terre-card-2'));
  });

  it('chevauchement faible : le coin (valeur, famille) de chaque carte reste visible', () => {
    // La carte du dessus ne cache que (1 − pas) de la suivante, moins que l'écart du coin.
    expect(1 - GARAM_TERRE_STEP).toBeLessThan(FACE_CORNER.left);
  });

  it('pendant le tirage : la tête reste posée au terre, au-dessus des suivantes', async () => {
    await render(table(ROUND_DONE));
    await wait(5_000); // tour rangé : le serveur va tirer
    expect(zOf('garam-terre-card-0')).toBeGreaterThan(zOf('garam-terre-card-1'));
  });
});
