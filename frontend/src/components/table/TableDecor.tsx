import { Cinzel_700Bold } from '@expo-google-fonts/cinzel';
import { Rajdhani_700Bold } from '@expo-google-fonts/rajdhani';
import { loadAsync, useFonts } from 'expo-font';
import type { ReactNode } from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
  type PressableProps,
  type StyleProp,
  type TextStyle,
  type ViewStyle,
} from 'react-native';

import { gameTheme, salon } from '../../constants/theme';
import { playSound } from '../../services/audio-service';

/**
 * Identité visuelle des écrans autour du jeu (connexion, accueil, tournois…), « Ébène &
 * Laiton » déclinée en salon (`salon`, constants/theme) : pièce vert nuit éclairée d'en haut,
 * feutre émeraude cerclé de noyer et de laiton, cartes décoratives ébène, bouton principal en
 * laiton. Un seul jeu de couleurs et de formes pour tous les écrans.
 *
 * `gold`, `cream` et `error` gardent leurs valeurs : la table de jeu les emploie aussi.
 */
export const tablePalette = {
  backdrop: salon.backdrop,
  cream: '#F7F1E1',
  gold: '#F2C451',
  goldDeep: gameTheme.brass.deep,
  /** Accent et statut « en cours » sur fond sombre (jade lisible). */
  teal: gameTheme.self,
  error: '#FFB3A6',
  /** Actions secondaires des panneaux (Modifier, Créer, ON…) : laque émeraude. */
  jade: gameTheme.emerald.main,
  /** Départ, refus, suppression : sang-de-bœuf. */
  danger: gameTheme.oxblood.main,
  /** Surfaces sombres posées sur le fond (HUD, panneaux). */
  panel: salon.surface.fill,
  panelBorder: salon.surface.border,
} as const;

/**
 * Initiale de la marque Le Ter, la SEULE source du monogramme visuel : table en bois, dos de
 * carte, jeton de monnaie, emblèmes. Purement graphique (aucun identifiant, aucune donnée).
 */
export const BRAND_INITIAL = 'L';

export interface TableFonts {
  /** Cinzel : titres « gravés » (Connexion, Choisis ton mode !, pseudo du HUD). */
  title?: string;
  /** Rajdhani : boutons, libellés, titres de panneaux. */
  button?: string;
}

const TABLE_FONT_FILES = { Cinzel_700Bold, Rajdhani_700Bold };

/**
 * Chargement lancé au démarrage (racine), en parallèle de la restauration de la session : le
 * premier écran s'affiche directement avec ses polices, au lieu d'un texte en police système
 * qui change de largeur une fois les polices prêtes. Un échec garde la police de repli.
 */
export function preloadTableFonts(): Promise<void> {
  return loadAsync(TABLE_FONT_FILES).catch(() => undefined);
}

/** Tant que les polices chargent (ou si elles échouent), la police système prend le relais. */
export function useTableFonts(): TableFonts {
  const [fontsLoaded] = useFonts(TABLE_FONT_FILES);
  return fontsLoaded ? { title: 'Cinzel_700Bold', button: 'Rajdhani_700Bold' } : {};
}

/** Polices prêtes, ou définitivement en échec (la police de repli est alors gardée). */
export function useTableFontsSettled(): boolean {
  const [fontsLoaded, fontError] = useFonts(TABLE_FONT_FILES);
  return fontsLoaded || fontError != null;
}

/** Police et graisse de repli : la graisse n'est forcée que sur la police système. */
export function fontOf(family: string | undefined): TextStyle {
  return { fontFamily: family, fontWeight: family ? undefined : '800' };
}

/** Fond plein écran : la pièce vert nuit, éclairée d'en haut, frise de laiton en filigrane. */
export function TableBackdrop({ children }: { children: ReactNode }) {
  return (
    <View style={styles.root}>
      <View style={[StyleSheet.absoluteFill, styles.passThrough, styles.vignette]} />
      {children}
    </View>
  );
}

/**
 * Cercle de feutre émeraude, cerclé de noyer incrusté de laiton (comme la table de jeu).
 * - `classic` : feutre profond et anneau épais (connexion) ;
 * - `bright` : feutre éclairé, anneau fin et emblème L gravé (tournois) ;
 * - `deep` : feutre profond, anneau fin et emblème L gravé (boutique).
 */
export function FeltCircle({
  diameter,
  ring,
  variant = 'classic',
  fontFamily,
}: {
  diameter: number;
  ring: number;
  variant?: 'classic' | 'bright' | 'deep';
  fontFamily?: string;
}) {
  const felt = diameter - ring * 2;
  const bright = variant === 'bright';
  const emblem = variant !== 'classic';
  const innerLine = Math.round(felt * (emblem ? 0.5 : 0.8));
  return (
    <View
      style={[
        styles.ring,
        emblem && styles.ringBright,
        {
          width: diameter,
          height: diameter,
          borderRadius: diameter / 2,
          // Pas de halo orangé : la table est posée dans la pénombre, éclairée d'en haut.
          boxShadow: `0 ${Math.round(diameter * 0.04)}px ${Math.round(diameter * 0.1)}px rgba(0, 0, 0, 0.6), 0 0 ${Math.round(diameter * 0.12)}px rgba(214, 178, 94, 0.12)`,
        },
      ]}
    >
      <View
        style={[
          styles.felt,
          bright && styles.feltBright,
          { width: felt, height: felt, borderRadius: felt / 2 },
        ]}
      >
        <View
          style={[
            styles.feltLine,
            emblem && [styles.emblem, { borderWidth: Math.max(2, felt * 0.035) }],
            { width: innerLine, height: innerLine, borderRadius: innerLine / 2 },
          ]}
        >
          {emblem ? (
            <Text
              allowFontScaling={false}
              style={[styles.emblemLetter, fontOf(fontFamily), { fontSize: innerLine * 0.62 }]}
            >
              {BRAND_INITIAL}
            </Text>
          ) : null}
        </View>
      </View>
    </View>
  );
}

/** Éventail de trois cartes de chaque côté, posé sur le bord bas, sans jamais toucher le centre. */
const FAN = [
  { shift: 0.9, rotate: 16, lift: 0.1 },
  { shift: 0.45, rotate: 9, lift: 0.05 },
  { shift: 0, rotate: 4, lift: 0 },
] as const;

/**
 * Cartes décoratives des deux côtés de l'écran. `sideSpace` est la largeur libre entre un bord
 * de l'écran et le contenu central : la carte de devant s'arrête avant lui.
 */
export function DecorativeCards({
  cardWidth,
  sideSpace,
  fontFamily,
}: {
  cardWidth: number;
  sideSpace: number;
  fontFamily?: string;
}) {
  const cardHeight = cardWidth * 1.36;
  // Bord intérieur de la carte de devant, avec un écart au centre qui absorbe sa rotation.
  const front = sideSpace - cardWidth - Math.max(sideSpace * 0.1, 8);
  return (
    <View
      style={[StyleSheet.absoluteFill, styles.passThrough]}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      {FAN.map(({ shift, rotate, lift }) => {
        const bottom = -cardHeight * 0.14 + cardHeight * lift;
        const offset = front - cardWidth * shift;
        return [
          <TatamiCard
            key={`l${shift}`}
            width={cardWidth}
            fontFamily={fontFamily}
            style={{ left: offset, bottom, transform: [{ rotate: `-${rotate}deg` }] }}
          />,
          <TatamiCard
            key={`r${shift}`}
            width={cardWidth}
            fontFamily={fontFamily}
            style={{ right: offset, bottom, transform: [{ rotate: `${rotate}deg` }] }}
          />,
        ];
      })}
    </View>
  );
}

/**
 * Dos de carte décoratif Le Ter (laque ébène, cadre et médaillon L en laiton). Positionné en absolu.
 * `letter` et `medallionRatio` : autre lettre, médaillon agrandi pour rester lisible sur une
 * petite carte (cartes L E T E R de la connexion) ; par défaut, le dos habituel.
 */
export function TatamiCard({
  width,
  fontFamily,
  style,
  letter = BRAND_INITIAL,
  medallionRatio = 0.46,
}: {
  width: number;
  fontFamily?: string;
  style: StyleProp<ViewStyle>;
  letter?: string;
  medallionRatio?: number;
}) {
  const radius = width * 0.08;
  const diamond = Math.max(5, width * 0.08);
  const medallion = width * medallionRatio;
  const diamondStyle = { width: diamond, height: diamond, margin: -diamond / 2 };
  return (
    <View
      style={[
        styles.card,
        {
          width,
          height: width * 1.36,
          borderRadius: radius,
          borderWidth: Math.max(2, width * 0.025),
          padding: width * 0.07,
        },
        style,
      ]}
    >
      <View
        style={[
          styles.cardFrame,
          { borderRadius: radius * 0.6, borderWidth: Math.max(1, width * 0.012) },
        ]}
      >
        <View style={[styles.diamond, diamondStyle, { top: 0, left: '50%' }]} />
        <View style={[styles.diamond, diamondStyle, { bottom: 0, left: '50%' }]} />
        <View style={[styles.diamond, diamondStyle, { left: 0, top: '50%' }]} />
        <View style={[styles.diamond, diamondStyle, { right: 0, top: '50%' }]} />
        <View
          style={[
            styles.medallion,
            {
              width: medallion,
              height: medallion,
              borderRadius: medallion / 2,
              borderWidth: Math.max(1.5, width * 0.025),
            },
          ]}
        >
          <Text
            style={[styles.cardLetter, { fontSize: medallion * 0.62, fontFamily }]}
            allowFontScaling={false}
          >
            {letter}
          </Text>
        </View>
      </View>
    </View>
  );
}

/** Bouton pilule de l'action principale d'un écran : laiton, texte ébène. */
export function PillButton({
  title,
  onPress,
  height,
  fontSize,
  fontFamily,
  loading = false,
  disabled = false,
  accessibilityLabel,
  style,
  hitSlop,
}: {
  title: string;
  onPress: () => void;
  height: number;
  fontSize: number;
  fontFamily?: string;
  loading?: boolean;
  disabled?: boolean;
  accessibilityLabel?: string;
  style?: StyleProp<ViewStyle>;
  /** Zone d'appui élargie au-delà du bouton (bouton compact, toujours facile à toucher). */
  hitSlop?: PressableProps['hitSlop'];
}) {
  const inactive = disabled || loading;
  return (
    <Pressable
      onPress={() => {
        onPress();
        playSound('uiClick');
      }}
      disabled={inactive}
      hitSlop={hitSlop}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? title}
      accessibilityState={{ disabled: inactive, busy: loading }}
      style={({ pressed }) => [
        styles.button,
        { height, borderRadius: height / 2 },
        style,
        pressed && styles.buttonPressed,
        inactive && styles.inactive,
      ]}
    >
      {loading ? (
        <ActivityIndicator color={salon.ink} />
      ) : (
        <Text numberOfLines={1} style={[styles.buttonText, fontOf(fontFamily), { fontSize }]}>
          {title}
        </Text>
      )}
    </Pressable>
  );
}

/** Ombre portée commune aux titres posés sur le fond. */
export const titleShadow: TextStyle = {
  textShadowColor: 'rgba(0, 0, 0, 0.6)',
  textShadowOffset: { width: 0, height: 2 },
  textShadowRadius: 4,
};

const styles = StyleSheet.create({
  root: {
    flex: 1,
    overflow: 'hidden',
    backgroundColor: salon.backdrop,
    experimental_backgroundImage: salon.backdropLight,
  },
  // Frise de laiton à peine visible en bas de la pièce, et bords assombris.
  vignette: {
    experimental_backgroundImage:
      'linear-gradient(180deg, rgba(0, 0, 0, 0) 62%, rgba(214, 178, 94, 0.05) 86%, rgba(0, 0, 0, 0.35) 100%)',
  },
  passThrough: { pointerEvents: 'none' },
  // Noyer incrusté d'un filet de laiton, comme le plateau de la table de jeu.
  ring: {
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: gameTheme.rim.base,
    experimental_backgroundImage: gameTheme.rim.wood,
    borderWidth: 1.5,
    borderColor: gameTheme.brass.line,
  },
  ringBright: { borderColor: gameTheme.brass.main },
  felt: {
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: gameTheme.felt.base,
    experimental_backgroundImage: gameTheme.felt.surface,
    borderWidth: 1,
    borderColor: gameTheme.brass.hairline,
    boxShadow: `inset 0 0 22px 4px ${gameTheme.felt.shade}`,
  },
  feltBright: {
    experimental_backgroundImage:
      'radial-gradient(circle at 50% 34%, #33A274 0%, #23805A 36%, #16613F 70%, #0C452C 100%)',
  },
  feltLine: { borderWidth: 1, borderColor: gameTheme.brass.faint },
  emblem: { alignItems: 'center', justifyContent: 'center', borderColor: gameTheme.brass.hairline },
  emblemLetter: { color: 'rgba(214, 178, 94, 0.32)', includeFontPadding: false },
  card: {
    position: 'absolute',
    borderColor: gameTheme.brass.deep,
    backgroundColor: gameTheme.lacquer.solid,
    experimental_backgroundImage: 'linear-gradient(160deg, #1D2C27 0%, #0E1815 50%, #060B09 100%)',
    boxShadow: gameTheme.shadow.panel,
  },
  cardFrame: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    borderColor: gameTheme.brass.line,
  },
  diamond: {
    position: 'absolute',
    backgroundColor: gameTheme.brass.main,
    transform: [{ rotate: '45deg' }],
  },
  medallion: {
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#0A1210',
    borderColor: gameTheme.brass.main,
  },
  cardLetter: { color: gameTheme.brass.bright, fontWeight: '700', includeFontPadding: false },
  button: {
    width: '100%',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 16,
    borderWidth: 1,
    borderColor: salon.brass.border,
    backgroundColor: salon.brass.fill,
    experimental_backgroundImage: salon.brass.gradient,
    boxShadow: '0 4px 10px rgba(0, 0, 0, 0.45), inset 0 1px 0 rgba(255, 244, 205, 0.55)',
  },
  buttonPressed: { opacity: 0.88, transform: [{ scale: 0.98 }] },
  inactive: { opacity: 0.5 },
  buttonText: { color: salon.ink, letterSpacing: 0.8 },
});
