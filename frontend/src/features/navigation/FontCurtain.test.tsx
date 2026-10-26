/// <reference types="jest" />
import { act, cleanup, render, screen } from '@testing-library/react-native';

import { FONT_CURTAIN_MAX_MS, FontCurtain } from './FontCurtain';

/**
 * Démarrage à froid : le premier écran n'est jamais montré en police système avant de changer
 * de taille de texte. Le voile tient jusqu'aux polices, jamais au-delà de son délai maximal.
 */

let mockSettled = false;
jest.mock('../../components/table/TableDecor', () => ({
  ...jest.requireActual('../../components/table/TableDecor'),
  useTableFontsSettled: () => mockSettled,
}));

beforeEach(() => {
  jest.useFakeTimers();
  mockSettled = false;
});
afterEach(async () => {
  await cleanup();
  jest.useRealTimers();
});

const shown = () => screen.queryByTestId('font-curtain') !== null;

it('couvre l’interface tant que les polices chargent, puis disparaît', async () => {
  const view = await render(<FontCurtain />);
  expect(shown()).toBe(true);
  mockSettled = true;
  await view.rerender(<FontCurtain />);
  expect(shown()).toBe(false);
});

it('polices prêtes d’emblée (racine remontée) : jamais affiché', async () => {
  mockSettled = true;
  await render(<FontCurtain />);
  expect(shown()).toBe(false);
});

it('polices trop lentes : l’interface s’affiche quand même après le délai maximal', async () => {
  await render(<FontCurtain />);
  expect(shown()).toBe(true);
  await act(async () => {
    jest.advanceTimersByTime(FONT_CURTAIN_MAX_MS);
  });
  expect(shown()).toBe(false);
});
