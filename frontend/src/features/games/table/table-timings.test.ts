/// <reference types="jest" />
import { DEAL_STEP_MS, TRICK_CLEAR_DELAY_MS } from './TableCards';
import { DEFAULT_TURN_MS, TURN_SIGNAL_MS } from './turn-signal';

describe('durées de la table', () => {
  it('tour de jeu : 10 s (D-092, 15 s auparavant), comme TURN_DURATION_MS du serveur', () => {
    expect(DEFAULT_TURN_MS).toBe(10_000);
  });

  it('durées d’animation : halo du joueur actif 5 s (visuel seul), autres inchangées', () => {
    expect(TURN_SIGNAL_MS).toBe(5_000);
    expect(DEAL_STEP_MS).toBe(420);
    // Cartes d'un tour rangées 1 s après la dernière carte du tour (D-151, 2 s auparavant).
    expect(TRICK_CLEAR_DELAY_MS).toBe(1_000);
  });
});
