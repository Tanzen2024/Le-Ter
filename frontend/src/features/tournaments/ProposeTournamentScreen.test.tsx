/// <reference types="jest" />
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import type { ReactElement } from 'react';

import { ApiError } from '../../lib/api-client';
import { tournamentsApi } from '../../services/tournaments-api';
import { useAuthStore } from '../../stores/auth-store';
import type { TournamentSummary } from '../../types/tournament';
import { MyProposals, ProposalForm } from './ProposeTournamentScreen';
import { tournamentView } from './tournament-fixtures.test-utils';

jest.mock('../../services/tournaments-api', () => ({
  tournamentsApi: {
    propose: jest.fn(),
    submit: jest.fn(),
    withdraw: jest.fn(),
    mine: jest.fn(),
  },
}));
jest.mock('expo-router', () => ({
  router: { replace: jest.fn(), push: jest.fn(), back: jest.fn() },
}));

const api = tournamentsApi as jest.Mocked<typeof tournamentsApi>;

const summary = (overrides: Partial<TournamentSummary> = {}): TournamentSummary => {
  const {
    registration: _r,
    account: _a,
    podium: _p,
    canRegister: _c1,
    canUnregister: _c2,
    canJoin: _c3,
    serverNow: _s,
    registeredCount: _n,
    ...rest
  } = tournamentView();
  return { ...rest, creatorType: 'PLAYER', status: 'DRAFT', ...overrides };
};

const clients: QueryClient[] = [];
async function renderWith(ui: ReactElement) {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: Infinity },
      mutations: { retry: false, gcTime: Infinity },
    },
  });
  clients.push(queryClient);
  await render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>);
}

beforeEach(() => {
  jest.clearAllMocks();
  useAuthStore.getState().signIn('jeton');
});
afterEach(async () => {
  await cleanup();
  clients.splice(0).forEach((client) => client.clear());
});

const type = (label: string, text: string) =>
  fireEvent.changeText(screen.getByLabelText(label), text);

describe('formulaire de proposition', () => {
  it('s’ouvre avec les champs de l’API et une répartition par défaut 50 / 30 / 20', async () => {
    await renderWith(<ProposalForm onSaved={jest.fn()} />);
    expect(screen.queryByLabelText('Nom du tournoi')).toBeNull();
    expect(screen.queryByLabelText('Description (facultatif)')).toBeNull();
    for (const label of [
      'Date (JJ/MM/AAAA)',
      'Heure de début',
      'Durée (minutes)',
      'Participation (FCFA)',
      'Joueurs minimum',
      'Joueurs maximum',
    ]) {
      expect(screen.getByLabelText(label)).toBeTruthy();
    }
    expect(screen.getByText('Rangs récompensés : 3')).toBeTruthy();
    expect(screen.getByText('Total : 100 %')).toBeTruthy();
    expect(screen.getByLabelText('Part du rang 1 (%)').props.value).toBe('50');
  });

  it('change le nombre de rangs récompensés', async () => {
    await renderWith(<ProposalForm onSaved={jest.fn()} />);
    await fireEvent.press(screen.getByLabelText('Un rang récompensé de plus'));
    expect(screen.getByText('Rangs récompensés : 4')).toBeTruthy();
    expect(screen.getByLabelText('Part du rang 4 (%)')).toBeTruthy();
  });

  it('validation du format avant envoi : aucun appel API', async () => {
    await renderWith(<ProposalForm onSaved={jest.fn()} />);
    await type('Date (JJ/MM/AAAA)', '31/02/2026');
    await fireEvent.press(screen.getByText('Proposer'));
    expect(screen.getByText('Date au format JJ/MM/AAAA.')).toBeTruthy();
    expect(api.propose).not.toHaveBeenCalled();
  });

  it.each(['29', '121'])(
    'durée de %s minutes : message exact, aucun appel API',
    async (minutes) => {
      await renderWith(<ProposalForm onSaved={jest.fn()} />);
      await type('Durée (minutes)', minutes);
      await fireEvent.press(screen.getByText('Proposer'));
      expect(screen.getByText('Durée entre 30 minutes et 120 minutes.')).toBeTruthy();
      expect(api.propose).not.toHaveBeenCalled();
    },
  );

  it('durée de 30 minutes : proposition envoyée (fin = début + 30 min)', async () => {
    api.propose.mockResolvedValue({ tournament: summary() });
    await renderWith(<ProposalForm onSaved={jest.fn()} />);
    await type('Durée (minutes)', '30');
    await fireEvent.press(screen.getByText('Enregistrer le brouillon'));
    await waitFor(() => expect(api.propose).toHaveBeenCalled());
    const payload = api.propose.mock.calls[0][1];
    expect(Date.parse(payload.endsAt) - Date.parse(payload.startsAt)).toBe(30 * 60_000);
  });

  it('« Enregistrer le brouillon » : proposition créée sans soumission', async () => {
    const onSaved = jest.fn();
    api.propose.mockResolvedValue({ tournament: summary() });
    await renderWith(<ProposalForm onSaved={onSaved} />);
    await fireEvent.press(screen.getByText('Enregistrer le brouillon'));
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    expect(api.propose).toHaveBeenCalledWith(
      'jeton',
      expect.objectContaining({
        entryFee: 1000,
        minimumPlayers: 20,
        prizeRules: [
          { rank: 1, percent: 50 },
          { rank: 2, percent: 30 },
          { rank: 3, percent: 20 },
        ],
      }),
    );
    expect(api.submit).not.toHaveBeenCalled();
  });

  it('« Proposer » : créé puis soumis à l’approbation', async () => {
    const onSaved = jest.fn();
    api.propose.mockResolvedValue({ tournament: summary() });
    api.submit.mockResolvedValue({
      tournament: summary({ status: 'PENDING_APPROVAL' }),
    });
    await renderWith(<ProposalForm onSaved={onSaved} />);
    await fireEvent.press(screen.getByText('Proposer'));
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    expect(api.submit).toHaveBeenCalledWith('jeton', summary().tournamentId);
  });

  it('erreurs du serveur affichées sur les champs concernés', async () => {
    api.propose.mockRejectedValue(
      new ApiError(400, 'VALIDATION_ERROR', 'Certaines informations sont invalides.', {
        startsAt: 'Le tournoi doit commencer au moins 1 h plus tard.',
        prizeRules: 'La somme des parts doit être exactement 100 %.',
      }),
    );
    await renderWith(<ProposalForm onSaved={jest.fn()} />);
    await fireEvent.press(screen.getByText('Proposer'));
    expect(
      await screen.findByText('Le tournoi doit commencer au moins 1 h plus tard.'),
    ).toBeTruthy();
    expect(screen.getByText('La somme des parts doit être exactement 100 %.')).toBeTruthy();
  });

  it('refus global du serveur (une proposition déjà en attente) : message affiché', async () => {
    api.propose.mockRejectedValue(
      new ApiError(
        409,
        'TOO_MANY_PENDING_TOURNAMENTS',
        'Vous avez déjà un tournoi en attente : attendez sa validation ou retirez-le.',
      ),
    );
    await renderWith(<ProposalForm onSaved={jest.fn()} />);
    await fireEvent.press(screen.getByText('Proposer'));
    expect(await screen.findByText(/déjà un tournoi en attente/)).toBeTruthy();
  });
});

describe('mes propositions', () => {
  it('aucune proposition', async () => {
    api.mine.mockResolvedValue({ tournaments: [] });
    await renderWith(<MyProposals />);
    expect(await screen.findByText('Vous n’avez encore proposé aucun tournoi.')).toBeTruthy();
  });

  it('distingue brouillon, en attente, approuvé, refusé, retiré, annulé', async () => {
    const ids = ['a', 'b', 'c', 'd', 'e', 'f'].map(
      (c) => `${c.repeat(8)}-0000-4000-8000-000000000000`,
    );
    api.mine.mockResolvedValue({
      tournaments: [
        summary({ tournamentId: ids[0]!, status: 'DRAFT' }),
        summary({ tournamentId: ids[1]!, status: 'PENDING_APPROVAL' }),
        summary({ tournamentId: ids[2]!, status: 'REGISTRATION_OPEN' }),
        summary({
          tournamentId: ids[3]!,
          status: 'CANCELLED',
          cancellationReason: 'APPROVAL_REJECTED',
        }),
        summary({
          tournamentId: ids[4]!,
          status: 'CANCELLED',
          cancellationReason: 'CREATOR_CANCELLED',
        }),
        summary({
          tournamentId: ids[5]!,
          status: 'CANCELLED',
          cancellationReason: 'INSUFFICIENT_PLAYERS',
        }),
      ],
    });
    await renderWith(<MyProposals />);
    const labels = await Promise.all(
      ids.map(async (id) => (await screen.findByTestId(`proposal-status-${id}`)).props.children),
    );
    expect(labels).toEqual([
      'Brouillon',
      'En attente d’approbation',
      'Approuvé',
      'Refusé',
      'Retiré',
      'Annulé',
    ]);
    expect(
      screen.getByText('Votre proposition attend la validation de l’administration.'),
    ).toBeTruthy();
  });

  it('soumettre un brouillon et retirer une proposition en attente', async () => {
    const draft = summary({
      tournamentId: '11111111-0000-4000-8000-000000000000',
      status: 'DRAFT',
    });
    api.mine.mockResolvedValue({ tournaments: [draft] });
    api.submit.mockResolvedValue({
      tournament: { ...draft, status: 'PENDING_APPROVAL' },
    });
    api.withdraw.mockResolvedValue({
      tournament: { ...draft, status: 'CANCELLED' },
    });
    await renderWith(<MyProposals />);
    await fireEvent.press(await screen.findByText('Soumettre'));
    expect(api.submit).toHaveBeenCalledWith('jeton', draft.tournamentId);
    await fireEvent.press(screen.getByText('Retirer'));
    expect(api.withdraw).toHaveBeenCalledWith('jeton', draft.tournamentId);
  });
});
