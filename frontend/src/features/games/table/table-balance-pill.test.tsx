/// <reference types="jest" />
import { cleanup, render, screen } from '@testing-library/react-native';
import { Text } from 'react-native';

import { BalancePill } from './TableParts';

afterEach(cleanup);

/** Pendant une partie, la table affiche le solde mais ne propose aucune opération financière. */
describe('solde à la table', () => {
  it('lecture seule : le solde reste visible, sans bouton ni « + » vers la boutique', async () => {
    await render(
      <BalancePill height={44}>
        <Text>7178</Text>
      </BalancePill>,
    );

    expect(screen.getByTestId('table-balance')).toBeTruthy();
    expect(screen.getByText('7178')).toBeTruthy();
    expect(screen.queryByRole('button')).toBeNull();
    expect(screen.queryByLabelText('Ajouter des jetons')).toBeNull();
    expect(screen.queryByText('+')).toBeNull();
  });
});
