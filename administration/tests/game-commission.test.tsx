import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { simulate, toDraft, validateDraft } from '@/features/settings/game-commission';
import { GameCommissionCard } from '@/features/settings/game-commission-card';
import { ApiError } from '@/lib/api/errors';
import type { GameCommissionSettings, GameCommissionTier } from '@/types/admin';

const get = vi.fn();
const patch = vi.fn();
const post = vi.fn();
vi.mock('@/lib/api/client', () => ({
  api: {
    get: (path: string, query?: unknown) => get(path, query),
    patch: (path: string, body: unknown) => patch(path, body),
    post: (path: string, body: unknown) => post(path, body),
  },
  downloadUrl: (path: string) => path,
  idempotencyKey: () => 'k',
}));

/** Barème initial (D-074), tel que renvoyé par le serveur. */
const INITIAL: GameCommissionTier[] = [
  { minStake: 1, maxStake: 5, percent: 0 },
  { minStake: 6, maxStake: 100, percent: 1 },
  { minStake: 101, maxStake: 200, percent: 2 },
  { minStake: 201, maxStake: 300, percent: 3 },
  { minStake: 301, maxStake: 400, percent: 4 },
  { minStake: 401, maxStake: 500, percent: 6 },
  { minStake: 501, maxStake: 700, percent: 7 },
  { minStake: 701, maxStake: 999, percent: 8 },
  { minStake: 1000, maxStake: null, percent: 10 },
];

const settings = (tiers = INITIAL, updatedAt: string | null = null): GameCommissionSettings => ({
  tiers,
  updatedAt,
  limits: { min: 0, max: 50 },
  maxTiers: 50,
  koraLossMultiplier: 2,
  appliesTo: 'GAMES_STARTED_AFTER_CHANGE',
});

function wrap(ui: ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

const rateInput = (n: number) => screen.getByLabelText(`Taux de la tranche ${n}`);
const maxInput = (n: number) => screen.getByLabelText(`Mise maximale de la tranche ${n}`);
const minInput = (n: number) => screen.getByLabelText(`Mise minimale de la tranche ${n}`);
const type = (el: HTMLElement, value: string) => fireEvent.change(el, { target: { value } });

async function openEditor() {
  fireEvent.click(await screen.findByRole('button', { name: 'Modifier' }));
}
function submit() {
  fireEvent.click(screen.getByRole('button', { name: 'Enregistrer' }));
  return screen.findByRole('dialog');
}

beforeEach(() => {
  get.mockReset();
  patch.mockReset();
  post.mockReset();
  get.mockResolvedValue(settings());
});

describe('consultation', () => {
  it('affiche toutes les tranches, leurs bornes, leur taux et la tranche sans plafond', async () => {
    wrap(<GameCommissionCard />);
    const table = await screen.findByRole(
      'table',
      { name: 'Barème de commission enregistré' },
      { timeout: 5_000 }, // premier rendu du fichier : démarrage à froid
    );
    const rows = within(table).getAllByRole('row').slice(1);
    expect(rows).toHaveLength(9);
    expect(
      within(rows[1]!)
        .getAllByRole('cell')
        .map((c) => c.textContent),
    ).toEqual(['6', '100', '1 %']);
    expect(within(rows[8]!).getByText('Sans plafond')).toBeInTheDocument();
    expect(within(rows[8]!).getByText('10 %')).toBeInTheDocument();
    expect(screen.getByText(/jamais \(barème initial\)/)).toBeInTheDocument();
    expect(screen.getByText(/parties en cours et déjà réglées ne sont jamais/)).toBeInTheDocument();
    expect(get).toHaveBeenCalledWith('settings/game-commission', undefined);
  });

  it('chargement, puis erreur avec nouvelle tentative', async () => {
    get.mockRejectedValueOnce(new ApiError(500, 'HTTP_500', ''));
    wrap(<GameCommissionCard />);
    expect(screen.getByLabelText('Chargement')).toBeInTheDocument();
    expect(await screen.findByText('Les données n’ont pas pu être chargées')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Réessayer/ }));
    expect(await screen.findByRole('table')).toBeInTheDocument();
  });

  it('barème vide renvoyé par le serveur : état explicite, aucune valeur inventée', async () => {
    get.mockResolvedValue(settings([]));
    wrap(<GameCommissionCard />);
    expect(await screen.findByText('Aucune tranche')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Modifier' })).not.toBeInTheDocument();
  });

  it('accès refusé par le serveur (403) : message, aucune édition possible', async () => {
    get.mockRejectedValue(new ApiError(403, 'FORBIDDEN', 'Accès refusé.'));
    wrap(<GameCommissionCard />);
    expect(await screen.findByText("Vous n'avez pas accès à cette ressource.")).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Modifier' })).not.toBeInTheDocument();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
  });
});

describe('édition et prévalidation', () => {
  it('mise minimale modifiable : trou, chevauchement et première tranche ≠ 1 signalés', async () => {
    wrap(<GameCommissionCard />);
    await openEditor();
    const save = screen.getByRole('button', { name: 'Enregistrer' });
    expect(minInput(2)).toHaveValue('6');

    type(minInput(2), '8'); // tranche 1 jusqu'à 5
    expect(
      screen.getByText('Trou : les mises de 6 à 7 n’ont pas de tranche. Attendu : 6.'),
    ).toBeInTheDocument();
    expect(save).toBeDisabled();

    type(minInput(2), '4');
    expect(
      screen.getByText('Chevauchement avec la tranche précédente (jusqu’à 5). Attendu : 6.'),
    ).toBeInTheDocument();
    expect(save).toBeDisabled();

    type(minInput(2), 'x');
    expect(screen.getByText('Mise minimale entière attendue (au moins 1).')).toBeInTheDocument();

    type(minInput(1), '2');
    expect(screen.getByText('La première tranche commence à 1.')).toBeInTheDocument();
    type(minInput(1), '1');

    // Déplacer une frontière : plafond 1 → 10 et minimum 2 → 11, cohérent.
    type(maxInput(1), '10');
    type(minInput(2), '11');
    expect(screen.queryByText(/Trou|Chevauchement/)).not.toBeInTheDocument();
    expect(save).toBeEnabled();
  });

  it('frontière déplacée : le barème envoyé contient les nouvelles bornes', async () => {
    patch.mockResolvedValue({ ...settings(), changed: true });
    wrap(<GameCommissionCard />);
    await openEditor();
    type(maxInput(1), '10');
    type(minInput(2), '11');
    const dialog = await submit();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Enregistrer' }));
    await waitFor(() => expect(patch).toHaveBeenCalled());
    const sent = (patch.mock.calls[0]![1] as { tiers: GameCommissionTier[] }).tiers;
    expect(sent.slice(0, 2)).toEqual([
      { minStake: 1, maxStake: 10, percent: 0 },
      { minStake: 11, maxStake: 100, percent: 1 },
    ]);
  });

  it('taux hors bornes ou mal formé, plafond inférieur au minimum : erreurs, Enregistrer bloqué', async () => {
    wrap(<GameCommissionCard />);
    await openEditor();
    const save = screen.getByRole('button', { name: 'Enregistrer' });
    expect(save).toBeDisabled(); // rien n'a changé

    type(rateInput(2), '60');
    expect(screen.getByText('Taux entre 0 et 50 %, deux décimales au plus.')).toBeInTheDocument();
    expect(save).toBeDisabled();
    type(rateInput(2), '1,234');
    expect(save).toBeDisabled();
    type(rateInput(2), 'abc');
    expect(save).toBeDisabled();
    type(rateInput(2), '1,5');
    expect(save).toBeEnabled();

    type(maxInput(2), '3'); // minimum de la tranche 2 : 6
    expect(screen.getByText('Au moins 6 (mise minimale de la tranche).')).toBeInTheDocument();
    expect(save).toBeDisabled();
    type(maxInput(2), '');
    expect(screen.getByText('Mise maximale entière attendue.')).toBeInTheDocument();
  });

  it('ajouter et supprimer des tranches ; la dernière reste sans plafond', async () => {
    wrap(<GameCommissionCard />);
    await openEditor();
    fireEvent.click(screen.getByRole('button', { name: /Ajouter une tranche/ }));
    expect(screen.getByLabelText('Taux de la tranche 10')).toBeInTheDocument();
    // L'ancienne dernière tranche reçoit un plafond à saisir, la nouvelle un minimum.
    expect(maxInput(9)).toHaveValue('');
    expect(minInput(10)).toHaveValue('');
    expect(screen.getByRole('button', { name: 'Enregistrer' })).toBeDisabled();
    type(maxInput(9), '1999');
    type(minInput(10), '2000');
    expect(screen.getByRole('button', { name: 'Enregistrer' })).toBeEnabled();

    fireEvent.click(screen.getByRole('button', { name: 'Supprimer la tranche 10' }));
    expect(screen.queryByLabelText('Taux de la tranche 10')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Mise maximale de la tranche 9')).not.toBeInTheDocument();
  });

  it('Annuler abandonne le brouillon et réaffiche le barème enregistré', async () => {
    wrap(<GameCommissionCard />);
    await openEditor();
    type(rateInput(2), '3');
    fireEvent.click(screen.getByRole('button', { name: 'Annuler' }));
    expect(
      screen.getByRole('table', { name: 'Barème de commission enregistré' }),
    ).toBeInTheDocument();
    expect(patch).not.toHaveBeenCalled();
  });
});

describe('enregistrement', () => {
  it('confirmation, PATCH du barème complet, puis rechargement depuis le serveur', async () => {
    const saved = INITIAL.map((t) => (t.minStake === 6 ? { ...t, percent: 1.5 } : t));
    patch.mockResolvedValue({ ...settings(saved, '2026-10-10T10:00:00.000Z'), changed: true });
    wrap(<GameCommissionCard />);
    await openEditor();
    type(rateInput(2), '1,5');
    const dialog = await submit();
    expect(within(dialog).getByText(/ne sont pas recalculées/)).toBeInTheDocument();
    expect(patch).not.toHaveBeenCalled(); // rien n'est envoyé avant la confirmation

    get.mockResolvedValue(settings(saved, '2026-10-10T10:00:00.000Z'));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Enregistrer' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());

    expect(patch).toHaveBeenCalledTimes(1);
    expect(patch).toHaveBeenCalledWith('settings/game-commission', { tiers: saved });
    // Barème relu depuis le serveur, retour en consultation.
    await waitFor(() => expect(get).toHaveBeenCalledTimes(2));
    const table = await screen.findByRole('table', { name: 'Barème de commission enregistré' });
    expect(within(table).getByText('1,5 %')).toBeInTheDocument();
  });

  it('aucune double soumission : un seul PATCH malgré plusieurs clics', async () => {
    let resolve: (v: unknown) => void = () => {};
    patch.mockReturnValue(new Promise((r) => (resolve = r)));
    wrap(<GameCommissionCard />);
    await openEditor();
    type(rateInput(2), '2');
    const dialog = await submit();
    const confirm = within(dialog).getByRole('button', { name: 'Enregistrer' });
    fireEvent.click(confirm);
    fireEvent.click(within(dialog).getByRole('button', { name: 'En cours…' }));
    expect(within(dialog).getByRole('button', { name: 'En cours…' })).toBeDisabled();
    expect(patch).toHaveBeenCalledTimes(1);
    resolve({ ...settings(), changed: true });
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(patch).toHaveBeenCalledTimes(1);
  });

  it('refus du serveur (400) : message affiché, modifications locales conservées', async () => {
    patch.mockRejectedValue(
      new ApiError(400, 'VALIDATION_ERROR', 'Données invalides.', {
        tiers: 'Tranche 2 : taux entre 0 et 50 %, deux décimales au plus.',
      }),
    );
    wrap(<GameCommissionCard />);
    await openEditor();
    type(rateInput(2), '2');
    const dialog = await submit();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Enregistrer' }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('Données invalides.');

    fireEvent.click(within(dialog).getByRole('button', { name: 'Annuler' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(screen.getByRole('alert')).toHaveTextContent(
      'Refusé par le serveur : Tranche 2 : taux entre 0 et 50 %',
    );
    expect(rateInput(2)).toHaveValue('2');
    expect(screen.getByRole('button', { name: 'Enregistrer' })).toBeEnabled();
  });

  it('erreur réseau : message exploitable, brouillon conservé, nouvel essai possible', async () => {
    patch.mockRejectedValueOnce(
      new ApiError(0, 'NETWORK', 'Impossible de joindre le serveur. Vérifiez votre connexion.'),
    );
    patch.mockResolvedValueOnce({ ...settings(), changed: true });
    wrap(<GameCommissionCard />);
    await openEditor();
    type(rateInput(3), '2,5');
    const dialog = await submit();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Enregistrer' }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent(
      'Impossible de joindre le serveur',
    );
    expect(rateInput(3)).toHaveValue('2,5');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Enregistrer' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(patch).toHaveBeenCalledTimes(2);
  });

  it('aucun recalcul côté administration : seul le barème est envoyé, aucune autre route', async () => {
    patch.mockResolvedValue({ ...settings(), changed: true });
    wrap(<GameCommissionCard />);
    await openEditor();
    type(rateInput(9), '12');
    const dialog = await submit();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Enregistrer' }));
    await waitFor(() => expect(patch).toHaveBeenCalled());
    expect(Object.keys(patch.mock.calls[0]![1] as object)).toEqual(['tiers']);
    expect(patch.mock.calls.every(([path]) => path === 'settings/game-commission')).toBe(true);
    expect(get.mock.calls.every(([path]) => path === 'settings/game-commission')).toBe(true);
    expect(post).not.toHaveBeenCalled();
  });
});

describe('simulation indicative', () => {
  const flat2 = [{ minStake: 1, maxStake: null, percent: 2 }];

  it('exemple du propriétaire : 3 joueurs, mise 50, 2 %', () => {
    expect(
      simulate(flat2, { stake: 50, players: 3, victory: 'SIMPLE', koraLossMultiplier: 2 }),
    ).toMatchObject({
      lossPerLoser: 50,
      redistributed: 100,
      appliedPercent: 2,
      commission: 2,
      netGain: 98,
      requiredBalance: 100,
    });
    expect(
      simulate(flat2, { stake: 50, players: 3, victory: 'KORA', koraLossMultiplier: 2 }),
    ).toMatchObject({
      lossPerLoser: 100,
      redistributed: 200,
      // D-080 : la Kora double la perte, jamais le taux.
      appliedPercent: 2,
      commission: 4,
      netGain: 196,
    });
  });

  it('exemple de référence D-080 : 2 joueurs, mise 500, 6 % (simple 30, Kora 60)', () => {
    const flat6 = [{ minStake: 1, maxStake: null, percent: 6 }];
    const input = { stake: 500, players: 2, koraLossMultiplier: 2 } as const;
    expect(simulate(flat6, { ...input, victory: 'SIMPLE' })).toMatchObject({
      lossPerLoser: 500,
      commission: 30,
      netGain: 470,
    });
    expect(simulate(flat6, { ...input, victory: 'KORA' })).toMatchObject({
      lossPerLoser: 1_000,
      appliedPercent: 6,
      commission: 60,
      netGain: 940,
    });
  });

  it('arrondi à l’entier inférieur ; tranche selon la mise ; entrées invalides ignorées', () => {
    // 3 perdants × 7 à 5 % = 1,05 → 1.
    const flat5 = [{ minStake: 1, maxStake: null, percent: 5 }];
    expect(
      simulate(flat5, { stake: 7, players: 4, victory: 'SIMPLE', koraLossMultiplier: 2 })
        ?.commission,
    ).toBe(1);
    expect(
      simulate(INITIAL, { stake: 100, players: 2, victory: 'SIMPLE', koraLossMultiplier: 2 })?.tier
        .percent,
    ).toBe(1);
    expect(
      simulate(INITIAL, { stake: 101, players: 2, victory: 'SIMPLE', koraLossMultiplier: 2 })?.tier
        .percent,
    ).toBe(2);
    expect(
      simulate(INITIAL, { stake: 0, players: 2, victory: 'SIMPLE', koraLossMultiplier: 2 }),
    ).toBeNull();
    expect(
      simulate(INITIAL, {
        stake: Number.NaN,
        players: 2,
        victory: 'SIMPLE',
        koraLossMultiplier: 2,
      }),
    ).toBeNull();
  });

  it('dans l’écran : victoire simple puis Kora, avec la mention indicative', async () => {
    wrap(<GameCommissionCard />);
    await screen.findByRole('table');
    expect(
      screen.getByText(/résultat officiel est celui calculé par le serveur/),
    ).toBeInTheDocument();
    type(screen.getByLabelText('Mise'), '150'); // tranche 101-200 : 2 %
    type(screen.getByLabelText('Nombre de joueurs'), '3');
    expect(screen.getByTestId('sim-redistributed')).toHaveTextContent('300 jetons');
    expect(screen.getByTestId('sim-commission')).toHaveTextContent('6 jetons');
    expect(screen.getByTestId('sim-net')).toHaveTextContent('294 jetons');

    type(screen.getByLabelText('Victoire'), 'KORA'); // 2 × 150 × 2 perdants, toujours à 2 %
    expect(screen.getByTestId('sim-redistributed')).toHaveTextContent('600 jetons');
    expect(screen.getByTestId('sim-commission')).toHaveTextContent('12 jetons');
    expect(screen.getByTestId('sim-net')).toHaveTextContent('588 jetons');
  });

  it('simule avec le brouillon valide pendant l’édition, jamais avec un brouillon invalide', async () => {
    wrap(<GameCommissionCard />);
    await openEditor();
    type(rateInput(3), '5'); // 101-200 : 5 %
    type(screen.getByLabelText('Mise'), '200');
    type(screen.getByLabelText('Nombre de joueurs'), '2');
    expect(screen.getByText(/barème en cours de modification/)).toBeInTheDocument();
    expect(screen.getByTestId('sim-commission')).toHaveTextContent('10 jetons');
    type(rateInput(3), '99');
    expect(screen.getByText('Corrigez le barème pour lancer la simulation.')).toBeInTheDocument();
  });
});

describe('prévalidation (fonctions pures)', () => {
  it('barème initial : valide et identique une fois reconstruit', () => {
    const { tiers, rows } = validateDraft(toDraft(INITIAL), { min: 0, max: 50 }, 50);
    expect(tiers).toEqual(INITIAL);
    expect(rows.at(-1)).toMatchObject({ last: true, minStake: '1000' });
  });

  it('limite du nombre de tranches', () => {
    const many = Array.from({ length: 3 }, (_, i) => ({
      minStake: i + 1,
      maxStake: i === 2 ? null : i + 1,
      percent: 1,
    }));
    expect(validateDraft(toDraft(many), { min: 0, max: 50 }, 2)).toMatchObject({
      tiers: null,
      formError: 'Barème limité à 2 tranches.',
    });
  });
});
