/// <reference types="jest" />
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react-native';
import type { ReactNode } from 'react';
import { StyleSheet } from 'react-native';

import { tournamentsApi } from '../../services/tournaments-api';
import { useAuthStore } from '../../stores/auth-store';
import type { OfficialTournamentResults, TournamentResultView } from '../../types/tournament';
import { TournamentOfficialResultsScreen } from './TournamentResultsScreens';

jest.mock('../../services/tournaments-api', () => ({
  tournamentsApi: { results: jest.fn() },
}));
jest.mock('expo-router', () => {
  const { useEffect } = jest.requireActual('react');
  return {
    router: { push: jest.fn(), replace: jest.fn(), back: jest.fn(), canGoBack: () => true },
    useFocusEffect: (effect: () => void) => useEffect(effect, [effect]),
    useLocalSearchParams: () => ({ tournamentId: T1 }),
  };
});
jest.mock('../lobby/LobbyShell', () => ({
  LobbyShell: ({ children }: { children: ReactNode }) => children,
}));

const api = tournamentsApi as jest.Mocked<typeof tournamentsApi>;
const T1 = '11111111-1111-4111-8111-111111111111';

const row = (rank: number, overrides: Partial<TournamentResultView> = {}): TournamentResultView => ({
  rank,
  username: `joueur${rank}`,
  initialTokens: 1000,
  remainingTokens: 1000,
  gamesPlayed: 2,
  gamesWon: 1,
  score: 50,
  prizePercent: 0,
  prizeAmount: 0,
  paid: false,
  isViewer: false,
  ...overrides,
});

function official(results: TournamentResultView[]): OfficialTournamentResults {
  return {
    tournament: {
      tournamentId: T1,
      status: 'COMPLETED',
      creatorType: 'ADMIN',
      timezone: 'Africa/Douala',
      startsAt: new Date(2026, 9, 12, 18, 0).toISOString(),
      endsAt: new Date(2026, 9, 12, 20, 0).toISOString(),
      registrationClosesAt: new Date(2026, 9, 12, 18, 0).toISOString(),
      entryFee: 1000,
      currency: 'XAF',
      minimumPlayers: 20,
      initialTournamentTokens: 1000,
      stakePerGame: 100,
      prizeRules: [
        { rank: 1, percent: 70 },
        { rank: 2, percent: 30 },
      ],
    },
    publishedAt: new Date(2026, 9, 12, 20, 5).toISOString(),
    participants: results.length,
    rules: {
      method: 'D106_CAPITAL_RATIO',
      tokensWeightPercent: 60,
      gamesWeightPercent: 40,
      gamesReference: 42,
    },
    results,
    me: null,
    share: '',
  };
}

const clients: QueryClient[] = [];
async function renderResults(results: TournamentResultView[]) {
  api.results.mockResolvedValue(official(results));
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: Infinity } },
  });
  clients.push(queryClient);
  await render(
    <QueryClientProvider client={queryClient}>
      <TournamentOfficialResultsScreen />
    </QueryClientProvider>,
  );
  await screen.findByTestId('tournament-official-results');
}

beforeEach(() => {
  jest.clearAllMocks();
  useAuthStore.getState().signIn('jeton');
});
afterEach(async () => {
  await cleanup();
  clients.splice(0).forEach((client) => client.clear());
});

describe('colonne « Gain » du classement officiel', () => {
  it('dernière colonne, les colonnes existantes gardent leur ordre', async () => {
    await renderResults([row(1)]);
    const head = screen.getByTestId('tournament-results-columns');
    expect(within(head).queryAllByText(/./).map((n) => n.props.children)).toEqual([
      'Rang',
      'Joueur',
      'Parties',
      'Jetons',
      'Score',
      'Gain',
    ]);
    // Dans chaque ligne aussi, le gain est la dernière cellule.
    const line = screen.getByTestId('tournament-results-row-1');
    const cells = within(line).queryAllByText(/./);
    expect(cells[cells.length - 1]!.props.testID).toBe('tournament-results-prize-1');
  });

  it('montant officiel du serveur (jamais recalculé), 0 FCFA sans gain', async () => {
    await renderResults([
      row(1, { username: 'ben', prizeAmount: 13_300, prizePercent: 70, paid: true }),
      // Montant reçu tel quel, même s'il diffère d'un calcul « pourcentage × cagnotte ».
      row(2, { username: 'ana', prizeAmount: 5_701, prizePercent: 30, paid: true }),
      row(3, { username: 'cid' }),
    ]);
    expect(screen.getByTestId('tournament-results-prize-1')).toHaveTextContent(/^13\s300\sFCFA$/);
    expect(screen.getByTestId('tournament-results-prize-2')).toHaveTextContent(/^5\s701\sFCFA$/);
    expect(screen.getByTestId('tournament-results-prize-3')).toHaveTextContent(/^0\sFCFA$/);
    expect(screen.getByTestId('tournament-results-row-1').props.accessibilityLabel).toMatch(
      /Gain 13\s300\sFCFA/,
    );
  });

  it('gain attribué mais pas encore crédité : signalé en cours, jamais présenté comme versé', async () => {
    await renderResults([
      row(1, { prizeAmount: 9000, paid: false }),
      row(2, { prizeAmount: 3000, paid: true }),
    ]);
    expect(screen.getByTestId('tournament-results-prize-1')).toHaveTextContent(
      /^9\s000\sFCFA ⏳$/,
    );
    expect(screen.getByTestId('tournament-results-row-1').props.accessibilityLabel).toContain(
      'versement en cours',
    );
    expect(screen.getByTestId('tournament-results-prize-2')).toHaveTextContent(/^3\s000\sFCFA$/);
    expect(screen.getByTestId('tournament-results-row-2').props.accessibilityLabel).not.toContain(
      'versement en cours',
    );
  });

  it('« Votre résultat » : 5 cartes en haut ; Pondérations sous les 3 premières, Gain sous les 2 dernières', async () => {
    api.results.mockResolvedValue({
      ...official([row(1, { isViewer: true })]),
      me: {
        rank: 1,
        score: 50,
        initialTokens: 1000,
        remainingTokens: 1000,
        gamesPlayed: 2,
        gamesWon: 1,
        tokensRatio: 1,
        gamesRatio: 0.05,
        tokensPoints: 60,
        gamesPoints: 2,
        prizeAmount: 0,
        paid: false,
      },
    });
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false, gcTime: Infinity } },
    });
    clients.push(queryClient);
    await render(
      <QueryClientProvider client={queryClient}>
        <TournamentOfficialResultsScreen />
      </QueryClientProvider>,
    );
    const card = await screen.findByTestId('tournament-my-result');
    // Grille de 5 colonnes de même largeur, déduite de la largeur mesurée.
    const grid = within(card).getByTestId('tournament-my-facts');
    await act(async () => {
      fireEvent(grid, 'layout', { nativeEvent: { layout: { x: 0, y: 0, width: 600, height: 200 } } });
    });
    const gap = StyleSheet.flatten(grid.props.style).gap as number;
    const column = Math.floor((600 - 4 * gap) / 5);
    const widthOf = (label: string) =>
      StyleSheet.flatten(within(card).getByText(label).parent!.props.style).width;
    const top = ['Rang final', 'Score final', 'Capital initial', 'Jetons restants', 'Parties jouées'];
    for (const label of top) expect(widthOf(label)).toBe(column);
    // Bords alignés : Pondérations = 3 colonnes (Rang final → Capital initial), Gain = 2 colonnes
    // (Jetons restants → Parties jouées).
    expect(widthOf('Pondérations')).toBe(3 * column + 2 * gap);
    expect(widthOf('Gain')).toBe(2 * column + gap);
    expect(3 * column + 2 * gap + gap + 2 * column + gap).toBeLessThanOrEqual(600);
    const labels = [...top, 'Pondérations', 'Gain'];
    const order = within(grid)
      .getAllByText(new RegExp(`^(${labels.join('|')})$`))
      .map((n) => n.props.children);
    expect(order).toEqual(labels);
    // Pondérations de nouveau sur une seule ligne (carte large).
    expect(within(grid).getByText('60 % jetons · 40 % parties')).toBeTruthy();
  });

  it('« Récompense réelle » juste sous les cartes, pleine largeur (visible sans défiler)', async () => {
    api.results.mockResolvedValue({
      ...official([row(1, { isViewer: true, prizeAmount: 9000, paid: true })]),
      me: {
        rank: 1,
        score: 50,
        initialTokens: 1000,
        remainingTokens: 1000,
        gamesPlayed: 2,
        gamesWon: 1,
        tokensRatio: 1,
        gamesRatio: 0.05,
        tokensPoints: 60,
        gamesPoints: 2,
        prizeAmount: 9000,
        paid: true,
        payout: { amount: 9000, status: 'CREDITED' },
      },
    });
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false, gcTime: Infinity } },
    });
    clients.push(queryClient);
    await render(
      <QueryClientProvider client={queryClient}>
        <TournamentOfficialResultsScreen />
      </QueryClientProvider>,
    );
    const card = await screen.findByTestId('tournament-my-result');
    const payout = within(card).getByTestId('tournament-my-payout');
    expect(payout).toHaveTextContent(/Récompense réelle : 9\s000\sFCFA/);
    expect(StyleSheet.flatten(payout.props.style)).toMatchObject({ alignSelf: 'stretch' });
    // Ordre dans la carte : grille des cartes, puis la récompense, puis les explications.
    const ids = (card.children as readonly unknown[]).map((c) =>
      typeof c === 'string' ? undefined : (c as { props: { testID?: string } }).props.testID,
    );
    const grid = ids.indexOf('tournament-my-facts');
    expect(ids[grid + 1]).toBe('tournament-my-payout');
  });

  it('mobile : largeur fixe, montant ajusté plutôt que coupé, ligne de hauteur fixe', async () => {
    await renderResults([row(1, { prizeAmount: 1_234_567_890, paid: true })]);
    const prize = screen.getByTestId('tournament-results-prize-1');
    expect(prize.props).toMatchObject({ numberOfLines: 1, adjustsFontSizeToFit: true });
    expect(StyleSheet.flatten(prize.props.style)).toMatchObject({ width: 96 });
    expect(StyleSheet.flatten(screen.getByTestId('tournament-results-row-1').props.style)).toMatchObject(
      { height: 40 },
    );
  });
});
