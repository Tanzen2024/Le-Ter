/// <reference types="jest" />
import { fireEvent, render, screen } from '@testing-library/react-native';

import { AppErrorScreen } from './AppErrorScreen';

describe('écran de secours (erreur imprévue d’un écran)', () => {
  it('aucun message d’erreur (D-168) : seulement « Réessayer »', async () => {
    const error = new TypeError("Cannot read properties of undefined (reading 'gameId')");
    error.stack = 'TypeError: …\n    at GameTableScreen (GameTableScreen.tsx:42:7)';
    const retry = jest.fn(async () => undefined);
    const spy = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    await render(<AppErrorScreen error={error} retry={retry} />);
    expect(screen.queryByText(/Oups|problème|erreur/i)).toBeNull();
    expect(screen.queryByText(/Cannot read|TypeError|GameTableScreen|undefined/)).toBeNull();
    fireEvent.press(screen.getByRole('button', { name: 'Réessayer' }));
    expect(retry).toHaveBeenCalledTimes(1);
    spy.mockRestore();
  });
});
