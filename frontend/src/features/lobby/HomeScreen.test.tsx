/// <reference types="jest" />
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react-native';
import { router } from 'expo-router';
import type { ReactNode } from 'react';

import { sessionsApi } from '../../services/sessions-api';
import { tournamentsApi } from '../../services/tournaments-api';
import { useAuthStore } from '../../stores/auth-store';
import type { OpenTable } from '../../types/session';
import type { TournamentView } from '../../types/tournament';
import {
  participant,
  registration,
  tournamentView,
} from '../tournaments/tournament-fixtures.test-utils';
import { HomeScreen } from './HomeScreen';

jest.mock('../../services/tournaments-api', () => ({
  tournamentsApi: {
    list: jest.fn(),
    notifications: jest.fn().mockResolvedValue({ notifications: [], unread: 0 }),
    markNotificationRead: jest.fn().mockResolvedValue({ read: true }),
  },
}));
jest.mock('../../services/sessions-api', () => ({
  sessionsApi: { listOpen: jest.fn() },
}));
jest.mock('expo-router', () => {
  const { useEffect } = jest.requireActual('react');
  return {
    router: { push: jest.fn(), replace: jest.fn(), setParams: jest.fn() },
    useLocalSearchParams: () => mockSearchParams,
    useFocusEffect: (effect: () => void) => useEffect(effect, [effect]),
  };
});
let mockSearchParams: { panel?: string } = {};
// La coquille (HUD, portefeuille, profil) n'est pas l'objet de ces tests.
const mockOpenPanel = jest.fn();
let mockOpenedPanel: string | null = null;
jest.mock('./LobbyShell', () => ({
  LobbyShell: ({ children }: { children: ReactNode }) => children,
  useLobbyPanels: () => ({ openPanel: mockOpenPanel, panel: mockOpenedPanel }),
}));

const api = tournamentsApi as jest.Mocked<typeof tournamentsApi>;
const listOpen = sessionsApi.listOpen as jest.Mock;
const push = router.push as jest.Mock;

// Heures LOCALES : l'affichage suit le fuseau du téléphone, quel que soit celui des tests.
const local = (h: number, min = 0) => new Date(2026, 9, 12, h, min).toISOString();
const view = (overrides: Partial<TournamentView> = {}): TournamentView =>
  tournamentView({
    startsAt: local(18),
    endsAt: local(19, 30),
    registrationClosesAt: local(18),
    serverNow: local(16),
    ...overrides,
  });
const serve = (tournaments: TournamentView[]) =>
  api.list.mockResolvedValue({
    tournaments,
    history: [],
    serverNow: local(16),
  });

const clients: QueryClient[] = [];
async function renderHome() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: Infinity } },
  });
  clients.push(queryClient);
  await render(
    <QueryClientProvider client={queryClient}>
      <HomeScreen />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  jest.clearAllMocks();
  listOpen.mockResolvedValue({ tables: [] });
  mockSearchParams = {};
  mockOpenedPanel = null;
  useAuthStore.getState().signIn('jeton');
});
afterEach(async () => {
  await cleanup();
  clients.splice(0).forEach((client) => client.clear());
});

describe('accueil : ouverture demandée de la création de partie', () => {
  it('paramètre panel=private (« Non merci » à la géolocalisation) : panneau Partie privée ouvert, paramètre effacé', async () => {
    serve([]);
    mockSearchParams = { panel: 'private' };
    await renderHome();
    expect(mockOpenPanel).toHaveBeenCalledWith('private');
    expect(router.setParams).toHaveBeenCalledWith({ panel: undefined });
  });

  it('sans paramètre : aucun panneau ouvert automatiquement', async () => {
    serve([]);
    await renderHome();
    expect(mockOpenPanel).not.toHaveBeenCalled();
  });
});

describe('accueil : panneau Tournois (D-059, D-065)', () => {
  it('« + Proposer un tournoi » présent une seule fois (Tournois), ouvre le parcours existant', async () => {
    serve([]);
    await renderHome();
    const buttons = screen.getAllByRole('button', {
      name: 'Proposer un tournoi',
    });
    expect(buttons).toHaveLength(1);
    expect(screen.getByText('+')).toBeTruthy();
    await fireEvent.press(buttons[0]!);
    expect(push).toHaveBeenCalledWith('/tournament/propose');
  });

  it('troisième panneau Garam Tia (D-119) : même bouton « Rejoindre », ouvre son panneau', async () => {
    serve([]);
    await renderHome();
    expect(screen.getAllByRole('button', { name: /^Rejoindre : / })).toHaveLength(3);
    await fireEvent.press(screen.getByRole('button', { name: 'Rejoindre : Garam Tia' }));
    expect(mockOpenPanel).toHaveBeenCalledWith('garam');
    expect(push).not.toHaveBeenCalled();
  });

  it('boutons existants inchangés : Rejoindre Fap-Fap et Rejoindre Tournois (liste complète)', async () => {
    serve([]);
    await renderHome();
    expect(screen.getByText('À toi de jouer !')).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: 'Rejoindre : Fap-Fap' }));
    expect(mockOpenPanel).toHaveBeenCalledWith('private');
    await fireEvent.press(screen.getByRole('button', { name: 'Rejoindre : Tournois' }));
    expect(push).toHaveBeenCalledWith('/tournament');
  });

  it('résumé compact du prochain tournoi : date, horaires, statut, participation, inscrits / minimum, rangs, inscription', async () => {
    serve([view()]);
    await renderHome();
    const summary = await screen.findByTestId('home-tournament-summary');
    expect(screen.getByText('12/10/2026')).toBeTruthy();
    expect(screen.getByText('🕐 18:00 — 19:30')).toBeTruthy();
    expect(screen.getByText('Inscriptions ouvertes')).toBeTruthy();
    // Une information par élément : elles passent à la ligne au lieu de rétrécir (mobile).
    expect(screen.getByText('💰 1 000 FCFA')).toBeTruthy();
    expect(screen.getByText('👥 12/20')).toBeTruthy();
    expect(screen.getByText('🏆 3 premiers rangs')).toBeTruthy();
    expect(screen.getByText('Non inscrit')).toBeTruthy();
    expect(api.list).toHaveBeenCalledWith('jeton');
    // Un appui ouvre la fiche (inscription) ; les boutons du panneau restent utilisables.
    await fireEvent.press(summary);
    expect(push).toHaveBeenCalledWith('/tournament/33333333-3333-4333-8333-333333333333');
    expect(screen.getByRole('button', { name: 'Proposer un tournoi' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Rejoindre : Tournois' })).toBeTruthy();
  });

  it('joueur inscrit : « ✓ Inscrit » ; tournoi en cours où il participe : prioritaire', async () => {
    const later = view({
      tournamentId: '55555555-5555-4555-8555-555555555555',
      startsAt: new Date(2026, 9, 13, 18).toISOString(),
      endsAt: new Date(2026, 9, 13, 19).toISOString(),
      registration,
      canRegister: false,
    });
    const live = view({
      status: 'IN_PROGRESS',
      startsAt: local(15),
      endsAt: local(17),
      registration,
      account: participant,
      canRegister: false,
      canJoin: true,
    });
    serve([live, later]);
    await renderHome();
    await screen.findByTestId('home-tournament-summary');
    expect(screen.getByText('En cours')).toBeTruthy();
    expect(screen.getByText('✓ Inscrit')).toBeTruthy();
  });

  it('tournoi « à venir » dont l’heure est passée sur l’horloge du serveur : jamais présenté à venir', async () => {
    serve([view({ startsAt: local(15), endsAt: local(17) })]);
    await renderHome();
    await waitFor(() => expect(api.list).toHaveBeenCalled());
    expect(screen.queryByTestId('home-tournament-summary')).toBeNull();
    expect(screen.queryByText('Inscriptions ouvertes')).toBeNull();
  });

  it('aucun tournoi : rien n’est affiché (aucune date inventée)', async () => {
    serve([]);
    await renderHome();
    await waitFor(() => expect(api.list).toHaveBeenCalled());
    expect(screen.queryByTestId('home-tournament-summary')).toBeNull();
  });

  it('serveur injoignable : rien n’est affiché, le panneau reste utilisable', async () => {
    api.list.mockRejectedValue(new Error('réseau'));
    await renderHome();
    await waitFor(() => expect(api.list).toHaveBeenCalled());
    expect(screen.queryByTestId('home-tournament-summary')).toBeNull();
    expect(screen.getByRole('button', { name: 'Proposer un tournoi' })).toBeTruthy();
  });
});

describe('accueil : emblème du panneau Garam Tia', () => {
  it('trois cartes face visible : 3 de carreau, As de pique, 7 de carreau (de gauche à droite)', async () => {
    serve([]);
    await renderHome();
    const garam = screen.getByTestId('game-identity-GARAM', { includeHiddenElements: true });
    const values = within(garam)
      .getAllByTestId(/^card-value-/, { includeHiddenElements: true })
      .map((node) => node.props.testID);
    expect(values).toEqual(['card-value-3', 'card-value-A', 'card-value-7']);
    // L'As est un As de PIQUE (noir) : deux piques de coin et un grand pique central ; le 3 et
    // le 7 restent des carreaux rouges.
    expect(
      within(garam).getAllByTestId(/^spade-pip/, { includeHiddenElements: true }),
    ).toHaveLength(3);
    // Le 3 et le 7 de carreau sont dessinés à l'identique : même grand carreau central.
    const diamonds = within(garam).getAllByTestId('diamond-pip-center', {
      includeHiddenElements: true,
    });
    expect(diamonds).toHaveLength(2);
    // Le pique central de l'As : même place sur sa carte (milieu) et même taille que les
    // carreaux centraux du 3 et du 7.
    const spade = within(garam).getByTestId('spade-pip-center', { includeHiddenElements: true });
    expect(spade).toBeTruthy();
    // Fap-Fap n'a pas de cartes face visible : aucune valeur sur son emblème.
    const fapFap = screen.getByTestId('game-identity-TER', { includeHiddenElements: true });
    expect(
      within(fapFap).queryAllByTestId(/^card-value-/, { includeHiddenElements: true }),
    ).toHaveLength(0);
  });
});

describe('accueil : repère graphique du jeu du tournoi (D-124)', () => {
  /** Repère du résumé (hors lecteurs d'écran : décoratif, le jeu est dans le libellé). */
  const marker = (id: string) => screen.queryByTestId(id, { includeHiddenElements: true });
  const inSummary = (id: string) =>
    within(screen.getByTestId('home-tournament-summary')).queryAllByTestId(id, {
      includeHiddenElements: true,
    });

  it('tournoi FAP-FAP : uniquement la flèche gauche et l’identité Fap-Fap, à gauche du statut', async () => {
    serve([view({ gameType: 'TER' })]);
    await renderHome();
    const summary = await screen.findByTestId('home-tournament-summary');
    expect(marker('tournament-game-TER')).toBeTruthy();
    expect(inSummary('tournament-game-arrow-left')).toHaveLength(1);
    expect(inSummary('game-identity-TER')).toHaveLength(1);
    // Jamais l'autre jeu, jamais l'autre flèche.
    expect(marker('tournament-game-GARAM')).toBeNull();
    expect(inSummary('tournament-game-arrow-right')).toHaveLength(0);
    expect(inSummary('game-identity-GARAM')).toHaveLength(0);
    // Flèche, PUIS identité, PUIS pastille de statut (repère tourné vers le panneau Fap-Fap).
    const row = screen.getByTestId('tournament-game-TER', { includeHiddenElements: true });
    expect(row.children.map((c) => (typeof c === 'string' ? c : c.props.testID))).toEqual([
      'tournament-game-arrow-left',
      'tournament-game-identity',
    ]);
    expect(row.parent?.children.at(-1)).not.toBe(row);
    // Aucun nom de jeu en texte à l'écran ; il n'est dit qu'aux lecteurs d'écran.
    expect(within(summary).queryByText(/fap-fap|garam/i)).toBeNull();
    expect(summary.props.accessibilityLabel).toMatch(/^Fap-Fap, /);
  });

  it('tournoi GARAM TIA : uniquement l’identité Garam Tia et la flèche droite, à droite du statut', async () => {
    serve([view({ gameType: 'GARAM' })]);
    await renderHome();
    const summary = await screen.findByTestId('home-tournament-summary');
    expect(marker('tournament-game-GARAM')).toBeTruthy();
    expect(inSummary('tournament-game-arrow-right')).toHaveLength(1);
    expect(inSummary('game-identity-GARAM')).toHaveLength(1);
    expect(marker('tournament-game-TER')).toBeNull();
    expect(inSummary('tournament-game-arrow-left')).toHaveLength(0);
    expect(inSummary('game-identity-TER')).toHaveLength(0);
    const row = screen.getByTestId('tournament-game-GARAM', { includeHiddenElements: true });
    expect(row.children.map((c) => (typeof c === 'string' ? c : c.props.testID))).toEqual([
      'tournament-game-identity',
      'tournament-game-arrow-right',
    ]);
    expect(row.parent?.children.at(-1)).toBe(row);
    expect(within(summary).queryByText(/fap-fap|garam/i)).toBeNull();
    expect(summary.props.accessibilityLabel).toMatch(/^Garam Tia, /);
  });

  it('jamais les deux jeux à la fois : une seule flèche et une seule identité dans le résumé', async () => {
    for (const gameType of ['TER', 'GARAM'] as const) {
      serve([view({ gameType })]);
      await renderHome();
      await screen.findByTestId('home-tournament-summary');
      expect(inSummary('tournament-game-identity')).toHaveLength(1);
      expect(
        inSummary('tournament-game-arrow-left').length +
          inSummary('tournament-game-arrow-right').length,
      ).toBe(1);
      await cleanup();
    }
  });

  it('nom du tournoi trompeur : seul le vrai gameType décide, jamais le nom', async () => {
    serve([view({ gameType: 'TER', name: 'Grand tournoi GARAM' } as Partial<TournamentView>)]);
    await renderHome();
    await screen.findByTestId('home-tournament-summary');
    expect(marker('tournament-game-TER')).toBeTruthy();
    expect(marker('tournament-game-GARAM')).toBeNull();
  });

  it('jeu absent ou inconnu : aucun repère ajouté, le résumé reste affiché', async () => {
    serve([view({ gameType: undefined }), view({ gameType: 'POKER' as never })]);
    await renderHome();
    await screen.findByTestId('home-tournament-summary');
    expect(inSummary('tournament-game-identity')).toHaveLength(0);
    expect(inSummary('tournament-game-arrow-left')).toHaveLength(0);
    expect(inSummary('tournament-game-arrow-right')).toHaveLength(0);
  });

  it('aucun tournoi : aucun repère de jeu', async () => {
    serve([]);
    await renderHome();
    await waitFor(() => expect(api.list).toHaveBeenCalled());
    expect(marker('tournament-game-TER')).toBeNull();
    expect(marker('tournament-game-GARAM')).toBeNull();
    expect(marker('tournament-game-identity')).toBeNull();
  });

  it('aucun débordement ni statut tronqué : la pastille passe à la ligne plutôt que d’être coupée', async () => {
    serve([view({ gameType: 'GARAM' })]);
    await renderHome();
    await screen.findByTestId('home-tournament-summary');
    const row = screen.getByTestId('tournament-game-GARAM', { includeHiddenElements: true });
    const flat = (style: unknown) => Object.assign({}, ...[style].flat(Infinity).filter(Boolean));
    // Ni le repère ni la pastille ne rétrécissent : faute de place, la ligne se replie.
    expect(flat(row.props.style)).toMatchObject({ flexShrink: 0 });
    const line = row.parent!;
    expect(flat(line.props.style)).toMatchObject({
      flexDirection: 'row',
      flexWrap: 'wrap',
      maxWidth: '100%',
    });
    const chip = line.children.find((c) => c !== row && typeof c !== 'string');
    expect(flat(typeof chip === 'string' ? {} : chip?.props.style)).toMatchObject({
      flexShrink: 0,
      maxWidth: '100%',
    });
    // Panneau très étroit : le statut rétrécit pour rester entier, jamais « Inscriptions ouv… ».
    const status = screen.getByText('Inscriptions ouvertes');
    expect(status.props.adjustsFontSizeToFit).toBe(true);
    expect(status.props.minimumFontScale).toBe(0.6);
    // Taille du repère tirée du texte du résumé (qui suit la largeur du panneau) : jamais fixe.
    const arrow = screen.getByTestId('tournament-game-arrow-right', {
      includeHiddenElements: true,
    });
    expect(flat(arrow.props.style).fontSize).toBeLessThanOrEqual(Math.round(15 * 1.15));
  });
});

describe('accueil : avertissement de l’administration (D-079)', () => {
  it('affiche le message non lu tel quel, « J’ai compris » le marque lu', async () => {
    serve([]);
    api.notifications.mockResolvedValue({
      notifications: [
        {
          id: 'n-1',
          type: 'MODERATION_WARNING',
          payload: { message: 'Merci de rester courtois <b>dans le chat</b>.' },
          createdAt: local(15),
        },
      ],
      unread: 1,
    });
    await renderHome();
    expect(await screen.findByText('Merci de rester courtois <b>dans le chat</b>.')).toBeTruthy();
    fireEvent.press(screen.getByRole('button', { name: 'J’ai compris' }));
    await waitFor(() =>
      expect(api.markNotificationRead).toHaveBeenCalledWith(expect.anything(), 'n-1'),
    );
  });

  it('avertissement déjà lu : rien n’est affiché', async () => {
    serve([]);
    api.notifications.mockResolvedValue({
      notifications: [
        {
          id: 'n-2',
          type: 'MODERATION_WARNING',
          payload: { message: 'Ancien avertissement' },
          createdAt: local(15),
          readAt: local(15, 30),
        },
      ],
      unread: 0,
    });
    await renderHome();
    await waitFor(() => expect(api.notifications).toHaveBeenCalled());
    expect(screen.queryByText('Ancien avertissement')).toBeNull();
  });
});

const table = (overrides: Partial<OpenTable> = {}): OpenTable => ({
  sessionId: '77777777-7777-4777-8777-777777777777',
  gameId: '88888888-8888-4888-8888-888888888888',
  name: 'Table',
  creatorName: 'Awa',
  hasPassword: false,
  ...overrides,
}) as OpenTable;
const tables = (count: number, overrides: Partial<OpenTable> = {}) =>
  Array.from({ length: count }, (_, i) => table({ sessionId: `s-${i}`, ...overrides }));

describe('accueil : nombre de parties à rejoindre (Fap-Fap → TER, Garam Tia → GARAM)', () => {
  const serveTables = (ter: OpenTable[], garam: OpenTable[]) =>
    listOpen.mockImplementation((_token: string, gameType: string = 'TER') =>
      Promise.resolve({ tables: gameType === 'GARAM' ? garam : ter }),
    );
  const counter = async (gameType: 'TER' | 'GARAM', text: string) =>
    within(await screen.findByTestId(`open-games-${gameType}`)).findByText(text);

  it.each([
    [0, 0, '🃏 0 partie en cours', '🃏 0 partie en cours'],
    [1, 1, '🃏 1 partie en cours', '🃏 1 partie en cours'],
    [3, 2, '🃏 3 parties en cours', '🃏 2 parties en cours'],
  ])('%i Fap-Fap / %i Garam : chaque panneau compte son jeu', async (ter, garam, terText, garamText) => {
    serve([]);
    serveTables(tables(ter), tables(garam, { gameType: 'GARAM' }));
    await renderHome();
    expect(await counter('TER', terText)).toBeTruthy();
    expect(await counter('GARAM', garamText)).toBeTruthy();
    expect(listOpen).toHaveBeenCalledWith('jeton', 'TER');
    expect(listOpen).toHaveBeenCalledWith('jeton', 'GARAM');
  });

  it('même filtre que « Rechercher une partie » : les tables sans nom ne comptent pas', async () => {
    serve([]);
    serveTables([table(), table({ sessionId: 's-old', name: undefined })], []);
    await renderHome();
    expect(await counter('TER', '🃏 1 partie en cours')).toBeTruthy();
  });

  it('API en erreur : aucun chiffre inventé, les panneaux restent utilisables', async () => {
    serve([]);
    listOpen.mockRejectedValue(new Error('réseau'));
    await renderHome();
    await waitFor(() => expect(listOpen).toHaveBeenCalledTimes(2));
    expect(screen.queryByTestId('open-games-TER')).toBeNull();
    expect(screen.queryByTestId('open-games-GARAM')).toBeNull();
    expect(screen.getAllByRole('button', { name: /^Rejoindre : / })).toHaveLength(3);
  });

  it('réponse attendue : place du compteur réservée, invisible, sans aucun chiffre', async () => {
    serve([]);
    listOpen.mockReturnValue(new Promise(() => undefined));
    await renderHome();
    for (const gameType of ['TER', 'GARAM']) {
      const reserved = screen.getByTestId(`open-games-${gameType}-reserved`, {
        includeHiddenElements: true,
      });
      expect(reserved).toHaveStyle({ opacity: 0 });
      expect(screen.queryByTestId(`open-games-${gameType}`)).toBeNull();
    }
    expect(screen.queryByText(/en cours/)).toBeNull();
  });
});

describe('accueil : titre « À toi de jouer ! » et panneaux ouverts', () => {
  it('aucun panneau : titre affiché', async () => {
    serve([]);
    await renderHome();
    expect(screen.getByRole('header', { name: 'À toi de jouer !' })).toBeTruthy();
  });

  it.each(['profile', 'settings', 'shop'])(
    'panneau %s ouvert : le titre n’est plus affiché (le panneau est seul au premier plan)',
    async (panel) => {
      serve([]);
      mockOpenedPanel = panel;
      await renderHome();
      expect(screen.queryByText('À toi de jouer !')).toBeNull();
      // Le reste de l'accueil est inchangé derrière le panneau.
      expect(screen.getAllByRole('button', { name: /^Rejoindre : / })).toHaveLength(3);
    },
  );
});
