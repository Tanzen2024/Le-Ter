/// <reference types="jest" />
import { cleanup, render, screen } from '@testing-library/react-native';

import { gameTheme } from '../../../constants/theme';
import { UNKNOWN_PLAYER_LABEL, UNKNOWN_SELF_LABEL } from '../format';
import { avatarToneOf, SeatPlate } from './TableParts';

/**
 * Jetons-avatars (LOT 3) : teinte dérivée du pseudo réel, stable ; aucune teinte « personnelle »
 * pour un libellé neutre ; le pseudo reste écrit et annoncé.
 */
afterEach(cleanup);

const NEUTRAL = gameTheme.avatarTones.length - 1;

describe('teinte du jeton', () => {
  it('même pseudo, même teinte, quelle que soit la casse ou les espaces', () => {
    expect(avatarToneOf('Kofi')).toBe(avatarToneOf('  kofi '));
    expect(avatarToneOf('Kofi')).toBeLessThan(NEUTRAL);
  });

  it('pseudos différents : plusieurs teintes possibles (repère visuel)', () => {
    const tones = new Set(['Kofi', 'Awa', 'Moussa', 'Ngozi', 'Yaw', 'Fatou'].map(avatarToneOf));
    expect(tones.size).toBeGreaterThan(1);
  });

  it('libellé neutre ou vide : teinte neutre', () => {
    for (const name of [UNKNOWN_PLAYER_LABEL, UNKNOWN_SELF_LABEL, '', '  ']) {
      expect(avatarToneOf(name)).toBe(NEUTRAL);
    }
  });
});

it('la plaque garde le pseudo écrit et son monogramme', async () => {
  await render(
    <SeatPlate
      state={{
        name: 'Kofi',
        local: false,
        active: false,
        firstPlayer: false,
        dimmed: false,
        winner: false,
      }}
      width={160}
      height={36}
      style={{}}
    />,
  );
  expect(screen.getByText('Kofi')).toBeTruthy();
  expect(screen.getByTestId('seat-avatar', { includeHiddenElements: true })).toBeTruthy();
  expect(screen.getByText('K', { includeHiddenElements: true })).toBeTruthy();
});
