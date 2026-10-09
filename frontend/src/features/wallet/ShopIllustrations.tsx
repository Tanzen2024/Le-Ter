import { StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';

import { Coin } from '../lobby/LobbyUi';

/**
 * Illustrations de la boutique (jetons « L » turquoise, coffre-fort doré), dessinées avec
 * des formes simples aux couleurs de la table : aucune image externe. Purement décoratives.
 */

/** Pile de jetons vue de côté, surmontée d'un jeton de face. */
export function ChipStack({
  size,
  layers = 4,
  style,
}: {
  size: number;
  layers?: number;
  style?: StyleProp<ViewStyle>;
}) {
  const edge = Math.max(4, size * 0.16);
  return (
    <View
      style={[{ width: size, alignItems: 'center' }, style]}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      <Coin size={size * 0.78} />
      <View style={{ marginTop: -size * 0.12 }}>
        {Array.from({ length: layers }, (_, i) => (
          <View
            key={i}
            style={[
              styles.chipEdge,
              {
                width: size * 0.82,
                height: edge,
                borderRadius: edge / 2,
                marginTop: i === 0 ? 0 : -edge * 0.25,
              },
            ]}
          />
        ))}
      </View>
    </View>
  );
}

/** Coffre-fort doré entrouvert, rempli de jetons. */
export function Safe({ size, style }: { size: number; style?: StyleProp<ViewStyle> }) {
  const inner = size * 0.7;
  const chip = size * 0.2;
  return (
    <View
      style={[{ width: size * 1.15, height: size }, style]}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      <View style={[styles.safeBody, { width: size, height: size, borderRadius: size * 0.08 }]}>
        <View
          style={[styles.safeInside, { width: inner, height: inner, borderRadius: size * 0.05 }]}
        >
          <View style={styles.safeChips}>
            <ChipStack size={chip} layers={3} />
            <ChipStack size={chip} layers={4} />
            <ChipStack size={chip} layers={2} />
          </View>
        </View>
      </View>
      {/* Porte ouverte, vue de biais à gauche. */}
      <View
        style={[
          styles.safeDoor,
          {
            width: size * 0.22,
            height: size * 0.92,
            left: -size * 0.12,
            top: size * 0.04,
            borderRadius: size * 0.05,
          },
        ]}
      >
        <View
          style={[styles.dial, { width: size * 0.1, height: size * 0.1, borderRadius: size }]}
        />
      </View>
      <Sparkle size={size * 0.07} style={{ right: size * 0.06, top: -size * 0.08 }} />
      <Sparkle size={size * 0.05} style={{ right: size * 0.3, top: -size * 0.14 }} />
      <Sparkle size={size * 0.06} style={{ left: size * 0.3, top: -size * 0.1 }} />
    </View>
  );
}

function Sparkle({ size, style }: { size: number; style: StyleProp<ViewStyle> }) {
  return (
    <View style={[styles.sparkle, { width: size, height: size, borderRadius: size / 2 }, style]} />
  );
}

/** « Jeton + → coffre » : la recharge du compte de jeu. */
export function DepositIllustration({ size }: { size: number }) {
  return (
    <View style={[styles.row, { gap: size * 0.06 }]}>
      <View style={styles.center}>
        <Coin size={size * 0.42} />
        <Text
          allowFontScaling={false}
          style={[styles.plus, { fontSize: size * 0.3, top: -size * 0.12 }]}
        >
          +
        </Text>
      </View>
      <Text allowFontScaling={false} style={[styles.arrow, { fontSize: size * 0.32 }]}>
        ➜
      </Text>
      <Safe size={size * 0.72} />
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center' },
  center: { alignItems: 'center' },
  chipEdge: {
    backgroundColor: '#1C9396',
    borderWidth: 1,
    borderColor: '#0E5C5E',
    experimental_backgroundImage:
      'linear-gradient(90deg, #17797F 0%, #2DB3B1 20%, #1C9396 40%, #E8F6F5 46%, #1C9396 52%, #2DB3B1 80%, #17797F 100%)',
    boxShadow: '0 2px 3px rgba(0, 0, 0, 0.35)',
  },
  safeBody: {
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#E9B23A',
    experimental_backgroundImage:
      'linear-gradient(160deg, #FBE08A 0%, #F2C451 35%, #D9961F 75%, #B97A12 100%)',
    boxShadow: '0 8px 18px rgba(0, 0, 0, 0.45)',
  },
  safeInside: {
    justifyContent: 'flex-end',
    alignItems: 'center',
    overflow: 'hidden',
    backgroundColor: '#5A3A10',
    experimental_backgroundImage: 'linear-gradient(180deg, #3E2608 0%, #6B4614 100%)',
    paddingBottom: 4,
  },
  safeChips: { flexDirection: 'row', alignItems: 'flex-end', gap: 2 },
  safeDoor: {
    position: 'absolute',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#F2C451',
    experimental_backgroundImage: 'linear-gradient(180deg, #FFE7A0 0%, #E3A93A 100%)',
    transform: [{ skewY: '-10deg' }],
    boxShadow: '0 4px 8px rgba(0, 0, 0, 0.35)',
  },
  dial: { borderWidth: 1.5, borderColor: '#B97A12' },
  sparkle: { position: 'absolute', backgroundColor: 'rgba(255, 255, 255, 0.9)' },
  plus: { position: 'absolute', right: -6, color: '#BDF1EE', fontWeight: '900' },
  arrow: {
    color: '#BDF1EE',
    fontWeight: '900',
    textShadowColor: 'rgba(0,0,0,0.4)',
    textShadowRadius: 4,
  },
});
