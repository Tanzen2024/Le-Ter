import {
  defaultShares,
  defaultTournamentForm,
  fieldErrorsFromApi,
  sharesTotal,
  toTournamentPayload,
  TOURNAMENT_DURATION_ERROR,
  type TournamentFormValues,
} from './tournament-form';

const values = (overrides: Partial<TournamentFormValues> = {}): TournamentFormValues => ({
  ...defaultTournamentForm(new Date(2026, 9, 8, 10, 0)),
  ...overrides,
});

describe('valeurs par défaut', () => {
  it('demain 18:00, 60 min, 1 000 FCFA, 20 joueurs minimum, 50 / 30 / 20', () => {
    expect(defaultTournamentForm(new Date(2026, 9, 8, 10, 0))).toMatchObject({
      date: '09/10/2026',
      startTime: '18:00',
      durationMinutes: '60',
      entryFee: '1000',
      minimumPlayers: '20',
      shares: ['50', '30', '20'],
    });
  });

  it.each([1, 2, 3, 4, 7, 10])('répartition proposée pour %i rang(s) : somme 100', (n) => {
    const shares = defaultShares(n);
    expect(shares).toHaveLength(n);
    expect(sharesTotal(shares)).toBe(100);
  });
});

describe('toTournamentPayload (format seulement)', () => {
  it('construit le corps de l’API : instants UTC, fin = début + durée, parts par rang', () => {
    const result = toTournamentPayload(values({ maximumPlayers: '32' }), 'Africa/Douala');
    expect(result).toEqual({
      ok: true,
      payload: {
        timezone: 'Africa/Douala',
        startsAt: new Date(2026, 9, 9, 18, 0).toISOString(),
        endsAt: new Date(2026, 9, 9, 19, 0).toISOString(),
        entryFee: 1000,
        minimumPlayers: 20,
        maximumPlayers: 32,
        prizeRules: [
          { rank: 1, percent: 50 },
          { rank: 2, percent: 30 },
          { rank: 3, percent: 20 },
        ],
      },
    });
  });

  it('ni nom ni description (D-060) : absents du formulaire et du corps envoyé', () => {
    const form = defaultTournamentForm(new Date(2026, 9, 8, 10, 0));
    expect(form).not.toHaveProperty('name');
    expect(form).not.toHaveProperty('description');
    const result = toTournamentPayload(values());
    expect(result.ok).toBe(true);
    expect(result.ok && result.payload).not.toHaveProperty('name');
    expect(result.ok && result.payload).not.toHaveProperty('description');
  });

  it('maximum vide : sans limite ; décimales à la virgule acceptées', () => {
    const result = toTournamentPayload(values({ shares: ['62,5', '37,5'] }));
    expect(result.ok && result.payload.maximumPlayers).toBeUndefined();
    expect(result.ok && result.payload.prizeRules).toEqual([
      { rank: 1, percent: 62.5 },
      { rank: 2, percent: 37.5 },
    ]);
  });

  it.each([
    [{ date: '31/02/2026' }, 'date'],
    [{ date: '2026-10-12' }, 'date'],
    [{ startTime: '25:00' }, 'startTime'],
    [{ durationMinutes: '1h' }, 'durationMinutes'],
    [{ entryFee: '10.5' }, 'entryFee'],
    [{ minimumPlayers: '' }, 'minimumPlayers'],
    [{ maximumPlayers: 'beaucoup' }, 'maximumPlayers'],
    [{ shares: ['50', 'x'] }, 'shares'],
  ] as const)('format refusé %j → champ %s', (overrides, field) => {
    const result = toTournamentPayload(values(overrides as Partial<TournamentFormValues>));
    expect(result.ok).toBe(false);
    expect(!result.ok && Object.keys(result.errors)).toContain(field);
  });

  it.each([
    ['29', false],
    ['30', true],
    ['45', true],
    ['120', true],
    ['121', false],
  ] as const)('durée de %s minutes : acceptée = %s (D-058)', (durationMinutes, accepted) => {
    const result = toTournamentPayload(values({ durationMinutes }), 'Africa/Douala');
    if (accepted) {
      expect(result.ok).toBe(true);
      const start = new Date(2026, 9, 9, 18, 0);
      expect(result.ok && result.payload).toMatchObject({
        startsAt: start.toISOString(),
        endsAt: new Date(start.getTime() + Number(durationMinutes) * 60_000).toISOString(),
      });
    } else {
      expect(result).toEqual({
        ok: false,
        errors: { durationMinutes: 'Durée entre 30 minutes et 120 minutes.' },
      });
    }
  });

  it('message de durée exact, sans texte ajouté', () => {
    expect(TOURNAMENT_DURATION_ERROR).toBe('Durée entre 30 minutes et 120 minutes.');
  });

  it.each([' 30 ', '030', '0120'])('durée « %s » : convertie en minutes entières', (raw) => {
    const result = toTournamentPayload(values({ durationMinutes: raw }), 'Africa/Douala');
    expect(result.ok).toBe(true);
  });

  it.each(['', '45.5', '45,5', '-45', '1h'])('durée « %s » : format refusé', (raw) => {
    const result = toTournamentPayload(values({ durationMinutes: raw }));
    expect(!result.ok && result.errors.durationMinutes).toBe('Durée en minutes.');
  });

  it('ne duplique pas les règles du serveur : 120 %, 1 joueur ou début passé partent au serveur', () => {
    const result = toTournamentPayload(
      values({ shares: ['60', '60'], minimumPlayers: '1', date: '01/01/2020' }),
    );
    expect(result.ok).toBe(true);
  });
});

describe('fieldErrorsFromApi', () => {
  it('place les messages du serveur sur les champs du formulaire', () => {
    expect(
      fieldErrorsFromApi({
        startsAt: 'Le tournoi doit commencer au moins 1 h plus tard.',
        endsAt: 'Durée entre 30 minutes et 120 minutes.',
        prizeRules: 'La somme des parts doit être exactement 100 %.',
        entryFee: 'Montant entier entre 0 et 100000.',
      }),
    ).toEqual({
      startTime: 'Le tournoi doit commencer au moins 1 h plus tard.',
      durationMinutes: 'Durée entre 30 minutes et 120 minutes.',
      shares: 'La somme des parts doit être exactement 100 %.',
      entryFee: 'Montant entier entre 0 et 100000.',
    });
  });
});

describe('toTournamentPayload : changement de jour, de mois et d’année', () => {
  it.each([
    ['31/12/2026', '23:30', 60, [2026, 12, 31, 23, 30], [2027, 1, 1, 0, 30]],
    ['31/10/2026', '23:45', 30, [2026, 10, 31, 23, 45], [2026, 11, 1, 0, 15]],
    ['28/02/2027', '23:00', 120, [2027, 2, 28, 23, 0], [2027, 3, 1, 1, 0]],
    ['01/01/2027', '00:00', 60, [2027, 1, 1, 0, 0], [2027, 1, 1, 1, 0]],
  ] as const)(
    '%s %s (%i min) : début et fin locaux exacts, aucun décalage de fuseau',
    (date, startTime, duration, startParts, endParts) => {
      const result = toTournamentPayload(
        values({ date, startTime, durationMinutes: String(duration) }),
      );
      if (!result.ok) throw new Error('payload attendu');
      const local = (iso: string) => {
        const d = new Date(iso);
        return [d.getFullYear(), d.getMonth() + 1, d.getDate(), d.getHours(), d.getMinutes()];
      };
      expect(local(result.payload.startsAt)).toEqual(startParts);
      expect(local(result.payload.endsAt)).toEqual(endParts);
    },
  );

  it('29/02 d’une année non bissextile : refusé', () => {
    const result = toTournamentPayload(values({ date: '29/02/2027' }));
    expect(result.ok).toBe(false);
  });
});
