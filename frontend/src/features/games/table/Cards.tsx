import { StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import Svg, { Defs, LinearGradient, Path, Pattern, Rect, Stop } from 'react-native-svg';

import { fontOf, useTableFonts } from '../../../components/table/TableDecor';
import { cardLabel } from '../format';

/**
 * Cartes du Ter dessinées (le projet n'a pas d'images de cartes), au modèle de la capture de
 * référence : face blanche unie, grand chiffre en haut à gauche, symbole de la famille dessous,
 * grand symbole centré dans le bas ; dos bleu texturé, cadre blanc, monogramme de Le Ter.
 *
 * Couleurs classiques d'un jeu de cartes : pique et trèfle noir très foncé, cœur rouge.
 * L'étoile (★), quatrième famille du Ter, tient la place du carreau de la référence : même
 * rouge, son symbole reste l'étoile (identité de la carte inchangée). La famille d'une carte
 * se lit à son symbole ; la couleur n'est qu'un repère visuel.
 */
const RED = '#D3202A';
const BLACK = '#141414';
const SUITS: Record<string, { symbol: string; color: string }> = {
  COEUR: { symbol: '♥', color: RED },
  PIQUE: { symbol: '♠', color: BLACK },
  TREFLE: { symbol: '♣', color: BLACK },
  ETOILE: { symbol: '★', color: RED },
};

/** Proportions des cartes de la référence (largeur × 1,5). */
export const CARD_RATIO = 1.5;

/**
 * Coin d'une face, en fractions de la largeur : grand chiffre en haut à gauche, symbole de la
 * famille juste dessous. Le coin tient dans le pas de la main chevauchée (valeur toujours lisible).
 */
export const FACE_CORNER = {
  value: 0.44,
  /** Valeur à deux chiffres (« 10 ») : un peu réduite pour rester dans le coin. */
  valueLong: 0.34,
  pip: 0.36,
  top: 0.03,
  left: 0.06,
  /** Grand symbole centré dans le bas de la face (gros ♦ du 8 de la référence). */
  center: 0.62,
  /** Marge du grand symbole au-dessus du bord bas. */
  centerBottom: 0.06,
} as const;

function parse(cardId: string) {
  const [suit = '', value = ''] = cardId.split('-');
  return { value, ...(SUITS[suit] ?? { symbol: suit, color: '#141414' }) };
}

/**
 * Face visible, modèle de la référence : fond blanc uni, contour fin gris clair, coins arrondis,
 * ombre légère, grand chiffre gras en haut à gauche, symbole de la famille dessous et grand
 * symbole centré dans le bas. Dans une main chevauchée, seul le coin reste visible (comme sur
 * la référence) ; la dernière carte montre aussi son grand symbole.
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
  const { value, symbol, color } = parse(cardId);
  // Chiffres gras et étroits, proches de la référence : Rajdhani 700, police du projet déjà
  // chargée par la table (police système grasse tant qu'elle charge).
  const fonts = useTableFonts();
  const valueSize = Math.max(
    10,
    width * (value.length > 1 ? FACE_CORNER.valueLong : FACE_CORNER.value),
  );
  const pipSize = Math.max(8, width * FACE_CORNER.pip);
  const centerSize = width * FACE_CORNER.center;
  return (
    <View
      accessible
      accessibilityLabel={cardLabel(cardId)}
      testID="card-face"
      style={[
        styles.face,
        {
          width,
          height: width * CARD_RATIO,
          borderRadius: width * 0.08,
          borderWidth: Math.max(1, width * 0.015),
        },
        style,
      ]}
    >
      <View
        testID="card-corner"
        style={[styles.corner, { top: width * FACE_CORNER.top, left: width * FACE_CORNER.left }]}
        >
        <Text
          allowFontScaling={false}
          style={[
            styles.value,
            fontOf(fonts.button),
            {
              color,
              fontSize: valueSize,
              lineHeight: valueSize * 1.04,
              letterSpacing: value.length > 1 ? -valueSize * 0.08 : 0,
            },
          ]}
        >
          {value}
        </Text>
        <Text
          allowFontScaling={false}
          style={[styles.pip, { color, fontSize: pipSize, lineHeight: pipSize * 1.05 }]}
        >
          {symbol}
        </Text>
      </View>
      {/* Grand symbole centré dans le bas, dessiné dans la carte (jamais coupé par les bords).
          Décoratif : la carte est déjà annoncée par son libellé. */}
      <View
        testID="card-center-pip"
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
        style={[styles.center, { bottom: width * FACE_CORNER.centerBottom }]}
      >
        <Text
          allowFontScaling={false}
          style={[styles.pip, { color, fontSize: centerSize, lineHeight: centerSize * 1.05 }]}
        >
          {symbol}
        </Text>
      </View>
    </View>
  );
}

/**
 * Monogramme « L » du dos (repère 100 × 150) : lettre à empattements dessinée en tracé, partie
 * intégrante du dos, jamais un texte posé sur la carte.
 */
export const BACK_LETTER =
  'M27 28 H57 V36 H50 V104 H70 V95 H78 V122 H27 V114 H34 V36 H27 Z';

/** Dos de carte Le Ter : fond bleu texturé, liseré blanc, coins arrondis, « L » central. */
export function CardBack({ width, style }: { width: number; style?: StyleProp<ViewStyle> }) {
  const height = width * CARD_RATIO;
  return (
    <View
      testID="card-back"
      importantForAccessibility="no-hide-descendants"
      accessibilityElementsHidden
      style={[styles.back, { width, height, borderRadius: width * 0.08 }, style]}
    >
      <Svg width={width} height={height} viewBox="0 0 100 150">
        <Defs>
          <LinearGradient id="backFill" x1="0" y1="0" x2="1" y2="1">
            <Stop offset="0" stopColor="#2F7FC4" />
            <Stop offset="0.55" stopColor="#1A5C9E" />
            <Stop offset="1" stopColor="#0E3E73" />
          </LinearGradient>
          <Pattern id="backWeave" width="8" height="8" patternUnits="userSpaceOnUse">
            <Path d="M0 8 L8 0 M-2 2 L2 -2 M6 10 L10 6" stroke="#7FB6E6" strokeWidth="1.1" />
            <Path d="M0 0 L8 8" stroke="#0A2E57" strokeWidth="0.8" opacity="0.6" />
          </Pattern>
          <LinearGradient id="backLetter" x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0" stopColor="#FFFFFF" />
            <Stop offset="1" stopColor="#D6E7F7" />
          </LinearGradient>
        </Defs>
        {/* Liseré blanc et contour gris clair. */}
        <Rect x="0.75" y="0.75" width="98.5" height="148.5" rx="8" fill="#FFFFFF" stroke="#B9C3CE" strokeWidth="1.5" />
        {/* Fond bleu texturé (dégradé + tissage). */}
        <Rect x="6" y="6" width="88" height="138" rx="5" fill="url(#backFill)" />
        <Rect x="6" y="6" width="88" height="138" rx="5" fill="url(#backWeave)" opacity="0.45" />
        <Rect x="11" y="11" width="78" height="128" rx="3.5" fill="none" stroke="#CFE4F7" strokeWidth="1.4" opacity="0.8" />
        {/* « L » : ombre portée bleu nuit puis lettre blanche cernée. */}
        <Path d={BACK_LETTER} fill="#08264A" transform="translate(2.5 3)" opacity="0.7" />
        <Path d={BACK_LETTER} fill="url(#backLetter)" stroke="#0B3563" strokeWidth="2.6" strokeLinejoin="round" />
      </Svg>
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

/**
 * Cartes déjà jouées par un joueur, face visible pour tous, cumulées dans l'ordre. `step` :
 * pas entre deux cartes en largeurs de carte (≥ 1 : cartes séparées) ; `reverse` : rangée qui
 * s'étend vers la gauche. Le coin de chaque carte (valeur, famille) reste toujours visible.
 */
export function PublicRow({
  cardIds,
  width,
  step = ROW_STEP,
  reverse = false,
  style,
}: {
  cardIds: string[];
  width: number;
  step?: number;
  reverse?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  const count = cardIds.length;
  return (
    <View
      testID="public-row"
      style={[
        styles.absolute,
        {
          width: fanWidth(count, width, step),
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
          style={[
            styles.absolute,
            reverse
              ? // Vers la gauche : les premières cartes restent au-dessus, coin visible.
                { left: (count - 1 - i) * width * step, zIndex: count - i }
              : { left: i * width * step },
          ]}
        />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  absolute: { position: 'absolute' },
  face: {
    overflow: 'hidden',
    // Blanc uni très légèrement cassé, sans dégradé (absent de la référence).
    backgroundColor: '#FDFDFC',
    borderColor: '#C7C9CC',
    // Ombre légère : effet de carte physique posée sur le feutre.
    boxShadow: '0 2px 4px rgba(0, 0, 0, 0.3)',
  },
  back: { overflow: 'hidden', boxShadow: '0 2px 5px rgba(0, 0, 0, 0.4)' },
  corner: { position: 'absolute', alignItems: 'center' },
  center: { position: 'absolute', left: 0, right: 0, alignItems: 'center' },
  value: {
    includeFontPadding: false,
    textAlign: 'center',
    fontWeight: '900',
  },
  pip: { includeFontPadding: false, textAlign: 'center', marginTop: -1 },
});
