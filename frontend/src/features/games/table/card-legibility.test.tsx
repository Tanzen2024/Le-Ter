/// <reference types="jest" />
import { cleanup, render, screen } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';

import type { GameView } from '../../../types/game';
import { computeLobbyMetrics } from '../../lobby/lobby-metrics';
import { DraggableCard } from '../DraggableCard';
import { computeGameTableLayout } from './table-layout';
import { TurnActions } from './TurnHud';

/**
 * Netteté des cartes en main et des boutons d'action. Sur Android, une `opacity` (ou un
 * `filter`) posée sur une vue à plusieurs couches les rend translucides une à une : la carte
 * du dessous transparaît (effet de flou) et le bouton paraît voilé. Aucun état (non jouable,
 * envoi en cours, non autorisé, pressé) ne doit donc en utiliser.
 */

afterEach(cleanup);

const flat = (style: unknown) => StyleSheet.flatten(style as never) ?? {};

/** Aucune opacité < 1 ni filtre sur le nœud ni sur aucun de ses ancêtres rendus. */
function expectOpaque(node: { props: { style?: unknown }; parent: unknown } | null) {
  for (let n = node; n; n = n.parent as typeof node) {
    const style = flat(n.props.style) as { opacity?: unknown; filter?: unknown };
    if (typeof style.opacity === 'number') expect(style.opacity).toBe(1);
    expect(style.filter).toBeUndefined();
  }
}

const card = (props: Partial<Parameters<typeof DraggableCard>[0]> = {}) => (
  <DraggableCard
    cardId="PIQUE-8"
    width={80}
    enabled={false}
    getDropZone={() => null}
    onDrop={() => undefined}
    {...props}
  />
);

describe('cartes en main : toujours opaques et nettes', () => {
  it.each([
    ['non jouable (pas mon tour)', { enabled: false }],
    ['jouable', { enabled: true }],
    ['envoi en cours', { enabled: false, pending: true }],
  ])('%s : aucune opacité, chiffre et symbole rendus', async (_label, props) => {
    await render(card(props));
    // Conteneur glissable et face de la carte, puis le chiffre (remonte tous les ancêtres).
    for (const node of screen.getAllByLabelText(/^8 ♠/)) expectOpaque(node as never);
    expectOpaque(screen.getByText('8') as never);
    expectOpaque(screen.getByText('♠') as never);
  });

  it('jouable : liseré doré net par-dessus la carte (pas de transparence)', async () => {
    await render(card({ enabled: true }));
    expect(screen.getByTestId('card-playable')).toHaveStyle({
      borderColor: '#F5C842',
      borderWidth: 2,
    });
    await cleanup();
    await render(card({ enabled: false }));
    expect(screen.queryByTestId('card-playable')).toBeNull();
  });

  it('envoi en cours : voile posé sur la carte opaque, carte elle-même jamais translucide', async () => {
    await render(card({ pending: true }));
    expect(screen.getByTestId('card-pending')).toBeTruthy();
    for (const node of screen.getAllByLabelText(/^8 ♠/)) expectOpaque(node as never);
  });
});

describe('boutons « Main spéciale » et « Se coucher » : opaques dans tous les états', () => {
  const layout = computeGameTableLayout(
    computeLobbyMetrics({
      width: 800,
      height: 360,
      safe: { top: 6, bottom: 6, left: 12, right: 12 },
    }),
  );
  const game = (canFlee: boolean, canDeclareInstantWin: boolean) =>
    ({
      gameId: 'g-1',
      viewerId: 'me',
      players: [],
      myActions: { canPlayCard: false, playableCardIds: [], canFlee, canDeclareInstantWin },
    }) as unknown as GameView;

  it.each([
    ['non autorisés (inactifs)', false, false, false],
    ['autorisés', true, true, false],
    ['envoi en cours (inactifs)', true, true, true],
  ])('%s : aucune opacité ni filtre, libellés rendus', async (_label, flee, win, pending) => {
    await render(
      <TurnActions
        game={game(flee, win)}
        layout={layout}
        pending={pending}
        onFlee={() => undefined}
        onDeclareWin={() => undefined}
        safeRight={12}
        safeBottom={6}
      />,
    );
    for (const label of ['Main spéciale', 'Se coucher']) {
      expectOpaque(screen.getByText(label) as never);
    }
  });
});
