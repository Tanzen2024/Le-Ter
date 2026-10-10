import {
  addMonths,
  compareDates,
  formatDisplayDate,
  formatDisplayTime,
  formatFormDate,
  formatFormTime,
  formatLongDate,
  formatMonthTitle,
  from12Hour,
  monthGrid,
  parseFormDate,
  parseFormTime,
  to12Hour,
  todayOf,
  weekdayLabels,
} from './date-time';

describe('valeur interne (indépendante de la langue)', () => {
  it('date JJ/MM/AAAA : lecture et écriture', () => {
    expect(parseFormDate('10/10/2026')).toEqual({ year: 2026, month: 10, day: 10 });
    expect(formatFormDate({ year: 2027, month: 1, day: 5 })).toBe('05/01/2027');
  });

  it.each(['31/02/2026', '29/02/2027', '00/10/2026', '10/13/2026', '2026-10-10', ''])(
    'date invalide refusée : %s',
    (value) => expect(parseFormDate(value)).toBeUndefined(),
  );

  it('29/02 accepté une année bissextile', () => {
    expect(parseFormDate('29/02/2028')).toEqual({ year: 2028, month: 2, day: 29 });
  });

  it('heure HH:MM sur 24 h', () => {
    expect(parseFormTime('20:05')).toEqual({ hours: 20, minutes: 5 });
    expect(parseFormTime('24:00')).toBeUndefined();
    expect(parseFormTime('8 PM')).toBeUndefined();
    expect(formatFormTime({ hours: 8, minutes: 0 })).toBe('08:00');
  });
});

describe('affichage localisé', () => {
  it('français : 24 h', () => {
    expect(formatDisplayTime({ hours: 20, minutes: 0 }, '24h')).toBe('20:00');
    expect(formatDisplayTime({ hours: 0, minutes: 5 }, '24h')).toBe('00:05');
  });

  it('anglais : 12 h avec AM/PM', () => {
    expect(formatDisplayTime({ hours: 20, minutes: 0 }, '12h')).toBe('08:00 PM');
    expect(formatDisplayTime({ hours: 0, minutes: 5 }, '12h')).toBe('12:05 AM');
    expect(formatDisplayTime({ hours: 12, minutes: 30 }, '12h')).toBe('12:30 PM');
    expect(formatDisplayTime({ hours: 11, minutes: 59 }, '12h')).toBe('11:59 AM');
  });

  it('conversion 12 h ↔ 24 h sur toute la journée', () => {
    for (let hours = 0; hours < 24; hours++) {
      const { hour, period } = to12Hour(hours);
      expect(hour).toBeGreaterThanOrEqual(1);
      expect(hour).toBeLessThanOrEqual(12);
      expect(from12Hour(hour, period)).toBe(hours);
    }
  });

  it('date : 10/10/2026 en fr-FR et en en-GB (jour en premier)', () => {
    expect(formatDisplayDate({ year: 2026, month: 10, day: 10 }, 'fr-FR')).toBe('10/10/2026');
    expect(formatDisplayDate({ year: 2026, month: 10, day: 3 }, 'en-GB')).toBe('03/10/2026');
  });

  it('noms des mois et des jours dans la langue', () => {
    expect(formatMonthTitle(2026, 10, 'fr-FR')).toBe('octobre 2026');
    expect(formatMonthTitle(2026, 10, 'en-GB')).toBe('October 2026');
    expect(formatLongDate({ year: 2026, month: 10, day: 10 }, 'fr-FR')).toBe(
      'samedi 10 octobre 2026',
    );
    expect(weekdayLabels('fr-FR', 1)[0]).toMatch(/^lun/);
    expect(weekdayLabels('en-GB', 1)[6]).toBe('Sun');
  });

  it('premier et dernier jour de l’année : jamais décalés', () => {
    expect(formatDisplayDate({ year: 2026, month: 12, day: 31 }, 'fr-FR')).toBe('31/12/2026');
    expect(formatDisplayDate({ year: 2027, month: 1, day: 1 }, 'fr-FR')).toBe('01/01/2027');
  });
});

describe('calendrier', () => {
  it('octobre 2026 commence un jeudi (semaine du lundi)', () => {
    const grid = monthGrid(2026, 10, 1);
    expect(grid[0]).toEqual([null, null, null, 1, 2, 3, 4]);
    expect(grid.flat().filter((d) => d !== null)).toHaveLength(31);
    expect(grid.every((week) => week.length === 7)).toBe(true);
  });

  it('février 2028 (bissextile) : 29 jours', () => {
    expect(
      Math.max(
        ...monthGrid(2028, 2, 1)
          .flat()
          .map((d) => d ?? 0),
      ),
    ).toBe(29);
  });

  it('navigation : changement d’année dans les deux sens', () => {
    expect(addMonths({ year: 2026, month: 12 }, 1)).toEqual({ year: 2027, month: 1 });
    expect(addMonths({ year: 2027, month: 1 }, -1)).toEqual({ year: 2026, month: 12 });
    expect(addMonths({ year: 2026, month: 10 }, 12)).toEqual({ year: 2027, month: 10 });
  });

  it('comparaison et jour courant', () => {
    expect(todayOf(new Date(2026, 9, 9, 23, 59))).toEqual({ year: 2026, month: 10, day: 9 });
    expect(
      compareDates({ year: 2026, month: 10, day: 9 }, { year: 2026, month: 10, day: 10 }),
    ).toBeLessThan(0);
    expect(
      compareDates({ year: 2027, month: 1, day: 1 }, { year: 2026, month: 12, day: 31 }),
    ).toBeGreaterThan(0);
  });
});
