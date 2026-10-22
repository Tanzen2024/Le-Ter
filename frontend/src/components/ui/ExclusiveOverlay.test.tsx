/// <reference types="jest" />
import { cleanup, fireEvent, render, screen } from '@testing-library/react-native';
import { Text } from 'react-native';

import { LobbyPanel } from '../../features/lobby/LobbyUi';
import { ExclusiveOverlay } from './ExclusiveOverlay';

/**
 * Une fenêtre ouverte ne se ferme JAMAIS par un appui hors d'elle (D-131) : seulement par son
 * propre bouton (X, Annuler, Valider…) ou le bouton retour d'Android.
 */
afterEach(cleanup);

describe('appui hors de la fenêtre', () => {
  it('fond de la fenêtre : un appui ne ferme rien et ne touche pas l’écran du dessous', async () => {
    await render(
      <ExclusiveOverlay testID="overlay">
        <Text>contenu</Text>
      </ExclusiveOverlay>,
    );
    await fireEvent.press(screen.getByTestId('overlay'));
    expect(screen.getByText('contenu')).toBeTruthy();
  });

  it('panneau (Profil, Boutique, Réglages…) : seul le bouton X le ferme', async () => {
    const onClose = jest.fn();
    await render(
      <LobbyPanel title="Boutique" onClose={onClose} width={520}>
        <Text>articles</Text>
      </LobbyPanel>,
    );
    // Aucune zone « fermer » hors de la fenêtre.
    expect(screen.getAllByLabelText('Fermer')).toHaveLength(1);
    await fireEvent.press(screen.getByText('articles'));
    expect(onClose).not.toHaveBeenCalled();
    await fireEvent.press(screen.getByLabelText('Fermer'));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

describe('défilement dans la fenêtre (D-132)', () => {
  it('aucun parent du contenu ne capte les appuis : le geste revient toujours au défilement', async () => {
    await render(
      <ExclusiveOverlay testID="overlay">
        <Text>libellé non cliquable</Text>
      </ExclusiveOverlay>,
    );
    // Le fond bloque l'écran du dessous par une couche SŒUR, derrière le contenu…
    expect(
      screen.getByTestId('overlay-blocker', { includeHiddenElements: true }).props
        .onStartShouldSetResponder?.(),
    ).toBe(true);
    // …et aucun ancêtre du contenu ne réclame l'appui (sinon un geste commencé sur un libellé
    // lui remonterait et ne ferait pas défiler la fenêtre).
    let node = screen.getByText('libellé non cliquable').parent;
    while (node) {
      expect(node.props.onStartShouldSetResponder).toBeUndefined();
      node = node.parent;
    }
  });
});
