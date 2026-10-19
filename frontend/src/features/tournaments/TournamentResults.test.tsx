/// <reference types="jest" />
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react-native';
import { router } from 'expo-router';
import type { ReactNode } from 'react';
import { StyleSheet } from 'react-native';

import { colors } from '../../constants/theme';
import { ApiError } from '../../lib/api-client';
import { tournamentsApi } from '../../services/tournaments-api';
import { useAuthStore } from '../../stores/auth-store';
import type {
  OfficialTournamentResults,
  TournamentContext,
  TournamentResultView,
} from '../../types/tournament';
import { TournamentTableHud } from '../games/table/TournamentTableHud';
import {
  rankingLayout,
  TournamentOfficialResultsScreen,
  TournamentResultsHistoryScreen,
} from './TournamentResultsScreens';

jest.mock('../../services/tournaments-api', () => ({
  tournamentsApi: { results: jest.fn(), resultsHistory: jest.fn(), myContext: jest.fn() },
}));
const mockParams: { tournamentId?: string } = {};
jest.mock('expo-router', () => {
  const { useEffect } = jest.requireActual('react');
  return {
    router: { push: jest.fn(), replace: jest.fn(), back: jest.fn(), canGoBack: () => true },
    useFocusEffect: (effect: () => void) => useEffect(effect, [effect]),
    useLocalSearchParams: () => mockParams,
  };
});
jest.mock('../lobby/LobbyShell', () => ({
  LobbyShell: ({ children }: { children: ReactNode }) => children,
}));

const api = tournamentsApi as jest.Mocked<typeof tournamentsApi>;
const push = router.push as jest.Mock;
const T1 = '11111111-1111-4111-8111-111111111111';

const row = (
  rank: number,
  overrides: Partial<TournamentResultView> = {},
): TournamentResultView => ({
  rank,
  username: `joueur${rank}`,
  initialTokens: 1000,
  remainingTokens: 1000,
  gamesPlayed: 0,
  gamesWon: 0,
  score: 50,
  prizePercent: 0,
  prizeAmount: 0,
  paid: false,
  isViewer: false,
  ...overrides,
});

function official(overrides: Partial<OfficialTournamentResults> = {}): OfficialTournamentResults {
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
      prizeRules: [{ rank: 1, percent: 100 }],
    },
    publishedAt: new Date(2026, 9, 12, 20, 5).toISOString(),
    participants: 4,
    rules: {
      method: 'D106_CAPITAL_RATIO',
      tokensWeightPercent: 60,
      gamesWeightPercent: 40,
      gamesReference: 42,
    },
    results: [
      row(1, {
        username: 'ben',
        remainingTokens: 1300,
        gamesPlayed: 3,
        score: 80.857,
        prizeAmount: 9000,
      }),
      row(2, {
        username: 'ana',
        remainingTokens: 900,
        gamesPlayed: 3,
        score: 56.857,
        isViewer: true,
      }),
      row(3, { username: 'cid', tieBreak: 'REGISTRATION_ORDER' }),
      row(4, { username: 'dan', tieBreak: 'REGISTRATION_ORDER' }),
    ],
    me: {
      rank: 2,
      score: 56.857,
      initialTokens: 1000,
      remainingTokens: 900,
      gamesPlayed: 3,
      gamesWon: 1,
      tokensRatio: 0.9,
      gamesRatio: 0.071429,
      tokensPoints: 54,
      gamesPoints: 2.8571,
      prizeAmount: 0,
      paid: false,
    },
    share: '',
    ...overrides,
  };
}

const clients: QueryClient[] = [];
async function renderWith(node: ReactNode) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: Infinity } },
  });
  clients.push(queryClient);
  await render(<QueryClientProvider client={queryClient}>{node}</QueryClientProvider>);
}

beforeEach(() => {
  jest.clearAllMocks();
  mockParams.tournamentId = T1;
  useAuthStore.getState().signIn('jeton');
});
afterEach(async () => {
  await cleanup();
  clients.splice(0).forEach((client) => client.clear());
});

describe('classement général officiel (D-106)', () => {
  it('tous les participants dans l’ordre du serveur, ma ligne mise en évidence', async () => {
    api.results.mockResolvedValue(official());
    await renderWith(<TournamentOfficialResultsScreen />);
    const list = await screen.findByTestId('tournament-official-results');
    expect(within(list).getByText('ben')).toBeTruthy();
    expect(within(list).getByText(/cid/)).toBeTruthy();
    expect(within(list).getByText(/dan/)).toBeTruthy();
    const me = screen.getByTestId('tournament-results-me');
    expect(within(me).getByText('ana')).toBeTruthy();
    expect(within(me).getByText(' (Vous)')).toBeTruthy();
    expect(me.props.accessibilityLabel).toContain('Rang 2');
    // Départage signalé (lecteur d'écran compris).
    expect(screen.getByTestId('tournament-results-row-3').props.accessibilityLabel).toContain(
      'ordre d’inscription',
    );
  });

  it('mon résultat : rang, score, capital, jetons, parties, pondérations, détail du score', async () => {
    api.results.mockResolvedValue(official());
    await renderWith(<TournamentOfficialResultsScreen />);
    const card = await screen.findByTestId('tournament-my-result');
    // Formats français (espaces insécables fines) : `\s` les reconnaît.
    for (const text of [
      /2 \/ 4/,
      /^56,86$/,
      /^1\s000$/,
      /^900$/,
      /^3$/,
      /60 % jetons · 40 % parties/,
    ]) {
      expect(within(card).getByText(text)).toBeTruthy();
    }
    expect(within(card).getByText(/Jetons conservés : 90\s% du capital → 54 pts/)).toBeTruthy();
    expect(within(card).getByText(/Parties jouées : 3 → 2,86 pts/)).toBeTruthy();
  });

  it('non-participant : classement public seulement', async () => {
    api.results.mockResolvedValue(
      official({ me: null, results: official().results.map((r) => ({ ...r, isViewer: false })) }),
    );
    await renderWith(<TournamentOfficialResultsScreen />);
    expect(await screen.findByText(/Vous n’avez pas participé/)).toBeTruthy();
    expect(screen.queryByTestId('tournament-my-result')).toBeNull();
    expect(screen.queryByTestId('tournament-results-me')).toBeNull();
  });

  it('publication en cours : état explicite, jamais un classement provisoire', async () => {
    api.results.mockRejectedValue(
      new ApiError(409, 'TOURNAMENT_RESULTS_UNAVAILABLE', 'pas encore'),
    );
    await renderWith(<TournamentOfficialResultsScreen />);
    expect(await screen.findByTestId('tournament-results-pending')).toBeTruthy();
    expect(screen.getByText(/classement officiel est en cours de publication/)).toBeTruthy();
    expect(screen.queryByTestId('tournament-official-results')).toBeNull();
  });

  it('erreur réseau : message et nouvel essai', async () => {
    api.results.mockRejectedValue(new Error('réseau'));
    await renderWith(<TournamentOfficialResultsScreen />);
    // Erreur réseau : deux nouvelles tentatives automatiques avant l'affichage de l'erreur.
    expect(
      await screen.findByText('Impossible de charger les résultats.', {}, { timeout: 8_000 }),
    ).toBeTruthy();
    api.results.mockResolvedValue(official());
    fireEvent.press(screen.getByText('Réessayer'));
    expect(await screen.findByTestId('tournament-official-results')).toBeTruthy();
  });
});

const medalOf = (rank: number) => screen.getByTestId(`tournament-results-medal-${rank}`);
const flat = (node: { props: { style?: unknown } }) =>
  StyleSheet.flatten(node.props.style as never) as Record<string, unknown>;
const many = (count: number, overrides: (rank: number) => Partial<TournamentResultView>) =>
  Array.from({ length: count }, (_, i) => row(i + 1, overrides(i + 1)));

describe('médailles : seules les récompenses effectivement attribuées', () => {
  it('récompensé : la médaille de sa récompense ; classé sans récompense : aucune', async () => {
    api.results.mockResolvedValue(
      official({
        results: [
          row(1, { username: 'ben', prizeAmount: 6000 }),
          row(2, { username: 'ana', isViewer: true }),
          row(3, { username: 'cid' }),
          row(4, { username: 'dan', prizeAmount: 1000 }),
          row(5, { username: 'eve' }),
        ],
      }),
    );
    await renderWith(<TournamentOfficialResultsScreen />);
    await screen.findByTestId('tournament-official-results');
    expect(medalOf(1)).toHaveTextContent('🥇');
    // 2ᵉ et 3ᵉ sans prix : aucune médaille, même sur le podium, même pour moi.
    expect(medalOf(2)).toHaveTextContent('');
    expect(medalOf(3)).toHaveTextContent('');
    expect(medalOf(4)).toHaveTextContent('🏅');
    expect(medalOf(5)).toHaveTextContent('');
    // « Votre résultat » : rang sans médaille non plus.
    expect(within(screen.getByTestId('tournament-my-result')).getByText('2 / 4')).toBeTruthy();
    // Le rang reste affiché, médaille ou non.
    for (const rank of [1, 2, 3, 4, 5]) {
      const line = screen.getByTestId(
        rank === 2 ? 'tournament-results-me' : `tournament-results-row-${rank}`,
      );
      expect(within(line).getByText(String(rank))).toBeTruthy();
    }
  });

  it('même règle pour le joueur connecté : récompensé, il a sa médaille', async () => {
    api.results.mockResolvedValue(
      official({
        results: [
          row(1, { username: 'ben', prizeAmount: 6000 }),
          row(2, { username: 'ana', isViewer: true, prizeAmount: 3000 }),
          row(3, { username: 'cid' }),
        ],
        me: { ...official().me!, prizeAmount: 3000 },
      }),
    );
    await renderWith(<TournamentOfficialResultsScreen />);
    await screen.findByTestId('tournament-official-results');
    expect(medalOf(2)).toHaveTextContent('🥈');
    expect(medalOf(3)).toHaveTextContent('');
    expect(within(screen.getByTestId('tournament-my-result')).getByText('🥈 2 / 4')).toBeTruthy();
  });

  it('classement sans aucune récompense : rangs, noms et scores, sans médaille', async () => {
    api.results.mockResolvedValue(
      official({
        results: [
          row(1, { username: 'ben', score: 80.5, remainingTokens: 1300 }),
          row(2, { username: 'ana', score: 56.857, isViewer: true }),
          row(3, { username: 'cid', score: 12 }),
        ],
      }),
    );
    await renderWith(<TournamentOfficialResultsScreen />);
    await screen.findByTestId('tournament-official-results');
    for (const rank of [1, 2, 3]) expect(medalOf(rank)).toHaveTextContent('');
    const first = screen.getByTestId('tournament-results-row-1');
    expect(within(first).getByText('1')).toBeTruthy();
    expect(within(first).getByText('ben')).toBeTruthy();
    expect(within(first).getByText('80,5')).toBeTruthy();
    expect(within(first).getByText(/^1\s300$/)).toBeTruthy();
    expect(within(screen.getByTestId('tournament-results-me')).getByText('56,86')).toBeTruthy();
  });

  it.each([0, 2500])('ma ligne reste mise en évidence (prix : %d)', async (prizeAmount) => {
    api.results.mockResolvedValue(
      official({ results: [row(1, { username: 'ana', isViewer: true, prizeAmount })] }),
    );
    await renderWith(<TournamentOfficialResultsScreen />);
    const me = await screen.findByTestId('tournament-results-me');
    expect(flat(me)).toMatchObject({ borderLeftWidth: 3 });
    expect(medalOf(1)).toHaveTextContent(prizeAmount > 0 ? '🥇' : '');
  });
});

describe('classement long', () => {
  it('120 joueurs : liste virtualisée, en-tête épinglé, dernières lignes atteintes', async () => {
    api.results.mockResolvedValue(
      official({
        participants: 120,
        results: many(120, (rank) => ({ isViewer: rank === 2, prizeAmount: rank <= 3 ? 100 : 0 })),
      }),
    );
    await renderWith(<TournamentOfficialResultsScreen />);
    const list = await screen.findByTestId('tournament-official-results');
    // Index 1 = en-tête des colonnes (l'index 0 : titre et « Votre résultat »).
    expect(list.props.stickyHeaderIndices).toEqual([1]);
    expect(screen.getByTestId('tournament-results-columns')).toBeTruthy();
    // Virtualisée : jamais les 120 lignes d'un coup.
    expect(screen.queryByTestId('tournament-results-row-120')).toBeNull();
    // Défilement jusqu'en bas (écran de 400 px, lignes de 40 px) : la dernière ligne est rendue.
    const height = 400;
    const contentHeight = 40 * 122 + 300;
    await act(async () => {
      fireEvent(list, 'layout', { nativeEvent: { layout: { x: 0, y: 0, width: 800, height } } });
      fireEvent(list, 'contentSizeChange', 800, contentHeight);
    });
    for (let step = 0; step < 60 && !screen.queryByTestId('tournament-results-row-120'); step++) {
      await act(async () => {
        fireEvent.scroll(list, {
          nativeEvent: {
            contentOffset: { x: 0, y: contentHeight - height },
            contentSize: { width: 800, height: contentHeight },
            layoutMeasurement: { width: 800, height },
          },
        });
        await new Promise((resolve) => setTimeout(resolve, 20));
      });
    }
    expect(screen.getByTestId('tournament-results-row-120')).toBeTruthy();
  });

  it('noms longs et grands nombres : nom tronqué, nombres ajustés, colonnes fixes', async () => {
    const long = 'Un_pseudo_vraiment_tres_tres_long_qui_ne_tient_pas_sur_une_ligne';
    api.results.mockResolvedValue(
      official({
        results: [
          row(1, {
            username: long,
            remainingTokens: 1_234_567_890,
            gamesPlayed: 12_345,
            score: 99.99,
          }),
          row(2, { username: long, isViewer: true }),
        ],
      }),
    );
    await renderWith(<TournamentOfficialResultsScreen />);
    await screen.findByTestId('tournament-official-results');
    const first = screen.getByTestId('tournament-results-row-1');
    const name = within(first).getByText(long);
    expect(name.props.numberOfLines).toBe(1);
    expect(flat(name)).toMatchObject({ flexShrink: 1 });
    const tokens = within(first).getByText(/^1\s234\s567\s890$/);
    expect(tokens.props).toMatchObject({ numberOfLines: 1, adjustsFontSizeToFit: true });
    expect(flat(tokens).width).toBe(84);
    expect(flat(within(first).getByText('12345')).width).toBe(56);
    // Hauteur de ligne fixe : rien ne se décale d'une ligne à l'autre.
    expect(flat(first).height).toBe(40);
    // « (Vous) » reste visible même quand le nom est tronqué.
    const me = screen.getByTestId('tournament-results-me');
    expect(flat(within(me).getByText(' (Vous)'))).toMatchObject({ flexShrink: 0 });
  });

  it('petit écran : la colonne « Joueur » garde une largeur lisible, les nombres se resserrent', async () => {
    api.results.mockResolvedValue(official({ results: [row(1, { username: 'Mireille' })] }));
    await renderWith(<TournamentOfficialResultsScreen />);
    const list = await screen.findByTestId('tournament-official-results');
    const width = 420;
    await act(async () => {
      fireEvent(list, 'layout', { nativeEvent: { layout: { x: 0, y: 0, width, height: 300 } } });
    });
    const first = screen.getByTestId('tournament-results-row-1');
    const numeric = [
      flat(within(first).getAllByText('1')[0]!).width,
      flat(screen.getByTestId('tournament-results-medal-1')).width,
      flat(screen.getByTestId('tournament-results-prize-1')).width,
    ];
    for (const w of numeric) expect(w).toBeGreaterThan(0);
    const { gap, widths } = rankingLayout(width, flat(first).paddingHorizontal as number);
    const used =
      Object.values(widths).reduce((sum, w) => sum + w, 0) +
      gap * 6 +
      2 * (flat(first).paddingHorizontal as number);
    // Le nom garde au moins 96 dp (~30 % de la ligne), qui s'affiche.
    expect(width - used).toBeGreaterThanOrEqual(96);
    expect(within(first).getByText('Mireille')).toBeTruthy();
    // En-tête et lignes partagent les mêmes largeurs.
    expect(
      flat(within(screen.getByTestId('tournament-results-columns')).getByText('Gain')).width,
    ).toBe(widths.prize);
  });

  it('rankingLayout : largeurs de référence sur grand écran, jamais de colonne nom écrasée', () => {
    expect(rankingLayout(0, 8).widths.tokens).toBe(84);
    expect(rankingLayout(900, 8).widths).toMatchObject({ tokens: 84, prize: 96, games: 56 });
    for (const width of [320, 360, 420, 480, 560, 640]) {
      const { gap, widths } = rankingLayout(width, 6);
      const player = width - 12 - gap * 6 - Object.values(widths).reduce((s, w) => s + w, 0);
      expect(player).toBeGreaterThanOrEqual(Math.min(96, width * 0.25));
      expect(widths.medal).toBeGreaterThanOrEqual(24);
    }
  });
});

describe('rubrique « Résultats des tournois »', () => {
  it('mes tournois terminés, ma position ; un appui ouvre le classement complet', async () => {
    api.resultsHistory.mockResolvedValue({
      tournaments: [
        {
          tournamentId: T1,
          status: 'COMPLETED',
          timezone: 'Africa/Douala',
          startsAt: new Date(2026, 9, 12, 18, 0).toISOString(),
          endsAt: new Date(2026, 9, 12, 20, 0).toISOString(),
          participants: 24,
          resultsPublishedAt: new Date(2026, 9, 12, 20, 5).toISOString(),
          myRank: 2,
          myScore: 56.857,
        },
      ],
      nextBefore: new Date(2026, 9, 12, 20, 0).toISOString(),
    });
    await renderWith(<TournamentResultsHistoryScreen />);
    expect(await screen.findByText(/Votre position : 2 \/ 24/)).toBeTruthy();
    expect(screen.getByText(/24 participants/)).toBeTruthy();
    fireEvent.press(screen.getByTestId(`tournament-results-${T1}`));
    expect(push).toHaveBeenCalledWith(`/tournament/results/${T1}`);
  });

  it('aucun tournoi terminé : état vide explicite', async () => {
    api.resultsHistory.mockResolvedValue({ tournaments: [], nextBefore: null });
    await renderWith(<TournamentResultsHistoryScreen />);
    expect(await screen.findByText(/vos tournois terminés apparaîtront ici/)).toBeTruthy();
  });
});

describe('HUD d’une table de tournoi', () => {
  it('jetons de CE tournoi, parties, rang provisoire et temps restant (jamais le compte de jeu)', async () => {
    const now = Date.now();
    const context: TournamentContext = {
      tournamentId: T1,
      status: 'IN_PROGRESS',
      startsAt: new Date(now - 3_600_000).toISOString(),
      endsAt: new Date(now + 12 * 60_000).toISOString(),
      serverNow: new Date(now).toISOString(),
      participation: 'ACTIVE',
      tokensAllocatedAtStart: 1000,
      tokensRemaining: 1250,
      gamesPlayed: 4,
      gamesWon: 3,
      stakePerGame: 100,
      rank: 3,
      rankIsOfficial: false,
      participants: 20,
      score: 70,
      rules: {
        method: 'D106_CAPITAL_RATIO',
        tokensWeightPercent: 50,
        gamesWeightPercent: 50,
        gamesReference: 42,
      },
    };
    api.myContext.mockResolvedValue({ context });
    await renderWith(<TournamentTableHud tournamentId={T1} height={40} />);
    const hud = await screen.findByTestId('tournament-table-hud');
    expect(within(hud).getByText('1250')).toBeTruthy();
    expect(within(hud).getByText(/4 parties · #3\/20 · Fin dans 1[12] min/)).toBeTruthy();
    expect(hud.props.accessibilityLabel).toContain(
      '1250 jetons de tournoi restants (solde fictif)',
    );
    // Solde visiblement identifié comme celui du tournoi, jamais confondu avec le compte réel.
    expect(within(hud).getByTestId('tournament-table-hud-tag')).toHaveTextContent('Tournoi');
    expect(api.myContext).toHaveBeenCalledWith('jeton', T1);
  });
});

describe('récompense réelle et état du versement (D-112)', () => {
  it('créditée : montant réel annoncé crédité ; jetons de tournoi présentés sans valeur', async () => {
    api.results.mockResolvedValue(
      official({
        me: { ...official().me!, prizeAmount: 9000, payout: { amount: 9000, status: 'CREDITED' } },
      }),
    );
    await renderWith(<TournamentOfficialResultsScreen />);
    const payout = await screen.findByTestId('tournament-my-payout');
    expect(payout.props.children).toMatch(
      /Récompense réelle : 9\s000\sFCFA, créditée sur votre compte de jeu/,
    );
    // Récompense réelle surlignée en vert clair, texte vert foncé lisible.
    expect(StyleSheet.flatten(payout.props.style)).toMatchObject({
      backgroundColor: colors.successBg,
      color: colors.success,
    });
    expect(screen.getByText(/Jetons de tournoi : sans valeur monétaire/)).toBeTruthy();
  });

  it('pas encore créditée : jamais annoncée comme créditée', async () => {
    api.results.mockResolvedValue(
      official({
        me: { ...official().me!, prizeAmount: 5400, payout: { amount: 5400, status: 'PENDING' } },
      }),
    );
    await renderWith(<TournamentOfficialResultsScreen />);
    const text = (await screen.findByTestId('tournament-my-payout')).props.children as string;
    expect(text).toMatch(/versement en cours/);
    expect(text).not.toMatch(/créditée/);
  });
});

describe('carte « Gain » du résultat personnel', () => {
  it('dernière carte, juste après « Pondérations » : montant réel du classement officiel', async () => {
    api.results.mockResolvedValue(official({ me: { ...official().me!, prizeAmount: 9000 } }));
    await renderWith(<TournamentOfficialResultsScreen />);
    const card = await screen.findByTestId('tournament-my-result');
    const labels = within(card)
      .getAllByText(/^(Parties jouées|Gain|Pondérations)$/)
      .map((n) => n.props.children);
    expect(labels).toEqual(['Parties jouées', 'Pondérations', 'Gain']);
    expect(within(card).getByText(/^9\s000\sFCFA$/)).toBeTruthy();
    // Mise en évidence vert clair de la seule carte « Gain ».
    const gain = within(card).getByTestId('tournament-my-gain');
    expect(gain).toHaveStyle({ backgroundColor: '#D4F7DC' });
    expect(within(gain).getByText('Gain')).toBeTruthy();
  });

  it('non récompensé : gain de 0', async () => {
    api.results.mockResolvedValue(official({ me: { ...official().me!, prizeAmount: 0 } }));
    await renderWith(<TournamentOfficialResultsScreen />);
    const card = await screen.findByTestId('tournament-my-result');
    expect(within(card).getByText('Gain')).toBeTruthy();
    expect(within(card).getByText(/^0\sFCFA$/)).toBeTruthy();
  });
});
