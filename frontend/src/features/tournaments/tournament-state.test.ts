import { formatDuration } from './tournament-messages';
import {
  participant,
  registration,
  tournamentView as view,
} from './tournament-fixtures.test-utils';
import {
  CLOSING_REFRESH_MS,
  formatFcfa,
  formatTournamentPeriod,
  formatTournamentSchedule,
  hasResults,
  MAX_REFRESH_DELAY_MS,
  nextRefreshDelayMs,
  remainingBeforeStartMs,
  rewardedRanks,
  selectHomeTournament,
  tournamentStatusKey,
  tournamentWidgetState,
} from './tournament-state';

describe('tournamentWidgetState (dérivé du serveur uniquement)', () => {
  it.each([
    ['aucun tournoi', null, {}, 'NO_TOURNAMENT'],
    ['inscriptions ouvertes, non inscrit', view(), {}, 'UPCOMING'],
    ['programmé, non inscrit', view({ status: 'SCHEDULED' }), {}, 'UPCOMING'],
    [
      'inscription confirmée à l’instant',
      view({ registration }),
      { justRegistered: true },
      'REGISTERED',
    ],
    ['inscrit, en attente', view({ registration }), {}, 'WAITING'],
    [
      'inscrit, inscriptions fermées',
      view({ status: 'REGISTRATION_CLOSED', registration }),
      {},
      'WAITING',
    ],
    ['en cours', view({ status: 'IN_PROGRESS' }), {}, 'IN_PROGRESS'],
    ['calcul des résultats', view({ status: 'CALCULATING_RESULTS' }), {}, 'COMPLETED'],
    ['terminé', view({ status: 'COMPLETED' }), {}, 'COMPLETED'],
    ['annulé', view({ status: 'CANCELLED' }), {}, 'COMPLETED'],
  ] as const)('%s → %s', (_label, tournament, options, expected) => {
    expect(tournamentWidgetState(tournament, options)).toBe(expected);
  });

  it('ne déduit jamais « commencé » de l’heure : seul le statut du serveur compte', () => {
    const late = view({ serverNow: '2026-10-12T18:00:00.000Z' });
    expect(tournamentWidgetState(late)).toBe('UPCOMING');
  });

  it('résultats affichables seulement une fois validés', () => {
    expect(hasResults(view({ status: 'CALCULATING_RESULTS' }))).toBe(false);
    expect(hasResults(view({ status: 'RESULTS_VALIDATED' }))).toBe(true);
    expect(hasResults(view({ status: 'COMPLETED' }))).toBe(true);
  });

  it('rangs récompensés', () => {
    expect(rewardedRanks(view())).toBe(3);
  });
});

describe('nextRefreshDelayMs', () => {
  it('relit à la fermeture des inscriptions (horloge du serveur) avec une marge', () => {
    expect(nextRefreshDelayMs(view({ serverNow: '2026-10-12T16:59:00.000Z' }))).toBe(62_000);
  });

  it('pendant le tournoi, relit à la fin', () => {
    const live = view({
      status: 'IN_PROGRESS',
      serverNow: '2026-10-12T18:59:30.000Z',
    });
    expect(nextRefreshDelayMs(live)).toBe(32_000);
  });

  it('pendant la clôture, relecture courte et bornée', () => {
    expect(nextRefreshDelayMs(view({ status: 'DISTRIBUTING_PRIZES' }))).toBe(CLOSING_REFRESH_MS);
  });

  it('plafonne l’attente (aucune échéance lointaine en minuterie)', () => {
    expect(nextRefreshDelayMs(view({ serverNow: '2026-10-01T00:00:00.000Z' }))).toBe(
      MAX_REFRESH_DELAY_MS,
    );
  });

  it('rien à attendre sans tournoi, terminé ou annulé', () => {
    expect(nextRefreshDelayMs(null)).toBeNull();
    expect(nextRefreshDelayMs(view({ status: 'COMPLETED' }))).toBeNull();
    expect(nextRefreshDelayMs(view({ status: 'CANCELLED' }))).toBeNull();
  });
});

describe('affichage', () => {
  it('date, heure de début et heure de fin dans le fuseau demandé', () => {
    expect(formatTournamentPeriod(view(), 'fr-FR', 'Africa/Douala')).toEqual({
      date: '12 octobre 2026',
      start: '18:00',
      end: '20:00',
    });
  });

  it('montants en FCFA', () => {
    expect(formatFcfa(45000)).toBe('45 000 FCFA');
    expect(formatFcfa(1000)).toBe('1 000 FCFA');
    expect(formatFcfa(0)).toBe('0 FCFA');
  });

  it('compte à rebours corrigé par serverNow', () => {
    const t = view({ serverNow: '2026-10-12T16:00:00.000Z' });
    const receivedAt = Date.parse('2026-10-12T15:55:00.000Z'); // téléphone en retard de 5 min
    expect(remainingBeforeStartMs(t, receivedAt, receivedAt)).toBe(60 * 60 * 1000);
  });

  it.each([
    [3_900_000, '1 h 05'],
    [720_000, '12 min'],
    [45_000, '45 s'],
  ])('formatDuration(%i) = %s', (ms, text) => {
    expect(formatDuration(ms)).toBe(text);
  });
});

describe('formatTournamentSchedule (accueil, D-059)', () => {
  it('date JJ/MM/AAAA, début et fin HH:mm en 24 h, heure locale', () => {
    expect(
      formatTournamentSchedule({
        startsAt: new Date(2026, 0, 5, 9, 0).toISOString(),
        endsAt: new Date(2026, 0, 5, 23, 45).toISOString(),
      }),
    ).toEqual({ date: '05/01/2026', start: '09:00', end: '23:45' });
  });

  it('fin après minuit : heure de fin du lendemain', () => {
    expect(
      formatTournamentSchedule({
        startsAt: new Date(2026, 11, 31, 23, 30).toISOString(),
        endsAt: new Date(2027, 0, 1, 0, 30).toISOString(),
      }),
    ).toEqual({ date: '31/12/2026', start: '23:30', end: '00:30' });
  });
});

describe('tournamentStatusKey : libellés fidèles à la machine à états du serveur (D-065)', () => {
  // serverNow (fixture) : 16:00 UTC ; début : 17:00 UTC.
  it.each([
    ['SCHEDULED', 'UPCOMING'],
    ['REGISTRATION_OPEN', 'OPEN'],
    ['REGISTRATION_CLOSED', 'CLOSED'],
    ['STARTING', 'STARTING'],
    ['IN_PROGRESS', 'IN_PROGRESS'],
    ['CALCULATING_RESULTS', 'CLOSING'],
    ['RESULTS_VALIDATED', 'CLOSING'],
    ['DISTRIBUTING_PRIZES', 'CLOSING'],
    ['COMPLETED', 'COMPLETED'],
    ['CANCELLED', 'CANCELLED'],
  ] as const)('%s → %s', (status, key) => {
    expect(tournamentStatusKey(view({ status }))).toBe(key);
  });

  it('heure de début atteinte sur l’horloge du serveur : « Démarrage », jamais « à venir »', () => {
    const started = { startsAt: '2026-10-12T16:00:00.000Z', serverNow: '2026-10-12T16:00:00.000Z' };
    expect(tournamentStatusKey(view({ status: 'SCHEDULED', ...started }))).toBe('STARTING');
    expect(tournamentStatusKey(view({ status: 'REGISTRATION_OPEN', ...started }))).toBe('STARTING');
  });
});

describe('selectHomeTournament : prochain tournoi pertinent de l’accueil (D-065)', () => {
  const at = (h: number) => `2026-10-12T${String(h).padStart(2, '0')}:00:00.000Z`;
  const upcoming = (id: string, h: number, extra = {}) =>
    view({ tournamentId: id, startsAt: at(h), endsAt: at(h + 1), ...extra });

  it('aucun tournoi : null', () => {
    expect(selectHomeTournament(undefined)).toBeNull();
    expect(selectHomeTournament([])).toBeNull();
  });

  it('tournoi en cours où je participe : prioritaire', () => {
    const live = view({ tournamentId: 'live', status: 'IN_PROGRESS', account: participant });
    expect(selectHomeTournament([live, upcoming('a', 18)])?.tournamentId).toBe('live');
  });

  it('sinon le plus proche à venir où je suis inscrit ou qui est ouvert, avant un tournoi fermé', () => {
    const closed = upcoming('closed', 17, { status: 'REGISTRATION_CLOSED', canRegister: false });
    const mine = upcoming('mine', 19, { registration, canRegister: false });
    expect(selectHomeTournament([closed, mine])?.tournamentId).toBe('mine');
    expect(selectHomeTournament([closed])?.tournamentId).toBe('closed');
  });

  it('jamais un tournoi dont l’heure est passée présenté « à venir »', () => {
    const past = upcoming('past', 15);
    expect(selectHomeTournament([past])).toBeNull();
  });

  it('en dernier recours : un tournoi en cours (information)', () => {
    const live = view({ tournamentId: 'live', status: 'IN_PROGRESS', canRegister: false });
    expect(selectHomeTournament([live])?.tournamentId).toBe('live');
  });
});
