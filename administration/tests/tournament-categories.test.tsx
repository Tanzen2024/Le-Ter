import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  apiStatusFilter,
  categoryOfStatus,
  onCategoryChange,
  onStatusChange,
  selectedCategory,
  statusesOfCategory,
  TOURNAMENT_CATEGORIES,
} from '@/features/tournaments/status-categories';
import { TournamentsList } from '@/features/tournaments/tournaments-list';
import { TOURNAMENT_STATUS } from '@/lib/labels';
import type { TournamentSummary } from '@/types/admin';

/** Filtre « Catégorie » de la liste des tournois, synchronisé avec « Statut ». */

const get = vi.fn();
vi.mock('@/lib/api/client', () => ({
  api: { get: (path: string, query?: unknown) => get(path, query), post: vi.fn(), patch: vi.fn() },
  downloadUrl: (path: string) => path,
  idempotencyKey: () => 'k',
}));

// URL simulée : `replace` la modifie, puis la page est re-rendue avec les nouveaux paramètres.
let params = new URLSearchParams();
const replace = vi.fn((url: string) => {
  params = new URLSearchParams(url.split('?')[1] ?? '');
});
vi.mock('next/navigation', () => ({
  useSearchParams: () => params,
  usePathname: () => '/tournois',
  useRouter: () => ({ replace, push: vi.fn() }),
}));

const ALL_STATUSES = Object.keys(TOURNAMENT_STATUS) as TournamentSummary['status'][];

/** Un tournoi par statut ; le jour de début (1 à 12) suit l'ordre des statuts. */
const tournaments: TournamentSummary[] = ALL_STATUSES.map((status, i) => ({
  tournamentId: `t-${status}`,
  status,
  creatorType: 'ADMIN',
  timezone: 'Africa/Douala',
  startsAt: `2026-10-${String(i + 1).padStart(2, '0')}T17:00:00.000Z`,
  endsAt: `2026-10-${String(i + 1).padStart(2, '0')}T18:00:00.000Z`,
  registrationClosesAt: `2026-10-${String(i + 1).padStart(2, '0')}T17:00:00.000Z`,
  entryFee: 1000,
  currency: 'XAF',
  minimumPlayers: 20,
  initialTournamentTokens: 10_000,
  stakePerGame: 500,
  prizeRules: [{ rank: 1, percent: 100 }],
}));

beforeEach(() => {
  params = new URLSearchParams();
  replace.mockClear();
  get.mockReset();
  // Comme le serveur : `status` est une liste séparée par des virgules.
  get.mockImplementation((_path: string, query?: { status?: string }) => {
    const wanted = query?.status?.split(',');
    return Promise.resolve({
      tournaments: wanted ? tournaments.filter((t) => wanted.includes(t.status)) : tournaments,
    });
  });
});

describe('correspondance catégories → statuts', () => {
  it('quatre catégories exactes, chaque statut dans une seule, aucun statut ajouté', () => {
    expect(TOURNAMENT_CATEGORIES.map((c) => [c.label, [...c.statuses]])).toEqual([
      [
        'À venir',
        [
          'DRAFT',
          'PENDING_APPROVAL',
          'SCHEDULED',
          'REGISTRATION_OPEN',
          'REGISTRATION_CLOSED',
          'STARTING',
        ],
      ],
      ['En cours', ['IN_PROGRESS']],
      ['En finalisation', ['CALCULATING_RESULTS', 'RESULTS_VALIDATED', 'DISTRIBUTING_PRIZES']],
      ['Clôturé', ['COMPLETED', 'CANCELLED']],
    ]);
    // Chaque statut dans exactement une catégorie, et la catégorie retrouvée par le statut.
    for (const s of ALL_STATUSES) {
      expect(
        TOURNAMENT_CATEGORIES.filter((c) => (c.statuses as readonly string[]).includes(s)),
      ).toHaveLength(1);
    }
    expect(Object.fromEntries(ALL_STATUSES.map((s) => [s, categoryOfStatus(s)]))).toEqual({
      DRAFT: 'a-venir',
      PENDING_APPROVAL: 'a-venir',
      SCHEDULED: 'a-venir',
      REGISTRATION_OPEN: 'a-venir',
      REGISTRATION_CLOSED: 'a-venir',
      STARTING: 'a-venir',
      IN_PROGRESS: 'en-cours',
      CALCULATING_RESULTS: 'en-finalisation',
      RESULTS_VALIDATED: 'en-finalisation',
      DISTRIBUTING_PRIZES: 'en-finalisation',
      COMPLETED: 'cloture',
      CANCELLED: 'cloture',
    });
    const mapped = TOURNAMENT_CATEGORIES.flatMap((c) => [...c.statuses]);
    expect([...mapped].sort()).toEqual([...ALL_STATUSES].sort());
    expect(new Set(mapped).size).toBe(12);
  });

  it('DRAFT et PENDING_APPROVAL appartiennent à « À venir »', () => {
    expect(categoryOfStatus('DRAFT')).toBe('a-venir');
    expect(categoryOfStatus('PENDING_APPROVAL')).toBe('a-venir');
    expect(apiStatusFilter({ categorie: 'a-venir', status: '' })).toBe(
      'DRAFT,PENDING_APPROVAL,SCHEDULED,REGISTRATION_OPEN,REGISTRATION_CLOSED,STARTING',
    );
  });

  it('synchronisation : le statut précis prime, « Tous les statuts » garde la catégorie', () => {
    const none = { categorie: '', status: '' };
    expect(onCategoryChange('en-finalisation', none)).toEqual({
      categorie: 'en-finalisation',
      status: '',
    });
    expect(onCategoryChange('', none)).toEqual({ categorie: '', status: '' });
    // Statut précédent hors de la nouvelle catégorie : retour à l'option neutre.
    expect(onCategoryChange('en-cours', { categorie: 'cloture', status: 'COMPLETED' })).toEqual({
      categorie: 'en-cours',
      status: '',
    });
    // Statut précédent dans la nouvelle catégorie : il est gardé.
    expect(
      onCategoryChange('en-finalisation', { categorie: '', status: 'RESULTS_VALIDATED' }),
    ).toEqual({
      categorie: 'en-finalisation',
      status: 'RESULTS_VALIDATED',
    });
    expect(onCategoryChange('', { categorie: 'cloture', status: 'COMPLETED' })).toEqual(none);
    expect(statusesOfCategory('en-finalisation')).toEqual([
      'CALCULATING_RESULTS',
      'RESULTS_VALIDATED',
      'DISTRIBUTING_PRIZES',
    ]);
    expect(statusesOfCategory('')).toEqual(ALL_STATUSES);
    expect(onStatusChange('COMPLETED', { categorie: '', status: '' })).toEqual({
      categorie: 'cloture',
      status: 'COMPLETED',
    });
    // Statut d'une autre catégorie : la catégorie suit.
    expect(onStatusChange('CANCELLED', { categorie: 'a-venir', status: 'DRAFT' })).toEqual({
      categorie: 'cloture',
      status: 'CANCELLED',
    });
    // Retour à l'option neutre : la catégorie du statut précédent reste, sans statut précis.
    expect(onStatusChange('', { categorie: 'a-venir', status: 'SCHEDULED' })).toEqual({
      categorie: 'a-venir',
      status: '',
    });
    expect(onStatusChange('', { categorie: '', status: '' })).toEqual({
      categorie: '',
      status: '',
    });
    // URL incohérente ou inconnue : jamais de restriction inventée.
    expect(selectedCategory({ categorie: 'cloture', status: 'IN_PROGRESS' })).toBe('en-cours');
    expect(apiStatusFilter({ categorie: 'inconnue', status: '' })).toBeUndefined();
    expect(apiStatusFilter({ categorie: '', status: '' })).toBeUndefined();
  });
});

describe('liste des tournois : filtres Catégorie et Statut', () => {
  const client = () => new QueryClient({ defaultOptions: { queries: { retry: false } } });
  let qc: QueryClient;
  let rerender: (ui: React.ReactElement) => void;
  const ui = () => (
    <QueryClientProvider client={qc}>
      <TournamentsList />
    </QueryClientProvider>
  );
  function mount() {
    qc = client();
    rerender = render(ui()).rerender;
  }
  /** Applique la navigation demandée par la page (nouvelle URL), comme le routeur. */
  const navigate = () => rerender(ui());
  const category = () => screen.getByLabelText('Catégorie') as HTMLSelectElement;
  const status = () => screen.getByLabelText('Statut') as HTMLSelectElement;
  const lastQuery = () => get.mock.calls.at(-1)?.[1] as { status?: string } | undefined;
  async function rowStatuses() {
    const table = await screen.findByRole('table');
    await waitFor(() => expect(within(table).getAllByRole('row').length).toBeGreaterThan(1));
    return within(table)
      .getAllByRole('row')
      .slice(1)
      .map((row) => row.textContent ?? '');
  }

  it('« Catégorie » est immédiatement à gauche de « Statut », sans changer les autres filtres', async () => {
    mount();
    const selects = screen.getAllByRole('combobox');
    expect(selects.map((s) => s.getAttribute('aria-label'))).toEqual(['Catégorie', 'Statut']);
    expect(category().nextElementSibling).toBe(status());
    expect([...category().options].map((o) => o.text)).toEqual([
      'Toutes les catégories',
      'À venir',
      'En cours',
      'En finalisation',
      'Clôturé',
    ]);
    // Statut : les 12 statuts, comme avant.
    expect(status().options).toHaveLength(13);
    expect(status().options[0]!.text).toBe('Tous les statuts');
    expect(screen.getByText('Début du')).toBeTruthy();
    expect(screen.getByText('au')).toBeTruthy();
    // Sans filtre : aucune restriction envoyée.
    await waitFor(() => expect(get).toHaveBeenCalledWith('tournaments', undefined));
  });

  it('catégorie → tous ses statuts (DRAFT et PENDING_APPROVAL inclus) ; option neutre du statut', async () => {
    mount();
    fireEvent.change(category(), { target: { value: 'a-venir' } });
    expect(replace).toHaveBeenLastCalledWith('/tournois?categorie=a-venir', { scroll: false });
    navigate();
    expect(category().value).toBe('a-venir');
    expect(status().value).toBe('');
    expect(status().options[0]!.text).toBe('Tous les statuts de la catégorie');
    await waitFor(() =>
      expect(lastQuery()).toEqual({
        status: 'DRAFT,PENDING_APPROVAL,SCHEDULED,REGISTRATION_OPEN,REGISTRATION_CLOSED,STARTING',
      }),
    );
    const rows = await rowStatuses();
    expect(rows).toHaveLength(6);
    for (const label of ['Brouillon', 'À approuver', 'Programmé', 'Démarrage']) {
      expect(rows.some((r) => r.includes(label))).toBe(true);
    }
    expect(rows.some((r) => r.includes('Annulé'))).toBe(false);
  });

  it('statut → sa catégorie ; puis un statut précis seul dans les résultats', async () => {
    params = new URLSearchParams('categorie=en-finalisation');
    mount();
    fireEvent.change(status(), { target: { value: 'RESULTS_VALIDATED' } });
    expect(replace).toHaveBeenLastCalledWith(
      '/tournois?categorie=en-finalisation&status=RESULTS_VALIDATED',
      { scroll: false },
    );
    navigate();
    expect(category().value).toBe('en-finalisation');
    await waitFor(() => expect(lastQuery()).toEqual({ status: 'RESULTS_VALIDATED' }));
    const rows = await rowStatuses();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toContain('Résultats validés');

    // Les statuts des autres catégories ne sont pas proposés.
    expect(statusTexts()).not.toContain('À approuver');

    // Retour à « Tous les statuts de la catégorie » : la catégorie reste, tous ses statuts.
    fireEvent.change(status(), { target: { value: '' } });
    navigate();
    expect(category().value).toBe('en-finalisation');
    expect(status().value).toBe('');
    await waitFor(() => expect(lastQuery()?.status?.split(',')).toHaveLength(3));
  });

  it('« Toutes les catégories » lève toute restriction (catégorie et statut)', async () => {
    params = new URLSearchParams('categorie=a-venir&status=DRAFT&du=2026-10-01');
    mount();
    fireEvent.change(category(), { target: { value: '' } });
    // Les autres filtres (période) sont conservés.
    expect(replace).toHaveBeenLastCalledWith('/tournois?du=2026-10-01', { scroll: false });
    navigate();
    expect(category().value).toBe('');
    expect(status().value).toBe('');
    expect(status().options[0]!.text).toBe('Tous les statuts');
    await waitFor(() => expect(get).toHaveBeenLastCalledWith('tournaments', undefined));
  });

  it('sans catégorie : le filtre Statut filtre comme avant, sur ce seul statut', async () => {
    mount();
    fireEvent.change(status(), { target: { value: 'CANCELLED' } });
    navigate();
    await waitFor(() => expect(lastQuery()).toEqual({ status: 'CANCELLED' }));
    const rows = await rowStatuses();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toContain('Annulé');
    // La catégorie affichée suit le statut choisi.
    expect(category().value).toBe('cloture');
  });

  const statusTexts = () => [...status().options].map((o) => o.text);

  it('« En finalisation » : seuls ses trois statuts sont proposés', async () => {
    mount();
    fireEvent.change(category(), { target: { value: 'en-finalisation' } });
    navigate();
    expect(statusTexts()).toEqual([
      'Tous les statuts de la catégorie',
      'Calcul des résultats',
      'Résultats validés',
      'Versement des gains',
    ]);
    await waitFor(() =>
      expect(lastQuery()).toEqual({
        status: 'CALCULATING_RESULTS,RESULTS_VALIDATED,DISTRIBUTING_PRIZES',
      }),
    );
  });

  it.each([
    ['CALCULATING_RESULTS', 'en-finalisation'],
    ['COMPLETED', 'cloture'],
    ['CANCELLED', 'cloture'],
  ])('statut %s → catégorie %s', (value, expected) => {
    mount();
    fireEvent.change(status(), { target: { value } });
    navigate();
    expect(category().value).toBe(expected);
    expect(status().value).toBe(value);
  });

  it('« En cours » après COMPLETED : retour à « Tous les statuts de la catégorie »', () => {
    params = new URLSearchParams('categorie=cloture&status=COMPLETED&du=2026-10-01');
    mount();
    fireEvent.change(category(), { target: { value: 'en-cours' } });
    // La période est conservée.
    expect(replace).toHaveBeenLastCalledWith('/tournois?categorie=en-cours&du=2026-10-01', {
      scroll: false,
    });
    navigate();
    expect(category().value).toBe('en-cours');
    expect(status().value).toBe('');
    expect(statusTexts()).toEqual(['Tous les statuts de la catégorie', 'En cours']);
  });

  it('« Toutes les catégories » : les 12 statuts redeviennent disponibles', () => {
    params = new URLSearchParams('categorie=en-finalisation');
    mount();
    expect(status().options).toHaveLength(4);
    fireEvent.change(category(), { target: { value: '' } });
    navigate();
    expect(status().options).toHaveLength(13);
  });

  it('actualisation avec des filtres dans l’URL : les deux listes restent cohérentes', async () => {
    // URL incohérente : le statut précis prime, sa catégorie et ses options suivent.
    params = new URLSearchParams('categorie=en-cours&status=RESULTS_VALIDATED');
    mount();
    expect(category().value).toBe('en-finalisation');
    expect(status().value).toBe('RESULTS_VALIDATED');
    expect(status().options).toHaveLength(4);
    await waitFor(() => expect(lastQuery()).toEqual({ status: 'RESULTS_VALIDATED' }));
    // Rien n'est réécrit au chargement : aucune boucle de navigation.
    expect(replace).not.toHaveBeenCalled();
  });

  it('statut hors de toute catégorie : « Toutes les catégories », statut gardé', () => {
    params = new URLSearchParams('status=INCONNU');
    mount();
    expect(category().value).toBe('');
    expect(status().value).toBe('INCONNU');
    expect(replace).not.toHaveBeenCalled();
  });

  it('autres filtres inchangés : la période garde son comportement, avec une catégorie active', async () => {
    params = new URLSearchParams('categorie=a-venir');
    mount();
    // Jours 1 à 6 : les six statuts « À venir » ; période du 2 au 3 → PENDING_APPROVAL, SCHEDULED.
    fireEvent.change(screen.getByLabelText('Début du'), { target: { value: '2026-10-02' } });
    expect(replace).toHaveBeenLastCalledWith('/tournois?categorie=a-venir&du=2026-10-02', {
      scroll: false,
    });
    navigate();
    fireEvent.change(screen.getByLabelText('au'), { target: { value: '2026-10-03' } });
    navigate();
    expect(category().value).toBe('a-venir');
    const rows = await rowStatuses();
    expect(rows).toHaveLength(2);
    expect(rows.join(' ')).toContain('À approuver');
    expect(rows.join(' ')).toContain('Programmé');
  });
  it('« À venir » : exactement ses six statuts sont proposés', () => {
    params = new URLSearchParams('categorie=a-venir');
    mount();
    expect(statusTexts()).toEqual([
      'Tous les statuts de la catégorie',
      'Brouillon',
      'À approuver',
      'Programmé',
      'Inscriptions ouvertes',
      'Inscriptions closes',
      'Démarrage',
    ]);
  });

  it('« Clôturé » : seuls Terminé et Annulé, filtrés ensemble puis séparément', async () => {
    mount();
    fireEvent.change(category(), { target: { value: 'cloture' } });
    navigate();
    expect(statusTexts()).toEqual(['Tous les statuts de la catégorie', 'Terminé', 'Annulé']);
    await waitFor(() => expect(lastQuery()).toEqual({ status: 'COMPLETED,CANCELLED' }));
    expect(await rowStatuses()).toHaveLength(2);

    // COMPLETED et CANCELLED partagent « Clôturé » sans être confondus.
    fireEvent.change(status(), { target: { value: 'COMPLETED' } });
    navigate();
    expect(category().value).toBe('cloture');
    await waitFor(() => expect(lastQuery()).toEqual({ status: 'COMPLETED' }));
    let rows = await rowStatuses();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toContain('Terminé');

    fireEvent.change(status(), { target: { value: 'CANCELLED' } });
    navigate();
    expect(category().value).toBe('cloture');
    await waitFor(() => expect(lastQuery()).toEqual({ status: 'CANCELLED' }));
    rows = await rowStatuses();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toContain('Annulé');
  });

  it('ancienne catégorie dans l’URL (avant regroupement) : aucune restriction, pas de plantage', async () => {
    for (const old of ['termines', 'annules', 'resultats']) {
      params = new URLSearchParams(`categorie=${old}`);
      mount();
      expect(category().value).toBe('');
      expect(status().options).toHaveLength(13);
      await waitFor(() => expect(get).toHaveBeenLastCalledWith('tournaments', undefined));
      expect(replace).not.toHaveBeenCalled();
      cleanup();
    }
  });

  it('changer un filtre revient à la page 1, sans toucher aux autres paramètres', () => {
    params = new URLSearchParams('categorie=a-venir&du=2026-10-01&page=2');
    mount();
    fireEvent.change(status(), { target: { value: 'DRAFT' } });
    expect(replace).toHaveBeenLastCalledWith(
      '/tournois?categorie=a-venir&du=2026-10-01&status=DRAFT',
      { scroll: false },
    );
    expect(replace).toHaveBeenCalledTimes(1);
  });
});
