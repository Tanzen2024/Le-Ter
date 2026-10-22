/// <reference types="jest" />
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen } from '@testing-library/react-native';

import type { GameView, GaramView } from '../../../types/game';
import { computeLobbyMetrics } from '../../lobby/lobby-metrics';
import { computeGameTableLayout } from '../table/table-layout';
import { GaramPlayArea } from './GaramPlayArea';

/**
 * Main spéciale de GARAM TIA déclarée par le SERVEUR (D-137) : plus de bouton ; pendant le court
 * délai qui précède la victoire (`specialPending`, état du serveur), une annonce légère est
 * visible par tous. L'écran n'envoie jamais rien : il présente la transition.
 */
const mockSend = jest.fn();
jest.mock('../hooks', () => ({
  ...jest.requireActual('../hooks'),
  useGameAction: () => ({ send: mockSend, isPending: false, isError: false, error: null, variables: undefined }),
}));

afterEach(() => {
  mockSend.mockClear();
  cleanup();
});

const layout = computeGameTableLayout(
  computeLobbyMetrics({ width: 800, height: 360, safe: { top: 6, bottom: 6, left: 12, right: 12 } }),
  { topSeat: true },
);

const view = (garam: Partial<GaramView>, extra: Partial<GameView> = {}): GameView => ({
  gameId: 'g',
  gameType: 'GARAM',
  garamVariant: 15,
  firstPlayerId: 'me',
  version: 3,
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
  garam: {
    phase: 'FIRST_ROUND',
    dealerId: 'me',
    order: ['me', 'b'],
    dealSequence: [],
    terre: ['TREFLE-4', 'PIQUE-5', 'CARREAU-3'],
    firstCards: [],
    drawOrder: [],
    drawn: { me: [], b: [] },
    drawDone: [],
    myHand: ['COEUR-7', 'TREFLE-7', 'PIQUE-7'],
    handCounts: { me: 3, b: 3 },
    canDraw: false,
    ...garam,
  },
  ...extra,
});

const table = (game: GameView) =>
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
const button = () => screen.queryByLabelText(/^Main spéciale/);
const announce = () => screen.queryByTestId('garam-special-announce');

describe('main spéciale automatique (D-137)', () => {
  it('détenteur : AUCUN bouton, annonce visible, rien n’est envoyé', async () => {
    await table(view({ mySpecial: 'THREE_SEVENS', specialPending: true }));
    expect(button()).toBeNull();
    expect(announce()).toBeTruthy();
    expect(screen.getByText(/Main spéciale/)).toBeTruthy();
    expect(mockSend).not.toHaveBeenCalled();
  });

  it('autres joueurs : même annonce (état public), sans rien savoir de la main', async () => {
    await table(view({ myHand: ['COEUR-9', 'TREFLE-7', 'PIQUE-10'], specialPending: true }, { viewerId: 'b', activePlayerId: 'me' }));
    expect(announce()).toBeTruthy();
    expect(button()).toBeNull();
  });

  it('pendant l’annonce : ni chrono ni consigne de jeu', async () => {
    const turn = () => ({
      turnStartedAt: new Date().toISOString(),
      turnDeadlineAt: new Date(Date.now() + 10_000).toISOString(),
    });
    const numbers = () => screen.queryAllByText(/^\d+$/).length;
    // Même table, tour normal : le chrono (secondes) est affiché.
    const normal = await table(view({}, turn()));
    const withDial = numbers();
    await normal.unmount();
    await table(view({ mySpecial: 'THREE_SEVENS', specialPending: true }, turn()));
    expect(numbers()).toBe(withDial - 1); // plus de chrono
    expect(screen.queryByText(/Dégagez/)).toBeNull();
  });

  it('rerendus successifs (nouvelle version reçue, reconnexion) : jamais d’envoi', async () => {
    const r = await table(view({ mySpecial: 'THREE_SEVENS', specialPending: true }));
    for (const version of [4, 5, 6]) {
      await r.rerender(
        <QueryClientProvider client={new QueryClient()}>
          <GaramPlayArea
            game={view({ mySpecial: 'THREE_SEVENS', specialPending: true }, { version })}
            receivedAt={Date.now()}
            layout={layout}
            dealing={false}
            onDealDone={() => undefined}
            onResultShown={() => undefined}
            center={() => null}
          />
        </QueryClientProvider>,
      );
    }
    expect(mockSend).not.toHaveBeenCalled();
    expect(announce()).toBeTruthy();
  });

  it('sans main spéciale : ni annonce ni bouton, consigne normale', async () => {
    await table(view({ myHand: ['COEUR-9', 'TREFLE-7', 'PIQUE-10'] }));
    expect(announce()).toBeNull();
    expect(button()).toBeNull();
    expect(screen.getByText(/Dégagez/)).toBeTruthy();
  });

  it('pendant la distribution : aucune annonce', async () => {
    await render(
      <QueryClientProvider client={new QueryClient()}>
        <GaramPlayArea
          game={view({ mySpecial: 'THREE_SEVENS', specialPending: true })}
          receivedAt={Date.now()}
          layout={layout}
          dealing
          onDealDone={() => undefined}
          onResultShown={() => undefined}
          center={() => null}
        />
      </QueryClientProvider>,
    );
    expect(announce()).toBeNull();
  });
});

describe('cadres des cartes jouées', () => {
  it('aucun texte « 1er tour » dans les cadres', async () => {
    await table(view({}));
    expect(screen.queryByText('1er tour', { includeHiddenElements: true })).toBeNull();
  });
});
