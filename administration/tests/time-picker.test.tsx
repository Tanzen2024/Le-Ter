import { fireEvent, render, screen, within } from '@testing-library/react';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { TimePicker } from '@/components/ui/time-picker';
import { toTournamentPayload, tournamentFormSchema } from '@/lib/validation/tournament';
import { formatTime, from12Hour, parseTime, to12Hour, uses12Hour } from '@/lib/time';

function Harness({
  initial,
  locale,
  spy,
}: {
  initial: string;
  locale?: string;
  spy: (v: string) => void;
}) {
  const [value, setValue] = useState(initial);
  return (
    <TimePicker
      id="time"
      value={value}
      locale={locale}
      onChange={(v) => {
        spy(v);
        setValue(v);
      }}
    />
  );
}

describe('heures : affichage selon la locale, valeur HH:mm', () => {
  it('fr-FR : 24 h ; en-US : 12 h avec AM/PM', () => {
    expect(uses12Hour('fr-FR')).toBe(false);
    expect(uses12Hour('en-US')).toBe(true);
    expect(formatTime({ hours: 20, minutes: 0 }, 'fr-FR')).toBe('20:00');
    expect(formatTime({ hours: 20, minutes: 0 }, 'en-US')).toBe('08:00 PM');
    expect(formatTime({ hours: 0, minutes: 5 }, 'en-US')).toBe('12:05 AM');
    expect(formatTime({ hours: 12, minutes: 0 }, 'en-US')).toBe('12:00 PM');
  });

  it('conversion 12 h ↔ 24 h sur toute la journée ; valeurs invalides refusées', () => {
    for (let h = 0; h < 24; h++) {
      const { hour, period } = to12Hour(h);
      expect(from12Hour(hour, period)).toBe(h);
    }
    expect(parseTime('24:00')).toBeUndefined();
    expect(parseTime('8:00 PM')).toBeUndefined();
    expect(parseTime('')).toBeUndefined();
  });
});

describe('sélecteur « Heure de début »', () => {
  it('français : champ avec horloge, colonnes Heures et Minutes sans AM/PM', () => {
    const spy = vi.fn();
    render(<Harness initial="20:00" spy={spy} />);
    const trigger = screen.getByRole('button', { name: /20:00/ });
    expect(trigger.querySelector('svg')).not.toBeNull();
    fireEvent.click(trigger);

    const hours = screen.getByRole('listbox', { name: 'Heures' });
    expect(within(hours).getAllByRole('option')).toHaveLength(24);
    expect(screen.queryByRole('listbox', { name: 'Période' })).toBeNull();
    fireEvent.click(within(hours).getByRole('option', { name: '21' }));
    fireEvent.click(
      within(screen.getByRole('listbox', { name: 'Minutes' })).getByRole('option', { name: '45' }),
    );
    expect(spy).toHaveBeenLastCalledWith('21:45');
    expect(screen.getByRole('button', { name: /21:45/ })).toBeInTheDocument();
  });

  it('clavier : flèches, Début et Fin dans une colonne (passage d’une heure à l’autre)', () => {
    const spy = vi.fn();
    render(<Harness initial="23:59" spy={spy} />);
    fireEvent.click(screen.getByRole('button', { name: /23:59/ }));
    const minutes = screen.getByRole('listbox', { name: 'Minutes' });
    fireEvent.keyDown(minutes, { key: 'ArrowDown' });
    expect(spy).toHaveBeenLastCalledWith('23:00');
    fireEvent.keyDown(minutes, { key: 'End' });
    expect(spy).toHaveBeenLastCalledWith('23:59');
    fireEvent.keyDown(screen.getByRole('listbox', { name: 'Heures' }), { key: 'Home' });
    expect(spy).toHaveBeenLastCalledWith('00:59');
  });

  it('anglais (en-US) : 12 h avec AM/PM, valeur émise toujours sur 24 h', () => {
    const spy = vi.fn();
    render(<Harness initial="20:00" locale="en-US" spy={spy} />);
    fireEvent.click(screen.getByRole('button', { name: /08:00 PM/ }));
    const hours = screen.getByRole('listbox', { name: 'Hours' });
    expect(within(hours).getAllByRole('option')).toHaveLength(12);
    fireEvent.click(
      within(screen.getByRole('listbox', { name: 'Period' })).getByRole('option', { name: 'AM' }),
    );
    expect(spy).toHaveBeenLastCalledWith('08:00');
    fireEvent.click(within(hours).getByRole('option', { name: '12' }));
    expect(spy).toHaveBeenLastCalledWith('00:00');
  });

  it('valeur du sélecteur acceptée par le formulaire et envoyée en Africa/Douala', () => {
    const values = tournamentFormSchema.parse({
      gameType: 'TER',
      date: '2026-12-31',
      time: '23:30',
      durationMinutes: '60',
      entryFee: '1000',
      minimumPlayers: '20',
      maximumPlayers: '',
      prizeRules: [{ percent: '100' }],
    });
    const payload = toTournamentPayload(values);
    expect(payload.startsAt).toBe('2026-12-31T22:30:00.000Z');
    expect(payload.endsAt).toBe('2026-12-31T23:30:00.000Z');
    expect(tournamentFormSchema.shape.time.safeParse('08:00 PM').success).toBe(false);
  });
});
