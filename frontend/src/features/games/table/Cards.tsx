import { StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';

import { fontOf, TatamiCard, useTableFonts } from '../../../components/table/TableDecor';
import { cardLabel } from '../format';

/**
 * Cartes du Ter dessinées (le projet n'a pas d'images de cartes) : faces lisibles dans la
 * couleur de leur famille (même couleur = même famille, D-035) et dos TATAMI, le dos
 * officiel du jeu (écran de connexion, accueil).
 */
const SUITS: Record<string, { symbol: string; color: string }> = {
  COEUR: { symbol: '♥', color: '#C62828' },
  PIQUE: { symbol: '♠', color: '#1B1B1B' },
  TREFLE: { symbol: '♣', color: '#1E6B2E' },
  ETOILE: { symbol: '★', color: '#C98A00' },
};

export const CARD_RATIO = 1.4;

function parse(cardId: string) {
  const [suit = '', value = ''] = cardId.split('-');
  return { value, ...(SUITS[suit] ?? { symbol: suit, color: '#1B1B1B' }) };
}

/**
 * Face visible, style de la table de référence : fond clair, coins arrondis, grande valeur
 * en haut à gauche avec son symbole dessous, grand symbole en filigrane en bas à droite.
 */
export function CardFace({
  cardId,
  width,
  style,
}: {
  cardId: string;
  width: number;
  style?: StyleProp<ViewStyle>;
}) {
  const fonts = useTableFonts();
  const { value, symbol, color } = parse(cardId);
  const valueSize = Math.max(10, width * (value.length > 1 ? 0.36 : 0.42));
  const pipSize = Math.max(8, width * 0.26);
  const bigSize = width * 0.62;
  return (
    <View
      accessible
      accessibilityLabel={cardLabel(cardId)}
      style={[
        styles.face,
        {
          width,
          height: width * CARD_RATIO,
          borderRadius: width * 0.1,
          borderWidth: Math.max(1, width * 0.02),
        },
        style,
      ]}
    >
      <View style={[styles.corner, { top: width * 0.05, left: width * 0.07 }]}>
        <Text
          allowFontScaling={false}
          style={[
            styles.value,
            fontOf(fonts.button),
            { color, fontSize: valueSize, lineHeight: valueSize * 1.02 },
          ]}
        >
          {value}
        </Text>
        <Text
          allowFontScaling={false}
          style={[styles.value, { color, fontSize: pipSize, lineHeight: pipSize * 1.1 }]}
        >
          {symbol}
        </Text>
      </View>
      <Text
        allowFontScaling={false}
        style={[
          styles.big,
          {
            color,
            fontSize: bigSize,
            lineHeight: bigSize * 1.05,
            right: -width * 0.06,
            bottom: -width * 0.08,
          },
        ]}
      >
        {symbol}
      </Text>
    </View>
  );
}

/** Dos de carte TATAMI (carte d'un adversaire, jamais révélée). */
export function CardBack({ width, style }: { width: number; style?: StyleProp<ViewStyle> }) {
  const fonts = useTableFonts();
  return (
    <View style={[{ width, height: width * CARD_RATIO }, style]}>
      <TatamiCard
        width={width}
        fontFamily={fonts.title}
        style={{ top: 0, left: 0, height: width * CARD_RATIO }}
      />
    </View>
  );
}

/** Pas horizontal entre deux cartes d'un éventail (chevauchement). */
export const FAN_STEP = 0.36;
export const ROW_STEP = 0.62;

export const fanWidth = (count: number, width: number, step: number) =>
  count > 0 ? width + (count - 1) * width * step : 0;

/**
 * Pas d'un éventail qui tient dans `maxWidth` : presque côte à côte avec peu de cartes, plus
 * chevauché quand il en reste davantage (jamais moins que FAN_STEP).
 */
export function fanStepFor(count: number, width: number, maxWidth: number): number {
  if (count <= 1) return FAN_STEP;
  const step = (maxWidth - width) / ((count - 1) * width);
  return Math.min(0.92, Math.max(FAN_STEP, step));
}

/**
 * Cartes encore en main d'un adversaire : seulement leur NOMBRE (le serveur n'envoie jamais
 * leur valeur), en éventail de dos.
 */
export function HiddenHand({
  count,
  width,
  zone,
}: {
  count: number;
  width: number;
  /** Emplacement des dos : le groupe y est centré horizontalement. */
  zone: { left: number; top: number; width: number };
}) {
  const step = fanStepFor(count, width, zone.width);
  const total = fanWidth(count, width, step);
  return (
    <View
      accessible
      accessibilityLabel={`${count} carte${count > 1 ? 's' : ''} en main`}
      style={[
        styles.absolute,
        {
          left: zone.left + (zone.width - total) / 2,
          top: zone.top,
          width: total,
          height: width * CARD_RATIO,
        },
      ]}
    >
      {Array.from({ length: count }, (_, i) => (
        <CardBack key={i} width={width} style={[styles.absolute, { left: i * width * step }]} />
      ))}
    </View>
  );
}

/** Cartes déjà jouées par un joueur, face visible pour tous, cumulées dans l'ordre. */
export function PublicRow({
  cardIds,
  width,
  style,
}: {
  cardIds: string[];
  width: number;
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <View
      style={[
        styles.absolute,
        {
          width: fanWidth(cardIds.length, width, ROW_STEP),
          height: width * CARD_RATIO,
        },
        style,
      ]}
    >
      {cardIds.map((cardId, i) => (
        <CardFace
          key={cardId}
          cardId={cardId}
          width={width}
          style={[styles.absolute, { left: i * width * ROW_STEP }]}
        />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  absolute: { position: 'absolute' },
  face: {
    overflow: 'hidden',
    backgroundColor: '#FDFBF6',
    experimental_backgroundImage: 'linear-gradient(165deg, #FFFFFF 0%, #F7F3EA 70%, #ECE5D6 100%)',
    borderColor: 'rgba(60, 40, 20, 0.28)',
    boxShadow: '0 2px 5px rgba(0, 0, 0, 0.35), inset 0 0 0 1px rgba(255, 255, 255, 0.9)',
  },
  corner: { position: 'absolute', alignItems: 'center' },
  value: { includeFontPadding: false, textAlign: 'center' },
  big: { position: 'absolute', opacity: 0.9, includeFontPadding: false },
});
