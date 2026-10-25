/// <reference types="jest" />
import { cleanup, fireEvent, render, screen } from '@testing-library/react-native';

import { DEFAULT_PREFERENCES, usePreferencesStore } from '../../stores/preferences-store';
import { placePopover } from './AnchoredPopover';
import { DatePickerField } from './DatePickerField';
import { TimePickerField } from './TimePickerField';

jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn(async () => null),
  setItemAsync: jest.fn(async () => undefined),
  deleteItemAsync: jest.fn(async () => undefined),
}));

const SCREEN = { width: 800, height: 360 };
const SIZE = { width: 240, height: 200 };

beforeEach(() => usePreferencesStore.setState(DEFAULT_PREFERENCES));
afterEach(async () => {
  await cleanup();
});

describe('placePopover', () => {
  it('sous le champ, alignée sur son bord gauche, quand la place suffit', () => {
    expect(placePopover({ x: 100, y: 40, width: 180, height: 36 }, SIZE, SCREEN)).toEqual({
      left: 100,
      top: 82,
      side: 'below',
    });
  });

  it('au-dessus du champ quand le bas manque', () => {
    expect(placePopover({ x: 100, y: 280, width: 180, height: 36 }, SIZE, SCREEN)).toEqual({
      left: 100,
      top: 74,
      side: 'above',
    });
  });

  it('paysage, ni dessus ni dessous : à côté du champ, entière dans l’écran', () => {
    expect(placePopover({ x: 100, y: 150, width: 180, height: 36 }, SIZE, SCREEN)).toEqual({
      left: 286,
      top: 150,
      side: 'right',
    });
    expect(placePopover({ x: 600, y: 150, width: 180, height: 36 }, SIZE, SCREEN)).toEqual({
      left: 354,
      top: 150,
      side: 'left',
    });
  });

  it('jamais hors de l’écran à droite', () => {
    expect(placePopover({ x: 700, y: 20, width: 90, height: 36 }, SIZE, SCREEN).left).toBe(552);
  });
});

describe('sélecteurs accrochés (presentation="popover")', () => {
  it('calendrier : sans titre ni Annuler, jour choisi transmis puis fermeture', async () => {
    const onChange = jest.fn();
    await render(
      <DatePickerField label="Date" value="10/10/2026" onChange={onChange} presentation="popover" />,
    );
    await fireEvent.press(screen.getByLabelText('Date'));
    expect(screen.getByTestId('date-picker-popover')).toBeTruthy();
    expect(screen.getByLabelText('Date').props.accessibilityState).toMatchObject({ expanded: true });
    expect(screen.queryByLabelText('Annuler')).toBeNull();
    await fireEvent.press(screen.getByLabelText('jeudi 15 octobre 2026'));
    expect(onChange).toHaveBeenCalledWith('15/10/2026');
    expect(screen.queryByTestId('date-picker-popover')).toBeNull();
  });

  it('un appui hors du calendrier le referme sans rien changer', async () => {
    const onChange = jest.fn();
    await render(
      <DatePickerField label="Date" value="10/10/2026" onChange={onChange} presentation="popover" />,
    );
    await fireEvent.press(screen.getByLabelText('Date'));
    await fireEvent.press(screen.getByLabelText('Fermer le sélecteur'));
    expect(screen.queryByTestId('date-picker-popover')).toBeNull();
    expect(onChange).not.toHaveBeenCalled();
  });

  it('horloge : choix appliqué seulement à la validation', async () => {
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
    expect(onChange).not.toHaveBeenCalled();
    await fireEvent.press(screen.getByLabelText('Valider'));
    expect(onChange).toHaveBeenCalledWith('20:30');
    expect(screen.queryByTestId('time-picker-popover')).toBeNull();
  });
});
