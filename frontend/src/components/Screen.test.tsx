/// <reference types="jest" />
import { render, screen } from '@testing-library/react-native';
import { StyleSheet, Text } from 'react-native';
import * as SafeArea from 'react-native-safe-area-context';

import { Screen } from './Screen';

afterEach(() => jest.restoreAllMocks());

describe('Screen', () => {
  it('applique les marges de sécurité du fournisseur racine dès le premier rendu, une seule fois', async () => {
    jest
      .spyOn(SafeArea, 'useSafeAreaInsets')
      .mockReturnValue({ top: 10, bottom: 20, left: 30, right: 40 });
    await render(
      <Screen>
        <Text>contenu</Text>
      </Screen>,
    );
    const container = screen.getByText('contenu').parent!;
    expect(StyleSheet.flatten(container.props.style)).toMatchObject({
      flex: 1,
      paddingTop: 10,
      paddingBottom: 20,
      paddingLeft: 30,
      paddingRight: 40,
    });
    // Aucun autre conteneur ne rajoute de marge (pas de double padding).
    expect(StyleSheet.flatten(container.parent?.props.style ?? {})).not.toHaveProperty(
      'paddingLeft',
    );
  });

  it('garde le style passé par l’écran (fond transparent)', async () => {
    await render(
      <Screen style={{ backgroundColor: 'transparent' }}>
        <Text>contenu</Text>
      </Screen>,
    );
    const container = screen.getByText('contenu').parent!;
    expect(StyleSheet.flatten(container.props.style).backgroundColor).toBe('transparent');
  });
});
