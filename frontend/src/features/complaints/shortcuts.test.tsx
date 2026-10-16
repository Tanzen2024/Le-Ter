/// <reference types="jest" />
import { fireEvent, render, screen } from '@testing-library/react-native';
import { router } from 'expo-router';

import { ApiError } from '../../lib/api-client';
import { DEFAULT_PREFERENCES, usePreferencesStore } from '../../stores/preferences-store';
import type { GameView } from '../../types/game';
import { GameOverPanel } from '../games/table/GameOverPanel';
import { ComplaintForm } from './ComplaintForm';
import { getComplaintMessages } from './complaint-messages';
import { useCreateComplaint } from './hooks';
import { ReportProblemLink } from './ReportProblemLink';
import { shortcutDraft } from './shortcut-draft';

jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn(async () => null),
  setItemAsync: jest.fn(async () => undefined),
  deleteItemAsync: jest.fn(async () => undefined),
}));
jest.mock('expo-router', () => ({
  router: { push: jest.fn(), back: jest.fn(), replace: jest.fn(), canGoBack: () => false },
  useLocalSearchParams: () => ({}),
}));
jest.mock('./hooks', () => ({ useCreateComplaint: jest.fn() }));

const GAME = '1b9d6bcd-bbfd-4b2d-9b5d-ab8dfbbd4bed';
const TOURNAMENT = '6ec0bd7f-11c0-43da-975e-2a8ad9ebae0b';
const mockCreate = jest.fn();

beforeEach(() => {
  usePreferencesStore.setState(DEFAULT_PREFERENCES);
  (router.push as jest.Mock).mockReset();
  mockCreate.mockReset();
  (useCreateComplaint as jest.Mock).mockReturnValue({
    isPending: false,
    error: null,
    mutate: mockCreate,
    reset: jest.fn(),
  });
});

describe('raccourci « Signaler un problème »', () => {
  it('transmet seulement le contexte affiché (partie, catégorie suggérée)', async () => {
    await render(<ReportProblemLink gameId={GAME} category="GAME_RESULT" />);
    await fireEvent.press(screen.getByText(/Signaler un problème/));
    expect(router.push).toHaveBeenCalledWith({
      pathname: '/support',
      params: { gameId: GAME, category: 'GAME_RESULT' },
    });
  });

  it('est présent sur le panneau de fin de partie, avec l’identifiant de la partie', async () => {
    const game = {
      gameId: GAME,
      sessionId: 's-1',
      firstPlayerId: 'p-other',
      version: 3,
      status: 'finished',
      creatorId: 'p-other',
      maxPlayers: 2,
      players: [
        { playerId: 'p-other', seat: 0, joinedAt: '2026-10-11T10:00:00Z', username: 'Sorobio' },
        { playerId: 'p-me', seat: 1, joinedAt: '2026-10-11T10:00:00Z', username: 'Moi' },
      ],
      result: {
        winnerId: 'p-other',
        method: 'CONTROL_AFTER_LAST_TRICK',
        remainingOpponentIds: ['p-me'],
        fledPlayerIds: [],
      },
      mySettlement: { delta: -84, account: 'WALLET' },
      myActions: {
        canPlayCard: false,
        playableCardIds: [],
        canFlee: false,
        canDeclareInstantWin: false,
      },
      viewerId: 'p-me',
      createdAt: '2026-10-11T10:00:00Z',
    } as unknown as GameView;
    await render(
      <GameOverPanel
        game={game}
        width={320}
        awaitingMe={false}
        canContinue={false}
        pending={false}
        onQuit={async () => true}
        onReplay={async () => true}
      />,
    );
    await fireEvent.press(screen.getByTestId('report-problem-link'));
    expect(router.push).toHaveBeenCalledWith({
      pathname: '/support',
      params: { gameId: GAME, category: 'GAME_RESULT' },
    });
  });

  it('construit le brouillon à partir du contexte et ignore un identifiant malformé', () => {
    const t = getComplaintMessages('fr');
    expect(shortcutDraft({ tournamentId: TOURNAMENT }, (c) => t.categories[c])).toEqual({
      category: 'TOURNAMENT',
      title: 'Tournoi (inscription, classement)',
      description: '',
      links: { tournamentId: TOURNAMENT },
      recommended: false,
    });
    expect(shortcutDraft({ gameId: "1' OR '1'='1" }, (c) => t.categories[c])).toBeNull();
    expect(shortcutDraft({}, (c) => t.categories[c])).toBeNull();
    expect(
      shortcutDraft({ gameId: GAME, category: 'REFUND_ME' }, (c) => t.categories[c])?.category,
    ).toBe('GAME_RESULT');
  });
});

describe('formulaire ouvert depuis un raccourci', () => {
  const draft = shortcutDraft(
    { gameId: GAME, category: 'GAME_RESULT' },
    (c) => getComplaintMessages('fr').categories[c],
  );

  it("envoie l'élément lié, sans autre identifiant", async () => {
    await render(
      <ComplaintForm
        draft={draft}
        conversationId={null}
        onCreated={jest.fn()}
        onCancel={jest.fn()}
      />,
    );
    expect(screen.getByTestId('complaint-links')).toBeTruthy();
    await fireEvent.changeText(
      screen.getByLabelText('Description'),
      'Le résultat affiché est faux.',
    );
    await fireEvent.press(screen.getByText('Déposer la réclamation'));
    expect(mockCreate).toHaveBeenCalledWith(
      {
        category: 'GAME_RESULT',
        title: 'Partie ou résultat contesté',
        description: 'Le résultat affiché est faux.',
        links: { gameId: GAME },
      },
      expect.anything(),
    );
  });

  it("contexte qui n'existe plus ou n'appartient pas au joueur : message clair, élément retirable", async () => {
    (useCreateComplaint as jest.Mock).mockReturnValue({
      isPending: false,
      error: new ApiError(422, 'COMPLAINT_LINK_INVALID', 'Élément introuvable parmi les vôtres.', {
        gameId: 'Élément introuvable parmi les vôtres.',
      }),
      mutate: mockCreate,
      reset: jest.fn(),
    });
    await render(
      <ComplaintForm
        draft={draft}
        conversationId={null}
        onCreated={jest.fn()}
        onCancel={jest.fn()}
      />,
    );
    expect(screen.getByText(/n’est pas \(ou plus\) rattaché à votre compte/)).toBeTruthy();
    await fireEvent.press(screen.getByLabelText('Retirer : Partie'));
    await fireEvent.changeText(
      screen.getByLabelText('Description'),
      'Le résultat affiché est faux.',
    );
    await fireEvent.press(screen.getByText('Déposer la réclamation'));
    expect(mockCreate.mock.calls[0]?.[0]).not.toHaveProperty('links');
  });
});
