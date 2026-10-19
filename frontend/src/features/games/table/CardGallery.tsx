import { ScrollView, StyleSheet, Text, useWindowDimensions, View } from 'react-native';

import { CardFace } from './Cards';

/**
 * Planche de comparaison (développement) : les 4 familles du Ter avec le composant réel
 * `CardFace`, pour comparer le rendu à la planche de référence. Valeurs de la référence
 * (A, 2…K) puis valeurs réelles du jeu (3 à 10). Aucune donnée de partie.
 */
const SUITS = ['PIQUE', 'COEUR', 'TREFLE', 'ETOILE'] as const;
const REFERENCE_VALUES = ['A', '2', '3', '4', '5', '10', 'J', 'Q', 'K'];
const GAME_VALUES = ['3', '4', '5', '6', '7', '8', '9', '10'];
const GAP = 6;

export function CardGallery() {
  const { width } = useWindowDimensions();
  // 9 cartes par rangée dans la largeur disponible (marges de 16), entre 28 et 72 points.
  const cardWidth = Math.max(28, Math.min(72, (width - 32 - GAP * 8) / 9));
  const section = (title: string, values: string[]) => (
    <View style={styles.section}>
      <Text style={styles.title}>{title}</Text>
      {SUITS.map((suit) => (
        <View key={suit} style={styles.row}>
          {values.map((value) => (
            <CardFace key={value} cardId={`${suit}-${value}`} width={cardWidth} />
          ))}
        </View>
      ))}
    </View>
  );
  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      {section('Référence (A, 2… K)', REFERENCE_VALUES)}
      {section('Valeurs du Ter (3 à 10)', GAME_VALUES)}
      <View style={styles.row}>
        {[28, 40, 56, 72, 96].map((w) => (
          <CardFace key={w} cardId="ETOILE-10" width={w} />
        ))}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#B9BBBE' },
  content: { padding: 16, gap: 16 },
  section: { gap: GAP + 4 },
  title: { fontSize: 16, fontWeight: '700', color: '#1E2125' },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: GAP, alignItems: 'flex-end' },
});
