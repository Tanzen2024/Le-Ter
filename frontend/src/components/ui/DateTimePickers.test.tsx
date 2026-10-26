/// <reference types="jest" />
import { cleanup, fireEvent, render, screen } from '@testing-library/react-native';

import { DEFAULT_PREFERENCES, usePreferencesStore } from '../../stores/preferences-store';
import { DatePickerField } from './DatePickerField';
import { TimePickerField } from './TimePickerField';

jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn(async () => null),
  setItemAsync: jest.fn(async () => undefined),
  deleteItemAsync: jest.fn(async () => undefined),
}));

const MIN = { year: 2026, month: 10, day: 9 };

beforeEach(() => usePreferencesStore.setState(DEFAULT_PREFERENCES));
afterEach(async () => {
  await cleanup();
});

describe('DatePickerField', () => {
  it('français : valeur localisée, calendrier en français, jour choisi transmis en JJ/MM/AAAA', async () => {
    const onChange = jest.fn();
    await render(
      <DatePickerField label="Date" value="10/10/2026" onChange={onChange} minDate={MIN} />,
    );
    const field = screen.getByLabelText('Date');
    expect(field.props.accessibilityRole).toBe('button');
    expect(field.props.accessibilityValue).toEqual({ text: '10/10/2026' });
    expect(screen.getByText('📅', { includeHiddenElements: true })).toBeTruthy();

    await fireEvent.press(field);
    expect(screen.getByTestId('date-picker-month').props.children).toBe('octobre 2026');
    expect(screen.getByLabelText('samedi 10 octobre 2026').props.accessibilityState).toMatchObject({
      selected: true,
    });
    await fireEvent.press(screen.getByLabelText('jeudi 15 octobre 2026'));
    expect(onChange).toHaveBeenCalledWith('15/10/2026');
  });

  it('petit écran : mois et année sur une seule ligne (rétrécis, jamais coupés), calendrier défilant', async () => {
    await render(
      <DatePickerField label="Date" value="10/11/2026" onChange={jest.fn()} minDate={MIN} />,
    );
    await fireEvent.press(screen.getByLabelText('Date'));
    const month = screen.getByTestId('date-picker-month');
    expect(month.props.children).toBe('novembre 2026');
    expect(month.props.numberOfLines).toBe(1);
    expect(month.props.adjustsFontSizeToFit).toBe(true);
    // Les 4 flèches restent plus étroites qu'un jour : il reste au mois plus de 3 jours de large.
    const flat = (style: unknown) => Object.assign({}, ...[style].flat(Infinity).filter(Boolean));
    const day = flat(screen.getByLabelText('mardi 10 novembre 2026').props.style).width;
    const arrow = flat(screen.getByLabelText(/mois précédent/i).props.style).width;
    expect(arrow).toBeLessThan(day);
    expect(day * 7 - arrow * 4).toBeGreaterThan(day * 3);
    // Hauteur insuffisante : le calendrier (6 semaines en novembre 2026) défile, jamais coupé.
    expect(screen.getByTestId('picker-scroll')).toBeTruthy();
  });

  it('dates passées (avant le minimum) : non sélectionnables, mois précédent bloqué', async () => {
    const onChange = jest.fn();
    await render(
      <DatePickerField label="Date" value="10/10/2026" onChange={onChange} minDate={MIN} />,
    );
    await fireEvent.press(screen.getByLabelText('Date'));
    const past = screen.getByLabelText('jeudi 8 octobre 2026, indisponible');
    expect(past.props.accessibilityState).toMatchObject({ disabled: true });
    await fireEvent.press(past);
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByLabelText('Mois précédent').props.accessibilityState).toMatchObject({
      disabled: true,
    });
    await fireEvent.press(screen.getByLabelText('vendredi 9 octobre 2026'));
    expect(onChange).toHaveBeenCalledWith('09/10/2026');
  });

  it('changement de mois et d’année', async () => {
    const onChange = jest.fn();
    await render(
      <DatePickerField label="Date" value="10/12/2026" onChange={onChange} minDate={MIN} />,
    );
    await fireEvent.press(screen.getByLabelText('Date'));
    expect(screen.getByTestId('date-picker-month').props.children).toBe('décembre 2026');
    await fireEvent.press(screen.getByLabelText('Mois suivant'));
    expect(screen.getByTestId('date-picker-month').props.children).toBe('janvier 2027');
    await fireEvent.press(screen.getByLabelText('Année suivante'));
    expect(screen.getByTestId('date-picker-month').props.children).toBe('janvier 2028');
    await fireEvent.press(screen.getByLabelText('Année précédente'));
    await fireEvent.press(screen.getByLabelText('vendredi 1 janvier 2027'));
    expect(onChange).toHaveBeenCalledWith('01/01/2027');
  });

  it('anglais : calendrier en anglais, valeur transmise inchangée (JJ/MM/AAAA)', async () => {
    usePreferencesStore.setState({ language: 'en' });
    const onChange = jest.fn();
    await render(
      <DatePickerField label="Date" value="03/10/2026" onChange={onChange} minDate={MIN} />,
    );
    expect(screen.getByLabelText('Date').props.accessibilityValue).toEqual({ text: '03/10/2026' });
    await fireEvent.press(screen.getByLabelText('Date'));
    expect(screen.getByTestId('date-picker-month').props.children).toBe('October 2026');
    expect(screen.getByLabelText('Next month')).toBeTruthy();
    await fireEvent.press(screen.getByLabelText(/^Thursday,? 15 October 2026$/));
    expect(onChange).toHaveBeenCalledWith('15/10/2026');
  });
});

describe('TimePickerField', () => {
  it('français : 24 h, colonnes Heures et Minutes, sans AM/PM ; valeur HH:MM', async () => {
    const onChange = jest.fn();
    await render(<TimePickerField label="Heure de début" value="18:00" onChange={onChange} />);
    const field = screen.getByLabelText('Heure de début');
    expect(field.props.accessibilityValue).toEqual({ text: '18:00' });
    expect(screen.getByText('🕐', { includeHiddenElements: true })).toBeTruthy();

    await fireEvent.press(field);
    expect(screen.getByLabelText('Heures 23')).toBeTruthy();
    expect(screen.queryByLabelText('Période')).toBeNull();
    await fireEvent.press(screen.getByLabelText('Heures 20'));
    await fireEvent.press(screen.getByLabelText('Minutes 45'));
    expect(screen.getByTestId('time-picker-preview').props.children).toBe('20:45');
    expect(onChange).not.toHaveBeenCalled();
    await fireEvent.press(screen.getByLabelText('Valider'));
    expect(onChange).toHaveBeenCalledWith('20:45');
  });

  it('annuler : aucune modification', async () => {
    const onChange = jest.fn();
    await render(<TimePickerField label="Heure de début" value="18:00" onChange={onChange} />);
    await fireEvent.press(screen.getByLabelText('Heure de début'));
    await fireEvent.press(screen.getByLabelText('Heures 09'));
    await fireEvent.press(screen.getByLabelText('Annuler'));
    expect(onChange).not.toHaveBeenCalled();
  });

  it('anglais : 12 h avec AM/PM, valeur toujours transmise sur 24 h', async () => {
    usePreferencesStore.setState({ language: 'en' });
    const onChange = jest.fn();
    await render(<TimePickerField label="Start time" value="18:00" onChange={onChange} />);
    expect(screen.getByLabelText('Start time').props.accessibilityValue).toEqual({
      text: '06:00 PM',
    });
    await fireEvent.press(screen.getByLabelText('Start time'));
    expect(screen.queryByLabelText('Hours 13')).toBeNull();
    await fireEvent.press(screen.getByLabelText('Hours 08'));
    await fireEvent.press(screen.getByLabelText('Minutes 30'));
    expect(screen.getByTestId('time-picker-preview').props.children).toBe('08:30 PM');
    await fireEvent.press(screen.getByLabelText('Period AM'));
    expect(screen.getByTestId('time-picker-preview').props.children).toBe('08:30 AM');
    await fireEvent.press(screen.getByLabelText('OK'));
    expect(onChange).toHaveBeenCalledWith('08:30');
  });

  it('anglais : 12 AM = 00:xx, 12 PM = 12:xx', async () => {
    usePreferencesStore.setState({ language: 'en' });
    const onChange = jest.fn();
    await render(<TimePickerField label="Start time" value="00:15" onChange={onChange} />);
    expect(screen.getByLabelText('Start time').props.accessibilityValue).toEqual({
      text: '12:15 AM',
    });
    await fireEvent.press(screen.getByLabelText('Start time'));
    await fireEvent.press(screen.getByLabelText('Period PM'));
    await fireEvent.press(screen.getByLabelText('OK'));
    expect(onChange).toHaveBeenCalledWith('12:15');
  });
});

describe('présentation « popover » (D-166)', () => {
  it('calendrier accroché au champ : jour choisi transmis, appui hors du calendrier sans effet sur la valeur', async () => {
    const onChange = jest.fn();
    await render(
      <DatePickerField
        label="Date"
        value="10/10/2026"
        onChange={onChange}
        minDate={MIN}
        presentation="popover"
      />,
    );
    await fireEvent.press(screen.getByLabelText('Date'));
    expect(screen.getByTestId('date-picker-popover')).toBeTruthy();
    expect(screen.queryByTestId('picker-scroll')).toBeNull();
    expect(screen.getByLabelText('Date').props.accessibilityState).toMatchObject({ expanded: true });
    await fireEvent.press(screen.getByTestId('date-picker-popover-outside'));
    expect(onChange).not.toHaveBeenCalled();
    await fireEvent.press(screen.getByLabelText('Date'));
    await fireEvent.press(screen.getByLabelText('jeudi 15 octobre 2026'));
    expect(onChange).toHaveBeenCalledWith('15/10/2026');
  });

  it('horloge accrochée au champ : appliquée seulement à la validation', async () => {
    const onChange = jest.fn();
    await render(
      <TimePickerField
        label="Heure de début"
        value="18:00"
        onChange={onChange}
        presentation="popover"
      />,
    );
    await fireEvent.press(screen.getByLabelText('Heure de début'));
    expect(screen.getByTestId('time-picker-popover')).toBeTruthy();
    await fireEvent.press(screen.getByLabelText('Heures 20'));
    await fireEvent.press(screen.getByLabelText('Minutes 30'));
    await fireEvent.press(screen.getByTestId('time-picker-popover-outside'));
    expect(onChange).not.toHaveBeenCalled();
    await fireEvent.press(screen.getByLabelText('Heure de début'));
    await fireEvent.press(screen.getByLabelText('Heures 20'));
    await fireEvent.press(screen.getByLabelText('Valider'));
    expect(onChange).toHaveBeenCalledWith('20:00');
  });
});
