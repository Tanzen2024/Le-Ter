import { memo } from 'react';
import { Platform, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import Svg, {
  Circle,
  Defs,
  Ellipse,
  LinearGradient,
  Path,
  Pattern,
  RadialGradient,
  Rect,
  Stop,
} from 'react-native-svg';

import { fontOf, useTableFonts } from '../../../components/table/TableDecor';
import { cardLabel } from '../format';

/**
 * Cartes du Ter dessinées (le projet n'a pas d'images de cartes), au modèle de la planche de
 * référence : face ivoire à trame de lin, cadre en dorure à chaud, biseau et vernis, coins
 * arrondis, valeur en haut à gauche, petit symbole de la famille dessous,
 * puis — après un espace net — grand symbole centré dans le bas ; dos bordeaux et or.
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
  return { value, ace: raw === '11', ...(SUIT_STYLES[suit] ?? { symbol: suit, color: ANTHRACITE }) };
}

/** Filigrane doré d'un coin (repère : le coin en 0,0, vers +x +y) : double volute et fleurons. */
const FACE_FLOURISH =
  'M0 10 C0 4 4 0 10 0 M2.6 10 C2.6 5.6 5.6 2.6 10 2.6 M10 0 C12 0 13 1.4 12.4 3 M0 10 C0 12 1.4 13 3 12.4';
/** Trois coins seulement : le coin haut gauche porte la valeur, rien n'est dessiné dessous. */
const FACE_FLOURISH_CORNERS = [
  'translate(91 9) scale(-1 1)',
  'translate(9 141) scale(1 -1)',
  'translate(91 141) scale(-1 -1)',
];
/** Médaillon de l'As : 16 perles dorées autour du grand symbole. */
const ACE_PEARLS = Array.from({ length: 16 }, (_, i) => {
  const a = (i * 22.5 * Math.PI) / 180;
  return { cx: (50 + 30 * Math.cos(a)).toFixed(2), cy: (104 + 30 * Math.sin(a)).toFixed(2) };
});

/**
 * Encre en léger relief : ombre courte sous la valeur et les symboles (impression gaufrée),
 * proportionnelle à la taille de la carte.
 */
function ink(width: number) {
  return {
    textShadowColor: 'rgba(60, 40, 10, 0.28)',
    textShadowOffset: { width: 0, height: Math.max(0.5, width * 0.012) },
    textShadowRadius: Math.max(0.5, width * 0.01),
  };
}

/**
 * Fond de la face (repère 100 × 150), finition « casino » : papier ivoire chaud à fine trame
 * de lin, halo de lumière sous le grand symbole (teinté de la couleur de la famille), cadre en
 * dorure à chaud avec filigranes, vernis brillant en diagonale et biseau (arête claire en haut
 * à gauche, ombrée en bas à droite). L'As reçoit un médaillon doré perlé. Un seul dessin
 * vectoriel par carte, sans image ; rien n'est dessiné sous le coin de la valeur.
 */
function FaceBackground({
  width,
  height,
  accent,
  ace,
}: {
  width: number;
  height: number;
  accent: string;
  ace: boolean;
}) {
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
        <LinearGradient id="faceFill" x1="0" y1="0" x2="0.35" y2="1">
          <Stop offset="0" stopColor="#FFFEFA" />
          <Stop offset="0.55" stopColor="#F8F3E7" />
          <Stop offset="1" stopColor="#EDE4D0" />
        </LinearGradient>
        {/* Trame de lin : fils croisés très fins, à peine perceptibles (papier toilé). */}
        <Pattern id="faceLozenges" width="3" height="3" patternUnits="userSpaceOnUse">
          <Path d="M0 0.75 H3 M0.75 0 V3" stroke="#C9BFA8" strokeWidth="0.22" />
        </Pattern>
        <RadialGradient id="faceHalo" cx="50" cy="104" r="42" gradientUnits="userSpaceOnUse">
          <Stop offset="0" stopColor="#FFFFFF" stopOpacity="0.9" />
          <Stop offset="0.45" stopColor={accent} stopOpacity="0.07" />
          <Stop offset="1" stopColor={accent} stopOpacity="0" />
        </RadialGradient>
        <LinearGradient id="faceGold" x1="0" y1="0" x2="1" y2="1">
          <Stop offset="0" stopColor="#F6E2A0" />
          <Stop offset="0.3" stopColor="#C99A3E" />
          <Stop offset="0.55" stopColor="#F3D88B" />
          <Stop offset="0.8" stopColor="#9C7429" />
          <Stop offset="1" stopColor="#E1C176" />
        </LinearGradient>
        {/* Vernis : bande brillante étroite en diagonale, voile ombré vers le bas à droite. */}
        <LinearGradient id="faceSheen" x1="0" y1="0" x2="1" y2="1">
          <Stop offset="0" stopColor="#FFFFFF" stopOpacity="0.55" />
          <Stop offset="0.18" stopColor="#FFFFFF" stopOpacity="0.12" />
          <Stop offset="0.27" stopColor="#FFFFFF" stopOpacity="0.38" />
          <Stop offset="0.36" stopColor="#FFFFFF" stopOpacity="0" />
          <Stop offset="0.8" stopColor="#7A6A4E" stopOpacity="0" />
          <Stop offset="1" stopColor="#7A6A4E" stopOpacity="0.22" />
        </LinearGradient>
      </Defs>
      <Rect x="0" y="0" width="100" height="150" fill="url(#faceFill)" />
      <Rect x="0" y="0" width="100" height="150" fill="url(#faceLozenges)" opacity="0.4" />
      <Rect x="0" y="0" width="100" height="150" fill="url(#faceHalo)" />
      {ace ? (
        <>
          {/* As : médaillon doré perlé derrière le grand symbole. */}
          <Circle cx="50" cy="104" r="34" fill="none" stroke="url(#faceGold)" strokeWidth="1.6" />
          <Circle
            cx="50"
            cy="104"
            r="26"
            fill="none"
            stroke="url(#faceGold)"
            strokeWidth="0.6"
            opacity="0.8"
          />
          {ACE_PEARLS.map(({ cx, cy }) => (
            <Circle key={`${cx}-${cy}`} cx={cx} cy={cy} r="1.1" fill="url(#faceGold)" />
          ))}
        </>
      ) : null}
      {/* Cadre en dorure à chaud : filet principal puis filet fin intérieur. */}
      <Rect
        x="4.5"
        y="4.5"
        width="91"
        height="141"
        rx="5"
        fill="none"
        stroke="url(#faceGold)"
        strokeWidth="1.1"
      />
      <Rect
        x="6.6"
        y="6.6"
        width="86.8"
        height="136.8"
        rx="3.6"
        fill="none"
        stroke="url(#faceGold)"
        strokeWidth="0.35"
        opacity="0.8"
      />
      {FACE_FLOURISH_CORNERS.map((transform) => (
        <Path
          key={transform}
          d={FACE_FLOURISH}
          fill="none"
          stroke="url(#faceGold)"
          strokeWidth="0.8"
          strokeLinecap="round"
          transform={transform}
        />
      ))}
      <Rect x="0" y="0" width="100" height="150" fill="url(#faceSheen)" />
      {/* Biseau : arête claire en haut et à gauche, arête ombrée en bas et à droite. */}
      <Path
        d="M1.6 146 V8 Q1.6 1.6 8 1.6 H92"
        fill="none"
        stroke="#FFFFFF"
        strokeWidth="1.8"
        opacity="0.95"
      />
      <Path
        d="M98.4 4 V142 Q98.4 148.4 92 148.4 H6"
        fill="none"
        stroke="#8D7C5C"
        strokeWidth="1.4"
        opacity="0.4"
      />
    </Svg>
  );
}

/**
 * Face visible, modèle de la planche de référence. Les dimensions viennent de l'appelant
 * (`width`, hauteur = largeur × 1,5) ; positions, rotations, éventails et animations restent
 * ceux des composants appelants. Dans une main chevauchée, seul le coin reste visible ; la
 * dernière carte montre aussi son grand symbole. Mémoïsée : une mise à jour de la partie ne
 * redessine pas les cartes inchangées (même carte, même taille, même placement).
 */
export const CardFace = memo(function CardFace({
  cardId,
  width,
  style,
}: {
  cardId: string;
  width: number;
  style?: StyleProp<ViewStyle>;
}) {
  const { value, ace, symbol, color } = parse(cardId);
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
      <FaceBackground width={width} height={height} accent={color} ace={ace} />
      <View
        testID="card-corner"
        style={[styles.corner, { top: width * FACE_CORNER.top, left: width * FACE_CORNER.left }]}
      >
        <Text
          allowFontScaling={false}
          style={[
            styles.value,
            fontOf(fonts.button),
            ink(width),
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
            ink(width),
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
            ink(width),
            { color: pipColor, fontSize: centerSize, lineHeight: centerText.lineHeight },
            centerGlyph,
          ]}
        >
          {symbol}
        </Text>
      </View>
    </View>
  );
});

/**
 * Monogramme « L » du dos (repère 100 × 150) : lettre à empattements dessinée en tracé, partie
 * intégrante du dos, jamais un texte posé sur la carte.
 */
export const BACK_LETTER =
  'M27 28 H57 V36 H50 V104 H70 V95 H78 V122 H27 V114 H34 V36 H27 Z';

/** Monogramme réduit et centré dans le médaillon du dos (le tracé `BACK_LETTER` est inchangé). */
const BACK_LETTER_FIT = 'translate(50 75) scale(0.6) translate(-52.5 -75)';

/** Éventail d'un coin du dos (repère : le coin en 0,0, vers +x +y) : deux arcs et trois rayons. */
const BACK_FAN = 'M0 7 A7 7 0 0 0 7 0 M0 11 A11 11 0 0 0 11 0 M0 0 L9.5 5.5 M0 0 L7.8 7.8 M0 0 L5.5 9.5';
const BACK_CORNERS = [
  'translate(14 14)',
  'translate(86 14) scale(-1 1)',
  'translate(14 136) scale(1 -1)',
  'translate(86 136) scale(-1 -1)',
];

/** Soleil du médaillon : 24 rayons du centre vers le filet intérieur (ellipse 23 × 36). */
const BACK_RAYS = Array.from({ length: 24 }, (_, i) => {
  const a = (i * 15 * Math.PI) / 180;
  const x = (r: number) => (50 + 23 * r * Math.cos(a)).toFixed(2);
  const y = (r: number) => (75 + 36 * r * Math.sin(a)).toFixed(2);
  return `M${x(0.3)} ${y(0.3)} L${x(0.94)} ${y(0.94)}`;
}).join(' ');

/**
 * Dos de carte Le Ter (nouveau design) : bordure ivoire, champ bordeaux profond tramé d'un
 * treillis Art déco doré, double filet doré, médaillon ovale et monogramme « L » doré en
 * relief. Aucune valeur ni famille n'y figure (main cachée).
 */
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
            <Stop offset="0" stopColor="#9A2436" />
            <Stop offset="0.55" stopColor="#6A1424" />
            <Stop offset="1" stopColor="#3E0912" />
          </LinearGradient>
          <Pattern id="backWeave" width="10" height="10" patternUnits="userSpaceOnUse">
            <Path d="M5 0 L10 5 L5 10 L0 5 Z" fill="none" stroke="#E2C27A" strokeWidth="0.7" />
            <Circle cx="5" cy="5" r="0.9" fill="#E2C27A" />
          </Pattern>
          <LinearGradient id="backLetter" x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0" stopColor="#FBE7A6" />
            <Stop offset="0.5" stopColor="#E2B85A" />
            <Stop offset="1" stopColor="#B4842E" />
          </LinearGradient>
          <LinearGradient id="backSheen" x1="0" y1="0" x2="1" y2="1">
            <Stop offset="0" stopColor="#FFFFFF" stopOpacity="0.22" />
            <Stop offset="0.4" stopColor="#FFFFFF" stopOpacity="0" />
            <Stop offset="1" stopColor="#000000" stopOpacity="0.18" />
          </LinearGradient>
        </Defs>
        {/* Bordure ivoire et contour champagne. */}
        <Rect x="0.75" y="0.75" width="98.5" height="148.5" rx="8" fill="#F6EFDF" stroke="#B9A77F" strokeWidth="1.5" />
        {/* Champ bordeaux tramé (dégradé + treillis doré). */}
        <Rect x="6" y="6" width="88" height="138" rx="5" fill="url(#backFill)" />
        <Rect x="6" y="6" width="88" height="138" rx="5" fill="url(#backWeave)" opacity="0.32" />
        {/* Double filet doré. */}
        <Rect x="10" y="10" width="80" height="130" rx="3.5" fill="none" stroke="#E2C27A" strokeWidth="1.3" opacity="0.9" />
        <Rect x="13" y="13" width="74" height="124" rx="2.5" fill="none" stroke="#E2C27A" strokeWidth="0.5" opacity="0.6" />
        {/* Éventails Art déco dans les quatre coins du cadre. */}
        {BACK_CORNERS.map((transform) => (
          <Path key={transform} d={BACK_FAN} fill="none" stroke="#E2C27A" strokeWidth="0.7" opacity="0.75" transform={transform} />
        ))}
        {/* Médaillon ovale : fond sombre cerclé d'or, soleil de rayons, losanges aux pôles. */}
        <Ellipse cx="50" cy="75" rx="27" ry="40" fill="#3A0811" stroke="#E2C27A" strokeWidth="1.8" />
        <Path d={BACK_RAYS} stroke="#E2C27A" strokeWidth="0.55" opacity="0.4" />
        <Ellipse cx="50" cy="75" rx="23" ry="36" fill="none" stroke="#E2C27A" strokeWidth="0.5" opacity="0.7" />
        <Path d="M50 29 L54 35 L50 41 L46 35 Z" fill="#E2C27A" />
        <Path d="M50 109 L54 115 L50 121 L46 115 Z" fill="#E2C27A" />
        {/* « L » : ombre portée puis lettre dorée cernée. */}
        <Path d={BACK_LETTER} fill="#12030A" transform={`translate(1.5 2) ${BACK_LETTER_FIT}`} opacity="0.7" />
        <Path
          d={BACK_LETTER}
          fill="url(#backLetter)"
          stroke="#5A3A10"
          strokeWidth="2.2"
          strokeLinejoin="round"
          transform={BACK_LETTER_FIT}
        />
        {/* Reflet satiné sur tout le dos (vernis). */}
        <Rect x="0.75" y="0.75" width="98.5" height="148.5" rx="8" fill="url(#backSheen)" />
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
    // Ivoire (couleur de repli sous le dégradé texturé de FaceBackground).
    backgroundColor: '#F8F3E7',
    // Tranche fine champagne ; le biseau du fond donne le relief.
    borderColor: '#B9A47A',
    // Trois ombres : contact net, épaisseur du carton, ombre portée douce sur le feutre.
    boxShadow:
      '0 1px 1px rgba(0, 0, 0, 0.35), 0 3px 5px rgba(0, 0, 0, 0.22), 0 9px 16px rgba(0, 0, 0, 0.24)',
  },
  back: {
    overflow: 'hidden',
    boxShadow: '0 1px 1px rgba(0, 0, 0, 0.4), 0 4px 9px rgba(0, 0, 0, 0.35)',
  },
  corner: { position: 'absolute', alignItems: 'center' },
  center: { position: 'absolute', left: 0, right: 0, alignItems: 'center' },
  value: {
    includeFontPadding: false,
    textAlign: 'center',
    fontWeight: '900',
  },
  pip: { includeFontPadding: false, textAlign: 'center', marginTop: -1 },
});
