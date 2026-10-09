/// <reference types="jest" />
import type { TournamentStatus, TournamentView } from '../../types/tournament';
import { groupOf, groupTournaments } from './tournament-groups';
import { tournamentView } from './tournament-fixtures.test-utils';

const t = (id: string, startsAt: string, overrides: Partial<TournamentView> = {}) =>
  tournamentView({ tournamentId: id, startsAt, ...overrides });

describe('groupe d’un tournoi (statut du serveur et capacité)', () => {
  it.each<[TournamentStatus, ReturnType<typeof groupOf>]>([
    ['REGISTRATION_OPEN', 'open'],
    ['SCHEDULED', 'closed'],
    ['REGISTRATION_CLOSED', 'closed'],
    ['STARTING', 'closed'],
    ['IN_PROGRESS', 'inProgress'],
    ['CALCULATING_RESULTS', 'inProgress'],
    ['RESULTS_VALIDATED', 'inProgress'],
    ['DISTRIBUTING_PRIZES', 'inProgress'],
    ['COMPLETED', 'history'],
    ['CANCELLED', 'history'],
  ])('%s → %s', (status, group) => {
    expect(groupOf(tournamentView({ status }))).toBe(group);
  });

  it('inscriptions ouvertes mais complet : « clôturées ou complets », jamais « en cours »', () => {
    const full = tournamentView({ status: 'REGISTRATION_OPEN', registeredCount: 100 });
    expect(full.maximumPlayers).toBe(100);
    expect(groupOf(full)).toBe('closed');
    expect(groupOf({ ...full, registeredCount: 99 })).toBe('open');
    expect(groupOf({ ...full, maximumPlayers: undefined, registeredCount: 5000 })).toBe('open');
  });

  it('un tournoi complet ET démarré est « en cours » (le statut prime sur la capacité)', () => {
    expect(groupOf(tournamentView({ status: 'IN_PROGRESS', registeredCount: 100 }))).toBe(
      'inProgress',
    );
  });
});

describe('répartition de la liste', () => {
  it('quatre groupes dans l’ordre, triés par début, chaque tournoi une seule fois', () => {
    const groups = groupTournaments({
      tournaments: [
        t('live', '2026-10-12T15:00:00.000Z', { status: 'IN_PROGRESS' }),
        t('open-late', '2026-10-14T17:00:00.000Z'),
        t('full', '2026-10-13T17:00:00.000Z', { registeredCount: 100 }),
        t('open-soon', '2026-10-13T09:00:00.000Z'),
        t('closed', '2026-10-12T20:00:00.000Z', { status: 'REGISTRATION_CLOSED' }),
      ],
      history: [
        t('old', '2026-10-01T17:00:00.000Z', { status: 'COMPLETED' }),
        t('recent', '2026-10-08T17:00:00.000Z', { status: 'CANCELLED' }),
        // Doublon défensif : jamais affiché deux fois.
        t('live', '2026-10-12T15:00:00.000Z', { status: 'IN_PROGRESS' }),
      ],
    });
    expect(groups.map((g) => [g.key, g.tournaments.map((x) => x.tournamentId)])).toEqual([
      ['open', ['open-soon', 'open-late']],
      ['closed', ['closed', 'full']],
      ['inProgress', ['live']],
      // Historique : le plus récent d'abord.
      ['history', ['recent', 'old']],
    ]);
    const all = groups.flatMap((g) => g.tournaments.map((x) => x.tournamentId));
    expect(new Set(all).size).toBe(all.length);
  });

  it('groupes vides masqués ; aucune donnée → aucun groupe (rien d’inventé)', () => {
    expect(groupTournaments({ tournaments: [], history: [] })).toEqual([]);
    expect(
      groupTournaments({ tournaments: [t('a', '2026-10-13T09:00:00.000Z')], history: [] }).map(
        (g) => g.key,
      ),
    ).toEqual(['open']);
  });

  it('même début : ordre stable par identifiant', () => {
    const at = '2026-10-13T09:00:00.000Z';
    const [open] = groupTournaments({ tournaments: [t('b', at), t('a', at)], history: [] });
    expect(open!.tournaments.map((x) => x.tournamentId)).toEqual(['a', 'b']);
  });
});
