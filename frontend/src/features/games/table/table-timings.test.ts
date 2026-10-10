/// <reference types="jest" />
import { DEAL_STEP_MS, PLAYED_CARD_HOLD_MS } from './TableCards';
import { DEFAULT_TURN_MS, TURN_SIGNAL_MS } from './turn-signal';

describe('durées de la table', () => {
  it('tour de jeu : 15 s (D-068, 20 s auparavant), comme TURN_DURATION_MS du serveur', () => {
    expect(DEFAULT_TURN_MS).toBe(15_000);
  });

  it('durées d’animation inchangées', () => {
    expect(TURN_SIGNAL_MS).toBe(2_000);
    expect(DEAL_STEP_MS).toBe(420);
    expect(PLAYED_CARD_HOLD_MS).toBe(2_500);
  });
});
