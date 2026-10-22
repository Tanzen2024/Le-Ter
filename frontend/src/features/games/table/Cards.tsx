import { Platform, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import Svg, { Defs, LinearGradient, Path, Pattern, Rect, Stop } from 'react-native-svg';

import { fontOf, useTableFonts } from '../../../components/table/TableDecor';
import { cardLabel } from '../format';

/**
 * Cartes du Ter dessinées (le projet n'a pas d'images de cartes), au modèle de la planche de
 * référence : face gris-blanc très clair à fine texture de losanges, coins arrondis, double
 * contour clair en léger relief, valeur en haut à gauche, petit symbole de la famille dessous,
 * puis — après un espace net — grand symbole centré dans le bas ; dos bleu texturé, inchangé.
 *
 * Couleurs : pique et trèfle anthracite, cœur rouge. L'étoile (★), quatrième famille du Ter,
 * tient la place du carreau de la référence : même rouge, son symbole reste l'étoile (identité
 * de la carte inchangée). La famille d'une carte se lit à son symbole ; la couleur n'est qu'un
 * repère visuel.
 */
const RED = '#D3202A';
const ANTHRACITE = '#1E2125';

/** Style de chaque famille, en un seul endroit (symbole et couleur). */
export const SUIT_STYLES: Record<string, { symbol: string; color: string }> = {
  COEUR: { symbol: '♥', color: RED },
  PIQUE: { symbol: '♠', color: ANTHRACITE },
  TREFLE: { symbol: '♣', color: ANTHRACITE },
  ETOILE: { symbol: '★', color: RED },
  /** GARAM TIA (D-119) : quatrième famille du paquet de 35 cartes. */
  CARREAU: { symbol: '♦', color: RED },
};

/** GARAM TIA : l'As porte la valeur 11 (jamais 1) et s'affiche « A ». */
const VALUE_LABELS: Record<string, string> = { '11': 'A' };

/**
 * Agrandissement du dessin du symbole, par famille : le glyphe ★ est dessiné nettement plus
 * petit que ♥ ♠ ♣ à taille de police égale. Seule l'étoile est agrandie, sans rien changer à
 * la mise en page de la face (tailles, positions, espace entre coin et grand symbole).
 */
export const SUIT_GLYPH_SCALE: Record<string, number> = { ETOILE: 1.35 };

/**
 * Couleur des SYMBOLES seuls (petit symbole du coin et grand symbole) quand elle diffère de
 * celle de la famille : pique et trèfle sont noirs tous les deux ; le pique a des symboles noir
 * FONCÉ, le trèfle noir LÉGER, pour les distinguer d'un coup d'œil. La valeur, le fond et le
 * reste de la carte ne changent pas.
 */
export const SUIT_PIP_COLORS: Record<string, string> = { PIQUE: '#08090B', TREFLE: '#6A7079' };

/**
 * Point fixe de l'agrandissement du GRAND symbole : le bas de sa boîte (centré en largeur). Son
 * dessin grandit vers le haut, avec la même taille, et ne touche jamais le bord bas.
 */
export const CENTER_GLYPH_ORIGIN = 'center bottom';

/** Proportions des cartes de la référence (largeur × 1,5). */
export const CARD_RATIO = 1.5;

/**
 * Mise en page d'une face, en fractions de la LARGEUR (donc identique à toutes les tailles) :
 * coin (valeur puis petit symbole) en haut à gauche, grand symbole centré en bas, avec un
 * espace vertical net entre les deux (`faceLayout`). Le coin tient dans le pas de la main
 * chevauchée : la valeur reste toujours lisible.
 */
export const FACE_CORNER = {
  value: 0.36,
  /** Valeur à deux chiffres (« 10 ») : un peu réduite pour rester dans le coin. */
  valueLong: 0.3,
  pip: 0.25,
  top: 0.05,
  left: 0.07,
  /**
   * Grand symbole centré dans le bas de la face : il occupe la moitié basse de la carte, comme
   * sur la référence (le dessin d'un symbole ne fait qu'environ 70 % de sa taille de police).
   */
  center: 0.74,
  /** Marge du grand symbole au-dessus du bord bas (l'espace sous le dessin suffit). */
  centerBottom: 0,
} as const;

/**
 * Espace minimal entre les BOÎTES de texte du petit symbole du coin et du grand symbole
 * (fraction de la largeur) : jamais de chevauchement. L'espace VISIBLE entre les deux dessins
 * est plus grand (environ 0,2 × largeur, comme la référence), les symboles ne remplissant pas
 * leur boîte.
 */
export const FACE_MIN_GAP = 0.04;

/** Hauteur de ligne des textes de la face (en fraction de leur taille). */
const VALUE_LINE = 1.0;
const PIP_LINE = 1.05;

/**
 * Hauteur de ligne RÉELLE du grand symbole sur Android (fraction de sa taille). Android rogne le
 * haut du dessin d'un texte à la hauteur de sa ligne : avec 1,05, la place au-dessus de la ligne
 * de base (≈ 0,87 em) aplatissait le rond supérieur du ♣ (et la pointe du ♠). Avec 1,4, le
 * dessin a la place d'environ 1 em au-dessus de la ligne de base : jamais rogné.
 */
export const CENTER_PIP_DRAW_LINE = 1.4;

/**
 * Texte du grand symbole : hauteur de ligne et décalage vers le bas de sa boîte. Android répartit
 * la hauteur ajoutée moitié au-dessus, moitié en dessous du texte : la boîte descend de cette
 * moitié pour que le DESSIN reste exactement au même endroit, à la même taille (seule la place
 * libre au-dessus grandit ; l'espace ajouté sous la carte est masqué par la face). Ailleurs
 * (iOS, web), rien ne change.
 */
export function centerPipText(centerSize: number, os: string = Platform.OS) {
  const layoutLine = centerSize * PIP_LINE;
  if (os !== 'android') return { lineHeight: layoutLine, shift: 0 };
  const lineHeight = centerSize * CENTER_PIP_DRAW_LINE;
  return { lineHeight, shift: (lineHeight - layoutLine) / 2 };
}

/**
 * Géométrie d'une face (en points) : bas du coin, haut du grand symbole et espace entre les
 * deux. Proportionnelle à la largeur : l'espace reste visible sur tous les écrans.
 */
export function faceLayout(width: number, longValue = false) {
  const height = width * CARD_RATIO;
  const valueSize = Math.max(10, width * (longValue ? FACE_CORNER.valueLong : FACE_CORNER.value));
  const pipSize = Math.max(8, width * FACE_CORNER.pip);
  const cornerBottom = width * FACE_CORNER.top + valueSize * VALUE_LINE + pipSize * PIP_LINE;
  // Grand symbole : taille de la référence, réduite si nécessaire (petites cartes, où les
  // tailles minimales du coin l'agrandissent) pour garder TOUJOURS l'espace net sous le coin.
  const room = height - width * FACE_CORNER.centerBottom - cornerBottom - width * FACE_MIN_GAP;
  const centerSize = Math.min(width * FACE_CORNER.center, room / PIP_LINE);
  const centerTop = height - width * FACE_CORNER.centerBottom - centerSize * PIP_LINE;
  return {
    height,
    valueSize,
    pipSize,
    centerSize,
    cornerBottom,
    centerTop,
    gap: centerTop - cornerBottom,
  };
}

function parse(cardId: string) {
  const [suit = '', raw = ''] = cardId.split('-');
  const value = VALUE_LABELS[raw] ?? raw;
  return { value, ...(SUIT_STYLES[suit] ?? { symbol: suit, color: ANTHRACITE }) };
}

/**
 * Fond de la face (repère 100 × 150) : dégradé gris-blanc très clair, fine texture de losanges
 * discrète, double contour clair (relief). Un seul petit dessin vectoriel par carte, sans image.
 */
function FaceBackground({ width, height }: { width: number; height: number }) {
  return (
    <Svg
      width={width}
      height={height}
      viewBox="0 0 100 150"
      preserveAspectRatio="none"
      style={StyleSheet.absoluteFill}
      testID="card-face-texture"
    >
      <Defs>
        <LinearGradient id="faceFill" x1="0" y1="0" x2="0.4" y2="1">
          <Stop offset="0" stopColor="#FBFBFC" />
          <Stop offset="1" stopColor="#ECEDEF" />
        </LinearGradient>
        <Pattern id="faceLozenges" width="7" height="7" patternUnits="userSpaceOnUse">
          <Path d="M3.5 0 L7 3.5 L3.5 7 L0 3.5 Z" fill="none" stroke="#D3D6DB" strokeWidth="0.45" />
        </Pattern>
      </Defs>
      <Rect x="0" y="0" width="100" height="150" fill="url(#faceFill)" />
      <Rect x="0" y="0" width="100" height="150" fill="url(#faceLozenges)" opacity="0.55" />
      {/* Second contour intérieur blanc : léger relief, comme la planche de référence. */}
      <Rect
        x="2.2"
        y="2.2"
        width="95.6"
        height="145.6"
        rx="6"
        fill="none"
        stroke="#FFFFFF"
        strokeWidth="1.6"
        opacity="0.95"
      />
    </Svg>
  );
}

/**
 * Face visible, modèle de la planche de référence. Les dimensions viennent de l'appelant
 * (`width`, hauteur = largeur × 1,5) ; positions, rotations, éventails et animations restent
 * ceux des composants appelants. Dans une main chevauchée, seul le coin reste visible ; la
 * dernière carte montre aussi son grand symbole.
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
  const pipColor = SUIT_PIP_COLORS[cardId.split('-')[0] ?? ''] ?? color;
  const glyphScale = SUIT_GLYPH_SCALE[cardId.split('-')[0] ?? ''] ?? 1;
  // Agrandi sans changer la boîte du texte, donc la mise en page : le petit symbole du coin
  // autour de son centre ; le GRAND symbole depuis le bas de sa boîte, pour que son dessin
  // grandisse vers le haut. Agrandi autour du centre, le bas de l'étoile descendait jusqu'au
  // bord de la carte et sa pointe était coupée (`overflow: 'hidden'` de la face). Proportionnel
  // à la taille de la boîte : même marge sous le dessin à toutes les tailles de carte.
  const glyph = glyphScale === 1 ? undefined : { transform: [{ scale: glyphScale }] };
  const centerGlyph = glyph && { ...glyph, transformOrigin: CENTER_GLYPH_ORIGIN };
  // Chiffres gras et étroits, proches de la référence : Rajdhani 700, police du projet déjà
  // chargée par la table (police système grasse tant qu'elle charge).
  const fonts = useTableFonts();
  const { height, valueSize, pipSize, centerSize } = faceLayout(width, value.length > 1);
  const centerText = centerPipText(centerSize);
  // Petit symbole du coin : même correctif Android que le grand (rond supérieur du ♣ rogné à
  // 1,05). Les marges négatives rendent la place ajoutée : le coin garde exactement sa hauteur.
  const cornerText = centerPipText(pipSize);
  return (
    <View
      accessible
      accessibilityLabel={cardLabel(cardId)}
      testID="card-face"
      style={[
        styles.face,
        {
          width,
          height,
          borderRadius: width * 0.08,
          borderWidth: Math.max(1, width * 0.012),
        },
        style,
      ]}
    >
      <FaceBackground width={width} height={height} />
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
              lineHeight: valueSize * VALUE_LINE,
              letterSpacing: value.length > 1 ? -valueSize * 0.08 : 0,
            },
          ]}
        >
          {value}
        </Text>
        <Text
          allowFontScaling={false}
          style={[
            styles.pip,
            {
              color: pipColor,
              fontSize: pipSize,
              lineHeight: cornerText.lineHeight,
              marginVertical: -cornerText.shift,
            },
            glyph,
          ]}
        >
          {symbol}
        </Text>
      </View>
      {/* Grand symbole centré dans le bas, séparé du coin par un espace net (`faceLayout`),
          dessiné dans la carte (jamais coupé). Décoratif : la carte est annoncée par son libellé. */}
      <View
        testID="card-center-pip"
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
        style={[styles.center, { bottom: width * FACE_CORNER.centerBottom - centerText.shift }]}
      >
        <Text
          allowFontScaling={false}
          style={[
            styles.pip,
            { color: pipColor, fontSize: centerSize, lineHeight: centerText.lineHeight },
            centerGlyph,
          ]}
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
  upsideDown = false,
  style,
}: {
  cardIds: string[];
  width: number;
  step?: number;
  reverse?: boolean;
  /** Joueur d'en face : chaque carte renversée sur place, les premières au-dessus (coin visible). */
  upsideDown?: boolean;
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
            upsideDown && { zIndex: count - i, transform: [{ rotate: '180deg' }] },
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
    // Gris-blanc très clair (couleur de repli sous le dégradé texturé de FaceBackground).
    backgroundColor: '#F4F5F6',
    // Contour fin gris clair ; le contour intérieur blanc du fond donne le léger relief.
    borderColor: '#C3C6CB',
    // Ombre légère : carte légèrement surélevée, posée sur le feutre.
    boxShadow: '0 2px 4px rgba(0, 0, 0, 0.28)',
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
