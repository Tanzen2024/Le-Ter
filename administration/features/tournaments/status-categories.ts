import type { TournamentSummary } from '@/types/admin';

type Status = TournamentSummary['status'];

/**
 * Catégories du filtre de la liste des tournois : regroupements d'affichage des 12 statuts
 * du serveur, sans statut nouveau. Chaque statut appartient à une seule catégorie.
 */
export const TOURNAMENT_CATEGORIES = [
  {
    value: 'a-venir',
    label: 'À venir',
    statuses: [
      'DRAFT',
      'PENDING_APPROVAL',
      'SCHEDULED',
      'REGISTRATION_OPEN',
      'REGISTRATION_CLOSED',
      'STARTING',
    ],
  },
  { value: 'en-cours', label: 'En cours', statuses: ['IN_PROGRESS'] },
  {
    value: 'en-finalisation',
    label: 'En finalisation',
    statuses: ['CALCULATING_RESULTS', 'RESULTS_VALIDATED', 'DISTRIBUTING_PRIZES'],
  },
  { value: 'cloture', label: 'Clôturé', statuses: ['COMPLETED', 'CANCELLED'] },
] as const satisfies readonly { value: string; label: string; statuses: readonly Status[] }[];

export type TournamentCategory = (typeof TOURNAMENT_CATEGORIES)[number]['value'];

/** Filtres portés par l'URL : `categorie` et `status` (chaîne vide = inactif). */
export interface CategoryStatusFilters {
  categorie: string;
  status: string;
}

/** Catégorie d'un statut, ou '' pour un statut vide ou inconnu. */
export function categoryOfStatus(status: string): TournamentCategory | '' {
  return (
    TOURNAMENT_CATEGORIES.find((c) => (c.statuses as readonly string[]).includes(status))?.value ??
    ''
  );
}

/**
 * Catégorie affichée : celle du statut précis s'il y en a un (le statut prime), sinon la
 * catégorie choisie si elle existe.
 */
export function selectedCategory({ categorie, status }: CategoryStatusFilters) {
  if (status) return categoryOfStatus(status);
  return TOURNAMENT_CATEGORIES.some((c) => c.value === categorie)
    ? (categorie as TournamentCategory)
    : '';
}

/**
 * Valeur du paramètre `status` de l'API (liste séparée par des virgules, déjà acceptée par le
 * serveur) : le statut précis, sinon tous ceux de la catégorie, sinon aucun filtre.
 */
export function apiStatusFilter(filters: CategoryStatusFilters): string | undefined {
  if (filters.status) return filters.status;
  const category = TOURNAMENT_CATEGORIES.find((c) => c.value === selectedCategory(filters));
  return category ? category.statuses.join(',') : undefined;
}

/**
 * Statuts proposés dans « Statut » : ceux de la catégorie, ou les 12 (ordre des catégories)
 * pour « Toutes les catégories » ou une catégorie inconnue.
 */
export function statusesOfCategory(categorie: string): readonly Status[] {
  const category = TOURNAMENT_CATEGORIES.find((c) => c.value === categorie);
  return category ? category.statuses : TOURNAMENT_CATEGORIES.flatMap((c) => c.statuses);
}

/**
 * Choix d'une catégorie : le statut précis est gardé s'il en fait partie, sinon retour à
 * « Tous les statuts de la catégorie ». '' lève les deux filtres.
 */
export function onCategoryChange(
  categorie: string,
  current: CategoryStatusFilters,
): CategoryStatusFilters {
  const keep = categorie !== '' && categoryOfStatus(current.status) === categorie;
  return { categorie, status: keep ? current.status : '' };
}

/**
 * Choix d'un statut : la catégorie suit le statut. « Tous les statuts (de la catégorie) »
 * ('') garde la catégorie affichée, donc tous ses statuts.
 */
export function onStatusChange(
  status: string,
  current: CategoryStatusFilters,
): CategoryStatusFilters {
  return status
    ? { categorie: categoryOfStatus(status), status }
    : { categorie: selectedCategory(current), status: '' };
}
