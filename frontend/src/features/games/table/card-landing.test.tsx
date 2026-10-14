/// <reference types="jest" />
import { act, cleanup, render, screen } from '@testing-library/react-native';
import {
  PanResponder,
  StyleSheet,
  type GestureResponderEvent,
  type PanResponderCallbacks,
  type PanResponderGestureState,
} from 'react-native';

import { CARD_LANDING_MS, DraggableCard, type LandingTarget } from '../DraggableCard';
import { flightState, handWithFlight } from './card-flight';
import { PlayedCardSpotlight, SPOT_ANGLE } from './TableCards';

/**
 * Carte jouée : un seul trajet continu de la main vers la table, sans retour dans la main ni
 * double affichage ; retour dans la main seulement si le serveur refuse le coup.
 */

let config: PanResponderCallbacks;
const create = PanResponder.create.bind(PanResponder);
beforeEach(() => {
  jest.useFakeTimers();
  jest.spyOn(PanResponder, 'create').mockImplementation((c) => {
    config = c;
    return create(c);
  });
});
afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
  cleanup();
});

const ZONE = { x: 100, y: 100, width: 100, height: 100 };
const TARGET: LandingTarget = { dx: 150, dy: -300, scale: 0.6 };
const event = {} as GestureResponderEvent;
const gesture = (dx: number, dy: number, inside: boolean) =>
  ({ dx, dy, moveX: inside ? 150 : 10, moveY: inside ? 150 : 10 }) as PanResponderGestureState;

type CardProps = Partial<Parameters<typeof DraggableCard>[0]>;
const card = (props: CardProps = {}) => (
  <DraggableCard
    cardId="PIQUE-8"
    width={80}
    enabled
    getDropZone={() => ZONE}
    onDrop={() => undefined}
    landingTarget={TARGET}
    {...props}
  />
);

/** Translation et échelle actuelles de la carte (valeurs animées résolues). */
function placement() {
  const style = StyleSheet.flatten(screen.getByRole('button').props.style) as {
    transform: Record<string, number>[];
  };
  const get = (key: string) => style.transform.find((t) => key in t)?.[key] as number;
  return {
    x: get('translateX'),
    y: get('translateY'),
    scale: get('scale'),
    rotate: get('rotate') as unknown as string,
  };
}

/** Glisse la carte de (dx, dy) puis la lâche, dans la zone ou non. */
async function dragAndRelease(dx: number, dy: number, inside: boolean) {
  await act(() => {
    config.onPanResponderGrant?.(event, gesture(0, 0, false));
    config.onPanResponderMove?.(event, gesture(dx, dy, inside));
    config.onPanResponderRelease?.(event, gesture(dx, dy, inside));
  });
}

/** Avance le temps par petits pas et relève chaque position. */
async function samples(totalMs: number, stepMs = 16) {
  const out = [placement()];
  for (let t = 0; t < totalMs; t += stepMs) {
    await act(() => jest.advanceTimersByTime(stepMs));
    out.push(placement());
  }
  return out;
}

describe('carte lâchée sur la table', () => {
  it('un seul trajet continu vers sa place : jamais de recul vers la main', async () => {
    const onDrop = jest.fn();
    const onLanded = jest.fn();
    await render(card({ onDrop, onLanded }));
    await dragAndRelease(40, -120, true);
    expect(onDrop).toHaveBeenCalledWith('PIQUE-8');

    const path = await samples(CARD_LANDING_MS + 200);
    for (const [i, p] of path.entries()) {
      if (i === 0) continue;
      // Monotone : x croît vers 150, y décroît vers −300, sans dépasser ni revenir.
      expect(p.x).toBeGreaterThanOrEqual(path[i - 1].x - 1e-6);
      expect(p.y).toBeLessThanOrEqual(path[i - 1].y + 1e-6);
      expect(p.x).toBeLessThanOrEqual(TARGET.dx + 1e-6);
      expect(p.y).toBeGreaterThanOrEqual(TARGET.dy - 1e-6);
    }
    const end = path[path.length - 1];
    expect(end.x).toBeCloseTo(TARGET.dx);
    expect(end.y).toBeCloseTo(TARGET.dy);
    expect(end.scale).toBeCloseTo(TARGET.scale);
    expect(onLanded).toHaveBeenCalledWith('PIQUE-8');
  });

  it('carte posée au centre : toujours droite, dès le lâcher', async () => {
    await render(card());
    await act(() => {
      config.onPanResponderGrant?.(event, gesture(0, 0, false));
    });
    await act(() => jest.advanceTimersByTime(1_000));
    // Soulevée pendant le glissé : légèrement inclinée.
    expect(parseFloat(placement().rotate)).toBeLessThan(0);
    await act(() => {
      config.onPanResponderRelease?.(event, gesture(40, -120, true));
    });
    for (const p of await samples(CARD_LANDING_MS + 100)) expect(parseFloat(p.rotate)).toBe(0);
  });

  it('envoi en cours puis accepté : la carte reste sur la table, aucun retour', async () => {
    await render(card({ held: false }));
    await dragAndRelease(40, -120, true);
    await screen.rerender(card({ held: true, pending: true }));
    await act(() => jest.advanceTimersByTime(CARD_LANDING_MS + 100));
    // Nouvelles mises à jour (temps réel, relecture) pendant l'attente : rien ne bouge.
    await screen.rerender(card({ held: true, pending: true, enabled: false }));
    await screen.rerender(card({ held: true, pending: false, enabled: false }));
    await act(() => jest.advanceTimersByTime(2_000));
    expect(placement().x).toBeCloseTo(TARGET.dx);
    expect(placement().y).toBeCloseTo(TARGET.dy);
  });

  it('coup refusé : la carte revient dans la main (comportement de refus inchangé)', async () => {
    await render(card({ held: false }));
    await dragAndRelease(40, -120, true);
    await screen.rerender(card({ held: true, pending: true }));
    await act(() => jest.advanceTimersByTime(CARD_LANDING_MS + 100));
    await screen.rerender(card({ held: false }));
    await act(() => jest.advanceTimersByTime(3_000));
    expect(placement().x).toBeCloseTo(0);
    expect(placement().y).toBeCloseTo(0);
    expect(placement().scale).toBeCloseTo(1);
  });

  it('lâchée hors de la zone : aucun coup, retour dans la main', async () => {
    const onDrop = jest.fn();
    const onLanded = jest.fn();
    await render(card({ onDrop, onLanded }));
    await dragAndRelease(40, -20, false);
    await act(() => jest.advanceTimersByTime(3_000));
    expect(onDrop).not.toHaveBeenCalled();
    expect(onLanded).not.toHaveBeenCalled();
    expect(placement().x).toBeCloseTo(0);
    expect(placement().y).toBeCloseTo(0);
  });
});

describe('main et carte jouée : une seule carte à l’écran', () => {
  const flight = { cardId: 'PIQUE-8', index: 1, landed: false };

  it('envoi en cours : la carte est encore dans ma main du serveur, rien à ajouter', () => {
    const state = flightState(flight, false, ['COEUR-7', 'PIQUE-8', 'TREFLE-9']);
    expect(state).toEqual({ flightCard: 'PIQUE-8', inHand: null });
  });

  it('accepté pendant le trajet : gardée à sa place dans la main, une seule fois', () => {
    const state = flightState(flight, false, ['COEUR-7', 'TREFLE-9']);
    expect(state.inHand).toBe(flight);
    expect(handWithFlight(['COEUR-7', 'TREFLE-9'], state.inHand)).toEqual([
      'COEUR-7',
      'PIQUE-8',
      'TREFLE-9',
    ]);
  });

  it('accepté et arrivée : retirée de la main, la carte jouée prend le relais', () => {
    const state = flightState({ ...flight, landed: true }, false, ['COEUR-7', 'TREFLE-9']);
    expect(state).toEqual({ flightCard: 'PIQUE-8', inHand: null });
    expect(handWithFlight(['COEUR-7', 'TREFLE-9'], state.inHand)).toEqual(['COEUR-7', 'TREFLE-9']);
  });

  it('refusé : aucune carte jouée inventée, la main du serveur fait foi', () => {
    expect(flightState(flight, true, ['COEUR-7', 'PIQUE-8'])).toEqual({ inHand: null });
  });

  it('jamais de doublon dans la main', () => {
    expect(handWithFlight(['PIQUE-8', 'COEUR-7'], flight)).toEqual(['PIQUE-8', 'COEUR-7']);
  });
});

describe('carte jouée du serveur à la place de ma carte posée', () => {
  const spotlight = (instant: boolean, angle?: number) => (
    <PlayedCardSpotlight
      cardId="PIQUE-8"
      from={{ x: 100, y: 100 }}
      to={{ x: 300, y: 200 }}
      width={40}
      targetWidth={30}
      angle={angle}
      instant={instant}
      release={false}
      onSettled={() => undefined}
    />
  );
  const opacityOf = () =>
    (StyleSheet.flatten(screen.getByLabelText(/^8 ♠/).parent?.parent?.props.style) as {
      opacity: number;
    }).opacity;

  it.each([
    ['moi (bas)', 'bottom', '0deg'],
    ['en face', 'top', '180deg'],
    ['à gauche', 'left', '90deg'],
    ['à droite', 'right', '-90deg'],
  ] as const)('droite devant son joueur, vue ainsi par tous : %s', async (_label, side, rotate) => {
    await render(spotlight(false, SPOT_ANGLE[side]));
    const style = StyleSheet.flatten(
      screen.getByLabelText(/^8 ♠/).parent?.parent?.props.style,
    ) as { transform: Record<string, unknown>[] };
    expect(style.transform.find((t) => 'rotate' in t)?.rotate).toBe(rotate);
  });

  it('reprise instantanée : visible tout de suite, sans fondu', async () => {
    await render(spotlight(true));
    expect(opacityOf()).toBe(1);
  });

  it('carte d’un autre joueur (ou 5e tour) : apparition en fondu inchangée', async () => {
    // Le fondu lui-même tourne sur le pilote natif (non simulé sous Jest) : il part de 0.
    await render(spotlight(false));
    expect(opacityOf()).toBe(0);
  });
});
