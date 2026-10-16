import {
  COMPLAINT_CATEGORIES,
  type ComplaintCategory,
  type ComplaintDraft,
} from '../../types/complaint';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const isCategory = (value: unknown): value is ComplaintCategory =>
  (COMPLAINT_CATEGORIES as readonly unknown[]).includes(value);

/**
 * Brouillon issu d'un raccourci « Signaler un problème » (partie, tournoi). Seule la FORME des
 * paramètres est contrôlée ici (un identifiant malformé est ignoré) : l'appartenance au joueur
 * est vérifiée par le serveur au dépôt. null : aucun contexte, l'écran s'ouvre normalement.
 */
export function shortcutDraft(
  params: { gameId?: unknown; tournamentId?: unknown; category?: unknown },
  titleOf: (category: ComplaintCategory) => string,
): ComplaintDraft | null {
  const gameId =
    typeof params.gameId === 'string' && UUID.test(params.gameId) ? params.gameId : undefined;
  const tournamentId =
    typeof params.tournamentId === 'string' && UUID.test(params.tournamentId)
      ? params.tournamentId
      : undefined;
  if (!gameId && !tournamentId) return null;
  const category: ComplaintCategory = isCategory(params.category)
    ? params.category
    : gameId
      ? 'GAME_RESULT'
      : 'TOURNAMENT';
  return {
    category,
    title: titleOf(category),
    description: '',
    links: { ...(gameId && { gameId }), ...(tournamentId && { tournamentId }) },
    recommended: false,
  };
}
