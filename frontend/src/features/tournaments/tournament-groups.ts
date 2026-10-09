import type { TournamentList, TournamentStatus, TournamentView } from '../../types/tournament';
import { isFull } from './tournament-state';

/**
 * Groupes de la liste des tournois, dans l'ordre d'affichage. Chaque tournoi appartient à
 * UN seul groupe, déduit du statut décidé par le serveur (déjà avancé avant la réponse,
 * D-065) et de sa capacité ; le client ne compare jamais lui-même les dates.
 */
export type TournamentGroupKey = 'open' | 'closed' | 'inProgress' | 'history';

export interface TournamentGroup {
  key: TournamentGroupKey;
  tournaments: TournamentView[];
}

const GROUP_ORDER: readonly TournamentGroupKey[] = ['open', 'closed', 'inProgress', 'history'];

/** Démarrage effectué (réservations capturées), tournoi pas encore terminé. */
const STARTED: readonly TournamentStatus[] = [
  'IN_PROGRESS',
  'CALCULATING_RESULTS',
  'RESULTS_VALIDATED',
  'DISTRIBUTING_PRIZES',
];
const FINISHED: readonly TournamentStatus[] = ['COMPLETED', 'CANCELLED'];

/**
 * - `open` : inscriptions ouvertes et au moins une place libre ;
 * - `closed` : pas encore démarré, mais plus (ou pas encore) d'inscription possible :
 *   inscriptions pas encore ouvertes (`SCHEDULED`), clôturées, tournoi complet, ou
 *   démarrage en cours (`STARTING` : rien n'est encore capturé, il peut encore être annulé) ;
 * - `inProgress` : démarré, pas terminé (jeu, puis calcul et versement des résultats) ;
 * - `history` : terminé ou annulé.
 * Un tournoi complet reste donc dans `closed` tant qu'il n'a pas démarré.
 */
export function groupOf(t: TournamentView): TournamentGroupKey {
  if (FINISHED.includes(t.status)) return 'history';
  if (STARTED.includes(t.status)) return 'inProgress';
  if (t.status === 'REGISTRATION_OPEN' && !isFull(t)) return 'open';
  return 'closed';
}

const startOf = (t: TournamentView) => new Date(t.startsAt).getTime();

/**
 * Répartit la réponse de `GET /api/tournaments` en groupes non vides, triés par début :
 * le plus proche d'abord, et pour l'historique le plus récent d'abord. Ordre stable
 * (identifiant en dernier recours) ; un même tournoi n'est jamais compté deux fois.
 */
export function groupTournaments(list: Pick<TournamentList, 'tournaments' | 'history'>) {
  const seen = new Set<string>();
  const buckets = new Map<TournamentGroupKey, TournamentView[]>();
  for (const t of [...list.tournaments, ...list.history]) {
    if (seen.has(t.tournamentId)) continue;
    seen.add(t.tournamentId);
    const key = groupOf(t);
    buckets.set(key, [...(buckets.get(key) ?? []), t]);
  }
  const groups: TournamentGroup[] = [];
  for (const key of GROUP_ORDER) {
    const items = buckets.get(key);
    if (!items?.length) continue;
    const direction = key === 'history' ? -1 : 1;
    items.sort(
      (a, b) =>
        direction * (startOf(a) - startOf(b)) || a.tournamentId.localeCompare(b.tournamentId),
    );
    groups.push({ key, tournaments: items });
  }
  return groups;
}
